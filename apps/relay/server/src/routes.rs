//! The HTTP routes: the paths the Next routes served, behind Caddy's `/relay` prefix.
//! Ported from apps/web/src/app/api/{pdf-proxy,html-proxy,semantic-scholar,arxiv,fetch-url,url-meta,sdk/{whoami,projects,experiments,metrics},report-issue,plan/feed}/route.ts.

use std::sync::Arc;
use std::time::Instant;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::response::Response;
use axum::routing::{get, post};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use reqwest::Url;
use serde_json::json;
use tower_http::cors::{AllowOrigin, CorsLayer};
use wf_relay::fetch::remote::{fetch_image_status_via, fetch_title_status_via};
use wf_relay::fetch::safe::PublicNetwork;
use wf_relay::relay::arxiv::{ARXIV_PROXY_PATH, proxy_arxiv};
use wf_relay::relay::html::{HTML_PROXY_PATH, proxy_html};
use wf_relay::relay::pdf::{PDF_PROXY_PATH, is_allowed_pdf_proxy_url, proxy_pdf};
use wf_relay::relay::route::RelayConfig;
use wf_relay::relay::semantic_scholar::proxy_semantic_scholar;
use wf_relay::relay::shared::{Answer, RelayRequest, refuse};

use crate::auth::require_user;
use crate::blob_routes::{self, UPLOAD_BODY_LIMIT};
use crate::config::Config;
use crate::limiter::RateLimiter;
use crate::org_routes;
use crate::sdk;
use crate::sdk_artifacts::{self, ARTIFACT_BODY_LIMIT};
use crate::sdk_metrics;
use crate::settings::SettingsConfig;
use crate::storage::StorageConfig;
use crate::url_meta::{MetaUpstreams, url_meta};
use crate::{
    account, admin_users, credentials, mcp_relay, overleaf_connections, overleaf_reports,
    overleaf_workshop, plan_feed, report_issue, settings_routes, zotero_collections,
};

const FETCH_URL_PATH: &str = "/api/fetch-url";
/// Same caching as the Next.js arXiv route on success.
const ARXIV_CACHE_CONTROL: &str =
    "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";
const URL_META_PATH: &str = "/api/url-meta";
const SEMANTIC_SCHOLAR_ROUTE: &str = "/api/semantic-scholar/{*path}";

/// What every handler shares: the config, the HTTP client, upstreams and the two budgets.
pub struct AppState {
    /// Settings read from the environment.
    pub config: Config,
    /// The client every upstream fetch goes through.
    pub client: reqwest::Client,
    /// Upstream addresses and timeouts for the relays.
    pub relay: RelayConfig,
    /// Upstream addresses for paper metadata.
    pub upstreams: MetaUpstreams,
    /// Per-user budget for uncached HTML pages.
    pub pages: RateLimiter,
    /// Per-user budget for pasted-link image fetches.
    pub pastes: RateLimiter,
    /// Tiered blob storage: provider switch, object stores and the view-token secret.
    pub storage: StorageConfig,
    /// MCP switch and the credential-sealing key for `/api/settings/*`.
    pub settings: SettingsConfig,
}

/// The router: every route, with CORS for the configured origins.
pub fn app(state: Arc<AppState>) -> Router {
    let cors = cors_layer(&state.config.allowed_origins);
    Router::new()
        .route("/healthz", get(healthz))
        .route(PDF_PROXY_PATH, get(pdf_proxy))
        .route(HTML_PROXY_PATH, get(html_proxy))
        .route(
            SEMANTIC_SCHOLAR_ROUTE,
            get(semantic_scholar).post(semantic_scholar),
        )
        .route(ARXIV_PROXY_PATH, get(arxiv))
        .route(FETCH_URL_PATH, get(fetch_url))
        .route(URL_META_PATH, get(url_meta_route))
        .route("/api/sdk/whoami", get(sdk::whoami))
        .route("/api/sdk/projects", get(sdk::projects))
        .route(
            "/api/sdk/experiments",
            get(sdk::experiments_get)
                .post(sdk::experiments_post)
                .delete(sdk::experiments_delete),
        )
        .route(
            "/api/sdk/metrics",
            post(sdk_metrics::metrics_post).delete(sdk_metrics::metrics_delete),
        )
        .route(
            "/api/org/codes",
            get(org_routes::codes_get).post(org_routes::codes_post),
        )
        .route("/api/org/create", post(org_routes::create))
        .route("/api/org/join", post(org_routes::join))
        .route("/api/org/leave", post(org_routes::leave))
        .route("/api/org/switch", post(org_routes::switch))
        .route("/api/org/standalone", post(org_routes::standalone))
        .route("/api/org/memberships", get(org_routes::memberships))
        .route("/api/org/mine", get(org_routes::mine))
        .route("/api/blobs/content", get(blob_routes::content))
        .route("/api/blobs/remove", post(blob_routes::remove))
        .route("/api/blobs/signed-urls", post(blob_routes::signed_urls))
        .route(
            "/api/blobs/upload",
            post(blob_routes::upload).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route(
            "/api/sdk/artifacts",
            post(sdk_artifacts::artifacts_post).layer(DefaultBodyLimit::max(ARTIFACT_BODY_LIMIT)),
        )
        .route(
            "/api/settings/api-tokens",
            get(settings_routes::api_tokens_get)
                .post(settings_routes::api_tokens_post)
                .delete(settings_routes::api_tokens_delete),
        )
        .route(
            "/api/settings/mcp-tokens",
            get(settings_routes::mcp_tokens_get)
                .post(settings_routes::mcp_tokens_post)
                .delete(settings_routes::mcp_tokens_delete),
        )
        .route(
            "/api/settings/credentials",
            get(credentials::credentials_get).post(credentials::credentials_post),
        )
        .route("/api/report-issue", post(report_issue::report_issue))
        .route("/api/plan/feed/{token}/{file}", get(plan_feed::plan_feed))
        .merge(account_routes())
        .merge(integration_routes())
        .layer(cors)
        .with_state(state)
}

/// Account deletion and admin user creation.
fn account_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/account/delete-user", post(account::delete_user))
        .route(
            "/api/account/delete-user/otp",
            post(account::delete_user_otp),
        )
        .route("/api/admin/create-user", post(admin_users::create_user))
}

/// Overleaf links, Zotero collections and the MCP relay.
fn integration_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/overleaf/connections",
            get(overleaf_connections::connections_get)
                .post(overleaf_connections::connections_post)
                .delete(overleaf_connections::connections_delete),
        )
        .route(
            "/api/overleaf/reports",
            get(overleaf_reports::reports_get)
                .post(overleaf_reports::reports_post)
                .patch(overleaf_reports::reports_patch)
                .delete(overleaf_reports::reports_delete),
        )
        .route(
            "/api/integrations/zotero/collections",
            post(zotero_collections::collections_post),
        )
        .route(
            "/api/mcp",
            get(mcp_relay::mcp_get).post(mcp_relay::mcp_post),
        )
        .route(
            "/api/mcp/relay",
            get(mcp_relay::relay_get)
                .post(mcp_relay::relay_post)
                .patch(mcp_relay::relay_patch),
        )
        .route("/api/mcp/relay/browser", get(mcp_relay::browser_get))
        .route(
            "/api/overleaf/workshop/session",
            post(overleaf_workshop::session_post).delete(overleaf_workshop::session_delete),
        )
        .route(
            "/api/overleaf/workshop/projects",
            post(overleaf_workshop::projects_post),
        )
        .route(
            "/api/overleaf/workshop/compile",
            post(overleaf_workshop::compile_post),
        )
        .route(
            "/api/overleaf/workshop/pdf",
            post(overleaf_workshop::pdf_post),
        )
}

fn cors_layer(origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|origin| HeaderValue::try_from(origin.as_str()).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        // x-api-key carries the user's own Semantic Scholar key, forwarded upstream.
        .allow_headers([
            AUTHORIZATION,
            CONTENT_TYPE,
            HeaderName::from_static("x-api-key"),
        ])
        // x-final-url names the page after redirects in html-proxy replies.
        .expose_headers([RETRY_AFTER, HeaderName::from_static("x-final-url")])
}

async fn healthz() -> &'static str {
    "ok"
}

async fn pdf_proxy(State(state): State<Arc<AppState>>, headers: HeaderMap, uri: Uri) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return *response;
    }
    let Some(url) = app_url(PDF_PROXY_PATH, uri.query()) else {
        return refused(400, BAD_ADDRESS);
    };
    answer_response(proxy_pdf(&state.client, &url).await)
}

async fn html_proxy(State(state): State<Arc<AppState>>, headers: HeaderMap, uri: Uri) -> Response {
    let user = match authorize(&state, &headers).await {
        Ok(user) => user,
        Err(response) => return *response,
    };
    let Some(url) = app_url(HTML_PROXY_PATH, uri.query()) else {
        return refused(400, BAD_ADDRESS);
    };
    let Some(target) = query_value(&url, "url").filter(|t| !t.is_empty()) else {
        return refused(400, "url is required");
    };
    if !is_allowed_pdf_proxy_url(&target)
        && let Err(retry_after) = state.pages.take(&user, Instant::now())
    {
        let message = "Too many pages fetched. Try again shortly.";
        return too_many(message, retry_after);
    }
    answer_response(proxy_html(&state.client, &url).await)
}

async fn semantic_scholar(
    State(state): State<Arc<AppState>>,
    method: Method,
    headers: HeaderMap,
    uri: Uri,
    body: Bytes,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return *response;
    }
    let Some(url) = app_url(uri.path(), uri.query()) else {
        return refused(400, BAD_ADDRESS);
    };
    let request = RelayRequest {
        method: method.as_str().to_string(),
        url,
        headers,
        body: body.to_vec(),
    };
    let relay = &state.relay;
    let answer = proxy_semantic_scholar(
        &state.client,
        &request,
        &relay.semantic_scholar,
        relay.semantic_scholar_timeout,
        relay.retry_unit,
    )
    .await;
    answer_response(answer)
}

async fn arxiv(State(state): State<Arc<AppState>>, uri: Uri) -> Response {
    let Some(url) = app_url(ARXIV_PROXY_PATH, uri.query()) else {
        return refused(400, BAD_ADDRESS);
    };
    let request = RelayRequest {
        method: "GET".to_string(),
        url,
        headers: HeaderMap::new(),
        body: Vec::new(),
    };
    let relay = &state.relay;
    let mut answer = proxy_arxiv(&state.client, &request, &relay.arxiv, relay.arxiv_timeout).await;
    let cache = if answer.status == 200 {
        ARXIV_CACHE_CONTROL
    } else {
        "no-store"
    };
    answer
        .headers
        .push(("cache-control".to_string(), cache.to_string()));
    answer_response(answer)
}

async fn fetch_url(State(state): State<Arc<AppState>>, headers: HeaderMap, uri: Uri) -> Response {
    let Some(url) = app_url(FETCH_URL_PATH, uri.query()) else {
        return refused(400, BAD_ADDRESS);
    };
    let Some(target) = query_value(&url, "url").filter(|t| !t.is_empty()) else {
        return refused(400, "url is required");
    };
    let kind = query_value(&url, "as").unwrap_or_else(|| "title".to_string());
    if kind != "title" && kind != "image" {
        return refused(400, "as must be title or image");
    }
    let user = match authorize(&state, &headers).await {
        Ok(user) => user,
        Err(response) => return *response,
    };
    if kind == "image" {
        if let Err(retry_after) = state.pastes.take(&user, Instant::now()) {
            let message = "Too many image fetches. Try again shortly.";
            return too_many(message, retry_after);
        }
        return answer_response(image_answer(&target).await);
    }
    answer_response(title_answer(&target).await)
}

async fn url_meta_route(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return *response;
    }
    let Some(url) = app_url(URL_META_PATH, uri.query()) else {
        return refused(400, BAD_ADDRESS);
    };
    let target = query_value(&url, "url");
    let (status, body) = url_meta(
        &state.client,
        &PublicNetwork,
        &state.upstreams,
        target.as_deref(),
    )
    .await;
    answer_response(json_answer(status, &body))
}

/// The page's title as `{title, url}`, or the fetch's own error status.
async fn title_answer(target: &str) -> Answer {
    match fetch_title_status_via(&PublicNetwork, target).await {
        Ok(reply) => json_answer(200, &json!({ "title": reply.title, "url": reply.url })),
        Err((status, message)) => Answer::from(refuse(status, &message)),
    }
}

/// The picture's bytes with the headers the page must see, or the fetch's own error status.
async fn image_answer(target: &str) -> Answer {
    let reply = match fetch_image_status_via(&PublicNetwork, target).await {
        Ok(reply) => reply,
        Err((status, message)) => return Answer::from(refuse(status, &message)),
    };
    let Ok(body) = STANDARD.decode(&reply.bytes) else {
        return Answer::from(refuse(502, "Upstream fetch failed"));
    };
    Answer {
        status: 200,
        headers: vec![
            ("content-type".to_string(), reply.content_type),
            ("content-length".to_string(), body.len().to_string()),
            (
                "content-security-policy".to_string(),
                "default-src 'none'; sandbox".to_string(),
            ),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
            ("content-disposition".to_string(), "inline".to_string()),
            (
                "cache-control".to_string(),
                "private, max-age=300".to_string(),
            ),
        ],
        body,
    }
}

const BAD_ADDRESS: &str = "Bad request address";

/// Checks the bearer token; the user id, or the refusal as a response.
async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<String, Box<Response>> {
    let authorization = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    require_user(&state.client, &state.config, authorization)
        .await
        .map_err(|e| Box::new(refused(e.status, &e.message)))
}

/// `app://localhost` plus the path and query, so the relays parse it as the desktop does.
fn app_url(path: &str, query: Option<&str>) -> Option<Url> {
    let mut text = format!("app://localhost{path}");
    if let Some(query) = query.filter(|q| !q.is_empty()) {
        text.push('?');
        text.push_str(query);
    }
    Url::parse(&text).ok()
}

/// The first value of query parameter `name`; None when absent.
fn query_value(url: &Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

fn json_answer(status: u16, value: &serde_json::Value) -> Answer {
    Answer {
        status,
        headers: vec![("content-type".to_string(), "application/json".to_string())],
        body: value.to_string().into_bytes(),
    }
}

fn refused(status: u16, message: &str) -> Response {
    answer_response(Answer::from(refuse(status, message)))
}

fn too_many(message: &str, retry_after: u64) -> Response {
    let mut answer = Answer::from(refuse(429, message));
    answer
        .headers
        .push(("retry-after".to_string(), retry_after.to_string()));
    answer_response(answer)
}

fn answer_response(answer: Answer) -> Response {
    let status = StatusCode::from_u16(answer.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = Response::new(Body::from(answer.body));
    *response.status_mut() = status;
    for (name, value) in answer.headers {
        if let (Ok(name), Ok(value)) = (HeaderName::try_from(name), HeaderValue::try_from(value)) {
            let _ = response.headers_mut().append(name, value);
        }
    }
    response
}

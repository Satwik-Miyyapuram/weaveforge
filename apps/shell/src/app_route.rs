//! Routes one `app://` request in the Electron order (`serveBundle` in apps/desktop/src/main.ts):
//! cached model weights, saved artifacts, the `/api/` relays, then the web export.
//! Saved artifacts are also served same-origin under `/artifacts/`, which Windows webviews need.

use std::path::PathBuf;

use tauri::http::request::Parts;

use crate::local_artifacts::{ARTIFACT_HOST, SAME_ORIGIN_PREFIX, serve_local_artifact};
use crate::model_cache::{UPSTREAM, model_path, serve_model_file};
use crate::protocol::{self, APP_HOSTS, Reply};
use crate::relay::route::{RelayConfig, answer_relay};
use crate::relay::shared::{Answer, RelayRequest};

/// Folders and clients the routes use, made once at startup.
pub struct AppRoutes {
    /// The static web export.
    pub web: PathBuf,
    /// Cached model weights (`<app data>/models`, as in Electron).
    pub models: PathBuf,
    /// Saved SDK uploads (`<app data>/artifacts`, as in Electron).
    pub artifacts: PathBuf,
    /// Follows redirects only within Hugging Face; None when it could not be built.
    pub model_client: Option<reqwest::Client>,
    /// Never follows redirects itself; None when it could not be built.
    pub relay_client: Option<reqwest::Client>,
    /// Relay upstreams and timeouts.
    pub relay_config: RelayConfig,
}

/// The host the page wrote: Windows webviews turn `app://x/` into `http://app.x/`.
#[must_use]
pub fn page_host(host: &str) -> &str {
    host.strip_prefix("app.").unwrap_or(host)
}

/// A status with no headers and no body.
fn bare(status: u16) -> Answer {
    Answer {
        status,
        headers: Vec::new(),
        body: Vec::new(),
    }
}

/// A protocol reply as an answer to the page.
#[must_use]
pub fn from_reply(reply: Reply) -> Answer {
    Answer {
        status: reply.status,
        headers: reply
            .headers
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
        body: reply.body,
    }
}

/// Runs disk work off the async threads; a lost task is a bare 500.
async fn blocking<F>(work: F) -> Answer
where
    F: FnOnce() -> Reply + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(reply) => from_reply(reply),
        Err(_) => bare(500),
    }
}

/// The request as a relay sees it, or None when its address does not parse.
fn relay_request(parts: &Parts, body: Vec<u8>) -> Option<RelayRequest> {
    Some(RelayRequest {
        method: parts.method.as_str().to_owned(),
        url: reqwest::Url::parse(&parts.uri.to_string()).ok()?,
        headers: parts.headers.clone(),
        body,
    })
}

/// The answer to one `app://` request.
pub async fn route(routes: &AppRoutes, request: tauri::http::Request<Vec<u8>>) -> Answer {
    let (parts, body) = request.into_parts();
    let host = parts.uri.host().unwrap_or_default().to_owned();
    let path = parts.uri.path().to_owned();
    let range = parts
        .headers
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    if let Some(file) = model_path(page_host(&host), &path) {
        let Some(client) = routes.model_client.as_ref() else {
            return bare(502);
        };
        let reply =
            serve_model_file(client, &routes.models, &file, UPSTREAM, range.as_deref()).await;
        return from_reply(reply);
    }
    if page_host(&host) == ARTIFACT_HOST {
        let root = routes.artifacts.clone();
        return blocking(move || serve_local_artifact(&root, &path)).await;
    }
    if !APP_HOSTS.contains(&host.as_str()) {
        return bare(404);
    }
    if let Some(rest) = path.strip_prefix(SAME_ORIGIN_PREFIX) {
        let (root, rest) = (routes.artifacts.clone(), format!("/{rest}"));
        return blocking(move || serve_local_artifact(&root, &rest)).await;
    }
    if path.starts_with("/api/")
        && let Some(client) = routes.relay_client.as_ref()
        && let Some(request) = relay_request(&parts, body)
        && let Some(answer) = answer_relay(client, &request, &routes.relay_config).await
    {
        return answer;
    }
    let web = routes.web.clone();
    let query = parts.uri.query().map(str::to_owned);
    blocking(move || {
        protocol::respond(&web, Some(&host), &path, query.as_deref(), range.as_deref())
    })
    .await
}

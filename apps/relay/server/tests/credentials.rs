//! Integration credentials routes and `clean_secrets`, over the HTTP router.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::credential_crypto::{AUTH_FAILED, MISSING_KEY, open, seal, seal_with_iv};
use wf_relay_server::credentials::clean_secrets;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const SETTINGS: &str = "/rest/v1/user_settings";
const PATH: &str = "/api/settings/credentials";
const KEY: &str = "test-key";
const IV: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where `a.b.c` is user `user-1`. The given routes win over the default.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]));
    serve(routes).await
}

fn keyed() -> SettingsConfig {
    SettingsConfig {
        mcp_enabled: true,
        credential_key: Some(KEY.to_string()),
        ..SettingsConfig::default()
    }
}

fn keyless() -> SettingsConfig {
    SettingsConfig::default()
}

fn state(up: &Upstream, settings: SettingsConfig) -> Arc<AppState> {
    let supabase = format!("http://127.0.0.1:{}", up.port);
    Arc::new(AppState {
        config: Config {
            data_url: format!("{supabase}/rest/v1"),
            supabase_url: supabase,
            anon_key: "anon".to_string(),
            service_role_key: "service".to_string(),
            jwt_secret: Some("secret".to_string()),
            allowed_origins: Vec::new(),
            bind: "127.0.0.1:0".parse().expect("addr"),
        },
        client: reqwest::Client::new(),
        relay: RelayConfig::production(),
        upstreams: MetaUpstreams::production(),
        pages: RateLimiter::new(PAGE_FETCH_LIMIT),
        pastes: RateLimiter::new(PASTE_FETCH_LIMIT),
        storage: StorageConfig::default(),
        settings,
    })
}

/// A request to the credentials route, with the session header when `auth` is set.
fn request(method: &str, body: &str, auth: bool) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(PATH);
    if auth {
        builder = builder.header("authorization", SESSION);
    }
    builder.body(Body::from(body.to_owned())).expect("request")
}

/// Sends `req` through the router; returns status, headers and the JSON body.
async fn call(
    up: &Upstream,
    settings: SettingsConfig,
    req: Request<Body>,
) -> (StatusCode, HeaderMap, Value) {
    let response = app(state(up, settings))
        .oneshot(req)
        .await
        .expect("router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    let value = serde_json::from_slice::<Value>(&bytes).expect("json body");
    (status, headers, value)
}

/// The requests the upstream saw whose target starts with `prefix`, in order.
fn calls(up: &Upstream, prefix: &str) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target.starts_with(prefix))
        .collect()
}

fn body_json(seen: &Seen) -> Value {
    serde_json::from_slice(&seen.body).expect("json body")
}

fn header(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .expect("header")
        .to_str()
        .expect("ascii")
        .to_string()
}

fn error_of(value: &Value) -> &str {
    value["error"].as_str().unwrap_or("")
}

/// A `user_settings` row whose sealed envelope is `plain` under `key`.
fn sealed_row(plain: &str, key: &str) -> Reply {
    let envelope = seal_with_iv(plain, Some(key), &IV).expect("seal");
    let rows = json!([{ "credentials_enc": envelope }]);
    json_reply(200, &rows.to_string())
}

#[test]
fn clean_secrets_trims_keys_and_drops_blanks() {
    let out = clean_secrets(&json!({
        "zoteroApiKey": "  k  ",
        "semanticScholarKey": "   ",
        "other": "x"
    }));
    assert_eq!(Value::Object(out), json!({"zoteroApiKey": "k"}));
}

#[test]
fn clean_secrets_drops_non_strings() {
    let out = clean_secrets(&json!({"zoteroApiKey": 5, "semanticScholarKey": null}));
    assert!(out.is_empty());
}

#[test]
fn clean_secrets_keeps_integration_values_untrimmed() {
    let out = clean_secrets(&json!({
        "integrations": {
            "p": {"a": " x ", "b": "  ", "c": 3},
            "q": {"d": ""},
            "r": "nope"
        }
    }));
    assert_eq!(
        Value::Object(out),
        json!({"integrations": {"p": {"a": " x "}}})
    );
}

#[test]
fn clean_secrets_drops_integrations_when_none_kept() {
    let out = clean_secrets(&json!({"integrations": {"q": {"d": " "}}, "zoteroApiKey": "z"}));
    assert_eq!(Value::Object(out), json!({"zoteroApiKey": "z"}));
    let not_object = clean_secrets(&json!({"integrations": "x"}));
    assert!(not_object.is_empty());
}

#[test]
fn clean_secrets_of_non_object_is_empty() {
    assert!(clean_secrets(&json!([1, 2])).is_empty());
    assert!(clean_secrets(&json!("x")).is_empty());
    assert!(clean_secrets(&Value::Null).is_empty());
}

#[tokio::test]
async fn get_without_auth_is_401_and_reads_nothing() {
    let up = upstream(vec![]).await;
    let (status, _, body) = call(&up, keyed(), request("GET", "", false)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Not authenticated.");
    assert!(calls(&up, SETTINGS).is_empty());
}

#[tokio::test]
async fn get_legacy_columns_are_cleaned_and_not_cached() {
    let row = r#"[{"zotero_api_key":" z ","semantic_scholar_key":null,"integrations":{"p":{"a":" x ","b":" "}}}]"#;
    let up = upstream(vec![(SETTINGS, vec![json_reply(200, row)])]).await;
    let (status, headers, body) = call(&up, keyless(), request("GET", "", true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"zoteroApiKey": "z", "integrations": {"p": {"a": " x "}}})
    );
    assert_eq!(header(&headers, "cache-control"), "no-store");
    let seen = calls(&up, SETTINGS);
    assert!(seen[0].target.contains("user_id=eq.user-1"));
}

#[tokio::test]
async fn get_decrypts_sealed_envelope() {
    let up = upstream(vec![(
        SETTINGS,
        vec![sealed_row(r#"{"zoteroApiKey":"abc"}"#, KEY)],
    )])
    .await;
    let (status, headers, body) = call(&up, keyed(), request("GET", "", true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"zoteroApiKey": "abc"}));
    assert_eq!(header(&headers, "cache-control"), "no-store");
}

#[tokio::test]
async fn get_with_no_key_configured_is_500() {
    let up = upstream(vec![(
        SETTINGS,
        vec![sealed_row(r#"{"zoteroApiKey":"abc"}"#, KEY)],
    )])
    .await;
    let (status, _, body) = call(&up, keyless(), request("GET", "", true)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(error_of(&body), MISSING_KEY);
}

#[tokio::test]
async fn get_with_wrong_key_is_500() {
    let up = upstream(vec![(
        SETTINGS,
        vec![sealed_row(r#"{"zoteroApiKey":"abc"}"#, KEY)],
    )])
    .await;
    let other = SettingsConfig {
        mcp_enabled: true,
        credential_key: Some("other".to_string()),
        ..SettingsConfig::default()
    };
    let (status, _, body) = call(&up, other, request("GET", "", true)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(error_of(&body), AUTH_FAILED);
}

#[tokio::test]
async fn get_with_non_json_plaintext_is_500() {
    let envelope = seal("not json", Some(KEY)).expect("seal");
    let row = json!([{ "credentials_enc": envelope }]);
    let up = upstream(vec![(SETTINGS, vec![json_reply(200, &row.to_string())])]).await;
    let (status, _, body) = call(&up, keyed(), request("GET", "", true)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(error_of(&body), "Stored credential is not valid JSON.");
}

#[tokio::test]
async fn get_with_no_row_is_empty_object() {
    let up = upstream(vec![(SETTINGS, vec![json_reply(200, "[]")])]).await;
    let (status, _, body) = call(&up, keyed(), request("GET", "", true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({}));
}

#[tokio::test]
async fn get_database_error_is_500() {
    let up = upstream(vec![(
        SETTINGS,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let (status, _, _) = call(&up, keyed(), request("GET", "", true)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn post_without_auth_is_401_and_writes_nothing() {
    let up = upstream(vec![(SETTINGS, vec![json_reply(201, "[]")])]).await;
    let (status, _, body) = call(&up, keyed(), request("POST", "{}", false)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Not authenticated.");
    assert!(calls(&up, SETTINGS).is_empty());
}

#[tokio::test]
async fn post_bad_json_is_400() {
    let up = upstream(vec![(SETTINGS, vec![json_reply(201, "[]")])]).await;
    let (status, _, body) = call(&up, keyed(), request("POST", "{", true)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error_of(&body).starts_with("Invalid JSON body: "));
    assert!(calls(&up, SETTINGS).is_empty());
}

#[tokio::test]
async fn post_array_body_is_400() {
    let up = upstream(vec![(SETTINGS, vec![json_reply(201, "[]")])]).await;
    let (status, _, body) = call(&up, keyed(), request("POST", "[]", true)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&body), "Body must be a JSON object.");
    assert!(calls(&up, SETTINGS).is_empty());
}

#[tokio::test]
async fn post_stores_sealed_secrets_and_clears_legacy_columns() {
    let up = upstream(vec![(SETTINGS, vec![json_reply(201, "[]")])]).await;
    let payload = r#"{"zoteroApiKey":"  abc  ","integrations":{"p":{"a":"x","b":" "}}}"#;
    let (status, headers, body) = call(&up, keyed(), request("POST", payload, true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"ok": true}));
    assert_eq!(header(&headers, "cache-control"), "no-store");

    let seen = calls(&up, SETTINGS);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert!(seen[0].target.contains("on_conflict=user_id"));
    let row = body_json(&seen[0]);
    assert_eq!(row["user_id"], "user-1");
    assert!(row["zotero_api_key"].is_null());
    assert!(row["semantic_scholar_key"].is_null());
    assert!(row["integrations"].is_null());
    assert!(row["updated_at"].is_string());
    let envelope = row["credentials_enc"].as_str().expect("envelope");
    let plain = open(envelope, Some(KEY)).expect("open");
    let stored: Value = serde_json::from_str(&plain).expect("json");
    assert_eq!(
        stored,
        json!({"zoteroApiKey": "abc", "integrations": {"p": {"a": "x"}}})
    );
}

#[tokio::test]
async fn post_empty_secrets_store_null_envelope() {
    let up = upstream(vec![(SETTINGS, vec![json_reply(201, "[]")])]).await;
    let (status, _, body) = call(&up, keyless(), request("POST", "{}", true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"ok": true}));
    let seen = calls(&up, SETTINGS);
    assert!(body_json(&seen[0])["credentials_enc"].is_null());
}

#[tokio::test]
async fn post_secrets_without_key_is_500_and_writes_nothing() {
    let up = upstream(vec![(SETTINGS, vec![json_reply(201, "[]")])]).await;
    let (status, _, body) = call(
        &up,
        keyless(),
        request("POST", r#"{"zoteroApiKey":"abc"}"#, true),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(error_of(&body), MISSING_KEY);
    assert!(calls(&up, SETTINGS).is_empty());
}

#[tokio::test]
async fn post_database_error_is_500() {
    let up = upstream(vec![(
        SETTINGS,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let (status, _, _) = call(&up, keyed(), request("POST", "{}", true)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

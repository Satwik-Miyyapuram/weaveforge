#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_core::storage::blob_access::MAX_BLOB_BYTES;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::sdk_artifacts::ARTIFACT_BODY_LIMIT;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const STORAGE: &str = "/storage/v1/object/experiment-artifacts/user-1/exp1/model.pt";
const ROUTE: &str = "/api/sdk/artifacts";
const MISSING: &str = "Body must include experimentId, name, dataBase64.";
const BAD_EXPERIMENT: &str = "experimentId must be a plain identifier with no path separators.";
const BAD_NAME: &str = "name must be 1-128 characters of letters, digits, dot, dash or underscore, with no path separators.";
const TOO_LARGE_REQUEST: &str = "Request body exceeds 33 MB.";
const TOO_LARGE_ARTIFACT: &str = "Artifact exceeds the 25 MB limit.";
const SERVER_FAULT: &str = "Something went wrong on the server.";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where `a.b.c` is user `user-1`, plus the given storage replies.
async fn upstream(storage: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = vec![(AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)])];
    routes.extend(storage);
    serve(routes).await
}

fn state(up: &Upstream) -> Arc<AppState> {
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
    })
}

/// A POST to the artifact route with the session header.
fn post(body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(ROUTE)
        .header("authorization", SESSION)
        .body(Body::from(body.to_owned()))
        .expect("request")
}

async fn send(up: &Upstream, request: Request<Body>) -> (StatusCode, Value) {
    let response = app(state(up))
        .oneshot(request)
        .await
        .expect("router is infallible");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    (status, serde_json::from_slice(&bytes).expect("json body"))
}

/// The answer to a body that must be refused before any storage call.
async fn refused(body: &str) -> (StatusCode, Value) {
    let up = upstream(vec![]).await;
    send(&up, post(body)).await
}

/// The requests the upstream saw on the storage API (not the user lookup).
fn storage_calls(up: &Upstream) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target.starts_with("/storage/"))
        .collect()
}

#[tokio::test]
async fn refuses_a_missing_token_before_anything_else() {
    let up = upstream(vec![]).await;
    let anonymous = Request::builder()
        .method("POST")
        .uri(ROUTE)
        .body(Body::from("not json"))
        .expect("request");
    let (status, value) = send(&up, anonymous).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Not authenticated."}));
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn refuses_a_declared_length_over_the_limit_before_reading() {
    let up = upstream(vec![]).await;
    let request = Request::builder()
        .method("POST")
        .uri(ROUTE)
        .header("authorization", SESSION)
        .header("content-length", "40000000")
        .body(Body::from("{}"))
        .expect("request");
    let (status, value) = send(&up, request).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(value, json!({"error": TOO_LARGE_REQUEST}));
    assert!(storage_calls(&up).is_empty());
}

#[tokio::test]
async fn refuses_a_body_that_is_not_json() {
    for body in ["not json", "", "null", "42", "\"text\""] {
        let (status, value) = refused(body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(value, json!({"error": "Invalid JSON body."}), "{body}");
    }
}

#[tokio::test]
async fn an_array_body_counts_as_an_object_with_no_fields() {
    let (status, value) = refused("[]").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": MISSING}));
}

#[tokio::test]
async fn refuses_missing_or_falsy_fields() {
    let cases = [
        r#"{"name":"model.pt","dataBase64":"aGk="}"#,
        r#"{"experimentId":"exp1","dataBase64":"aGk="}"#,
        r#"{"experimentId":"exp1","name":"model.pt"}"#,
        r#"{"experimentId":"","name":"model.pt","dataBase64":"aGk="}"#,
        r#"{"experimentId":null,"name":"model.pt","dataBase64":"aGk="}"#,
        r#"{"experimentId":"exp1","name":"model.pt","dataBase64":""}"#,
    ];
    for body in cases {
        let (status, value) = refused(body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(value, json!({"error": MISSING}), "{body}");
    }
}

#[tokio::test]
async fn refuses_an_unsafe_experiment_id() {
    let long = "a".repeat(129);
    for id in ["a/b", "..", ".", "a\\\\b", long.as_str()] {
        let body = format!(r#"{{"experimentId":"{id}","name":"model.pt","dataBase64":"aGk="}}"#);
        let (status, value) = refused(&body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{id}");
        assert_eq!(value, json!({"error": BAD_EXPERIMENT}), "{id}");
    }
    let (status, value) =
        refused(r#"{"experimentId":5,"name":"model.pt","dataBase64":"aGk="}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": BAD_EXPERIMENT}));
}

#[tokio::test]
async fn refuses_an_unsafe_name() {
    let long = "a".repeat(129);
    for name in ["../x", "a/b", "a b", long.as_str()] {
        let body = format!(r#"{{"experimentId":"exp1","name":"{name}","dataBase64":"aGk="}}"#);
        let (status, value) = refused(&body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{name}");
        assert_eq!(value, json!({"error": BAD_NAME}), "{name}");
    }
}

#[tokio::test]
async fn refuses_data_that_is_not_a_string() {
    let (status, value) =
        refused(r#"{"experimentId":"exp1","name":"model.pt","dataBase64":5}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "dataBase64 must be a string."}));
}

#[tokio::test]
async fn refuses_an_artifact_over_the_decoded_limit() {
    let up = upstream(vec![]).await;
    let data = "A".repeat(34_952_540);
    let body = format!(r#"{{"experimentId":"exp1","name":"model.pt","dataBase64":"{data}"}}"#);
    let (status, value) = send(&up, post(&body)).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(value, json!({"error": TOO_LARGE_ARTIFACT}));
    assert!(storage_calls(&up).is_empty());
}

#[tokio::test]
async fn refuses_data_that_decodes_to_no_bytes() {
    let (status, value) =
        refused(r#"{"experimentId":"exp1","name":"model.pt","dataBase64":"!!!!"}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "dataBase64 decoded to no bytes."}));
}

#[tokio::test]
async fn stores_the_decoded_bytes_and_answers_the_path() {
    let up = upstream(vec![(STORAGE, vec![json_reply(200, "{}")])]).await;
    let body = r#"{"experimentId":"exp1","name":"model.pt","contentType":"application/x-torch","dataBase64":"aGVsbG8="}"#;
    let (status, value) = send(&up, post(body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({"path": "user-1/exp1/model.pt", "url": "user-1/exp1/model.pt"})
    );
    let calls = storage_calls(&up);
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.method, "POST");
    assert_eq!(call.target, STORAGE);
    assert_eq!(call.header("x-upsert"), Some("true"));
    assert_eq!(call.header("apikey"), Some("anon"));
    assert_eq!(call.header("authorization"), Some("Bearer a.b.c"));
    assert_eq!(call.header("content-type"), Some("application/x-torch"));
    assert_eq!(call.body, b"hello");
}

#[tokio::test]
async fn accepts_unpadded_base64_and_defaults_the_content_type() {
    let up = upstream(vec![(STORAGE, vec![json_reply(200, "{}")])]).await;
    let body =
        r#"{"experimentId":"exp1","name":"model.pt","contentType":"   ","dataBase64":"aGVsbG8"}"#;
    let (status, _) = send(&up, post(body)).await;
    assert_eq!(status, StatusCode::OK);
    let calls = storage_calls(&up);
    assert_eq!(calls[0].body, b"hello");
    assert_eq!(
        calls[0].header("content-type"),
        Some("application/octet-stream")
    );
}

#[tokio::test]
async fn a_storage_refusal_answers_a_generic_server_fault() {
    let up = upstream(vec![(
        STORAGE,
        vec![json_reply(
            400,
            r#"{"statusCode":"400","error":"Bad","message":"no"}"#,
        )],
    )])
    .await;
    let body = r#"{"experimentId":"exp1","name":"model.pt","dataBase64":"aGVsbG8="}"#;
    let (status, value) = send(&up, post(body)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(value, json!({"error": SERVER_FAULT}));
}

#[test]
fn the_body_limit_is_base64_of_the_blob_limit_plus_a_margin() {
    let limit = u64::try_from(ARTIFACT_BODY_LIMIT).unwrap();
    assert_eq!(limit, MAX_BLOB_BYTES * 4 / 3 + 1 + 4096);
}

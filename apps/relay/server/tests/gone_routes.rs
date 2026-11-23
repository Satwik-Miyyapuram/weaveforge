//! Retired personal-row routes answer 410 on every method, before any auth or lookup.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use common::{Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

/// Every retired path, as a client would send it.
const RETIRED: [&str; 6] = [
    "/api/sdk/projects?name=Thesis",
    "/api/settings/credentials",
    "/api/overleaf/connections",
    "/api/overleaf/reports",
    "/api/overleaf/reports?id=r1",
    "/api/overleaf/reports/r1/content",
];
const METHODS: [&str; 5] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/// An upstream that would accept a session and answer every table, so a 410
/// can only come from the route itself.
async fn upstream() -> Upstream {
    let ok = |body: &str| {
        vec![response(
            200,
            &[("Content-Type", "application/json")],
            body.as_bytes(),
        )]
    };
    serve(vec![
        ("/auth/v1/user", ok(r#"{"id":"user-1"}"#)),
        ("/rest/v1/", ok("[]")),
    ])
    .await
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
            allowed_origins: vec!["https://app.weaveforge.org".to_string()],
            bind: "127.0.0.1:0".parse().expect("addr"),
        },
        client: reqwest::Client::new(),
        relay: RelayConfig::production(),
        upstreams: MetaUpstreams::production(),
        pages: RateLimiter::new(PAGE_FETCH_LIMIT),
        pastes: RateLimiter::new(PASTE_FETCH_LIMIT),
        storage: StorageConfig::default(),
        settings: SettingsConfig::default(),
    })
}

#[tokio::test]
async fn every_method_on_a_retired_route_is_410_with_no_upstream_call() {
    let up = upstream().await;
    for uri in RETIRED {
        for method in METHODS {
            for authorization in [None, Some("Bearer a.b.c")] {
                let mut builder = Request::builder().method(method).uri(uri);
                if let Some(value) = authorization {
                    builder = builder.header("authorization", value);
                }
                let request = builder.body(Body::from("{}")).expect("request");
                let reply = app(state(&up))
                    .oneshot(request)
                    .await
                    .expect("router is infallible");
                assert_eq!(reply.status(), StatusCode::GONE, "{method} {uri}");
                let bytes = to_bytes(reply.into_body(), 1 << 16).await.expect("body");
                let value: Value = serde_json::from_slice(&bytes).expect("json");
                assert_eq!(
                    value,
                    json!({"error": "This feature moved to your workspace files."}),
                    "{method} {uri}"
                );
            }
        }
    }
    assert!(up.seen().is_empty(), "{:?}", up.seen());
}

#[tokio::test]
async fn a_retired_route_answers_cors_so_the_browser_sees_the_410() {
    let up = upstream().await;
    let request = Request::builder()
        .method("GET")
        .uri("/api/settings/credentials")
        .header("origin", "https://app.weaveforge.org")
        .body(Body::empty())
        .expect("request");
    let reply = app(state(&up))
        .oneshot(request)
        .await
        .expect("router is infallible");
    assert_eq!(reply.status(), StatusCode::GONE);
    assert_eq!(
        reply
            .headers()
            .get("access-control-allow-origin")
            .expect("cors header"),
        "https://app.weaveforge.org"
    );
}

#[tokio::test]
async fn kept_neighbours_are_not_retired() {
    let up = upstream().await;
    for uri in [
        "/api/sdk/whoami",
        "/api/overleaf/workshop/projects",
        "/api/settings/api-tokens",
    ] {
        let method = if uri.contains("workshop") {
            "POST"
        } else {
            "GET"
        };
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::empty())
            .expect("request");
        let reply = app(state(&up))
            .oneshot(request)
            .await
            .expect("router is infallible");
        assert_ne!(reply.status(), StatusCode::GONE, "{uri}");
    }
}

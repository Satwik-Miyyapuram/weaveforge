#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::postgrest::UserDb;
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::sdk_metrics::ingest_metrics;
use wf_relay_server::url_meta::MetaUpstreams;

mod common;
use common::{Reply, Seen, response, serve};

const SESSION: &str = "Bearer a.b.c";
/// 2023-11-14T22:13:20.123Z
const NOW_MS: i64 = 1_700_000_000_123;

type Routes = Vec<(&'static str, Vec<Reply>)>;

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

fn empty_reply(status: u16) -> Reply {
    response(status, &[], b"")
}

/// What one `ingest_metrics` call answered, and what the upstream saw.
struct Run {
    status: StatusCode,
    json: Value,
    seen: Vec<Seen>,
}

async fn ingest(routes: Routes, body: Option<Value>) -> Run {
    let up = serve(routes).await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let db = UserDb::new(&client, &data_url, "anon", "tok");
    let response = ingest_metrics(&db, body, NOW_MS).await;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    Run {
        status,
        json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        seen: up.seen(),
    }
}

fn point(step: &Value) -> Value {
    json!({"experiment_id": "e1", "metric": "m", "step": step})
}

#[tokio::test]
async fn missing_body_is_invalid_json() {
    let run = ingest(vec![], None).await;
    assert_eq!(run.status, StatusCode::BAD_REQUEST);
    assert_eq!(run.json, json!({"error": "Invalid JSON body."}));
}

#[tokio::test]
async fn points_must_be_an_array_in_an_object() {
    let expected = json!({"error": "Body must be { points: [...] }."});
    for body in [
        json!({}),
        json!({"points": "x"}),
        json!({"points": {"a": 1}}),
        json!([point(&json!(1))]),
    ] {
        let run = ingest(vec![], Some(body)).await;
        assert_eq!(run.status, StatusCode::BAD_REQUEST);
        assert_eq!(run.json, expected);
    }
}

#[tokio::test]
async fn empty_batch_is_ok_without_upstream_calls() {
    let run = ingest(vec![], Some(json!({"points": []}))).await;
    assert_eq!(run.status, StatusCode::OK);
    assert_eq!(run.json, json!({"ok": true}));
    assert!(run.seen.is_empty());
}

#[tokio::test]
async fn more_than_5000_points_is_refused() {
    let points: Vec<Value> = (0..5001).map(|_| point(&json!(1))).collect();
    let run = ingest(vec![], Some(json!({"points": points}))).await;
    assert_eq!(run.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        run.json,
        json!({"error": "At most 5000 points per request."})
    );
}

#[tokio::test]
async fn every_point_must_be_an_object() {
    for bad in [json!(1), json!(null), json!([])] {
        let run = ingest(vec![], Some(json!({"points": [point(&json!(1)), bad]}))).await;
        assert_eq!(run.status, StatusCode::BAD_REQUEST);
        assert_eq!(run.json, json!({"error": "Every point must be an object."}));
    }
}

#[tokio::test]
async fn more_than_200_series_is_refused() {
    let points: Vec<Value> = (0..201)
        .map(|i| json!({"experiment_id": "e1", "metric": format!("m{i}"), "step": 1}))
        .collect();
    let run = ingest(vec![], Some(json!({"points": points}))).await;
    assert_eq!(run.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        run.json,
        json!({"error": "At most 200 distinct series per request."})
    );
    assert!(run.seen.is_empty());
}

#[tokio::test]
async fn non_numeric_step_is_refused_with_its_text() {
    let run = ingest(vec![], Some(json!({"points": [point(&json!("x"))]}))).await;
    assert_eq!(run.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        run.json,
        json!({"error": "Point step must be a finite number, got \"x\"."})
    );
    assert!(run.seen.is_empty());
}

#[tokio::test]
async fn happy_path_downsamples_and_removes_stale_tip() {
    let routes: Routes = vec![
        (
            "/rest/v1/experiment_metrics",
            vec![
                json_reply(200, r#"[{"step":10001}]"#),
                empty_reply(201),
                empty_reply(204),
            ],
        ),
        ("/rest/v1/experiments", vec![empty_reply(204)]),
    ];
    let points = json!({"points": [
        point(&json!(10001)),
        point(&json!(10002)),
        point(&json!(10003)),
    ]});
    let run = ingest(routes, Some(points)).await;
    assert_eq!(run.status, StatusCode::OK);
    assert_eq!(run.json, json!({"ok": true, "received": 3, "stored": 2}));

    let insert = run.seen.iter().find(|s| s.method == "POST").unwrap();
    let rows: Value = serde_json::from_slice(&insert.body).unwrap();
    assert_eq!(rows.as_array().unwrap().len(), 2);
    assert_eq!(rows[0]["step"], json!(10002));
    assert_eq!(rows[1]["step"], json!(10003));

    let delete = run.seen.iter().find(|s| s.method == "DELETE").unwrap();
    assert!(delete.target.contains("step=eq.10001"), "{}", delete.target);
}

#[tokio::test]
async fn numeric_string_step_is_accepted() {
    let routes: Routes = vec![
        (
            "/rest/v1/experiment_metrics",
            vec![json_reply(200, "[]"), empty_reply(201)],
        ),
        ("/rest/v1/experiments", vec![empty_reply(204)]),
    ];
    let run = ingest(routes, Some(json!({"points": [point(&json!(" 7 "))]}))).await;
    assert_eq!(run.status, StatusCode::OK);
    assert_eq!(run.json, json!({"ok": true, "received": 1, "stored": 1}));
    let insert = run.seen.iter().find(|s| s.method == "POST").unwrap();
    let rows: Value = serde_json::from_slice(&insert.body).unwrap();
    assert_eq!(rows[0]["step"], json!(7));
}

#[tokio::test]
async fn falsy_metric_passes_through_without_a_read() {
    let routes: Routes = vec![
        ("/rest/v1/experiment_metrics", vec![empty_reply(201)]),
        ("/rest/v1/experiments", vec![empty_reply(204)]),
    ];
    let points = json!({"points": [{"experiment_id": "e1", "metric": "", "step": 1}]});
    let run = ingest(routes, Some(points)).await;
    assert_eq!(run.status, StatusCode::OK);
    assert_eq!(run.json, json!({"ok": true, "received": 1, "stored": 1}));
    // No stored-step read: the insert, then the heartbeat (as in ingest.ts).
    let methods: Vec<&str> = run.seen.iter().map(|s| s.method.as_str()).collect();
    assert_eq!(methods, ["POST", "PATCH"]);
    let rows: Value = serde_json::from_slice(&run.seen[0].body).unwrap();
    assert_eq!(
        rows,
        json!([{"experiment_id": "e1", "metric": "", "step": 1}])
    );
}

#[tokio::test]
async fn ingest_touches_running_experiments() {
    let routes: Routes = vec![
        (
            "/rest/v1/experiment_metrics",
            vec![json_reply(200, "[]"), empty_reply(201)],
        ),
        ("/rest/v1/experiments", vec![empty_reply(204)]),
    ];
    let run = ingest(routes, Some(json!({"points": [point(&json!(1))]}))).await;
    assert_eq!(run.status, StatusCode::OK);
    let patch = run.seen.iter().find(|s| s.method == "PATCH").unwrap();
    assert!(
        patch.target.contains("id=in.%28%22e1%22%29"),
        "{}",
        patch.target
    );
    let body: Value = serde_json::from_slice(&patch.body).unwrap();
    assert_eq!(body["status"], json!("running"));
    assert_eq!(body["started_at"], json!("2023-11-14T22:13:20.123Z"));
}

async fn send(state: Arc<AppState>, request: Request<Body>) -> (StatusCode, String) {
    let response = app(state).oneshot(request).await.expect("infallible");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

fn state(supabase: &str) -> Arc<AppState> {
    Arc::new(AppState {
        config: Config {
            supabase_url: supabase.to_string(),
            data_url: format!("{supabase}/rest/v1"),
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
    })
}

fn delete(uri: &str, authorization: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method("DELETE").uri(uri);
    if let Some(value) = authorization {
        builder = builder.header("authorization", value);
    }
    builder.body(Body::empty()).expect("request")
}

#[tokio::test]
async fn metrics_delete_requires_a_caller() {
    let state = state("http://127.0.0.1:1");
    let (status, _) = send(state, delete("/api/sdk/metrics?experiment_id=e1", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn metrics_delete_checks_the_id_before_the_database() {
    let up = serve(vec![(
        "/auth/v1/user",
        vec![json_reply(200, r#"{"id":"user-1"}"#)],
    )])
    .await;
    let (status, body) = send(
        state(&format!("http://127.0.0.1:{}", up.port)),
        delete("/api/sdk/metrics", Some(SESSION)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, r#"{"error":"Missing experiment_id."}"#);
}

#[tokio::test]
async fn metrics_delete_removes_points_and_chunks() {
    let up = serve(vec![
        ("/auth/v1/user", vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        ("/rest/v1/experiment_metric_points", vec![empty_reply(204)]),
        ("/rest/v1/experiment_metric_chunks", vec![empty_reply(204)]),
    ])
    .await;
    let (status, body) = send(
        state(&format!("http://127.0.0.1:{}", up.port)),
        delete("/api/sdk/metrics?experiment_id=e1", Some(SESSION)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, r#"{"ok":true}"#);
    let targets: Vec<String> = up
        .seen()
        .into_iter()
        .filter(|s| s.method == "DELETE")
        .map(|s| s.target)
        .collect();
    assert_eq!(
        targets,
        vec![
            "/rest/v1/experiment_metric_points?experiment_id=eq.e1",
            "/rest/v1/experiment_metric_chunks?experiment_id=eq.e1",
        ]
    );
}

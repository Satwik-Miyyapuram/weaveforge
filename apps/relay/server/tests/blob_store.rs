//! Blob registry, viewer lookup and tiered blob operations, against local stand-ins.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use wf_core::storage::blob_access::BlobRefusal;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::blob_store::{self, BlobError};
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::postgrest::UserDb;
use wf_relay_server::routes::AppState;
use wf_relay_server::s3::S3Target;
use wf_relay_server::safe_error::SERVER_FAULT;
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const REGISTRY: &str = "/rest/v1/blob_objects";
const SHARED_RPC: &str = "/rest/v1/rpc/shared_to_user";
const RECORD_RPC: &str = "/rest/v1/rpc/record_blob_access_many";
const HOT_PUT: &str = "/phys/paper-images/u1/a.png";
const MISSING: &str = "Tiered storage is not configured: missing R2_ACCOUNT_ID.";
const RESOURCE_PATH: &str = "u1/0b6f3c2e-8d4a-4c1e-9f2a-1b2c3d4e5f60/a.png";

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

fn data_url(up: &Upstream) -> String {
    format!("http://127.0.0.1:{}/rest/v1", up.port)
}

fn hot_target(port: u16) -> S3Target {
    S3Target {
        endpoint: format!("http://127.0.0.1:{port}"),
        region: "auto".to_string(),
        bucket: "phys".to_string(),
        access_key_id: "ak".to_string(),
        secret_access_key: "sk".to_string(),
    }
}

fn tiered_storage(port: u16) -> StorageConfig {
    StorageConfig {
        tiered: true,
        hot: Ok(hot_target(port)),
        cold: None,
        view_secret: Some("s".to_string()),
    }
}

fn state(up: &Upstream, storage: StorageConfig) -> Arc<AppState> {
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
        storage,
        settings: SettingsConfig::default(),
    })
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

#[test]
fn object_key_joins_bucket_and_path() {
    assert_eq!(
        blob_store::object_key("paper-images", "u1/a.png"),
        "paper-images/u1/a.png"
    );
}

#[test]
fn refusal_converts_to_a_status_error() {
    let refusal = BlobRefusal {
        status: 400,
        message: "Unsupported blob bucket.",
    };
    let error: BlobError = refusal.into();
    assert_eq!(
        error,
        BlobError::Status(400, "Unsupported blob bucket.".to_string())
    );
    assert_eq!(error.status(), 400);
    assert_eq!(error.message(), "Unsupported blob bucket.");
}

#[test]
fn store_and_db_faults_are_500_and_store_hides_its_message() {
    let store = BlobError::Store("R2 said no".to_string());
    assert_eq!(store.status(), 500);
    assert_eq!(store.message(), SERVER_FAULT);
    assert_eq!(BlobError::Status(404, "gone".to_string()).status(), 404);
}

#[test]
fn now_seconds_is_after_2023() {
    assert!(blob_store::now_seconds() > 1_700_000_000);
}

#[tokio::test]
async fn registry_tiers_with_no_paths_sends_no_request() {
    let up = serve(vec![]).await;
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    let map = blob_store::registry_tiers(&db, "paper-images", &[])
        .await
        .unwrap();
    assert!(map.is_empty());
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn registry_tiers_maps_cold_and_unknown_to_tier_text() {
    let up = serve(vec![(
        REGISTRY,
        vec![json_reply(
            200,
            r#"[{"path":"u1/a.png","tier":"cold"},{"path":"u1/b.png","tier":"weird"}]"#,
        )],
    )])
    .await;
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    let paths = vec!["u1/a.png".to_string(), "u1/b.png".to_string()];
    let map = blob_store::registry_tiers(&db, "paper-images", &paths)
        .await
        .unwrap();
    assert_eq!(map.get("u1/a.png").map(String::as_str), Some("cold"));
    assert_eq!(map.get("u1/b.png").map(String::as_str), Some("hot"));
    let seen = calls(&up, REGISTRY);
    assert_eq!(seen[0].method, "GET");
    assert!(
        seen[0].target.contains("bucket=eq.paper-images"),
        "{}",
        seen[0].target
    );
    assert!(seen[0].target.contains("path=in."), "{}", seen[0].target);
}

#[tokio::test]
async fn registry_tier_is_none_for_no_row_and_normalises_the_tier() {
    let up = serve(vec![(
        REGISTRY,
        vec![
            json_reply(200, "[]"),
            json_reply(200, r#"[{"tier":"cold"}]"#),
        ],
    )])
    .await;
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    let none = blob_store::registry_tier(&db, "paper-images", "u1/a.png")
        .await
        .unwrap();
    assert_eq!(none, None);
    let cold = blob_store::registry_tier(&db, "paper-images", "u1/a.png")
        .await
        .unwrap();
    assert_eq!(cold, Some("cold".to_string()));
}

#[tokio::test]
async fn registry_register_upserts_on_bucket_and_path() {
    let up = serve(vec![(REGISTRY, vec![json_reply(201, "[]")])]).await;
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    blob_store::registry_register(&db, "paper-images", "u1/a.png", 42)
        .await
        .unwrap();
    let seen = calls(&up, REGISTRY);
    assert_eq!(seen[0].method, "POST");
    assert!(
        seen[0].target.contains("on_conflict=bucket%2Cpath"),
        "{}",
        seen[0].target
    );
    assert_eq!(
        seen[0].header("prefer"),
        Some("resolution=merge-duplicates,return=representation")
    );
    assert_eq!(
        body_json(&seen[0]),
        json!({
            "bucket": "paper-images",
            "path": "u1/a.png",
            "tier": "hot",
            "size_bytes": 42,
            "priority": 50
        })
    );
}

#[tokio::test]
async fn registry_remove_deletes_by_bucket_and_path() {
    let up = serve(vec![(REGISTRY, vec![empty_reply(204)])]).await;
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    blob_store::registry_remove(&db, "paper-images", "u1/a.png")
        .await
        .unwrap();
    let seen = calls(&up, REGISTRY);
    assert_eq!(seen[0].method, "DELETE");
    assert!(
        seen[0].target.contains("bucket=eq.paper-images"),
        "{}",
        seen[0].target
    );
    assert!(
        seen[0].target.contains("path=eq.u1%2Fa.png"),
        "{}",
        seen[0].target
    );
}

#[tokio::test]
async fn record_access_many_with_no_paths_sends_nothing() {
    let up = serve(vec![]).await;
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    blob_store::record_access_many(&db, "paper-images", &[]).await;
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn record_access_many_failure_does_not_fail_the_caller() {
    let up = serve(vec![(
        RECORD_RPC,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    let paths = vec!["u1/a.png".to_string()];
    blob_store::record_access_many(&db, "paper-images", &paths).await;
    let seen = calls(&up, RECORD_RPC);
    assert_eq!(seen.len(), 1);
    assert_eq!(
        body_json(&seen[0]),
        json!({"p_bucket": "paper-images", "p_paths": ["u1/a.png"]})
    );
}

#[tokio::test]
async fn viewer_tier_gives_the_owner_the_stored_tier() {
    let up = serve(vec![(
        REGISTRY,
        vec![json_reply(200, r#"[{"user_id":"u1","tier":"cold"}]"#)],
    )])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let tier = blob_store::viewer_tier(&state, "paper-images", "u1/a.png", "u1")
        .await
        .unwrap();
    assert_eq!(tier, Some("cold".to_string()));
}

#[tokio::test]
async fn viewer_tier_gives_a_sharee_the_tier_when_the_share_rpc_is_true() {
    let up = serve(vec![
        (
            REGISTRY,
            vec![json_reply(200, r#"[{"user_id":"u2","tier":"hot"}]"#)],
        ),
        (SHARED_RPC, vec![json_reply(200, "true")]),
    ])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let tier = blob_store::viewer_tier(&state, "paper-images", RESOURCE_PATH, "u3")
        .await
        .unwrap();
    assert_eq!(tier, Some("hot".to_string()));
    let rpc = calls(&up, SHARED_RPC);
    assert_eq!(
        body_json(&rpc[0]),
        json!({"rtype": "paper", "rid": "0b6f3c2e-8d4a-4c1e-9f2a-1b2c3d4e5f60", "uid": "u3"})
    );
}

#[tokio::test]
async fn viewer_tier_is_none_when_the_share_rpc_is_false() {
    let up = serve(vec![
        (
            REGISTRY,
            vec![json_reply(200, r#"[{"user_id":"u2","tier":"hot"}]"#)],
        ),
        (SHARED_RPC, vec![json_reply(200, "false")]),
    ])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let tier = blob_store::viewer_tier(&state, "paper-images", RESOURCE_PATH, "u3")
        .await
        .unwrap();
    assert_eq!(tier, None);
}

#[tokio::test]
async fn viewer_tier_skips_the_share_rpc_for_a_non_uuid_path() {
    let up = serve(vec![
        (
            REGISTRY,
            vec![json_reply(200, r#"[{"user_id":"u2","tier":"hot"}]"#)],
        ),
        (SHARED_RPC, vec![json_reply(200, "true")]),
    ])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let tier = blob_store::viewer_tier(&state, "paper-images", "u1/not-a-uuid/a.png", "u3")
        .await
        .unwrap();
    assert_eq!(tier, None);
    assert!(calls(&up, "/rest/v1/rpc").is_empty());
}

#[tokio::test]
async fn viewer_tier_is_none_when_there_is_no_row() {
    let up = serve(vec![(REGISTRY, vec![json_reply(200, "[]")])]).await;
    let state = state(&up, tiered_storage(up.port));
    let tier = blob_store::viewer_tier(&state, "paper-images", "u1/a.png", "u1")
        .await
        .unwrap();
    assert_eq!(tier, None);
    assert!(calls(&up, "/rest/v1/rpc").is_empty());
}

#[tokio::test]
async fn viewer_tier_uses_the_service_key_for_the_lookup() {
    let up = serve(vec![(
        REGISTRY,
        vec![json_reply(200, r#"[{"user_id":"u1","tier":"hot"}]"#)],
    )])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let tier = blob_store::viewer_tier(&state, "paper-images", "u1/a.png", "u1")
        .await
        .unwrap();
    assert_eq!(tier.as_deref(), Some("hot"));
    let seen = calls(&up, REGISTRY);
    assert_eq!(seen[0].header("apikey"), Some("service"));
    assert_eq!(seen[0].header("authorization"), Some("Bearer service"));
}

#[tokio::test]
async fn upload_with_no_hot_store_is_500_and_sends_nothing() {
    let up = serve(vec![]).await;
    let storage = StorageConfig {
        tiered: true,
        hot: Err(MISSING.to_string()),
        cold: None,
        view_secret: None,
    };
    let state = state(&up, storage);
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    let err = blob_store::upload(
        &state,
        &db,
        "paper-images",
        "u1/a.png",
        vec![1, 2, 3],
        "image/png",
    )
    .await
    .unwrap_err();
    assert_eq!(err, BlobError::Status(500, MISSING.to_string()));
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn upload_puts_to_hot_then_registers_the_size() {
    let up = serve(vec![
        (HOT_PUT, vec![empty_reply(200)]),
        (REGISTRY, vec![json_reply(201, "[]")]),
    ])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    blob_store::upload(
        &state,
        &db,
        "paper-images",
        "u1/a.png",
        vec![1, 2, 3],
        "image/png",
    )
    .await
    .unwrap();
    let put = calls(&up, HOT_PUT);
    assert_eq!(put[0].method, "PUT");
    assert_eq!(put[0].body, vec![1, 2, 3]);
    assert_eq!(put[0].header("content-type"), Some("image/png"));
    assert_eq!(body_json(&calls(&up, REGISTRY)[0])["size_bytes"], json!(3));
}

#[tokio::test]
async fn remove_of_a_cold_row_deletes_from_hot_then_drops_the_row() {
    let up = serve(vec![
        (
            REGISTRY,
            vec![json_reply(200, r#"[{"tier":"cold"}]"#), empty_reply(204)],
        ),
        ("/phys/paper-images/u1/a.png", vec![empty_reply(204)]),
    ])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    blob_store::remove(&state, &db, "paper-images", "u1/a.png")
        .await
        .unwrap();
    let seen = up.seen();
    let order: Vec<(&str, &str)> = seen
        .iter()
        .map(|s| (s.method.as_str(), s.target.split('?').next().unwrap_or("")))
        .collect();
    assert_eq!(
        order,
        vec![
            ("GET", REGISTRY),
            ("DELETE", "/phys/paper-images/u1/a.png"),
            ("DELETE", REGISTRY),
        ]
    );
}

#[tokio::test]
async fn remove_keeps_the_row_when_the_store_delete_fails() {
    let up = serve(vec![
        (REGISTRY, vec![json_reply(200, "[]")]),
        ("/phys/paper-images/u1/a.png", vec![empty_reply(500)]),
    ])
    .await;
    let state = state(&up, tiered_storage(up.port));
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    let err = blob_store::remove(&state, &db, "paper-images", "u1/a.png")
        .await
        .unwrap_err();
    assert!(matches!(err, BlobError::Store(_)), "{err:?}");
    assert_eq!(calls(&up, REGISTRY).len(), 1);
}

#[tokio::test]
async fn remove_with_no_hot_store_is_500_before_the_registry_lookup() {
    let up = serve(vec![]).await;
    let storage = StorageConfig {
        tiered: true,
        hot: Err(MISSING.to_string()),
        cold: None,
        view_secret: None,
    };
    let state = state(&up, storage);
    let client = reqwest::Client::new();
    let base = data_url(&up);
    let db = UserDb::new(&client, &base, "anon", "token");
    let err = blob_store::remove(&state, &db, "paper-images", "u1/a.png")
        .await
        .unwrap_err();
    assert_eq!(err, BlobError::Status(500, MISSING.to_string()));
    assert!(up.seen().is_empty());
}

//! User blob purge: storage listings, object deletes and registry rows, against a stand-in
//! for Supabase.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::account_purge::{BLOB_STORAGE_BUCKETS, purge_user_blobs};
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::AppState;
use wf_relay_server::s3::S3Target;
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const BLOBS: &str = "/rest/v1/blob_objects";
const PAPER_LIST: &str = "/storage/v1/object/list/paper-images";
const PAPER_DELETE: &str = "/storage/v1/object/paper-images";
const LISTS: [&str; 5] = [
    "/storage/v1/object/list/paper-images",
    "/storage/v1/object/list/experiment-artifacts",
    "/storage/v1/object/list/vault-assets",
    "/storage/v1/object/list/report-images",
    "/storage/v1/object/list/log-images",
];

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// Every bucket lists empty, the registry is empty, and deletes succeed; `extra` routes
/// come first so they win.
async fn upstream(extra: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = extra;
    routes.push((BLOBS, vec![json_reply(200, "[]")]));
    routes.push((PAPER_DELETE, vec![json_reply(200, "[]")]));
    routes.extend(
        LISTS
            .iter()
            .map(|path| (*path, vec![json_reply(200, "[]")])),
    );
    serve(routes).await
}

fn state(up: &Upstream, storage: StorageConfig) -> AppState {
    let supabase = format!("http://127.0.0.1:{}", up.port);
    AppState {
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
    }
}

/// The storage listing requests seen so far.
fn list_calls(up: &Upstream) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target.starts_with("/storage/v1/object/list/"))
        .collect()
}

fn body_of(seen: &Seen) -> Value {
    serde_json::from_slice(&seen.body).expect("json body")
}

#[tokio::test]
async fn empty_account_lists_every_bucket_and_drops_rows() {
    let up = upstream(vec![]).await;
    purge_user_blobs(&state(&up, StorageConfig::default()), "u1")
        .await
        .unwrap();
    let lists = list_calls(&up);
    let targets: Vec<&str> = lists.iter().map(|seen| seen.target.as_str()).collect();
    assert_eq!(targets, LISTS);
    for seen in &lists {
        assert_eq!(body_of(seen)["prefix"], "u1");
    }
    let deletes: Vec<Seen> = up
        .seen()
        .into_iter()
        .filter(|seen| seen.method == "DELETE")
        .collect();
    assert_eq!(deletes.len(), 1);
    assert_eq!(deletes[0].target, "/rest/v1/blob_objects?user_id=eq.u1");
}

#[tokio::test]
async fn folders_are_walked_and_files_deleted_in_one_batch() {
    let up = upstream(vec![(
        PAPER_LIST,
        vec![
            json_reply(
                200,
                r#"[{"name":"folder","id":null},{"name":"a.png","id":"x1"}]"#,
            ),
            json_reply(200, r#"[{"name":"b.png","id":"x2"}]"#),
        ],
    )])
    .await;
    purge_user_blobs(&state(&up, StorageConfig::default()), "u1")
        .await
        .unwrap();
    let paper: Vec<Value> = list_calls(&up)
        .iter()
        .filter(|seen| seen.target == PAPER_LIST)
        .map(body_of)
        .collect();
    let prefixes: Vec<&str> = paper
        .iter()
        .map(|b| b["prefix"].as_str().unwrap())
        .collect();
    assert_eq!(prefixes, ["u1", "u1/folder"]);
    let deletes: Vec<Seen> = up
        .seen()
        .into_iter()
        .filter(|seen| seen.method == "DELETE" && seen.target == PAPER_DELETE)
        .collect();
    assert_eq!(deletes.len(), 1);
    assert_eq!(
        body_of(&deletes[0])["prefixes"],
        json!(["u1/a.png", "u1/folder/b.png"])
    );
}

#[tokio::test]
async fn full_page_asks_for_the_next_offset() {
    let page: Vec<Value> = (0..200)
        .map(|i| json!({"name": format!("f{i}.png"), "id": format!("id{i}")}))
        .collect();
    let up = upstream(vec![(
        PAPER_LIST,
        vec![
            json_reply(200, &Value::Array(page).to_string()),
            json_reply(200, "[]"),
        ],
    )])
    .await;
    purge_user_blobs(&state(&up, StorageConfig::default()), "u1")
        .await
        .unwrap();
    let offsets: Vec<u64> = list_calls(&up)
        .iter()
        .filter(|seen| seen.target == PAPER_LIST)
        .map(|seen| body_of(seen)["offset"].as_u64().unwrap())
        .collect();
    assert_eq!(offsets, [0, 200]);
}

#[tokio::test]
async fn storage_listing_error_keeps_registry_rows() {
    let up = upstream(vec![(
        PAPER_LIST,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    let err = purge_user_blobs(&state(&up, StorageConfig::default()), "u1")
        .await
        .unwrap_err();
    assert_eq!(err, "boom");
    assert!(
        !up.seen()
            .iter()
            .any(|seen| seen.method == "DELETE" && seen.target.starts_with(BLOBS))
    );
}

#[tokio::test]
async fn registry_select_error_stops_before_storage() {
    let up = upstream(vec![(
        BLOBS,
        vec![json_reply(500, r#"{"message":"down"}"#)],
    )])
    .await;
    assert!(
        purge_user_blobs(&state(&up, StorageConfig::default()), "u1")
            .await
            .is_err()
    );
    assert!(list_calls(&up).is_empty());
}

#[tokio::test]
async fn failed_tiered_delete_keeps_rows_and_counts_failures() {
    // The registry row is returned once; the tier lookup that follows finds nothing and
    // defaults to hot. The S3 delete then fails with a 500 (a 404 would count as deleted).
    let up = upstream(vec![
        (
            BLOBS,
            vec![
                json_reply(200, r#"[{"bucket":"paper-images","path":"u1/a.png"}]"#),
                json_reply(200, "[]"),
            ],
        ),
        ("/hot/paper-images/u1/a.png", vec![json_reply(500, "")]),
    ])
    .await;
    let storage = StorageConfig {
        tiered: true,
        hot: Ok(S3Target {
            endpoint: up.base.as_str().trim_end_matches('/').to_string(),
            region: "auto".to_string(),
            bucket: "hot".to_string(),
            access_key_id: "key".to_string(),
            secret_access_key: "secret".to_string(),
        }),
        cold: None,
        view_secret: None,
    };
    let err = purge_user_blobs(&state(&up, storage), "u1")
        .await
        .unwrap_err();
    assert_eq!(
        err,
        "Could not delete 1 of 1 stored objects — account not deleted. Retry once object storage is reachable."
    );
    assert!(
        !up.seen()
            .iter()
            .any(|seen| seen.method == "DELETE" && seen.target.starts_with(BLOBS))
    );
    assert_eq!(BLOB_STORAGE_BUCKETS.len(), LISTS.len());
}

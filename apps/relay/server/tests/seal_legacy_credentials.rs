//! The one-shot `seal-legacy-credentials` run, and seal-on-read in `GET /api/settings/credentials`.
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
use wf_relay_server::credential_crypto::{MISSING_KEY, open};
use wf_relay_server::legacy_credentials::legacy_secrets;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::seal_legacy::{Report, seal_legacy_credentials};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const KEY: &str = "test-key";
const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const SETTINGS: &str = "/rest/v1/user_settings";
const PATH: &str = "/api/settings/credentials";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// A PostgREST `PATCH` answer with `return=representation`: the rows it changed.
fn patched_row() -> Reply {
    json_reply(200, &json!([{"user_id": "user-1"}]).to_string())
}

/// A row holding plaintext legacy secrets and no envelope.
fn legacy_row() -> Value {
    json!({
        "user_id": "user-1",
        "credentials_enc": null,
        "zotero_api_key": "  zk  ",
        "semantic_scholar_key": null,
        "integrations": {"overleaf": {"token": "ot"}}
    })
}

fn expected_secrets() -> Value {
    json!({"zoteroApiKey": "zk", "integrations": {"overleaf": {"token": "ot"}}})
}

/// What the envelope of `legacy_row()` holds: every legacy value exactly as stored.
fn raw_payload() -> Value {
    json!({"zoteroApiKey": "  zk  ", "integrations": {"overleaf": {"token": "ot"}}})
}

/// The decoded value of query parameter `name` in a request target.
fn query_value(seen: &Seen, name: &str) -> Option<String> {
    reqwest::Url::parse(&format!("http://x{}", seen.target))
        .expect("target url")
        .query_pairs()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v.into_owned())
}

/// The `user_settings` replies: a row, the `PATCH` answer, then an empty page.
fn legacy_turns() -> Vec<Reply> {
    vec![
        json_reply(200, &json!([legacy_row()]).to_string()),
        patched_row(),
        json_reply(200, "[]"),
    ]
}

fn config(up: &Upstream) -> Config {
    let supabase = format!("http://127.0.0.1:{}", up.port);
    Config {
        data_url: format!("{supabase}/rest/v1"),
        supabase_url: supabase,
        anon_key: "anon".to_string(),
        service_role_key: "service".to_string(),
        jwt_secret: Some("secret".to_string()),
        allowed_origins: Vec::new(),
        bind: "127.0.0.1:0".parse().expect("addr"),
    }
}

fn patches(up: &Upstream) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.method == "PATCH")
        .collect()
}

fn body_json(seen: &Seen) -> Value {
    serde_json::from_slice(&seen.body).expect("json body")
}

fn assert_legacy_nulled(body: &Value) {
    for column in ["zotero_api_key", "semantic_scholar_key", "integrations"] {
        assert_eq!(body[column], Value::Null, "{column} must be nulled");
    }
}

fn opened(envelope: &Value) -> Value {
    let text = envelope.as_str().expect("sealed envelope");
    serde_json::from_str(&open(text, Some(KEY)).expect("opens with the key")).expect("json")
}

#[test]
fn legacy_secrets_reads_only_unsealed_rows_with_plaintext() {
    let found = legacy_secrets(&legacy_row()).expect("legacy row");
    assert_eq!(
        Value::Object(found),
        raw_payload(),
        "values as stored, not cleaned"
    );

    let sealed = json!({"credentials_enc": "v1.x", "zotero_api_key": "zk"});
    assert!(legacy_secrets(&sealed).is_none());

    let blank = json!({"credentials_enc": null, "zotero_api_key": "  "});
    assert_eq!(
        Value::Object(legacy_secrets(&blank).expect("blank legacy")),
        json!({"zoteroApiKey": "  "})
    );

    let nothing = json!({"credentials_enc": null, "zotero_api_key": null});
    assert!(legacy_secrets(&nothing).is_none());
}

#[tokio::test]
async fn converts_a_legacy_row_and_nulls_the_plaintext_columns() {
    let up = serve(vec![(SETTINGS, legacy_turns())]).await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(
        report,
        Report {
            found: 1,
            converted: 1,
            left_plaintext: 0,
            dry_run: false
        }
    );
    let sent = patches(&up);
    assert_eq!(sent.len(), 1, "one write per legacy row");
    assert!(sent[0].target.contains("user_id=eq.user-1"));
    assert!(sent[0].target.contains("credentials_enc=is.null"));
    let body = body_json(&sent[0]);
    assert_legacy_nulled(&body);
    assert_eq!(opened(&body["credentials_enc"]), raw_payload());
}

#[tokio::test]
async fn the_envelope_keeps_every_legacy_value_as_stored() {
    // Values `clean_secrets` would drop (non-string fields, blank strings, non-object
    // providers) must survive in the envelope, since the columns are nulled.
    let integrations = json!({
        "github": {"enabled": true, "token": " t ", "blank": "  "},
        "note": "x"
    });
    let row = json!({
        "user_id": "user-1",
        "credentials_enc": null,
        "zotero_api_key": null,
        "semantic_scholar_key": " ",
        "integrations": integrations
    });
    let up = serve(vec![(
        SETTINGS,
        vec![
            json_reply(200, &json!([row]).to_string()),
            patched_row(),
            json_reply(200, "[]"),
        ],
    )])
    .await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(report.converted, 1);
    let body = body_json(&patches(&up)[0]);
    assert_legacy_nulled(&body);
    assert_eq!(
        opened(&body["credentials_enc"]),
        json!({"semanticScholarKey": " ", "integrations": integrations})
    );
}

#[tokio::test]
async fn the_write_guard_matches_the_exact_values_read() {
    // A plaintext key written between the read and the write (an old client) must not be
    // overwritten by the sealed copy of the older value.
    let up = serve(vec![(SETTINGS, legacy_turns())]).await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(
        (report.found, report.converted, report.left_plaintext),
        (1, 1, 0)
    );
    let sent = &patches(&up)[0];
    assert_eq!(query_value(sent, "user_id").as_deref(), Some("eq.user-1"));
    assert_eq!(
        query_value(sent, "credentials_enc").as_deref(),
        Some("is.null")
    );
    assert_eq!(
        query_value(sent, "zotero_api_key").as_deref(),
        Some("eq.  zk  ")
    );
    assert_eq!(
        query_value(sent, "semantic_scholar_key").as_deref(),
        Some("is.null")
    );
    let integrations = query_value(sent, "integrations").expect("integrations guard");
    let json_text = integrations.strip_prefix("eq.").expect("eq filter");
    assert_eq!(
        serde_json::from_str::<Value>(json_text).expect("json"),
        legacy_row()["integrations"]
    );
}

#[tokio::test]
async fn the_write_guard_carries_awkward_values_unchanged() {
    // Separators, percent, plus and non-ASCII text, and a jsonb array instead of an object.
    let key = "a,b (c).d%e+f \u{fc}=&";
    let row = json!({
        "user_id": "user-1",
        "credentials_enc": null,
        "zotero_api_key": key,
        "semantic_scholar_key": "",
        "integrations": [1, "two", {"k": null}]
    });
    let up = serve(vec![(
        SETTINGS,
        vec![
            json_reply(200, &json!([row]).to_string()),
            patched_row(),
            json_reply(200, "[]"),
        ],
    )])
    .await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(
        (report.found, report.converted, report.left_plaintext),
        (1, 1, 0)
    );
    let sent = &patches(&up)[0];
    assert_eq!(
        query_value(sent, "zotero_api_key"),
        Some(format!("eq.{key}"))
    );
    assert_eq!(
        query_value(sent, "semantic_scholar_key").as_deref(),
        Some("eq.")
    );
    let integrations = query_value(sent, "integrations").expect("integrations guard");
    assert_eq!(
        serde_json::from_str::<Value>(integrations.strip_prefix("eq.").expect("eq")).expect("json"),
        row["integrations"]
    );
    assert_eq!(
        opened(&body_json(sent)["credentials_enc"]),
        json!({"zoteroApiKey": key, "semanticScholarKey": "", "integrations": row["integrations"]})
    );
}

#[tokio::test]
async fn a_row_with_an_empty_envelope_is_selected_and_sealed() {
    // An empty `credentials_enc` holds no secrets: the plaintext is still the only copy.
    let mut row = legacy_row();
    row["credentials_enc"] = json!("");
    let up = serve(vec![(
        SETTINGS,
        vec![
            json_reply(200, &json!([row]).to_string()),
            patched_row(),
            json_reply(200, "[]"),
        ],
    )])
    .await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(report.converted, 1);
    let read = up
        .seen()
        .into_iter()
        .find(|seen| seen.method == "GET")
        .expect("page read");
    assert_eq!(
        query_value(&read, "credentials_enc"),
        None,
        "the read must not skip rows whose envelope is empty"
    );
    let sent = &patches(&up)[0];
    assert_eq!(query_value(sent, "credentials_enc").as_deref(), Some("eq."));
    assert_eq!(opened(&body_json(sent)["credentials_enc"]), raw_payload());
}

#[tokio::test]
async fn skips_a_row_that_is_already_sealed() {
    let envelope = wf_relay_server::credential_crypto::seal("{}", Some(KEY)).expect("seal");
    let mut sealed = legacy_row();
    sealed["credentials_enc"] = Value::String(envelope);
    let up = serve(vec![(
        SETTINGS,
        vec![
            json_reply(200, &json!([sealed]).to_string()),
            json_reply(200, "[]"),
        ],
    )])
    .await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(report.found, 0);
    assert_eq!(report.converted, 0);
    // The envelope wins, but plaintext still at rest beside it is reported, never hidden.
    assert_eq!(report.left_plaintext, 1);
    assert!(patches(&up).is_empty(), "a sealed row is never rewritten");
}

#[tokio::test]
async fn a_second_run_is_a_no_op() {
    let up = serve(vec![(SETTINGS, legacy_turns())]).await;
    let client = reqwest::Client::new();
    let first = seal_legacy_credentials(&config(&up), &client, Some(KEY), false)
        .await
        .expect("first run");
    assert_eq!(first.converted, 1);
    let second = seal_legacy_credentials(&config(&up), &client, Some(KEY), false)
        .await
        .expect("second run");
    assert_eq!(
        second,
        Report {
            found: 0,
            converted: 0,
            left_plaintext: 0,
            dry_run: false
        }
    );
    assert_eq!(patches(&up).len(), 1, "the second run writes nothing");
}

#[tokio::test]
async fn refuses_to_start_without_the_credential_key() {
    let up = serve(vec![(SETTINGS, legacy_turns())]).await;
    let err = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), None, false)
        .await
        .expect_err("must refuse");
    assert_eq!(err, MISSING_KEY);
    assert!(up.seen().is_empty(), "no database call without the key");
}

#[tokio::test]
async fn dry_run_counts_without_writing() {
    let up = serve(vec![(
        SETTINGS,
        vec![
            json_reply(200, &json!([legacy_row()]).to_string()),
            json_reply(200, "[]"),
        ],
    )])
    .await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), true)
        .await
        .expect("dry run");
    assert_eq!(
        report,
        Report {
            found: 1,
            converted: 0,
            left_plaintext: 0,
            dry_run: true
        }
    );
    assert!(patches(&up).is_empty(), "dry run never writes");
}

/// The state the credentials route runs on; `key` is the server's credential key.
fn state(up: &Upstream, key: Option<&str>) -> Arc<AppState> {
    Arc::new(AppState {
        config: config(up),
        client: reqwest::Client::new(),
        relay: RelayConfig::production(),
        upstreams: MetaUpstreams::production(),
        pages: RateLimiter::new(PAGE_FETCH_LIMIT),
        pastes: RateLimiter::new(PASTE_FETCH_LIMIT),
        storage: StorageConfig::default(),
        settings: SettingsConfig {
            mcp_enabled: true,
            credential_key: key.map(str::to_string),
            ..SettingsConfig::default()
        },
    })
}

/// Sends a `GET` to the credentials route; returns status, headers and the JSON body.
async fn get(up: &Upstream, key: Option<&str>) -> (StatusCode, HeaderMap, Value) {
    let req = Request::builder()
        .method("GET")
        .uri(PATH)
        .header("authorization", SESSION)
        .body(Body::empty())
        .expect("request");
    let response = app(state(up, key))
        .oneshot(req)
        .await
        .expect("router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    let value = serde_json::from_slice::<Value>(&bytes).expect("json body");
    (status, headers, value)
}

#[tokio::test]
async fn get_seals_legacy_plaintext_on_read_and_writes_it_back() {
    let up = serve(vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        (
            SETTINGS,
            vec![
                json_reply(200, &json!([legacy_row()]).to_string()),
                patched_row(),
            ],
        ),
    ])
    .await;
    let (status, headers, value) = get(&up, Some(KEY)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers.get("cache-control").expect("header"), "no-store");
    assert_eq!(value, expected_secrets());
    let sent = patches(&up);
    assert_eq!(sent.len(), 1, "the read writes the sealed copy back");
    let body = body_json(&sent[0]);
    assert_legacy_nulled(&body);
    assert_eq!(opened(&body["credentials_enc"]), raw_payload());
    assert_eq!(
        query_value(&sent[0], "zotero_api_key").as_deref(),
        Some("eq.  zk  "),
        "the read-path write is guarded by the exact values read"
    );
}

#[tokio::test]
async fn get_after_a_concurrent_plaintext_change_serves_the_current_keys() {
    // The guarded write missed because an old client wrote a new plaintext key. The reply
    // must carry that key, never an empty set a client could save over the real keys.
    let changed = json!({
        "credentials_enc": null,
        "zotero_api_key": " new ",
        "semantic_scholar_key": null,
        "integrations": null
    });
    let up = serve(vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        (
            SETTINGS,
            vec![
                json_reply(200, &json!([legacy_row()]).to_string()),
                json_reply(200, "[]"),
                json_reply(200, &json!([changed]).to_string()),
            ],
        ),
    ])
    .await;
    let (status, _headers, value) = get(&up, Some(KEY)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"zoteroApiKey": "new"}));
    assert_eq!(
        patches(&up).len(),
        1,
        "one guarded write; the next read seals the rest"
    );
}

#[tokio::test]
async fn get_refuses_a_legacy_row_without_the_key() {
    let up = serve(vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        (
            SETTINGS,
            vec![json_reply(200, &json!([legacy_row()]).to_string())],
        ),
    ])
    .await;
    let (status, _headers, value) = get(&up, None).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(value["error"].as_str(), Some(MISSING_KEY));
    assert!(
        patches(&up).is_empty(),
        "nothing is written without the key"
    );
}

#[tokio::test]
async fn a_write_guard_requires_a_row_that_still_holds_legacy_plaintext() {
    let up = serve(vec![(SETTINGS, legacy_turns())]).await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(
        (report.found, report.converted, report.left_plaintext),
        (1, 1, 0)
    );
    let sent = patches(&up);
    assert!(sent[0].target.contains("zotero_api_key.not.is.null"));
    assert!(sent[0].target.contains("semantic_scholar_key.not.is.null"));
    assert!(sent[0].target.contains("integrations.not.is.null"));
}

#[tokio::test]
async fn a_row_cleared_between_read_and_write_is_not_counted_or_rewritten() {
    // The keys were cleared after the read: the guarded PATCH matches no row.
    let up = serve(vec![(
        SETTINGS,
        vec![
            json_reply(200, &json!([legacy_row()]).to_string()),
            json_reply(200, "[]"),
        ],
    )])
    .await;
    let report = seal_legacy_credentials(&config(&up), &reqwest::Client::new(), Some(KEY), false)
        .await
        .expect("run");
    assert_eq!(
        report,
        Report {
            found: 1,
            converted: 0,
            left_plaintext: 0,
            dry_run: false
        }
    );
    assert_eq!(
        patches(&up).len(),
        1,
        "the guarded write was attempted once"
    );
}

#[tokio::test]
async fn get_after_a_concurrent_clear_returns_current_state_not_stale_legacy() {
    let cleared = json!({
        "credentials_enc": null,
        "zotero_api_key": null,
        "semantic_scholar_key": null,
        "integrations": null
    });
    let up = serve(vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        (
            SETTINGS,
            vec![
                json_reply(200, &json!([legacy_row()]).to_string()),
                json_reply(200, "[]"),
                json_reply(200, &json!([cleared]).to_string()),
            ],
        ),
    ])
    .await;
    let (status, _headers, value) = get(&up, Some(KEY)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({}),
        "the stale legacy secrets must not be returned"
    );
    let sent = patches(&up);
    assert_eq!(sent.len(), 1);
    assert!(sent[0].target.contains("zotero_api_key.not.is.null"));
}

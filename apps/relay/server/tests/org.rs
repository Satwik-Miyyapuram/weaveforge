//! Lab invite codes, lab creation, standalone setup and auth, over the HTTP router.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const ADMIN_USER: &str = "/auth/v1/admin/users/user-1";
const PROFILES: &str = "/rest/v1/profiles";
const ORGANIZATIONS: &str = "/rest/v1/organizations";
const INVITE_CODES: &str = "/rest/v1/org_invite_codes";
const MEMBERSHIPS: &str = "/rest/v1/org_memberships";
const RPC_CREATE: &str = "/rest/v1/rpc/create_organization_atomic";
const RPC_COMPLETE: &str = "/rest/v1/rpc/complete_org_setup";
const RPC_ENSURE: &str = "/rest/v1/rpc/ensure_user_provisioned";
const ABC_HASH: &str = "a79f6c78bd6996b2f806d2e9ba7ad557a75d6daf28c1988d758cfa13c85e8a68";
const ORG_ROUTES: [(&str, &str); 9] = [
    ("GET", "/api/org/codes"),
    ("POST", "/api/org/codes"),
    ("POST", "/api/org/create"),
    ("POST", "/api/org/join"),
    ("POST", "/api/org/leave"),
    ("POST", "/api/org/switch"),
    ("POST", "/api/org/standalone"),
    ("GET", "/api/org/memberships"),
    ("GET", "/api/org/mine"),
];

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

/// An upstream where `a.b.c` is user `user-1`. The given routes win over the defaults.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]));
    routes.push((
        ADMIN_USER,
        vec![json_reply(
            200,
            r#"{"id":"user-1","email":"a@b.c","user_metadata":{"full_name":"Ann"}}"#,
        )],
    ));
    routes.push((PROFILES, vec![empty_reply(201)]));
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
        settings: SettingsConfig::default(),
    })
}

/// A request with the session header.
fn request(method: &str, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
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

/// SHA-256 hex of a plaintext invite code with its dashes removed.
fn hash_of(code: &str) -> String {
    format!("{:x}", Sha256::digest(code.replace('-', "").as_bytes()))
}

/// Matches `XXX-XXX-XXX` with digits and capitals.
fn is_invite_code(code: &str) -> bool {
    code.len() == 11
        && code.as_bytes().iter().enumerate().all(|(i, b)| match i {
            3 | 7 => *b == b'-',
            _ => b.is_ascii_digit() || b.is_ascii_uppercase(),
        })
}

#[tokio::test]
async fn every_org_route_refuses_a_missing_or_api_token_before_anything_else() {
    let up = upstream(vec![]).await;
    for (method, uri) in ORG_ROUTES {
        let anonymous = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::from(""))
            .expect("request");
        let (status, value) = send(&up, anonymous).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(
            value,
            json!({"error": "Not authenticated."}),
            "{method} {uri}"
        );

        let api_token = Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", "Bearer wf_x")
            .body(Body::from(""))
            .expect("request");
        let (status, value) = send(&up, api_token).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(
            value,
            json!({"error": "Invalid session."}),
            "{method} {uri}"
        );
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn codes_get_needs_a_code() {
    let up = upstream(vec![]).await;
    for uri in ["/api/org/codes", "/api/org/codes?code=%20"] {
        let (status, value) = send(&up, request("GET", uri, "")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(value, json!({"error": "code required"}), "{uri}");
    }
}

#[tokio::test]
async fn codes_get_unknown_code_is_not_found() {
    let up = upstream(vec![(INVITE_CODES, vec![json_reply(200, "[]")])]).await;
    let (status, value) = send(&up, request("GET", "/api/org/codes?code=abc-def-ghj", "")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(value, json!({"error": "Invalid code."}));
    let query = calls(&up, INVITE_CODES)[0].target.clone();
    assert!(
        query.contains(&format!("code_hash=eq.{ABC_HASH}")),
        "{query}"
    );
    assert!(query.contains("revoked_at=is.null"), "{query}");
}

#[tokio::test]
async fn codes_get_phd_code_lists_professors_with_labels() {
    let up = upstream(vec![
        (
            INVITE_CODES,
            vec![json_reply(
                200,
                r#"[{"org_id":"org-1","target_role":"phd"}]"#,
            )],
        ),
        (
            ORGANIZATIONS,
            vec![json_reply(200, r#"[{"name":"Lab One"}]"#)],
        ),
        (
            MEMBERSHIPS,
            vec![
                json_reply(
                    200,
                    r#"[{"user_id":"p1"},{"user_id":"p2"},{"user_id":"p3"}]"#,
                ),
                json_reply(200, "[]"),
            ],
        ),
        (
            PROFILES,
            vec![json_reply(
                200,
                r#"[{"user_id":"p1","full_name":"Prof One","email":"p1@x.org"},
                    {"user_id":"p2","full_name":null,"email":"p2@x.org"},
                    {"user_id":"p3","full_name":null,"email":null}]"#,
            )],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("GET", "/api/org/codes?code=abc-def-ghj", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({
            "orgName": "Lab One",
            "targetRole": "phd",
            "professors": [
                {"id": "p1", "label": "Prof One"},
                {"id": "p2", "label": "p2@x.org"},
                {"id": "p3", "label": "Member"}
            ]
        })
    );
}

#[tokio::test]
async fn codes_get_phd_code_with_one_professor_has_no_professor_list() {
    let up = upstream(vec![
        (
            INVITE_CODES,
            vec![json_reply(
                200,
                r#"[{"org_id":"org-1","target_role":"phd"}]"#,
            )],
        ),
        (
            ORGANIZATIONS,
            vec![json_reply(200, r#"[{"name":"Lab One"}]"#)],
        ),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, r#"[{"user_id":"p1"}]"#),
                json_reply(200, "[]"),
            ],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("GET", "/api/org/codes?code=abc-def-ghj", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"orgName": "Lab One", "targetRole": "phd"}));
}

#[tokio::test]
async fn codes_get_masters_code_lists_phds_only() {
    let up = upstream(vec![
        (
            INVITE_CODES,
            vec![json_reply(
                200,
                r#"[{"org_id":"org-1","target_role":"masters"}]"#,
            )],
        ),
        (
            ORGANIZATIONS,
            vec![json_reply(200, r#"[{"name":"Lab One"}]"#)],
        ),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, r#"[{"user_id":"p1"}]"#),
                json_reply(200, r#"[{"user_id":"s1"}]"#),
            ],
        ),
        (
            PROFILES,
            vec![json_reply(
                200,
                r#"[{"user_id":"s1","full_name":"Stu One","email":"s1@x.org"}]"#,
            )],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("GET", "/api/org/codes?code=abc-def-ghj", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({
            "orgName": "Lab One",
            "targetRole": "masters",
            "phds": [{"id": "s1", "label": "Stu One"}]
        })
    );
}

#[tokio::test]
async fn codes_post_rejects_bad_bodies() {
    let up = upstream(vec![]).await;
    let (status, value) = send(&up, request("POST", "/api/org/codes", "{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "orgId and targetRole required."}));

    let (status, value) = send(&up, request("POST", "/api/org/codes", "[1]")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Body must be a JSON object."}));

    let (status, value) = send(&up, request("POST", "/api/org/codes", "{")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let message = value["error"].as_str().expect("error text");
    assert!(message.starts_with("Invalid JSON body: "), "{message}");
}

#[tokio::test]
async fn codes_post_by_a_non_owner_is_refused() {
    let up = upstream(vec![(
        ORGANIZATIONS,
        vec![json_reply(200, r#"[{"owner_id":"other"}]"#)],
    )])
    .await;
    let body = r#"{"orgId":"org-1","targetRole":"phd"}"#;
    let (status, value) = send(&up, request("POST", "/api/org/codes", body)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        value,
        json!({"error": "Only the lab owner can regenerate codes."})
    );
    assert!(calls(&up, INVITE_CODES).is_empty());
}

#[tokio::test]
async fn codes_post_by_the_owner_revokes_then_issues_a_new_code() {
    let up = upstream(vec![
        (
            ORGANIZATIONS,
            vec![json_reply(200, r#"[{"owner_id":"user-1"}]"#)],
        ),
        (INVITE_CODES, vec![empty_reply(204), json_reply(201, "[]")]),
    ])
    .await;
    let body = r#"{"orgId":"org-1","targetRole":"phd"}"#;
    let (status, value) = send(&up, request("POST", "/api/org/codes", body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["targetRole"], "phd");
    let code = value["code"].as_str().expect("code");
    assert!(is_invite_code(code), "{code}");

    let codes = calls(&up, INVITE_CODES);
    let methods: Vec<&str> = codes.iter().map(|s| s.method.as_str()).collect();
    assert_eq!(methods, ["PATCH", "POST"]);
    assert!(
        codes[0].target.contains("target_role=eq.phd"),
        "{}",
        codes[0].target
    );
    assert!(
        codes[0].target.contains("revoked_at=is.null"),
        "{}",
        codes[0].target
    );
    assert_eq!(body_json(&codes[1])["code_hash"], hash_of(code));
}

#[tokio::test]
async fn codes_post_gives_up_after_five_unique_violations() {
    let up = upstream(vec![
        (
            ORGANIZATIONS,
            vec![json_reply(200, r#"[{"owner_id":"user-1"}]"#)],
        ),
        (
            INVITE_CODES,
            vec![empty_reply(204), json_reply(409, r#"{"code":"23505"}"#)],
        ),
    ])
    .await;
    let body = r#"{"orgId":"org-1","targetRole":"phd"}"#;
    let (status, value) = send(&up, request("POST", "/api/org/codes", body)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(value, json!({"error": "Could not generate a unique code."}));
    let inserts = calls(&up, INVITE_CODES)
        .iter()
        .filter(|s| s.method == "POST")
        .count();
    assert_eq!(inserts, 5);
}

#[tokio::test]
async fn create_rejects_a_blank_name() {
    let up = upstream(vec![]).await;
    let (status, value) = send(&up, request("POST", "/api/org/create", r#"{"name":"  "}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Lab name is required."}));
}

#[tokio::test]
async fn create_makes_the_lab_with_three_codes_and_a_profile() {
    let up = upstream(vec![(
        RPC_CREATE,
        vec![json_reply(
            200,
            r#"{"id":"org-1","name":"Lab","owner_id":"user-1","created_at":"2026-01-01T00:00:00Z"}"#,
        )],
    )])
    .await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/create", r#"{"name":"  Lab  "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        value["organization"],
        json!({"id": "org-1", "name": "Lab", "ownerId": "user-1", "createdAt": "2026-01-01T00:00:00Z"})
    );
    let codes = value["codes"].as_array().expect("codes");
    let roles: Vec<&str> = codes
        .iter()
        .map(|c| c["targetRole"].as_str().unwrap())
        .collect();
    assert_eq!(roles, ["professor", "phd", "masters"]);

    let rpc = calls(&up, RPC_CREATE);
    let args = body_json(&rpc[0]);
    assert_eq!(args["p_user_id"], "user-1");
    assert_eq!(args["p_name"], "Lab");
    let sent = args["p_codes"].as_array().expect("p_codes");
    assert_eq!(sent.len(), 3);
    for (row, code) in sent.iter().zip(codes) {
        assert_eq!(row["target_role"], code["targetRole"]);
        let plain = code["code"].as_str().expect("code");
        assert!(is_invite_code(plain), "{plain}");
        assert_eq!(row["code_hash"], hash_of(plain));
    }

    let profile = calls(&up, PROFILES)
        .into_iter()
        .find(|s| s.method == "POST")
        .expect("profile upsert");
    assert!(
        profile.target.contains("on_conflict=user_id"),
        "{}",
        profile.target
    );
    let row = body_json(&profile);
    assert_eq!(row["full_name"], "Ann");
    assert_eq!(row["role"], "masters");
}

#[tokio::test]
async fn create_hides_the_database_message() {
    let up = upstream(vec![(
        RPC_CREATE,
        vec![json_reply(400, r#"{"code":"P0001","message":"boom"}"#)],
    )])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/create", r#"{"name":"Lab"}"#)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let message = value["error"].as_str().expect("error text");
    assert!(!message.contains("boom"), "{message}");
}

#[tokio::test]
async fn create_reports_an_unknown_admin_user() {
    let up = upstream(vec![(
        ADMIN_USER,
        vec![json_reply(404, r#"{"msg":"User not found"}"#)],
    )])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/create", r#"{"name":"Lab"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "User not found"}));
}

#[tokio::test]
async fn standalone_completes_setup_with_the_user_token() {
    let up = upstream(vec![(RPC_COMPLETE, vec![empty_reply(204)])]).await;
    let (status, value) = send(&up, request("POST", "/api/org/standalone", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));

    let rpc = calls(&up, "/rest/v1/rpc/");
    assert_eq!(rpc.len(), 1);
    assert_eq!(rpc[0].header("apikey"), Some("anon"));
    assert_eq!(rpc[0].header("authorization"), Some("Bearer a.b.c"));
    assert_eq!(body_json(&rpc[0]), json!({}));
}

#[tokio::test]
async fn standalone_provisions_the_user_and_retries_setup() {
    let up = upstream(vec![
        (
            RPC_COMPLETE,
            vec![
                json_reply(400, r#"{"code":"P0001","message":"missing"}"#),
                empty_reply(204),
            ],
        ),
        (RPC_ENSURE, vec![empty_reply(204)]),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/standalone", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
    let order: Vec<String> = calls(&up, "/rest/v1/rpc/")
        .into_iter()
        .map(|s| s.target)
        .collect();
    assert_eq!(order, [RPC_COMPLETE, RPC_ENSURE, RPC_COMPLETE]);
}

#[tokio::test]
async fn standalone_reports_a_permission_error_after_the_retry() {
    let denied = r#"{"code":"42501","message":"denied"}"#;
    let up = upstream(vec![
        (RPC_COMPLETE, vec![json_reply(400, denied)]),
        (RPC_ENSURE, vec![json_reply(400, denied)]),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/standalone", "")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        value,
        json!({"error": "You do not have permission to do that. (42501)"})
    );
}

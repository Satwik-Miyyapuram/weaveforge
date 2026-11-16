#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
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
const CODES: &str = "/rest/v1/org_invite_codes";
const ORGS: &str = "/rest/v1/organizations";
const MEMBERSHIPS: &str = "/rest/v1/org_memberships";
const RPC_JOIN: &str = "/rest/v1/rpc/join_organization_atomic";
const CODE_HASH_PATH: &str =
    "code_hash=eq.a79f6c78bd6996b2f806d2e9ba7ad557a75d6daf28c1988d758cfa13c85e8a68";
const JOIN_CODE: &str = r#"{"code":"abc-def-ghj"}"#;
const PROFESSOR_LIST: &str = r#"[{"user_id":"p1"},{"user_id":"p2"}]"#;
const LAB_OWNED_BY_OWNER: &str =
    r#"[{"id":"org-1","name":"Lab","owner_id":"owner-1","created_at":"2026-01-01T00:00:00Z"}]"#;
const LAB_OWNED_BY_USER: &str = r#"[{"owner_id":"user-1"}]"#;
const LAB_OWNER_OF_OTHER: &str = r#"[{"owner_id":"owner-1"}]"#;
const INVITE_PROFESSOR: &str =
    r#"[{"id":"c1","org_id":"org-1","target_role":"professor","code_hash":"x","revoked_at":null}]"#;
const INVITE_PHD: &str =
    r#"[{"id":"c1","org_id":"org-1","target_role":"phd","code_hash":"x","revoked_at":null}]"#;
const INVITE_MASTERS: &str =
    r#"[{"id":"c1","org_id":"org-1","target_role":"masters","code_hash":"x","revoked_at":null}]"#;
const MIGRATION_HINT: &str = "The server is missing a database migration; apply the schema migrations (npm run migrate:schema) and try again.";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An empty 201, as a profile upsert or insert answers.
fn created() -> Reply {
    response(201, &[], b"")
}

/// An empty 204, as an update, delete or void RPC answers.
fn no_content() -> Reply {
    response(204, &[], b"")
}

/// An upstream where `a.b.c` is user `user-1`, plus the given REST replies.
/// The profile upsert every org write makes gets a 201 unless the test gives its own.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let admin = r#"{"id":"user-1","email":"a@b.c","user_metadata":{"full_name":"Ann"}}"#;
    let mut routes = vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        (ADMIN_USER, vec![json_reply(200, admin)]),
    ];
    if !rest.iter().any(|(path, _)| *path == PROFILES) {
        routes.push((PROFILES, vec![created()]));
    }
    routes.extend(rest);
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

/// The requests the upstream saw on the REST API (not the user lookups).
fn rest_calls(up: &Upstream) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target.starts_with("/rest/v1/"))
        .collect()
}

/// The first REST request with this method whose target starts with `path`.
fn call(up: &Upstream, method: &str, path: &str) -> Seen {
    rest_calls(up)
        .into_iter()
        .find(|seen| seen.method == method && seen.target.starts_with(path))
        .expect("the upstream saw the call")
}

fn body_json(seen: &Seen) -> Value {
    serde_json::from_slice(&seen.body).expect("json body")
}

#[tokio::test]
async fn join_with_an_empty_code_is_400() {
    let up = upstream(vec![]).await;
    let (status, value) = send(&up, request("POST", "/api/org/join", r#"{"code":" - "}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Enter a join code."}));
}

#[tokio::test]
async fn join_with_an_unknown_code_is_400() {
    let up = upstream(vec![(CODES, vec![json_reply(200, "[]")])]).await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Invalid or expired join code."}));
    assert!(call(&up, "GET", CODES).target.contains(CODE_HASH_PATH));
    assert!(
        call(&up, "GET", CODES)
            .target
            .contains("revoked_at=is.null")
    );
}

#[tokio::test]
async fn join_when_the_lab_is_missing_is_404() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PHD)]),
        (ORGS, vec![json_reply(200, "[]")]),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(value, json!({"error": "Lab not found."}));
}

#[tokio::test]
async fn join_when_already_a_member_is_400() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PROFESSOR)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![json_reply(200, r#"[{"id":"m1","joined_via":"invite"}]"#)],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "You are already in this lab."}));
}

#[tokio::test]
async fn join_as_a_legacy_member_proceeds() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PROFESSOR)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, r#"[{"id":"m1","joined_via":"legacy"}]"#),
                json_reply(200, "[]"),
                json_reply(200, "[]"),
            ],
        ),
        (RPC_JOIN, vec![no_content()]),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"orgId": "org-1"}));
}

#[tokio::test]
async fn join_phd_with_no_professors_uses_the_owner_as_supervisor() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PHD)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, "[]"),
                json_reply(200, "[]"),
            ],
        ),
        (RPC_JOIN, vec![no_content()]),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"orgId": "org-1"}));
    let rpc = body_json(&call(&up, "POST", RPC_JOIN));
    assert_eq!(rpc["p_role"], json!("phd"));
    assert_eq!(rpc["p_supervisor_id"], json!("owner-1"));
}

#[tokio::test]
async fn join_phd_with_two_professors_needs_a_choice() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PHD)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, PROFESSOR_LIST),
                json_reply(200, "[]"),
            ],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Choose a professor supervisor for this lab."})
    );
    assert!(rest_calls(&up).iter().all(|seen| seen.target != RPC_JOIN));
}

#[tokio::test]
async fn join_phd_with_a_chosen_professor_sends_that_supervisor() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PHD)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, PROFESSOR_LIST),
                json_reply(200, "[]"),
            ],
        ),
        (RPC_JOIN, vec![no_content()]),
    ])
    .await;
    let body = r#"{"code":"abc-def-ghj","professorSupervisorId":"p2"}"#;
    let (status, value) = send(&up, request("POST", "/api/org/join", body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"orgId": "org-1"}));
    assert_eq!(
        body_json(&call(&up, "POST", RPC_JOIN))["p_supervisor_id"],
        json!("p2")
    );
}

#[tokio::test]
async fn join_masters_without_a_phd_choice_is_400() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_MASTERS)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, "[]"),
                json_reply(200, "[]"),
            ],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Choose a PhD supervisor in this lab."})
    );
}

#[tokio::test]
async fn join_masters_with_a_listed_phd_sends_that_supervisor() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_MASTERS)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, "[]"),
                json_reply(200, r#"[{"user_id":"ph1"}]"#),
            ],
        ),
        (RPC_JOIN, vec![no_content()]),
    ])
    .await;
    let body = r#"{"code":"abc-def-ghj","phdSupervisorId":"ph1"}"#;
    let (status, _) = send(&up, request("POST", "/api/org/join", body)).await;
    assert_eq!(status, StatusCode::OK);
    let rpc = body_json(&call(&up, "POST", RPC_JOIN));
    assert_eq!(rpc["p_role"], json!("masters"));
    assert_eq!(rpc["p_supervisor_id"], json!("ph1"));
}

#[tokio::test]
async fn join_as_a_professor_sends_no_supervisor() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PROFESSOR)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, "[]"),
                json_reply(200, "[]"),
            ],
        ),
        (RPC_JOIN, vec![no_content()]),
    ])
    .await;
    let (status, _) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::OK);
    let rpc = body_json(&call(&up, "POST", RPC_JOIN));
    assert_eq!(rpc["p_role"], json!("professor"));
    assert_eq!(rpc["p_supervisor_id"], Value::Null);
}

#[tokio::test]
async fn join_with_a_revoked_code_mid_join_is_400_with_that_text() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PROFESSOR)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, "[]"),
                json_reply(200, "[]"),
            ],
        ),
        (
            RPC_JOIN,
            vec![json_reply(
                400,
                r#"{"message":"invite code is no longer valid"}"#,
            )],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "invite code is no longer valid"}));
}

#[tokio::test]
async fn join_rpc_failure_is_500_without_the_raw_text() {
    let up = upstream(vec![
        (CODES, vec![json_reply(200, INVITE_PROFESSOR)]),
        (ORGS, vec![json_reply(200, LAB_OWNED_BY_OWNER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, "[]"),
                json_reply(200, "[]"),
                json_reply(200, "[]"),
            ],
        ),
        (
            RPC_JOIN,
            vec![json_reply(400, r#"{"code":"P0001","message":"boom"}"#)],
        ),
    ])
    .await;
    let (status, value) = send(&up, request("POST", "/api/org/join", JOIN_CODE)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!value.to_string().contains("boom"));
}

#[tokio::test]
async fn switch_without_an_org_id_is_400() {
    let up = upstream(vec![]).await;
    let (status, value) = send(&up, request("POST", "/api/org/switch", "{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "orgId required"}));
}

#[tokio::test]
async fn switch_to_a_lab_you_are_not_in_is_403() {
    let up = upstream(vec![(MEMBERSHIPS, vec![json_reply(200, "[]")])]).await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/switch", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(value, json!({"error": "Not a member of this lab."}));
}

#[tokio::test]
async fn switch_sets_the_active_lab_and_its_role() {
    let up = upstream(vec![
        (PROFILES, vec![created(), no_content()]),
        (
            MEMBERSHIPS,
            vec![json_reply(200, r#"[{"role":"phd","supervisor_id":"p1"}]"#)],
        ),
    ])
    .await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/switch", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
    let patch = call(&up, "PATCH", PROFILES);
    assert!(patch.target.contains("user_id=eq.user-1"));
    assert_eq!(
        body_json(&patch),
        json!({
            "active_org_id": "org-1",
            "role": "phd",
            "supervisor_id": "p1",
            "org_setup_complete": true
        })
    );
}

#[tokio::test]
async fn leave_without_an_org_id_is_400() {
    let up = upstream(vec![]).await;
    let (status, value) = send(&up, request("POST", "/api/org/leave", "{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "orgId required."}));
}

#[tokio::test]
async fn leave_as_the_owner_is_403() {
    let up = upstream(vec![(ORGS, vec![json_reply(200, LAB_OWNED_BY_USER)])]).await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/leave", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        value,
        json!({
            "error": "Lab owners cannot leave \u{2014} delete the lab or transfer ownership first."
        })
    );
}

#[tokio::test]
async fn leave_a_lab_you_are_not_in_is_403() {
    let up = upstream(vec![
        (ORGS, vec![json_reply(200, LAB_OWNER_OF_OTHER)]),
        (MEMBERSHIPS, vec![json_reply(200, "[]")]),
    ])
    .await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/leave", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(value, json!({"error": "Not a member of this lab."}));
}

#[tokio::test]
async fn leave_a_missing_lab_is_404() {
    let up = upstream(vec![(ORGS, vec![json_reply(200, "[]")])]).await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/leave", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(value, json!({"error": "Lab not found."}));
}

#[tokio::test]
async fn leave_the_active_lab_moves_to_the_next_membership() {
    let up = upstream(vec![
        (ORGS, vec![json_reply(200, LAB_OWNER_OF_OTHER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, r#"[{"id":"m1"}]"#),
                no_content(),
                json_reply(
                    200,
                    r#"[{"org_id":"org-2","role":"phd","supervisor_id":"p9"}]"#,
                ),
            ],
        ),
        (
            PROFILES,
            vec![
                created(),
                json_reply(200, r#"[{"active_org_id":"org-1"}]"#),
                no_content(),
            ],
        ),
    ])
    .await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/leave", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
    assert_eq!(
        body_json(&call(&up, "PATCH", PROFILES)),
        json!({
            "active_org_id": "org-2",
            "role": "phd",
            "supervisor_id": "p9",
            "org_setup_complete": true
        })
    );
}

#[tokio::test]
async fn leave_the_only_lab_goes_standalone() {
    let up = upstream(vec![
        (ORGS, vec![json_reply(200, LAB_OWNER_OF_OTHER)]),
        (
            MEMBERSHIPS,
            vec![
                json_reply(200, r#"[{"id":"m1"}]"#),
                no_content(),
                json_reply(200, "[]"),
            ],
        ),
        (
            PROFILES,
            vec![
                created(),
                json_reply(200, r#"[{"active_org_id":"org-1"}]"#),
                no_content(),
            ],
        ),
    ])
    .await;
    let (status, _) = send(
        &up,
        request("POST", "/api/org/leave", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body_json(&call(&up, "PATCH", PROFILES)),
        json!({
            "active_org_id": null,
            "supervisor_id": null,
            "role": "standalone",
            "org_setup_complete": true
        })
    );
}

#[tokio::test]
async fn leave_a_lab_that_is_not_active_leaves_the_profile_alone() {
    let up = upstream(vec![
        (ORGS, vec![json_reply(200, LAB_OWNER_OF_OTHER)]),
        (
            MEMBERSHIPS,
            vec![json_reply(200, r#"[{"id":"m1"}]"#), no_content()],
        ),
        (
            PROFILES,
            vec![created(), json_reply(200, r#"[{"active_org_id":"org-9"}]"#)],
        ),
    ])
    .await;
    let (status, value) = send(
        &up,
        request("POST", "/api/org/leave", r#"{"orgId":"org-1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
    assert!(rest_calls(&up).iter().all(|seen| seen.method != "PATCH"));
    assert!(
        call(&up, "DELETE", MEMBERSHIPS)
            .target
            .contains("user_id=eq.user-1")
    );
}

#[tokio::test]
async fn memberships_name_each_lab_and_map_the_join_source() {
    let rows = r#"[
        {"org_id":"org-1","role":"phd","joined_via":"invite","organizations":{"name":"Lab One"}},
        {"org_id":"org-2","role":"masters","joined_via":"legacy","organizations":[{"name":"Lab Two"}]},
        {"org_id":"org-3","role":"professor","joined_via":"create","organizations":null},
        {"org_id":"org-4","role":"masters","joined_via":null,"organizations":{"name":"Lab Four"}}
    ]"#;
    let up = upstream(vec![(MEMBERSHIPS, vec![json_reply(200, rows)])]).await;
    let (status, value) = send(&up, request("GET", "/api/org/memberships", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({"memberships": [
            {"orgId": "org-1", "orgName": "Lab One", "role": "phd", "joinSource": "invite"},
            {"orgId": "org-2", "orgName": "Lab Two", "role": "masters", "joinSource": "legacy"},
            {"orgId": "org-3", "orgName": "Lab", "role": "professor", "joinSource": "create"},
            {"orgId": "org-4", "orgName": "Lab Four", "role": "masters", "joinSource": "legacy"}
        ]})
    );
    let target = call(&up, "GET", MEMBERSHIPS).target;
    assert!(target.contains("user_id=eq.user-1"));
    assert!(target.contains("order=joined_at.asc"));
}

#[tokio::test]
async fn memberships_database_error_gives_the_migration_hint() {
    let up = upstream(vec![(
        MEMBERSHIPS,
        vec![json_reply(500, r#"{"code":"PGRST205"}"#)],
    )])
    .await;
    let (status, value) = send(&up, request("GET", "/api/org/memberships", "")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        value,
        json!({"error": format!("{MIGRATION_HINT} (PGRST205)")})
    );
}

#[tokio::test]
async fn mine_maps_the_owned_labs_and_filters_by_owner() {
    let up = upstream(vec![(
        ORGS,
        vec![json_reply(
            200,
            r#"[{"id":"org-1","name":"Lab","owner_id":"user-1","created_at":"2026-01-01T00:00:00Z"}]"#,
        )],
    )])
    .await;
    let (status, value) = send(&up, request("GET", "/api/org/mine", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({"organizations": [
            {"id": "org-1", "name": "Lab", "ownerId": "user-1", "createdAt": "2026-01-01T00:00:00Z"}
        ]})
    );
    let target = call(&up, "GET", ORGS).target;
    assert!(target.contains("owner_id=eq.user-1"));
    assert!(target.contains("order=created_at.asc"));
}

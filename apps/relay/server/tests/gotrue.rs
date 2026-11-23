//! The GoTrue client and caller profile lookup, against a stand-in for Supabase.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use common::{Reply, Upstream, response, serve};
use serde_json::{Value, json};
use wf_core::member::OtpInput;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::gotrue::{
    Member, admin_create_user, admin_delete_user, resolve_member, send_email_otp, session_user_id,
    verify_email_otp,
};
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::AppState;
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const PROFILES: &str = "/rest/v1/profiles";
const INVITE: &str = "/auth/v1/invite";
const ADMIN_USERS: &str = "/auth/v1/admin/users";
/// The page that ends a user lookup.
const EMPTY_PAGE: &str = r#"{"users":[]}"#;
/// A `created_at` after any test run, so the date check passes.
const NEW: &str = "2999-01-01T00:00:00Z";
/// An invite reply naming a user made by that call.
const MADE_NOW: &str = r#"{"id":"new1","created_at":"2999-01-01T00:00:00Z"}"#;

/// A user list page of invited users `(id, email, created_at)`.
fn page_of(users: &[(&str, &str, &str)]) -> String {
    let users: Vec<Value> = users
        .iter()
        .map(|(id, email, created)| {
            json!({"id": id, "email": email, "created_at": created, "invited_at": NEW})
        })
        .collect();
    json!({ "users": users }).to_string()
}

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where the session `a.b.c` is user `u1`, plus the given routes.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)]));
    serve(routes).await
}

fn state(supabase_port: u16) -> Arc<AppState> {
    let supabase = format!("http://127.0.0.1:{supabase_port}");
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

/// A port with nothing listening on it.
fn closed_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[tokio::test]
async fn session_user_id_reads_the_user_from_a_valid_session() {
    let up = upstream(vec![]).await;
    let state = state(up.port);
    assert_eq!(
        session_user_id(&state, SESSION).await,
        Some("u1".to_string())
    );
    let seen = up.seen();
    assert_eq!(seen[0].header("apikey"), Some("anon"));
    assert_eq!(seen[0].header("authorization"), Some("Bearer a.b.c"));
}

#[tokio::test]
async fn session_user_id_is_none_when_supabase_refuses_the_session() {
    let up = serve(vec![(AUTH_USER, vec![json_reply(401, r#"{"msg":"bad"}"#)])]).await;
    assert_eq!(session_user_id(&state(up.port), SESSION).await, None);
}

#[tokio::test]
async fn resolve_member_is_none_without_a_session() {
    let up = serve(vec![(AUTH_USER, vec![json_reply(401, "{}")])]).await;
    let member = resolve_member(&state(up.port), SESSION).await.unwrap();
    assert_eq!(member, None);
}

#[tokio::test]
async fn resolve_member_reads_the_profile_with_the_service_role() {
    let row = r#"[{"user_id":"u1","email":"a@x.org","full_name":null,"role":"phd","supervisor_id":"p1"}]"#;
    let up = upstream(vec![(PROFILES, vec![json_reply(200, row)])]).await;
    let member = resolve_member(&state(up.port), SESSION)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        member,
        Member {
            id: "u1".to_string(),
            email: Some("a@x.org".to_string()),
            full_name: None,
            role: "phd".to_string(),
            supervisor_id: Some("p1".to_string()),
        }
    );
    let seen = up.seen();
    let profile = seen
        .iter()
        .find(|s| s.target.starts_with(PROFILES))
        .unwrap();
    assert!(profile.target.contains("user_id=eq.u1"));
    assert_eq!(profile.header("apikey"), Some("service"));
}

#[tokio::test]
async fn resolve_member_is_none_without_a_profile_row() {
    let up = upstream(vec![(PROFILES, vec![json_reply(200, "[]")])]).await;
    let member = resolve_member(&state(up.port), SESSION).await.unwrap();
    assert_eq!(member, None);
}

#[tokio::test]
async fn resolve_member_fails_when_the_profile_query_fails() {
    let up = upstream(vec![(
        PROFILES,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    assert!(resolve_member(&state(up.port), SESSION).await.is_err());
}

#[test]
fn member_json_leaves_out_absent_fields() {
    let bare = Member {
        id: "u1".to_string(),
        email: None,
        full_name: None,
        role: "masters".to_string(),
        supervisor_id: None,
    };
    assert_eq!(bare.to_json(), json!({"id": "u1", "role": "masters"}));
    let full = Member {
        id: "u1".to_string(),
        email: Some("a@x.org".to_string()),
        full_name: Some("Ann".to_string()),
        role: "phd".to_string(),
        supervisor_id: Some("p1".to_string()),
    };
    assert_eq!(
        full.to_json(),
        json!({"id": "u1", "email": "a@x.org", "fullName": "Ann", "role": "phd", "supervisorId": "p1"})
    );
}

#[tokio::test]
async fn admin_create_invites_by_email_with_the_name_only_when_given() {
    let up = serve(vec![(INVITE, vec![json_reply(200, MADE_NOW)])]).await;
    let state = state(up.port);
    let named = admin_create_user(&state, "a@x.org", Some("Ann")).await;
    assert_eq!(named, Ok("new1".to_string()));
    let unnamed = admin_create_user(&state, "b@x.org", None).await;
    assert_eq!(unnamed, Ok("new1".to_string()));

    let seen = up.seen();
    assert_eq!(seen.len(), 2, "{seen:?}");
    for call in &seen {
        assert_eq!(call.method, "POST");
        assert_eq!(
            call.target,
            "/auth/v1/invite?redirect_to=https%3A%2F%2Fapp.weaveforge.org%2Freset-password"
        );
        assert_eq!(call.header("apikey"), Some("service"));
    }
    // Exact bodies: no password, no `email_confirm`, the name under `data`.
    let first: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(
        first,
        json!({"email": "a@x.org", "data": {"full_name": "Ann"}})
    );
    let second: Value = serde_json::from_slice(&seen[1].body).unwrap();
    assert_eq!(second, json!({"email": "b@x.org"}));
}

/// The invite link returns to the configured app origin.
#[tokio::test]
async fn admin_create_returns_the_invite_to_the_configured_origin() {
    let up = serve(vec![(INVITE, vec![json_reply(200, MADE_NOW)])]).await;
    let mut state = state(up.port);
    Arc::get_mut(&mut state).unwrap().settings.app_origin = "http://localhost:3000".to_string();
    assert_eq!(
        admin_create_user(&state, "a@x.org", None).await,
        Ok("new1".to_string())
    );
    assert_eq!(
        up.seen()[0].target,
        "/auth/v1/invite?redirect_to=http%3A%2F%2Flocalhost%3A3000%2Freset-password"
    );
}

#[tokio::test]
async fn admin_create_reads_the_id_from_a_user_object() {
    let up = serve(vec![(
        INVITE,
        vec![json_reply(
            200,
            &format!(r#"{{"user":{{"id":"new2","created_at":"{NEW}"}}}}"#),
        )],
    )])
    .await;
    let created = admin_create_user(&state(up.port), "a@x.org", None).await;
    assert_eq!(created, Ok("new2".to_string()));
}

/// GoTrue re-sends an invite to an existing unconfirmed account and answers 200 with it: an
/// older user (or an unreadable stamp) is a taken email, refused with no further call (no
/// lookup, no delete).
#[tokio::test]
async fn admin_create_refuses_an_invite_answered_with_an_older_user() {
    for (reply, refusal) in [
        (
            r#"{"id":"old1","created_at":"2001-01-01T00:00:00Z"}"#,
            "Email already registered.",
        ),
        (
            r#"{"user":{"id":"old1","created_at":"2001-01-01T00:00:00.5+00:00"}}"#,
            "Email already registered.",
        ),
        (
            r#"{"id":"old1","created_at":"yesterday"}"#,
            "Email already registered.",
        ),
    ] {
        let up = serve(vec![(INVITE, vec![json_reply(200, reply)])]).await;
        let created = admin_create_user(&state(up.port), "a@x.org", None).await;
        assert_eq!(created, Err(refusal.to_string()), "{reply}");
        assert_eq!(up.seen().len(), 1, "{reply}");
    }
}

/// A user made two minutes before the call is outside the 30 s skew: another admin's pending
/// invite, so it is refused as taken and never given a profile or deleted.
#[tokio::test]
async fn admin_create_refuses_a_user_made_minutes_before_the_call() {
    let reply = json!({"id": "old1", "created_at": stamp_secs_ago(120)}).to_string();
    let up = serve(vec![(INVITE, vec![json_reply(200, &reply)])]).await;
    let created = admin_create_user(&state(up.port), "a@x.org", None).await;
    assert_eq!(created, Err("Email already registered.".to_string()));
    assert_eq!(up.seen().len(), 1);
}

/// An undated reply with an id may still be a new user, so it is cleaned up like an unnamed
/// one (exact email, invited, inside the skew, no profile) and the create fails.
#[tokio::test]
async fn admin_create_with_an_undated_reply_deletes_the_half_made_user() {
    for reply in [r#"{"id":"new1"}"#, r#"{"id":"new1","created_at":null}"#] {
        let list = page_of(&[("new1", "a@x.org", NEW)]);
        let up = serve(vec![
            (INVITE, vec![json_reply(200, reply)]),
            (
                ADMIN_USERS,
                vec![json_reply(200, &list), json_reply(200, EMPTY_PAGE)],
            ),
            ("/auth/v1/admin/users/new1", vec![json_reply(200, "{}")]),
            (PROFILES, vec![json_reply(200, "[]")]),
        ])
        .await;
        let created = admin_create_user(&state(up.port), "a@x.org", None).await;
        assert_eq!(
            created,
            Err("Failed to create user.".to_string()),
            "{reply}"
        );
        let seen = up.seen();
        let last = seen.last().expect("calls");
        assert_eq!(last.method, "DELETE", "{reply}: {seen:?}");
        assert_eq!(last.target, "/auth/v1/admin/users/new1", "{reply}");
    }
}

/// The cleanup leaves alone a matching user made minutes before the call.
#[tokio::test]
async fn admin_create_cleanup_never_deletes_a_user_made_minutes_before_the_call() {
    let old = stamp_secs_ago(120);
    let list = page_of(&[("old1", "a@x.org", &old)]);
    let up = serve(vec![
        (INVITE, vec![json_reply(200, r#"{"id":""}"#)]),
        (
            ADMIN_USERS,
            vec![json_reply(200, &list), json_reply(200, EMPTY_PAGE)],
        ),
        (PROFILES, vec![json_reply(200, "[]")]),
    ])
    .await;
    let created = admin_create_user(&state(up.port), "a@x.org", None).await;
    assert_eq!(created, Err("Failed to create user.".to_string()));
    let seen = up.seen();
    assert!(seen.iter().all(|s| s.method != "DELETE"), "{seen:?}");
}

/// The GoTrue-style UTC stamp `secs` seconds before now.
fn stamp_secs_ago(secs: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs();
    let at = now - secs;
    let (days, rest) = (at / 86_400, at % 86_400);
    // Civil date from days since 1970-01-01 (H. Hinnant's algorithm).
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}
/// A create that answers 200 with no id made a user we cannot name: find it by email and
/// delete it, so no auth user is left without a profile. Still a failure for the caller.
#[tokio::test]
async fn admin_create_without_an_id_deletes_the_half_made_user() {
    let list = page_of(&[
        ("other", "a@x.org.evil", NEW),
        ("made1", "A@X.org", "2999-01-01T00:00:00.123456Z"),
    ]);
    let up = serve(vec![
        (INVITE, vec![json_reply(200, r#"{"id":""}"#)]),
        (
            ADMIN_USERS,
            vec![json_reply(200, &list), json_reply(200, EMPTY_PAGE)],
        ),
        ("/auth/v1/admin/users/made1", vec![json_reply(200, "{}")]),
        (PROFILES, vec![json_reply(200, "[]")]),
    ])
    .await;
    let created = admin_create_user(&state(up.port), "a@x.org", None).await;
    assert_eq!(created, Err("Failed to create user.".to_string()));
    let seen = up.seen();
    assert_eq!(seen.len(), 5, "{seen:?}");
    assert_eq!(seen[1].method, "GET");
    assert!(
        seen[1].target.starts_with("/auth/v1/admin/users?"),
        "{}",
        seen[1].target
    );
    assert!(
        seen[1].target.contains("filter=a%40x.org"),
        "{}",
        seen[1].target
    );
    assert_eq!(seen[1].header("apikey"), Some("service"));
    assert!(seen[2].target.contains("page=2"), "{}", seen[2].target);
    // Only a user with no profile row is taken for the half-made one.
    assert!(seen[3].target.starts_with(PROFILES), "{}", seen[3].target);
    assert!(
        seen[3].target.contains("user_id=eq.made1"),
        "{}",
        seen[3].target
    );
    assert_eq!(seen[4].method, "DELETE");
    assert_eq!(seen[4].target, "/auth/v1/admin/users/made1");
}

/// The lookup reads further pages until one comes back empty.
#[tokio::test]
async fn admin_create_without_an_id_finds_the_user_on_a_later_page() {
    let others: Vec<String> = (0..50)
        .map(|i| format!(r#"{{"id":"o{i}","email":"o{i}@x.org"}}"#))
        .collect();
    let full_page = format!(r#"{{"users":[{}]}}"#, others.join(","));
    let up = serve(vec![
        (INVITE, vec![json_reply(200, "{}")]),
        (
            ADMIN_USERS,
            vec![
                json_reply(200, &full_page),
                json_reply(
                    200,
                    &page_of(&[("made2", "a@x.org", "2999-01-01T00:00:00+00:00")]),
                ),
                json_reply(200, EMPTY_PAGE),
            ],
        ),
        ("/auth/v1/admin/users/made2", vec![json_reply(200, "{}")]),
        (PROFILES, vec![json_reply(200, "[]")]),
    ])
    .await;
    let created = admin_create_user(&state(up.port), "a@x.org", None).await;
    assert_eq!(created, Err("Failed to create user.".to_string()));
    let seen = up.seen();
    assert!(seen[1].target.contains("page=1"), "{}", seen[1].target);
    assert!(seen[2].target.contains("page=2"), "{}", seen[2].target);
    let deletes: Vec<_> = seen.iter().filter(|s| s.method == "DELETE").collect();
    assert_eq!(deletes.len(), 1, "{seen:?}");
    assert_eq!(deletes[0].target, "/auth/v1/admin/users/made2");
}

/// A match that already has a profile is a real account, and a failed profile check
/// proves nothing: neither is deleted.
#[tokio::test]
async fn admin_create_without_an_id_never_deletes_a_user_with_a_profile() {
    for profile in [
        json_reply(200, r#"[{"user_id":"made1"}]"#),
        json_reply(500, r#"{"message":"down"}"#),
    ] {
        let up = serve(vec![
            (INVITE, vec![json_reply(200, "{}")]),
            (
                ADMIN_USERS,
                vec![
                    json_reply(200, &page_of(&[("made1", "a@x.org", NEW)])),
                    json_reply(200, EMPTY_PAGE),
                ],
            ),
            ("/auth/v1/admin/users/made1", vec![json_reply(200, "{}")]),
            (PROFILES, vec![profile]),
        ])
        .await;
        let created = admin_create_user(&state(up.port), "a@x.org", None).await;
        assert_eq!(created, Err("Failed to create user.".to_string()));
        assert!(
            up.seen().iter().all(|seen| seen.method != "DELETE"),
            "{:?}",
            up.seen()
        );
    }
}

/// When the lookup fails or names no single safe, new, exact match, nothing is deleted and
/// the create still fails. Every match below is dated after the call unless the case is the
/// date, so only the check under test can stop the delete.
#[tokio::test]
async fn admin_create_without_an_id_fails_closed_when_the_user_is_not_found() {
    // Repeats forever on the stand-in: the page cap must end the lookup.
    let others: Vec<String> = (0..50)
        .map(|i| format!(r#"{{"id":"o{i}","email":"o{i}@x.org"}}"#))
        .collect();
    let endless = format!(r#"{{"users":[{}]}}"#, others.join(","));
    let one = |id: &str, created: &str| page_of(&[(id, "a@x.org", created)]);
    // Each page list is followed by an empty page, so only the matches decide.
    let then_empty = |page: &str| vec![json_reply(200, page), json_reply(200, EMPTY_PAGE)];
    for lookup in [
        vec![json_reply(200, &endless)],
        // A single match, then pages that never end: the cap means "unknown", not "one".
        vec![json_reply(200, &one("x1", NEW)), json_reply(200, &endless)],
        vec![json_reply(500, r#"{"msg":"down"}"#)],
        vec![json_reply(200, EMPTY_PAGE)],
        then_empty(&page_of(&[("x", "aa@x.org", NEW)])),
        then_empty(&one("", NEW)),
        then_empty(&page_of(&[("x1", "a@x.org", NEW), ("x2", "a@x.org", NEW)])),
        // A second exact match with a bad or missing id still counts: two matches, no delete.
        then_empty(&page_of(&[
            ("bad id!", "a@x.org", NEW),
            ("x2", "a@x.org", NEW),
        ])),
        then_empty(&format!(
            r#"{{"users":[{{"email":"A@x.org","created_at":"{NEW}"}},
            {{"id":"x2","email":"a@x.org","created_at":"{NEW}"}}]}}"#
        )),
        // A server that pages below the size asked for: the second match is on page 2.
        vec![
            json_reply(200, &one("x1", NEW)),
            json_reply(200, &one("x2", NEW)),
            json_reply(200, EMPTY_PAGE),
        ],
        // One match whose id would change the delete path.
        then_empty(&one("a/../b", NEW)),
        then_empty(&one("x?y", NEW)),
        then_empty(&one(".", NEW)),
        // One match made before the call, or with no readable UTC date: someone else's account.
        then_empty(&one("x1", "2026-01-01T00:00:00Z")),
        then_empty(&one("x1", "2999-01-01T00:00:00+02:00")),
        then_empty(&one("x1", "2999-01-01 00:00:00Z")),
        then_empty(&one("x1", "2999")),
        then_empty(&format!(
            r#"{{"users":[{{"id":"x1","email":"a@x.org","invited_at":"{NEW}"}}]}}"#
        )),
        // One new match that was never invited: another signup, not this invite. A confirmed
        // email alone (what the old create asked for) is not enough.
        then_empty(&format!(
            r#"{{"users":[{{"id":"x1","email":"a@x.org","created_at":"{NEW}"}}]}}"#
        )),
        then_empty(&format!(
            r#"{{"users":[{{"id":"x1","email":"a@x.org","created_at":"{NEW}",
            "invited_at":null}}]}}"#
        )),
        then_empty(&format!(
            r#"{{"users":[{{"id":"x1","email":"a@x.org","created_at":"{NEW}",
            "email_confirmed_at":"{NEW}"}}]}}"#
        )),
        vec![json_reply(200, "not json")],
    ] {
        // No profile rows: only the lookup can stop the delete.
        let up = serve(vec![
            (INVITE, vec![json_reply(200, "{}")]),
            (ADMIN_USERS, lookup),
            (PROFILES, vec![json_reply(200, "[]")]),
        ])
        .await;
        let created = admin_create_user(&state(up.port), "a@x.org", None).await;
        assert_eq!(created, Err("Failed to create user.".to_string()));
        assert!(
            up.seen().iter().all(|seen| seen.method != "DELETE"),
            "{:?}",
            up.seen()
        );
    }
}

/// A 2xx create whose body is not a JSON object may not be GoTrue at all: fail with no
/// lookup, so nothing is deleted on its word.
#[tokio::test]
async fn admin_create_with_a_body_that_is_not_an_object_makes_no_lookup() {
    for body in ["<html>ok</html>", "not json", "[]", r#""made1""#, "null"] {
        let up = serve(vec![
            (INVITE, vec![json_reply(200, body)]),
            (
                ADMIN_USERS,
                vec![json_reply(200, &page_of(&[("x1", "a@x.org", NEW)]))],
            ),
        ])
        .await;
        let created = admin_create_user(&state(up.port), "a@x.org", None).await;
        assert_eq!(created, Err("Failed to create user.".to_string()));
        assert_eq!(up.seen().len(), 1, "{body}: {:?}", up.seen());
    }
}

#[tokio::test]
async fn admin_create_taken_email_is_fixed_wording() {
    let body = r#"{"msg":"A user with this email secret-key has already been registered"}"#;
    let up = serve(vec![(INVITE, vec![json_reply(422, body)])]).await;
    let created = admin_create_user(&state(up.port), "a@x.org", None).await;
    assert_eq!(created, Err("Email already registered.".to_string()));
    assert_eq!(up.seen().len(), 1, "{:?}", up.seen());
}

#[tokio::test]
async fn admin_create_other_refusal_is_fixed_wording_not_the_auth_text() {
    let body = r#"{"msg":"db.internal secret-key down"}"#;
    let up = serve(vec![(INVITE, vec![json_reply(500, body)])]).await;
    let created = admin_create_user(&state(up.port), "a@x.org", None).await;
    assert_eq!(created, Err("Failed to create user.".to_string()));
}

#[tokio::test]
async fn admin_delete_succeeds_and_sends_no_soft_delete() {
    let up = serve(vec![(
        "/auth/v1/admin/users/u1",
        vec![json_reply(200, "{}")],
    )])
    .await;
    assert_eq!(admin_delete_user(&state(up.port), "u1").await, Ok(()));
    let seen = up.seen();
    assert_eq!(seen[0].method, "DELETE");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body, json!({"should_soft_delete": false}));
}

#[tokio::test]
async fn admin_delete_failure_is_fixed_wording_not_the_auth_text() {
    for (status, body) in [
        (404, r#"{"msg":"User not found secret-key"}"#),
        (403, r#"{"msg":"Forbidden: invalid JWT secret-key"}"#),
    ] {
        let up = serve(vec![(
            "/auth/v1/admin/users/u1",
            vec![json_reply(status, body)],
        )])
        .await;
        let deleted = admin_delete_user(&state(up.port), "u1").await;
        assert_eq!(
            deleted,
            Err("Failed to delete user.".to_string()),
            "{status}"
        );
    }
}

/// An id that would change the admin path is refused before any request is sent.
#[tokio::test]
async fn admin_delete_refuses_an_id_that_is_not_uuid_like() {
    let up = serve(vec![]).await;
    for id in ["", "a/../b", "x?y", ".", "u1#frag", "a b", "é"] {
        let deleted = admin_delete_user(&state(up.port), id).await;
        assert_eq!(deleted, Err("Failed to delete user.".to_string()), "{id}");
    }
    assert!(up.seen().is_empty(), "{:?}", up.seen());
}

#[tokio::test]
async fn send_email_otp_uses_the_anon_key_and_no_signup() {
    let up = serve(vec![("/auth/v1/otp", vec![json_reply(200, "{}")])]).await;
    assert_eq!(send_email_otp(&state(up.port), "a@x.org").await, Ok(()));
    let seen = up.seen();
    assert_eq!(seen[0].header("apikey"), Some("anon"));
    assert_eq!(seen[0].header("authorization"), Some("Bearer anon"));
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body, json!({"email": "a@x.org", "create_user": false}));
}

#[tokio::test]
async fn send_email_otp_failure_is_fixed_wording_not_the_auth_text() {
    let up = serve(vec![(
        "/auth/v1/otp",
        vec![json_reply(
            500,
            r#"{"error_description":"smtp.internal:587 secret-key"}"#,
        )],
    )])
    .await;
    assert_eq!(
        send_email_otp(&state(up.port), "a@x.org").await,
        Err("Failed to send confirmation code.".to_string())
    );
}

#[tokio::test]
async fn send_email_otp_rate_limit_says_to_wait() {
    let up = serve(vec![(
        "/auth/v1/otp",
        vec![json_reply(429, r#"{"msg":"rate secret-key"}"#)],
    )])
    .await;
    assert_eq!(
        send_email_otp(&state(up.port), "a@x.org").await,
        Err("Too many code requests. Wait a minute and try again.".to_string())
    );
}

#[tokio::test]
async fn verify_with_a_code_sends_the_email_and_token() {
    let up = serve(vec![(
        "/auth/v1/verify",
        vec![json_reply(200, r#"{"user":{"id":"u1"}}"#)],
    )])
    .await;
    let otp = OtpInput::Token("123456".to_string());
    let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
    assert_eq!(verified, Ok("u1".to_string()));
    let body: Value = serde_json::from_slice(&up.seen()[0].body).unwrap();
    assert_eq!(
        body,
        json!({"type": "email", "email": "a@x.org", "token": "123456"})
    );
}

#[tokio::test]
async fn verify_with_a_token_hash_sends_no_email() {
    let up = serve(vec![(
        "/auth/v1/verify",
        vec![json_reply(200, r#"{"id":"u1"}"#)],
    )])
    .await;
    let otp = OtpInput::TokenHash("abc".to_string());
    let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
    assert_eq!(verified, Ok("u1".to_string()));
    let body: Value = serde_json::from_slice(&up.seen()[0].body).unwrap();
    assert_eq!(body, json!({"type": "email", "token_hash": "abc"}));
}

#[tokio::test]
async fn verify_falls_back_to_a_fixed_message_without_one() {
    let up = serve(vec![("/auth/v1/verify", vec![json_reply(403, "{}")])]).await;
    let otp = OtpInput::Token("123456".to_string());
    let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
    assert_eq!(
        verified,
        Err("Invalid or expired confirmation code.".to_string())
    );
}

#[tokio::test]
async fn verify_refusal_is_fixed_wording_not_the_auth_text() {
    for status in [400, 403, 422] {
        let up = serve(vec![(
            "/auth/v1/verify",
            vec![json_reply(
                status,
                r#"{"msg":"Token secret-key has expired"}"#,
            )],
        )])
        .await;
        let otp = OtpInput::Token("123456".to_string());
        let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
        assert_eq!(
            verified,
            Err("Invalid or expired confirmation code.".to_string()),
            "{status}"
        );
    }
}

#[tokio::test]
async fn verify_server_failure_is_not_called_an_invalid_code() {
    // 401 (our key refused) and 404 are not a bad code either.
    for status in [401, 404, 429, 500] {
        let up = serve(vec![(
            "/auth/v1/verify",
            vec![json_reply(status, r#"{"msg":"invalid db secret-key"}"#)],
        )])
        .await;
        let otp = OtpInput::Token("123456".to_string());
        let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
        assert_eq!(
            verified,
            Err("The sign-in server could not check the code. Try again later.".to_string()),
            "{status}"
        );
    }
}

#[tokio::test]
async fn verify_ok_without_a_user_id_is_a_server_failure_not_a_bad_code() {
    // GoTrue accepted the code, so the user did nothing wrong: no "invalid code" (400).
    for body in ["{}", r#"{"id":""}"#, r#"{"user":{}}"#, "not json"] {
        let up = serve(vec![("/auth/v1/verify", vec![json_reply(200, body)])]).await;
        let otp = OtpInput::Token("123456".to_string());
        let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
        assert_eq!(
            verified,
            Err("The sign-in server could not check the code. Try again later.".to_string()),
            "{body}"
        );
    }
}

#[tokio::test]
async fn reply_past_the_size_cap_is_not_read() {
    // A valid user, padded past the 1 MiB cap: the relay must not buffer it or trust it.
    let pad = "a".repeat(1024 * 1024);
    let body = format!(r#"{{"user":{{"id":"u1"}},"pad":"{pad}"}}"#);
    let up = serve(vec![("/auth/v1/verify", vec![json_reply(200, &body)])]).await;
    let otp = OtpInput::Token("123456".to_string());
    let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
    assert_eq!(
        verified,
        Err("The sign-in server could not check the code. Try again later.".to_string())
    );
}

#[tokio::test]
async fn unreachable_auth_server_is_reported_as_such() {
    let state = state(closed_port());
    assert_eq!(
        send_email_otp(&state, "a@x.org").await,
        Err("Could not reach the auth server.".to_string())
    );
    assert_eq!(
        admin_delete_user(&state, "u1").await,
        Err("Could not reach the auth server.".to_string())
    );
}

//! Tests for one-click GitHub connect: the device flow and the repo it makes.

#![allow(clippy::unwrap_used, clippy::expect_used)]
use crate::upstream;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use upstream::{Reply, Upstream, response, serve};
use weaveforge_shell_lib::github_connect::{
    CANCELLED, DENIED, DeviceCode, EXPIRED, Endpoints, PollStep, ensure_repo, form, read_poll,
    repo_name, request_code, user_login, wait_for_token,
};

const TICK: Duration = Duration::from_millis(1);

fn json(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

fn ends(up: &Upstream) -> Endpoints {
    Endpoints {
        login: up.base.clone(),
        api: up.base.clone(),
    }
}

fn client() -> reqwest::Client {
    weaveforge_shell_lib::relay::shared::relay_client().unwrap()
}

fn code(expires_in: u64) -> DeviceCode {
    DeviceCode {
        device_code: "dev123".to_owned(),
        user_code: "ABCD-1234".to_owned(),
        verification_uri: "https://github.com/login/device".to_owned(),
        expires_in,
        interval: 1,
    }
}

const PENDING: &str = r#"{"error":"authorization_pending"}"#;
const SLOW: &str = r#"{"error":"slow_down","interval":10}"#;
const TOKEN: &str = r#"{"access_token":"gho_abc","token_type":"bearer","scope":"repo"}"#;

// --- read_poll ---

#[test]
fn poll_replies_map_to_steps() {
    assert_eq!(read_poll(PENDING.as_bytes()), PollStep::Pending);
    assert_eq!(read_poll(SLOW.as_bytes()), PollStep::SlowDown);
    assert_eq!(
        read_poll(TOKEN.as_bytes()),
        PollStep::Token("gho_abc".to_owned())
    );
    assert_eq!(read_poll(br#"{"error":"access_denied"}"#), PollStep::Denied);
    assert_eq!(
        read_poll(br#"{"error":"expired_token"}"#),
        PollStep::Expired
    );
    assert!(matches!(
        read_poll(br#"{"error":"incorrect_client_credentials","error_description":"bad id"}"#),
        PollStep::Failed(m) if m.contains("bad id")
    ));
    assert!(matches!(read_poll(b"not json"), PollStep::Failed(_)));
    assert!(matches!(
        read_poll(br#"{"access_token":""}"#),
        PollStep::Failed(_)
    ));
}

// --- form / repo_name ---

#[test]
fn form_encodes_reserved_characters() {
    assert_eq!(
        form(&[("grant_type", "urn:a b"), ("x", "a&b=c")]),
        "grant_type=urn%3Aa%20b&x=a%26b%3Dc"
    );
}

#[test]
fn repo_name_is_weaveforge_and_a_safe_slug() {
    assert_eq!(repo_name(Some("My Thesis!"), None), "weaveforge-my-thesis");
    assert_eq!(
        repo_name(Some("  "), Some("Notes 2026")),
        "weaveforge-notes-2026"
    );
    assert_eq!(repo_name(None, None), "weaveforge-notes");
    assert_eq!(repo_name(Some("--a__b..c--"), None), "weaveforge-a__b..c");
    assert!(repo_name(Some(&"x".repeat(300)), None).len() <= 100);
}

// --- device code ---

#[tokio::test]
async fn request_code_posts_client_id_and_repo_scope() {
    let up = serve(vec![(
        "/login/device/code",
        vec![json(
            200,
            r#"{"device_code":"dev123","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":899,"interval":5}"#,
        )],
    )])
    .await;
    let got = request_code(&client(), &ends(&up), "client-x")
        .await
        .unwrap();
    assert_eq!(got.user_code, "ABCD-1234");
    assert_eq!(got.expires_in, 899);
    assert_eq!(got.interval, 5);
    let seen = up.seen();
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].header("accept"), Some("application/json"));
    assert_eq!(
        String::from_utf8(seen[0].body.clone()).unwrap(),
        "client_id=client-x&scope=repo"
    );
}

// --- the polling state machine ---

#[tokio::test]
async fn pending_then_token() {
    let up = serve(vec![(
        "/login/oauth/access_token",
        vec![json(200, PENDING), json(200, PENDING), json(200, TOKEN)],
    )])
    .await;
    let token = wait_for_token(&client(), &ends(&up), "client-x", &code(900), TICK, &|| {
        false
    })
    .await
    .unwrap();
    assert_eq!(token, "gho_abc");
    let seen = up.seen();
    assert_eq!(seen.len(), 3);
    let body = String::from_utf8(seen[0].body.clone()).unwrap();
    assert!(body.contains("device_code=dev123"), "{body}");
    assert!(
        body.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"),
        "{body}"
    );
}

#[tokio::test]
async fn slow_down_backs_off_then_succeeds() {
    let up = serve(vec![(
        "/login/oauth/access_token",
        vec![json(200, SLOW), json(200, TOKEN)],
    )])
    .await;
    let started = std::time::Instant::now();
    let token = wait_for_token(&client(), &ends(&up), "c", &code(900), TICK, &|| false)
        .await
        .unwrap();
    assert_eq!(token, "gho_abc");
    // interval 1 tick, then slow_down adds 5: at least 1 + 6 ticks waited.
    assert!(started.elapsed() >= TICK * 7);
}

#[tokio::test]
async fn denied_stops() {
    let up = serve(vec![(
        "/login/oauth/access_token",
        vec![
            json(200, PENDING),
            json(200, r#"{"error":"access_denied"}"#),
        ],
    )])
    .await;
    let err = wait_for_token(&client(), &ends(&up), "c", &code(900), TICK, &|| false)
        .await
        .unwrap_err();
    assert_eq!(err, DENIED);
}

#[tokio::test]
async fn expired_token_reply_stops() {
    let up = serve(vec![(
        "/login/oauth/access_token",
        vec![json(200, r#"{"error":"expired_token"}"#)],
    )])
    .await;
    let err = wait_for_token(&client(), &ends(&up), "c", &code(900), TICK, &|| false)
        .await
        .unwrap_err();
    assert_eq!(err, EXPIRED);
}

#[tokio::test]
async fn deadline_passes_while_pending() {
    let up = serve(vec![(
        "/login/oauth/access_token",
        vec![json(200, PENDING)],
    )])
    .await;
    let err = wait_for_token(&client(), &ends(&up), "c", &code(3), TICK, &|| false)
        .await
        .unwrap_err();
    assert_eq!(err, EXPIRED);
}

#[tokio::test]
async fn cancel_stops_polling() {
    let up = serve(vec![(
        "/login/oauth/access_token",
        vec![json(200, PENDING)],
    )])
    .await;
    let stop = AtomicBool::new(true);
    let err = wait_for_token(&client(), &ends(&up), "c", &code(900), TICK, &|| {
        stop.load(Ordering::SeqCst)
    })
    .await
    .unwrap_err();
    assert_eq!(err, CANCELLED);
    assert!(up.seen().is_empty());
}

// --- user and repo ---

#[tokio::test]
async fn user_login_sends_the_token() {
    let up = serve(vec![(
        "/user",
        vec![json(200, r#"{"login":"octo","id":1}"#)],
    )])
    .await;
    assert_eq!(
        user_login(&client(), &ends(&up), "gho_abc").await.unwrap(),
        "octo"
    );
    assert_eq!(up.seen()[0].header("authorization"), Some("Bearer gho_abc"));
}

const REPO: &str = r#"{"full_name":"octo/weaveforge-notes","private":true,"clone_url":"https://github.com/octo/weaveforge-notes.git","owner":{"login":"octo"}}"#;

#[tokio::test]
async fn repo_created_with_201() {
    let up = serve(vec![("/user/repos", vec![json(201, REPO)])]).await;
    let repo = ensure_repo(&client(), &ends(&up), "gho_abc", "octo", "weaveforge-notes")
        .await
        .unwrap();
    assert!(repo.created);
    assert_eq!(repo.full_name, "octo/weaveforge-notes");
    assert_eq!(repo.url, "https://github.com/octo/weaveforge-notes.git");
    let seen = up.seen();
    assert_eq!(seen[0].method, "POST");
    let body: serde_json::Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["name"], "weaveforge-notes");
    assert_eq!(body["private"], true);
}

#[tokio::test]
async fn repo_422_reuses_the_users_private_repo() {
    let up = serve(vec![
        (
            "/user/repos",
            vec![json(422, r#"{"message":"Repository creation failed."}"#)],
        ),
        ("/repos/octo/weaveforge-notes", vec![json(200, REPO)]),
    ])
    .await;
    let repo = ensure_repo(&client(), &ends(&up), "gho_abc", "octo", "weaveforge-notes")
        .await
        .unwrap();
    assert!(!repo.created);
    assert_eq!(repo.url, "https://github.com/octo/weaveforge-notes.git");
}

#[tokio::test]
async fn repo_422_refuses_a_public_repo() {
    let public = REPO.replace(r#""private":true"#, r#""private":false"#);
    let up = serve(vec![
        ("/user/repos", vec![json(422, "{}")]),
        ("/repos/octo/weaveforge-notes", vec![json(200, &public)]),
    ])
    .await;
    let err = ensure_repo(&client(), &ends(&up), "t", "octo", "weaveforge-notes")
        .await
        .unwrap_err();
    assert!(err.contains("public"), "{err}");
}

#[tokio::test]
async fn repo_422_refuses_someone_elses_repo() {
    let other = REPO.replace(r#""login":"octo""#, r#""login":"mallory""#);
    let up = serve(vec![
        ("/user/repos", vec![json(422, "{}")]),
        ("/repos/octo/weaveforge-notes", vec![json(200, &other)]),
    ])
    .await;
    assert!(
        ensure_repo(&client(), &ends(&up), "t", "octo", "weaveforge-notes")
            .await
            .is_err()
    );
}

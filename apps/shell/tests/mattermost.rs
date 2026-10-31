//! Tests for Mattermost sign-in and post (ported from apps/desktop/src/mattermost-signin.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "common/upstream.rs"]
mod upstream;

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use upstream::{Reply, Upstream, response, serve};
use weaveforge_shell::mattermost::{
    BAD_SERVER_URL, CookieSource, MattermostPost, MattermostReply, POST_NEEDS_FIELDS,
    SERVER_UNREACHABLE, SignInOutcome, SignInSlot, check_server_url, post_with, shared_sign_in,
    verify_token, wait_for_token,
};

const NO_HOST: &str = "http://127.0.0.1:9";
const SHORT: Duration = Duration::from_millis(200);
const POLL: Duration = Duration::from_millis(10);
const GIVE_UP: Duration = Duration::from_millis(100);
const GIVE_UP_HTTP: Duration = Duration::from_secs(5);

fn post(server_url: &str, token: &str, channel_id: &str, message: &str) -> MattermostPost {
    MattermostPost {
        server_url: server_url.to_owned(),
        token: token.to_owned(),
        channel_id: channel_id.to_owned(),
        message: message.to_owned(),
    }
}

// --- check_server_url ---

#[test]
fn server_url_keeps_only_the_origin_of_http_and_https() {
    let url = check_server_url(" https://mattermost.example.org/team/x ").unwrap();
    assert_eq!(url.as_str(), "https://mattermost.example.org/");
    assert_eq!(
        check_server_url("http://127.0.0.1:8065").unwrap().as_str(),
        "http://127.0.0.1:8065/"
    );
}

#[test]
fn server_url_rejects_other_schemes_and_junk_with_the_exact_message() {
    for raw in [
        "ftp://x",
        "not a url",
        "javascript:alert(1)",
        "file:///etc/passwd",
    ] {
        assert_eq!(
            check_server_url(raw),
            Err(BAD_SERVER_URL.to_owned()),
            "{raw}"
        );
    }
    assert_eq!(
        BAD_SERVER_URL,
        "Mattermost server URL must be a valid http(s) URL."
    );
}

#[test]
fn server_url_is_trimmed_like_the_ts_trim() {
    // U+FEFF and U+00A0 are whitespace to JS trim.
    let wrapped = "\u{FEFF}\u{A0} https://mattermost.example.org/team \u{FEFF}";
    assert_eq!(
        check_server_url(wrapped).unwrap().as_str(),
        "https://mattermost.example.org/"
    );
    // U+0085 is not whitespace to JS trim, so TS refuses it too.
    assert_eq!(
        check_server_url("\u{85}https://mattermost.example.org"),
        Err(BAD_SERVER_URL.to_owned())
    );
}

// --- verify_token ---

async fn answering(status: u16) -> Upstream {
    serve(vec![(
        "/api/v4/users/me",
        vec![response(status, &[], b"{}")],
    )])
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn token_that_signs_in_is_true_and_a_refused_one_is_false() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let ok = answering(200).await;
    assert!(verify_token(&client, &ok.base, "tok", SHORT).await);
    let refused = answering(401).await;
    assert!(!verify_token(&client, &refused.base, "tok", SHORT).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn token_check_sends_a_get_with_the_bearer_token() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let up = answering(200).await;
    let _ = verify_token(&client, &up.base, "tok", SHORT).await;
    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "GET");
    assert_eq!(seen[0].target, "/api/v4/users/me");
    assert_eq!(seen[0].header("authorization"), Some("Bearer tok"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn token_check_that_outlasts_its_timeout_is_false() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let up = serve(vec![("/api/v4/users/me", vec![Reply::Silent])]).await;
    assert!(!verify_token(&client, &up.base, "tok", SHORT).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn token_check_with_no_server_is_false() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let base = reqwest::Url::parse(&format!("{NO_HOST}/")).unwrap();
    assert!(!verify_token(&client, &base, "tok", SHORT).await);
}

// --- post_with ---

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_is_sent_to_the_posts_endpoint_with_the_token_and_json_body() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let up = serve(vec![("/api/v4/posts", vec![response(201, &[], b"")])]).await;
    let req = post(&format!("{}team/x", up.base), "tok", "ch", "hi");
    let reply = post_with(&client, &req, SHORT).await.unwrap();
    assert_eq!(
        reply,
        MattermostReply {
            status: 201,
            body: String::new()
        }
    );
    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].target, "/api/v4/posts");
    assert_eq!(seen[0].header("authorization"), Some("Bearer tok"));
    let body: serde_json::Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({ "channel_id": "ch", "message": "hi" })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refused_post_returns_the_status_and_body() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let up = serve(vec![("/api/v4/posts", vec![response(403, &[], b"nope")])]).await;
    let req = post(up.base.as_ref(), "tok", "ch", "hi");
    let reply = post_with(&client, &req, SHORT).await.unwrap();
    assert_eq!(
        reply,
        MattermostReply {
            status: 403,
            body: "nope".to_owned()
        }
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refused_post_body_is_capped_at_2000_chars() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let long = "x".repeat(5000);
    let up = serve(vec![(
        "/api/v4/posts",
        vec![response(400, &[], long.as_bytes())],
    )])
    .await;
    let req = post(up.base.as_ref(), "tok", "ch", "hi");
    let reply = post_with(&client, &req, SHORT).await.unwrap();
    assert_eq!(reply.status, 400);
    assert_eq!(reply.body, "x".repeat(2000));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refusal_of_two_megabytes_returns_at_once_with_2000_chars() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let huge = vec![b'x'; 2 * 1024 * 1024];
    let up = serve(vec![("/api/v4/posts", vec![response(400, &[], &huge)])]).await;
    let req = post(up.base.as_ref(), "tok", "ch", "hi");
    let reply = tokio::time::timeout(
        Duration::from_secs(10),
        post_with(&client, &req, GIVE_UP_HTTP),
    )
    .await
    .expect("post_with returned within 10 s")
    .unwrap();
    assert_eq!(reply.status, 400);
    assert_eq!(reply.body, "x".repeat(2000));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refused_post_body_is_capped_by_chars_not_bytes() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let long = "é".repeat(3000);
    let up = serve(vec![(
        "/api/v4/posts",
        vec![response(400, &[], long.as_bytes())],
    )])
    .await;
    let req = post(up.base.as_ref(), "tok", "ch", "hi");
    let reply = post_with(&client, &req, SHORT).await.unwrap();
    assert_eq!(reply.body.chars().count(), 2000);
    assert_eq!(reply.body, "é".repeat(2000));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_missing_a_field_gives_its_message_and_sends_nothing() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let up = serve(vec![("/api/v4/posts", vec![response(201, &[], b"")])]).await;
    let base = up.base.to_string();
    let cases = [
        post(&base, "", "ch", "hi"),
        post(&base, "tok", "", "hi"),
        post(&base, "tok", "ch", ""),
    ];
    for req in &cases {
        assert_eq!(
            post_with(&client, req, SHORT).await,
            Err(POST_NEEDS_FIELDS.to_owned())
        );
    }
    assert_eq!(
        POST_NEEDS_FIELDS,
        "Mattermost post needs a token, a channel and a message."
    );
    assert_eq!(up.seen().len(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_to_a_bad_server_url_gives_the_url_message() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let req = post("file:///x", "tok", "ch", "hi");
    assert_eq!(
        post_with(&client, &req, SHORT).await,
        Err(BAD_SERVER_URL.to_owned())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_with_no_server_gives_the_could_not_reach_message() {
    let client = weaveforge_shell::relay::shared::relay_client().unwrap();
    let req = post(NO_HOST, "tok", "ch", "hi");
    assert_eq!(
        post_with(&client, &req, SHORT).await,
        Err(SERVER_UNREACHABLE.to_owned())
    );
    assert_eq!(SERVER_UNREACHABLE, "Could not reach the Mattermost server.");
}

// --- wait_for_token ---

/// Hands out `script` one read at a time (the last one repeats), and closes after `closed_on` reads.
struct Scripted {
    script: Vec<Option<&'static str>>,
    closed_on: usize,
    reads: AtomicUsize,
}

impl Scripted {
    fn new(script: Vec<Option<&'static str>>, closed_on: usize) -> Self {
        Self {
            script,
            closed_on,
            reads: AtomicUsize::new(0),
        }
    }
}

impl CookieSource for Scripted {
    async fn auth_cookie(&self) -> Option<String> {
        let idx = self.reads.fetch_add(1, Ordering::SeqCst);
        self.script
            .get(idx)
            .or(self.script.last())
            .copied()
            .flatten()
            .map(str::to_owned)
    }

    fn is_open(&self) -> bool {
        self.reads.load(Ordering::SeqCst) < self.closed_on
    }
}

fn accept(token: &'static str) -> impl Fn(String) -> std::future::Ready<bool> {
    move |t: String| std::future::ready(t == token)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cookie_that_appears_on_the_third_poll_is_returned() {
    let source = Scripted::new(vec![None, None, Some("tok")], usize::MAX);
    let got = wait_for_token(&source, accept("tok"), POLL, GIVE_UP).await;
    assert_eq!(got, Some("tok".to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn closed_window_gives_none() {
    let source = Scripted::new(vec![None], 2);
    let got = wait_for_token(&source, accept("tok"), POLL, GIVE_UP).await;
    assert_eq!(got, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cookie_that_never_appears_gives_none_after_give_up() {
    let source = Scripted::new(vec![None], usize::MAX);
    let started = Instant::now();
    let got = wait_for_token(&source, accept("tok"), POLL, GIVE_UP).await;
    assert_eq!(got, None);
    assert!(started.elapsed() >= GIVE_UP);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejected_cookie_is_not_rechecked_and_a_later_one_is_accepted() {
    let checked = Mutex::new(Vec::<String>::new());
    let check = |t: String| {
        checked.lock().unwrap().push(t.clone());
        std::future::ready(t == "new")
    };
    let source = Scripted::new(vec![Some("old"), Some("old"), Some("new")], usize::MAX);
    let got = wait_for_token(&source, check, POLL, GIVE_UP).await;
    assert_eq!(got, Some("new".to_owned()));
    assert_eq!(
        *checked.lock().unwrap(),
        vec!["old".to_owned(), "new".to_owned()]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_cookie_is_ignored() {
    let checked = Mutex::new(0_usize);
    let check = |_t: String| {
        *checked.lock().unwrap() += 1;
        std::future::ready(true)
    };
    let source = Scripted::new(vec![Some("")], usize::MAX);
    let got = wait_for_token(&source, check, POLL, GIVE_UP).await;
    assert_eq!(got, None);
    assert_eq!(*checked.lock().unwrap(), 0);
}

/// A sign-in run that counts itself and answers `outcome` after a short wait.
async fn counted(runs: &AtomicUsize, outcome: SignInOutcome) -> SignInOutcome {
    let _ = runs.fetch_add(1, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(50)).await;
    outcome
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_sign_ins_share_one_run_and_one_answer() {
    let slot: SignInSlot = Mutex::new(None);
    let runs = AtomicUsize::new(0);
    let r = &runs;
    let (first, second) = tokio::join!(
        shared_sign_in(&slot, move || counted(r, Ok(Some("tok".to_owned())))),
        shared_sign_in(&slot, move || counted(r, Ok(Some("other".to_owned())))),
    );
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    assert_eq!(first, Ok(Some("tok".to_owned())));
    assert_eq!(second, Ok(Some("tok".to_owned())));
    assert!(slot.lock().unwrap().is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_error_reaches_both_callers_and_clears_the_slot() {
    let slot: SignInSlot = Mutex::new(None);
    let runs = AtomicUsize::new(0);
    let r = &runs;
    let boom = || Err("boom".to_owned());
    let (first, second) = tokio::join!(
        shared_sign_in(&slot, move || counted(r, boom())),
        shared_sign_in(&slot, move || counted(r, boom())),
    );
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    assert_eq!(first, Err("boom".to_owned()));
    assert_eq!(second, Err("boom".to_owned()));
    assert!(slot.lock().unwrap().is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_sign_in_after_the_first_one_ends_runs_again() {
    let slot: SignInSlot = Mutex::new(None);
    let runs = AtomicUsize::new(0);
    let r = &runs;
    let first = shared_sign_in(&slot, move || counted(r, Ok(None))).await;
    let second = shared_sign_in(&slot, move || counted(r, Ok(Some("tok".to_owned())))).await;
    assert_eq!(first, Ok(None));
    assert_eq!(second, Ok(Some("tok".to_owned())));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

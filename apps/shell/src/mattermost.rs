//! Mattermost sign-in in a window of its own, and the post sent from the shell. Ported from apps/desktop/src/mattermost-signin.ts.

use std::future::Future;
use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use tauri::Manager;
use tokio::sync::watch;

use crate::commands::ShellError;

/// The server URL is not an http(s) URL.
pub const BAD_SERVER_URL: &str = "Mattermost server URL must be a valid http(s) URL.";
/// A post is missing its token, channel or message.
pub const POST_NEEDS_FIELDS: &str = "Mattermost post needs a token, a channel and a message.";
/// The sign-in window could not be opened.
pub const SIGN_IN_NOT_OPENED: &str = "Could not open the Mattermost sign-in window.";
/// The Mattermost server could not be reached.
pub const SERVER_UNREACHABLE: &str = "Could not reach the Mattermost server.";

const SIGNIN_LABEL: &str = "mattermost-signin";
const SIGNIN_TITLE: &str = "Sign in to Mattermost";
const SESSION_COOKIE: &str = "MMAUTHTOKEN";
const POLL: Duration = Duration::from_secs(1);
const GIVE_UP: Duration = Duration::from_secs(10 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const POST_TIMEOUT: Duration = Duration::from_secs(15);
/// Most characters of an error body the page gets.
const REPLY_CHARS: usize = 2000;
/// Bytes read from a refusal before it is cut; enough for `REPLY_CHARS` of any text.
const ERROR_BODY_BYTES: usize = 8192;

/// What a sign-in answers: the token, or the message the page shows.
pub type SignInOutcome = Result<Option<String>, String>;
/// The sign-in in flight, if any: a receiver that gets the outcome once it is known.
pub type SignInSlot = std::sync::Mutex<Option<watch::Receiver<Option<SignInOutcome>>>>;

/// The one sign-in at a time, shared by every caller (the TS `open ??=`).
static IN_FLIGHT: SignInSlot = std::sync::Mutex::new(None);

/// A Mattermost post as the page sends it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MattermostPost {
    /// The server's address, http or https.
    pub server_url: String,
    /// The session token from sign-in.
    pub token: String,
    /// The channel to post in.
    pub channel_id: String,
    /// The message text.
    pub message: String,
}

/// The server's answer to a post: its status, and the body only when it refused.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MattermostReply {
    /// HTTP status.
    #[specta(type = u32)]
    pub status: u16,
    /// The error body, cut to 2000 chars; empty on success.
    pub body: String,
}

/// Where the sign-in cookie comes from; a fake in tests, the window in the app.
pub trait CookieSource {
    /// The `MMAUTHTOKEN` value for the server, if set.
    fn auth_cookie(&self) -> impl Future<Output = Option<String>> + Send;
    /// Whether the sign-in window is still open.
    fn is_open(&self) -> bool;
}

/// The server's origin as an `http(s)` URL, or the message the page shows.
///
/// # Errors
/// `BAD_SERVER_URL` when the text is not an http or https URL.
pub fn check_server_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim_matches(crate::fetch::is_js_space))
        .map_err(|_| BAD_SERVER_URL.to_owned())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(BAD_SERVER_URL.to_owned());
    }
    reqwest::Url::parse(&url.origin().ascii_serialization()).map_err(|_| BAD_SERVER_URL.to_owned())
}

/// True when the token signs in as a user (2xx from `/api/v4/users/me`), so a stale cookie is not saved.
pub async fn verify_token(
    client: &reqwest::Client,
    server: &reqwest::Url,
    token: &str,
    timeout: Duration,
) -> bool {
    let Ok(url) = server.join("/api/v4/users/me") else {
        return false;
    };
    let sent = client
        .get(url)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .timeout(timeout)
        .send()
        .await;
    matches!(sent, Ok(reply) if reply.status().is_success())
}

/// Polls `source` every `poll` until `check` accepts a cookie. Returns None when the window
/// closes or `give_up` passes. A rejected cookie is not checked again until it changes.
pub async fn wait_for_token<C, F, Fut>(
    source: &C,
    check: F,
    poll: Duration,
    give_up: Duration,
) -> Option<String>
where
    C: CookieSource,
    F: Fn(String) -> Fut,
    Fut: Future<Output = bool>,
{
    let deadline = tokio::time::Instant::now() + give_up;
    let mut rejected: Option<String> = None;
    while source.is_open() && tokio::time::Instant::now() < deadline {
        if let Some(token) = source.auth_cookie().await.filter(|t| !t.is_empty())
            && rejected.as_deref() != Some(token.as_str())
        {
            if check(token.clone()).await {
                return Some(token);
            }
            rejected = Some(token);
        }
        tokio::time::sleep(poll).await;
    }
    None
}

/// The sign-in cookie, read from the open sign-in window for the server's URL.
struct WindowCookies {
    app: tauri::AppHandle,
    server: tauri::Url,
}

impl CookieSource for WindowCookies {
    async fn auth_cookie(&self) -> Option<String> {
        let window = self.app.get_webview_window(SIGNIN_LABEL)?;
        let cookies = window.cookies_for_url(self.server.clone()).ok()?;
        cookies
            .into_iter()
            .find(|c| c.name() == SESSION_COOKIE)
            .map(|c| c.value().to_owned())
    }

    fn is_open(&self) -> bool {
        self.app.get_webview_window(SIGNIN_LABEL).is_some()
    }
}

/// Opens the server's login page in a fresh in-memory window. Popups are denied: opening
/// http(s) links in the browser waits for tauri 2.13's opener.
fn open_window(app: &tauri::AppHandle, login: tauri::Url) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(app, SIGNIN_LABEL, tauri::WebviewUrl::External(login))
        .title(SIGNIN_TITLE)
        .inner_size(520.0, 760.0)
        .incognito(true)
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map(|_| ())
        .map_err(|_| SIGN_IN_NOT_OPENED.to_owned())
}

/// The one sign-in at a time. A caller that finds one in flight waits for its outcome, and
/// the first caller's run is the only one that runs. The slot is cleared on every exit.
///
/// # Errors
/// Whatever `run` answers, or `SIGN_IN_NOT_OPENED` when the slot's lock is poisoned.
pub async fn shared_sign_in<F, Fut>(slot: &SignInSlot, run: F) -> SignInOutcome
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = SignInOutcome>,
{
    // Check and claim the slot under one lock, so two callers cannot both start a run.
    let claim = {
        let mut held = slot.lock().map_err(|_| SIGN_IN_NOT_OPENED.to_owned())?;
        match held.clone() {
            Some(joined) => Err(joined),
            None => {
                let (tx, rx) = watch::channel(None);
                *held = Some(rx);
                Ok(tx)
            }
        }
    };
    let tx = match claim {
        Ok(tx) => tx,
        Err(mut joined) => {
            return match joined.wait_for(Option::is_some).await {
                Ok(outcome) => (*outcome).clone().unwrap_or(Ok(None)),
                Err(_) => Ok(None),
            };
        }
    };
    let _clear = ClearSlot(slot);
    let outcome = run().await;
    let _ = tx.send_replace(Some(outcome.clone()));
    outcome
}

/// Empties the sign-in slot when dropped, so an early return or a cancelled sign-in frees it.
struct ClearSlot<'a>(&'a SignInSlot);

impl Drop for ClearSlot<'_> {
    fn drop(&mut self) {
        match self.0.lock() {
            Ok(mut slot) => *slot = None,
            Err(poisoned) => *poisoned.into_inner() = None,
        }
    }
}

/// Signs in on the server's login page; answers the token, or None if the window closed first.
/// A second caller gets the first caller's answer, whatever server it asked for.
///
/// # Errors
/// `BAD_SERVER_URL`, or `SIGN_IN_NOT_OPENED` when the window cannot be built.
pub async fn mattermost_sign_in_with(
    app: &tauri::AppHandle,
    server_url: String,
) -> Result<Option<String>, String> {
    let server = check_server_url(&server_url)?;
    shared_sign_in(&IN_FLIGHT, move || sign_in_window(app, server)).await
}

/// Opens the window for `server` (or joins one already open) and waits for its token.
async fn sign_in_window(
    app: &tauri::AppHandle,
    server: reqwest::Url,
) -> Result<Option<String>, String> {
    let login = server
        .join("/login")
        .ok()
        .and_then(|u| tauri::Url::parse(u.as_str()).ok())
        .ok_or_else(|| SIGN_IN_NOT_OPENED.to_owned())?;
    // A second click joins the open window: both callers poll the same cookies.
    if app.get_webview_window(SIGNIN_LABEL).is_none() {
        open_window(app, login)?;
    }
    let client = crate::relay::shared::relay_client().map_err(|_| SERVER_UNREACHABLE.to_owned())?;
    let cookies = WindowCookies {
        app: app.clone(),
        server: tauri::Url::parse(server.as_str()).map_err(|_| BAD_SERVER_URL.to_owned())?,
    };
    let (client_ref, server_ref) = (&client, &server);
    let token =
        wait_for_token(
            &cookies,
            |token: String| async move {
                verify_token(client_ref, server_ref, &token, CHECK_TIMEOUT).await
            },
            POLL,
            GIVE_UP,
        )
        .await;
    if let Some(window) = app.get_webview_window(SIGNIN_LABEL) {
        let _ = window.close();
    }
    Ok(token)
}

/// Sends one post from the shell, where the server's CORS policy does not apply.
///
/// Empty token, channel or message are refused here, whereas TS lets the server refuse them.
///
/// # Errors
/// `BAD_SERVER_URL`, `POST_NEEDS_FIELDS` for an empty field, or `SERVER_UNREACHABLE` on a network failure.
pub async fn post_with(
    client: &reqwest::Client,
    post: &MattermostPost,
    timeout: Duration,
) -> Result<MattermostReply, String> {
    let server = check_server_url(&post.server_url)?;
    if post.token.is_empty() || post.channel_id.is_empty() || post.message.is_empty() {
        return Err(POST_NEEDS_FIELDS.to_owned());
    }
    let url = server
        .join("/api/v4/posts")
        .map_err(|_| SERVER_UNREACHABLE.to_owned())?;
    let body = serde_json::json!({ "channel_id": post.channel_id, "message": post.message });
    let sent = client
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {}", post.token))
        .header(CONTENT_TYPE, "application/json")
        .timeout(timeout)
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| SERVER_UNREACHABLE.to_owned())?;
    let status = sent.status();
    let body = if status.is_success() {
        String::new()
    } else {
        refusal_body(sent).await
    };
    Ok(MattermostReply {
        status: status.as_u16(),
        body,
    })
}

/// The start of a refusal's body, read only as far as needed so a huge reply cannot stall the call.
async fn refusal_body(mut reply: reqwest::Response) -> String {
    let mut bytes: Vec<u8> = Vec::new();
    while bytes.len() < ERROR_BODY_BYTES {
        match reply.chunk().await {
            Ok(Some(chunk)) => bytes.extend_from_slice(&chunk),
            _ => break,
        }
    }
    String::from_utf8_lossy(&bytes)
        .chars()
        .take(REPLY_CHARS)
        .collect()
}

/// Opens the Mattermost sign-in window and answers the session token, or null if it was closed.
///
/// # Errors
/// The message the page shows; see `mattermost_sign_in_with`.
#[tauri::command]
#[specta::specta]
pub async fn mattermost_sign_in(
    app: tauri::AppHandle,
    server_url: String,
) -> Result<Option<String>, ShellError> {
    mattermost_sign_in_with(&app, server_url)
        .await
        .map_err(ShellError::from)
}

/// Sends one Mattermost post from the shell.
///
/// # Errors
/// The message the page shows; see `post_with`.
#[tauri::command]
#[specta::specta]
pub async fn mattermost_post(post: MattermostPost) -> Result<MattermostReply, ShellError> {
    let client = crate::relay::shared::relay_client()
        .map_err(|_| ShellError::from(SERVER_UNREACHABLE.to_owned()))?;
    post_with(&client, &post, POST_TIMEOUT)
        .await
        .map_err(ShellError::from)
}

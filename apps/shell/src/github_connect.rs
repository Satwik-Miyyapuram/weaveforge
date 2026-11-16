//! One-click "Connect GitHub": the OAuth device flow, then a private repo for the workspace folder.
//!
//! The page asks `github_connect_start` for a code, shows it, and calls `github_connect_finish`,
//! which polls until the reader approves on github.com, then stores the token in the keychain
//! (`git-sync-token`), makes or reuses the repo and sets the `vault-git` / `vault-git-remote`
//! prefs. The page then runs the usual `vault_sync("connect")`. No client secret: the device
//! flow needs none, and the token does not expire.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands::ShellError;
use crate::prefs::{PrefValue, Prefs};
use crate::relay::shared::{read_capped, relay_client};
use crate::secrets::Secrets;
use crate::vault::VaultState;

/// The GitHub OAuth App's client id: public, not a secret. A build can set its own.
pub const CLIENT_ID: &str = match option_env!("WF_GITHUB_CLIENT_ID") {
    Some(id) => id,
    None => "Ov23liGTr77x2QN93Qmw",
};

/// Private repos need `repo`; nothing else is asked for.
const SCOPE: &str = "repo";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// Seconds added to the poll interval on each `slow_down` (RFC 8628 §3.5).
const SLOW_DOWN_STEP: u64 = 5;
const USER_AGENT: &str = "WeaveForge-Desktop";
const MAX_BODY: usize = 256 * 1024;
/// GitHub's longest repo name.
const MAX_REPO_NAME: usize = 100;

/// Shown when the reader declines on github.com.
pub const DENIED: &str = "GitHub sign-in was declined.";
/// Shown when the code ran out before the reader approved.
pub const EXPIRED: &str = "The GitHub code expired. Start again.";
/// Shown when the page cancelled the wait.
pub const CANCELLED: &str = "GitHub sign-in was cancelled.";
/// Shown when GitHub cannot be reached or answers nonsense.
pub const UNREACHABLE: &str = "Could not reach GitHub. Check the connection and try again.";
const NOT_STARTED: &str = "Start GitHub sign-in first.";

/// Where GitHub answers: `github.com` for sign-in, `api.github.com` for the rest. Tests point both at a stub.
#[derive(Clone, Debug)]
pub struct Endpoints {
    /// Base of `login/device/code` and `login/oauth/access_token`.
    pub login: Url,
    /// Base of `user`, `user/repos` and `repos/{owner}/{name}`.
    pub api: Url,
}

impl Endpoints {
    /// GitHub itself.
    ///
    /// # Errors
    /// Never in practice; the URLs are constants.
    pub fn production() -> Result<Self, String> {
        let parse = |s: &str| Url::parse(s).map_err(|e| e.to_string());
        Ok(Self {
            login: parse("https://github.com/")?,
            api: parse("https://api.github.com/")?,
        })
    }
}

/// GitHub's answer to `login/device/code`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct DeviceCode {
    /// Kept in the shell; the poll sends it.
    pub device_code: String,
    /// What the reader types on github.com.
    pub user_code: String,
    /// Where the reader types it.
    pub verification_uri: String,
    /// Seconds until the code is void.
    pub expires_in: u64,
    /// Seconds between polls.
    #[serde(default = "default_interval")]
    pub interval: u64,
}

const fn default_interval() -> u64 {
    5
}

/// What the page shows while the reader approves.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubConnectStart {
    /// The code to type, e.g. `ABCD-1234`.
    pub user_code: String,
    /// `https://github.com/login/device`.
    pub verification_uri: String,
    /// Seconds until the code is void.
    pub expires_in: u32,
}

/// The repo the folder now syncs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubConnected {
    /// The GitHub account.
    pub login: String,
    /// `owner/name`.
    pub repo: String,
    /// The https clone URL, now the folder's remote.
    pub url: String,
    /// False when an existing repo of the same name was reused.
    pub created: bool,
}

/// One poll's outcome.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PollStep {
    /// Not approved yet.
    Pending,
    /// Polling too fast: wait longer.
    SlowDown,
    /// Approved: the access token.
    Token(String),
    /// The reader declined.
    Denied,
    /// The code ran out.
    Expired,
    /// Anything else, with GitHub's reason.
    Failed(String),
}

/// Reads one `login/oauth/access_token` reply.
#[must_use]
pub fn read_poll(body: &[u8]) -> PollStep {
    let Ok(reply) = serde_json::from_slice::<Value>(body) else {
        return PollStep::Failed(UNREACHABLE.to_owned());
    };
    if let Some(token) = reply.get("access_token").and_then(Value::as_str) {
        return if token.is_empty() {
            PollStep::Failed(UNREACHABLE.to_owned())
        } else {
            PollStep::Token(token.to_owned())
        };
    }
    match reply.get("error").and_then(Value::as_str) {
        Some("authorization_pending") => PollStep::Pending,
        Some("slow_down") => PollStep::SlowDown,
        Some("access_denied") => PollStep::Denied,
        Some("expired_token") => PollStep::Expired,
        other => {
            let why = reply
                .get("error_description")
                .and_then(Value::as_str)
                .or(other)
                .unwrap_or("no reason given");
            PollStep::Failed(format!("GitHub refused the sign-in: {why}"))
        }
    }
}

/// An `application/x-www-form-urlencoded` body; every byte but `A-Za-z0-9-_.~` is escaped.
#[must_use]
pub fn form(pairs: &[(&str, &str)]) -> String {
    let escape = |s: &str| {
        s.bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                    char::from(b).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect::<String>()
    };
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", escape(k), escape(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// `weaveforge-<slug>`: the project slug, else the folder name, else `workspace`, made safe for
/// GitHub (lowercase ASCII letters, digits, `-`, `_`, `.`; at most 100 characters).
#[must_use]
pub fn repo_name(slug: Option<&str>, folder: Option<&str>) -> String {
    let clean = |s: &str| {
        let mut out = String::new();
        for c in s.trim().chars().flat_map(char::to_lowercase) {
            let c = if c.is_ascii_alphanumeric() || "_.".contains(c) {
                c
            } else {
                '-'
            };
            if !(c == '-' && out.ends_with('-')) {
                out.push(c);
            }
        }
        out.trim_matches(|c| c == '-' || c == '.').to_owned()
    };
    let base = [slug, folder]
        .into_iter()
        .flatten()
        .map(clean)
        .find(|s| !s.is_empty())
        .unwrap_or_else(|| "workspace".to_owned());
    let mut name = format!("weaveforge-{base}");
    name.truncate(MAX_REPO_NAME);
    name.trim_end_matches(['-', '.']).to_owned()
}

/// The shell-only flag set when GitHub refused the stored token; the page then offers Reconnect.
pub const REAUTH_PREF: &str = "github-reauth";

/// Whether a git or GitHub failure means the token was refused or missing.
#[must_use]
pub fn is_auth_failure(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    [
        "token was refused",
        "add a token",
        "401",
        "unauthorized",
        "authentication",
        "bad credentials",
    ]
    .iter()
    .any(|sign| reason.contains(sign))
}

fn is_github(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
}

/// Whether `reason`, from a sync with the remote `url`, means GitHub wants a new sign-in.
#[must_use]
pub fn needs_github_reauth(url: Option<&str>, reason: &str) -> bool {
    url.and_then(|u| Url::parse(u).ok())
        .is_some_and(|u| is_github(&u))
        && is_auth_failure(reason)
}

/// The repo name in `remote` when it is `https://github.com/<login>/<name>`, so a reconnect
/// keeps syncing to the same repo.
#[must_use]
pub fn existing_repo_name(remote: Option<&str>, login: &str) -> Option<String> {
    let url = Url::parse(remote?).ok().filter(is_github)?;
    let mut parts = url.path_segments()?;
    let (owner, name, rest) = (parts.next()?, parts.next()?, parts.next());
    let name = name.strip_suffix(".git").unwrap_or(name);
    (owner.eq_ignore_ascii_case(login) && !name.is_empty() && rest.is_none())
        .then(|| name.to_owned())
}

fn join(base: &Url, path: &str) -> Result<Url, String> {
    base.join(path).map_err(|e| e.to_string())
}

async fn post_form(
    client: &reqwest::Client,
    url: Url,
    pairs: &[(&str, &str)],
) -> Result<(StatusCode, Vec<u8>), String> {
    let response = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/x-www-form-urlencoded")
        .header("user-agent", USER_AGENT)
        .body(form(pairs))
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_owned())?;
    body(response).await
}

async fn body(response: reqwest::Response) -> Result<(StatusCode, Vec<u8>), String> {
    let status = response.status();
    let bytes = read_capped(response, MAX_BODY)
        .await
        .ok()
        .flatten()
        .ok_or_else(|| UNREACHABLE.to_owned())?;
    Ok((status, bytes))
}

/// Asks GitHub for a device code.
///
/// # Errors
/// `UNREACHABLE` on a network failure, or GitHub's reason when it refuses.
pub async fn request_code(
    client: &reqwest::Client,
    ends: &Endpoints,
    client_id: &str,
) -> Result<DeviceCode, String> {
    let url = join(&ends.login, "login/device/code")?;
    let (status, bytes) =
        post_form(client, url, &[("client_id", client_id), ("scope", SCOPE)]).await?;
    if let Ok(code) = serde_json::from_slice::<DeviceCode>(&bytes) {
        return Ok(code);
    }
    match read_poll(&bytes) {
        PollStep::Failed(why) => Err(why),
        _ => Err(format!("GitHub answered {status} to the sign-in request.")),
    }
}

/// Polls once for the token.
pub async fn poll_once(
    client: &reqwest::Client,
    ends: &Endpoints,
    client_id: &str,
    device_code: &str,
) -> PollStep {
    let url = match join(&ends.login, "login/oauth/access_token") {
        Ok(url) => url,
        Err(why) => return PollStep::Failed(why),
    };
    let pairs = [
        ("client_id", client_id),
        ("device_code", device_code),
        ("grant_type", DEVICE_GRANT),
    ];
    match post_form(client, url, &pairs).await {
        Ok((_, bytes)) => read_poll(&bytes),
        // A dropped connection is not an answer; try again next tick.
        Err(_) => PollStep::Pending,
    }
}

/// Polls every `interval` ticks until approval, refusal, expiry or `cancelled()`.
/// A tick is one second in the app; tests pass a millisecond.
///
/// # Errors
/// `DENIED`, `EXPIRED`, `CANCELLED`, or GitHub's reason.
pub async fn wait_for_token(
    client: &reqwest::Client,
    ends: &Endpoints,
    client_id: &str,
    code: &DeviceCode,
    tick: Duration,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<String, String> {
    let ticks = |n: u64| tick.saturating_mul(u32::try_from(n).unwrap_or(u32::MAX));
    let deadline = Instant::now() + ticks(code.expires_in);
    let mut interval = code.interval.max(1);
    loop {
        tokio::time::sleep(ticks(interval)).await;
        if cancelled() {
            return Err(CANCELLED.to_owned());
        }
        if Instant::now() >= deadline {
            return Err(EXPIRED.to_owned());
        }
        match poll_once(client, ends, client_id, &code.device_code).await {
            PollStep::Pending => {}
            PollStep::SlowDown => interval = interval.saturating_add(SLOW_DOWN_STEP),
            PollStep::Token(token) => return Ok(token),
            PollStep::Denied => return Err(DENIED.to_owned()),
            PollStep::Expired => return Err(EXPIRED.to_owned()),
            PollStep::Failed(why) => return Err(why),
        }
    }
}

fn api(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: Url,
    token: &str,
) -> reqwest::RequestBuilder {
    client
        .request(method, url)
        .header("accept", "application/vnd.github+json")
        .header("user-agent", USER_AGENT)
        .header("x-github-api-version", "2022-11-28")
        .bearer_auth(token)
}

async fn send_json(request: reqwest::RequestBuilder) -> Result<(StatusCode, Value), String> {
    let response = request.send().await.map_err(|_| UNREACHABLE.to_owned())?;
    let (status, bytes) = body(response).await?;
    Ok((
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    ))
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// The signed-in account's login.
///
/// # Errors
/// `UNREACHABLE`, or a message naming GitHub's status.
pub async fn user_login(
    client: &reqwest::Client,
    ends: &Endpoints,
    token: &str,
) -> Result<String, String> {
    let url = join(&ends.api, "user")?;
    let (status, user) = send_json(api(client, reqwest::Method::GET, url, token)).await?;
    match text(&user, "login") {
        Some(login) if status.is_success() => Ok(login),
        _ => Err(format!("GitHub would not say who signed in ({status}).")),
    }
}

/// A repo the folder can push to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Repo {
    /// `owner/name`.
    pub full_name: String,
    /// The https clone URL.
    pub url: String,
    /// False when it already existed.
    pub created: bool,
}

fn read_repo(repo: &Value, created: bool) -> Option<Repo> {
    Some(Repo {
        full_name: text(repo, "full_name")?,
        url: text(repo, "clone_url")?,
        created,
    })
}

/// Makes the private repo `name`, or reuses it when `login` already owns a private repo by that name.
///
/// # Errors
/// When the name is taken by a public repo or someone else's, or GitHub refuses.
pub async fn ensure_repo(
    client: &reqwest::Client,
    ends: &Endpoints,
    token: &str,
    login: &str,
    name: &str,
) -> Result<Repo, String> {
    let create = serde_json::json!({
        "name": name,
        "private": true,
        "description": "WeaveForge workspace",
    });
    let url = join(&ends.api, "user/repos")?;
    let request = api(client, reqwest::Method::POST, url, token)
        .header("content-type", "application/json")
        .body(create.to_string());
    let (status, repo) = send_json(request).await?;
    if status == StatusCode::CREATED {
        return read_repo(&repo, true).ok_or_else(|| UNREACHABLE.to_owned());
    }
    if status != StatusCode::UNPROCESSABLE_ENTITY {
        return Err(format!("GitHub would not make the repository ({status})."));
    }
    // 422: the name is taken. Reuse it only when it is this account's own private repo.
    let url = join(&ends.api, &format!("repos/{login}/{name}"))?;
    let (status, repo) = send_json(api(client, reqwest::Method::GET, url, token)).await?;
    let owner = repo.pointer("/owner/login").and_then(Value::as_str);
    if !status.is_success() || !owner.is_some_and(|o| o.eq_ignore_ascii_case(login)) {
        return Err(format!(
            "A repository named {name} exists but is not yours to use."
        ));
    }
    if repo.get("private").and_then(Value::as_bool) != Some(true) {
        return Err(format!(
            "{login}/{name} is public. Make it private on GitHub, or delete it, then try again."
        ));
    }
    read_repo(&repo, false).ok_or_else(|| UNREACHABLE.to_owned())
}

/// The code `github_connect_start` handed out, tagged with its turn. A new start or a
/// cancel bumps `TURN`, which stops any `finish` still waiting on the old code.
static PENDING: Mutex<Option<(u64, DeviceCode)>> = Mutex::new(None);
static TURN: AtomicU64 = AtomicU64::new(0);

fn pending() -> std::sync::MutexGuard<'static, Option<(u64, DeviceCode)>> {
    PENDING.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Starts the device flow and answers the code for the page to show.
///
/// # Errors
/// `UNREACHABLE`, or GitHub's reason.
#[tauri::command]
#[specta::specta]
pub async fn github_connect_start() -> Result<GithubConnectStart, ShellError> {
    let client = relay_client().map_err(|_| ShellError::from(UNREACHABLE.to_owned()))?;
    let code = request_code(&client, &Endpoints::production()?, CLIENT_ID).await?;
    let turn = TURN.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    let start = GithubConnectStart {
        user_code: code.user_code.clone(),
        verification_uri: code.verification_uri.clone(),
        expires_in: u32::try_from(code.expires_in).unwrap_or(u32::MAX),
    };
    *pending() = Some((turn, code));
    Ok(start)
}

/// Waits for approval, then stores the token, makes or reuses the repo and sets it as the folder's remote.
/// `name` is the project slug; the repo is `weaveforge-<name>`.
///
/// # Errors
/// `NOT_STARTED`, `DENIED`, `EXPIRED`, `CANCELLED`, or why GitHub or the keychain refused.
#[tauri::command]
#[specta::specta]
pub async fn github_connect_finish(
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
    secrets: tauri::State<'_, Secrets>,
    name: Option<String>,
) -> Result<GithubConnected, ShellError> {
    let (turn, code) = pending()
        .clone()
        .ok_or_else(|| ShellError::from(NOT_STARTED.to_owned()))?;
    let client = relay_client().map_err(|_| ShellError::from(UNREACHABLE.to_owned()))?;
    let ends = Endpoints::production()?;
    let stale = move || TURN.load(Ordering::SeqCst) != turn;
    let token = wait_for_token(
        &client,
        &ends,
        CLIENT_ID,
        &code,
        Duration::from_secs(1),
        &stale,
    )
    .await?;
    let login = user_login(&client, &ends, &token).await?;
    let stored = prefs.inner().clone();
    let remote = stored
        .queued(|p| p.read("vault-git-remote"))
        .await
        .ok()
        .flatten();
    let remote = match remote {
        Some(PrefValue::Text(url)) => Some(url),
        _ => None,
    };
    let name = match existing_repo_name(remote.as_deref(), &login) {
        Some(same) => same,
        None => {
            let folder = crate::vault_sync::current_root(vault.inner())
                .await
                .and_then(|root| root.file_name().map(|n| n.to_string_lossy().into_owned()));
            repo_name(name.as_deref(), folder.as_deref())
        }
    };
    let repo = ensure_repo(&client, &ends, &token, &login, &name).await?;
    secrets
        .queued(move |s| s.write("git-sync-token", &token))
        .await?;
    let url = repo.url.clone();
    prefs
        .queued(move |p| {
            p.write("vault-git", Some(PrefValue::Flag(true)))?;
            p.write("vault-git-remote", Some(PrefValue::Text(url)))?;
            p.write(REAUTH_PREF, None)
        })
        .await?;
    let mut slot = pending();
    if slot.as_ref().is_some_and(|(t, _)| *t == turn) {
        *slot = None;
    }
    Ok(GithubConnected {
        login,
        repo: repo.full_name,
        url: repo.url,
        created: repo.created,
    })
}

/// Stops a `github_connect_finish` that is still waiting.
///
/// # Errors
/// Never; the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn github_connect_cancel() -> Result<(), ShellError> {
    let _ = TURN.fetch_add(1, Ordering::SeqCst);
    *pending() = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_id_is_the_public_default_without_a_build_override() {
        if option_env!("WF_GITHUB_CLIENT_ID").is_none() {
            assert_eq!(CLIENT_ID, "Ov23liGTr77x2QN93Qmw");
        }
        assert!(!CLIENT_ID.is_empty());
    }
}

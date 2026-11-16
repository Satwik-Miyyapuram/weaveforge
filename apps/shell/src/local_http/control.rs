//! The local API switch, its tokens and MCP Connect. Ported from
//! `apps/shell/sidecar/src/main-local-api.ts` (`registerMainLocalApi`).
//!
//! Every handler answers `{ ok, value | message }` rather than failing: a failed
//! call reaches the page as a bare error the panels do not show.

use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;

use super::connect::{
    MCP_CLIENT_PERMISSIONS, MCP_CLIENT_TOKEN_NAME, MCP_OPEN_CLIENTS, McpConnection, McpPaths,
    cursor_install_link, mcp_launch, read_mcp_connection, remove_mcp_connection,
    vscode_install_link, write_mcp_connection, write_mcpb,
};
use super::rewrite::kept_backup;
use super::route::{RouteDeps, route_local_request};
use super::server::{Handler, bind, serve};
use super::token::{
    MAX_LOCAL_API_TOKENS, hash_local_api_token, make_local_api_token, parse_local_api_tokens,
};
use super::{
    BoxFuture, Expected, LocalApiRequest, LocalApiResponse, McpRouter, Permission, SaveArtifact,
    SdkQuery, SemanticRanker, TokenRecord,
};
use crate::host::{Opener, PrefAccess, SecretAccess, WindowEvents};
use crate::prefs::PrefValue;
use crate::vault::{VaultState, iso_utc};

/// The preference that remembers the switch.
const PREF: &str = "local-api";
/// The secret that holds the token list (hashes only).
const SECRET: &str = "local-api-token";
/// The window event that asks for a semantic rank.
const RANK_EVENT: &str = "semanticRank";
/// How long the window may take to rank before the order is kept.
const RANK_TIMEOUT: Duration = Duration::from_secs(4);
/// The channels arrive with this prefix from the page.
const CHANNEL_PREFIX: &str = "weaveforge:";
const FUTURE_EXPIRY: &str = "The expiry must be in the future.";

/// A log line sink.
pub type Warn = Arc<dyn Fn(&str) + Send + Sync>;
/// The tools the MCP server lists, written beside the bridge.
pub type ToolList = Arc<dyn Fn() -> Vec<Value> + Send + Sync>;
type Reply = Result<Value, String>;

/// The rewritten configs, each with the original kept beside it when there is one.
fn shown_rewrites(changed: &[PathBuf], skipped: &[PathBuf]) -> Value {
    let shown = |p: &PathBuf| json!(p.display().to_string());
    let changed: Vec<Value> = changed
        .iter()
        .map(|file| {
            let mut entry = json!({ "file": shown(file) });
            if let Some(backup) = kept_backup(file) {
                entry["backup"] = shown(&backup);
            }
            entry
        })
        .collect();
    json!({ "changed": changed, "skipped": skipped.iter().map(shown).collect::<Vec<_>>() })
}

/// Locks `mutex`, taking the data back from a panicked holder.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Asks the window to rank a word search by meaning.
///
/// The encoder runs in the page, so the server asks and takes silence for an
/// answer: no window, no encoder, or a slow window all mean "keep the order".
pub struct WindowRanker {
    window: Arc<dyn WindowEvents>,
    warn: Warn,
    timeout: Duration,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Option<Vec<String>>>>>,
}

impl WindowRanker {
    /// A ranker that waits up to four seconds for the window.
    #[must_use]
    pub fn new(window: Arc<dyn WindowEvents>, warn: Warn) -> Self {
        Self::with_timeout(window, warn, RANK_TIMEOUT)
    }

    /// A ranker with its own wait, for tests.
    #[must_use]
    pub fn with_timeout(window: Arc<dyn WindowEvents>, warn: Warn, timeout: Duration) -> Self {
        Self {
            window,
            warn,
            timeout,
            next: AtomicU64::new(0),
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// The window's answer: `[id, order | null, error?]`.
    pub fn answer(&self, args: &[Value]) {
        let Some(id) = args.first().and_then(Value::as_u64) else {
            return;
        };
        let Some(waiting) = lock(&self.pending).remove(&id) else {
            return;
        };
        let _ = waiting.send(read_rank_answer(args.get(1), args.get(2), &*self.warn));
    }
}

impl SemanticRanker for WindowRanker {
    fn rank<'a>(
        &'a self,
        query: &'a str,
        candidates: Vec<String>,
    ) -> BoxFuture<'a, Option<Vec<String>>> {
        Box::pin(async move {
            if candidates.len() < 2 {
                return None;
            }
            let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
            let (sender, receiver) = oneshot::channel();
            let _ = lock(&self.pending).insert(id, sender);
            self.window.emit(RANK_EVENT, json!([id, query, candidates]));
            if let Ok(Ok(order)) = tokio::time::timeout(self.timeout, receiver).await {
                return order;
            }
            let _ = lock(&self.pending).remove(&id);
            None
        })
    }
}

/// The names the window sent back, or `None` to keep the order. A reason is logged, cut short.
fn read_rank_answer(
    order: Option<&Value>,
    error: Option<&Value>,
    warn: &dyn Fn(&str),
) -> Option<Vec<String>> {
    if let Some(Value::String(reason)) = error {
        let short: String = reason.chars().take(200).collect();
        warn(&format!(
            "[local-api] semantic ranking failed in the window: {short}"
        ));
    }
    order.and_then(Value::as_array).map(|names| {
        names
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    })
}

/// What the local API needs from the shell.
pub struct LocalApiDeps {
    /// The workspace the door opens onto.
    pub vault: VaultState,
    /// Where the switch is remembered.
    pub prefs: Arc<dyn PrefAccess>,
    /// Where the token list lives.
    pub secrets: Arc<dyn SecretAccess>,
    /// Opens a client's install link or the .mcpb file.
    pub opener: Arc<dyn Opener>,
    /// The local database for `/api/sdk/`.
    pub query: Option<Arc<dyn SdkQuery>>,
    /// Saves SDK artifact uploads.
    pub save_artifact: Option<Arc<dyn SaveArtifact>>,
    /// Answers `/mcp`.
    pub mcp: Option<Arc<dyn McpRouter>>,
    /// Takes the window's semantic rank answers.
    pub ranker: Arc<WindowRanker>,
    /// Where Connect writes the token file and the bridge.
    pub paths: McpPaths,
    /// This app's binary, which clients start with `--mcp-bridge`.
    pub exe: PathBuf,
    /// Stamped into the .mcpb manifest.
    pub version: String,
    /// The tools the MCP server lists.
    pub tools: ToolList,
    /// The port to serve on (`LOCAL_API_PORT`; 0 in tests).
    pub port: u16,
}

/// The server task and the switch that stops it.
struct Running {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

#[derive(Default)]
struct State {
    running: Option<Running>,
    /// Kept so the panel can say why on any later read, not only the click that failed.
    start_error: Option<String>,
}

/// What each request needs, owned so the server task can hold it.
struct Serving {
    vault: VaultState,
    query: Option<Arc<dyn SdkQuery>>,
    save_artifact: Option<Arc<dyn SaveArtifact>>,
    mcp: Option<Arc<dyn McpRouter>>,
    grants: Arc<Mutex<Vec<TokenRecord>>>,
}

impl Serving {
    async fn answer(&self, request: LocalApiRequest) -> LocalApiResponse {
        let mut expected = Expected::Grants(lock(&self.grants).clone());
        let deps = RouteDeps {
            vault: &self.vault,
            query: self.query.as_deref(),
            save_artifact: self.save_artifact.as_deref(),
            mcp: self.mcp.as_deref(),
        };
        let response =
            route_local_request(&deps, &request, &mut expected, now_ms(), &now_iso()).await;
        if let Expected::Grants(after) = expected {
            merge_used(&self.grants, &after);
        }
        response
    }
}

/// Copies each grant's last use from `after` into the live list.
fn merge_used(grants: &Mutex<Vec<TokenRecord>>, after: &[TokenRecord]) {
    let mut live = lock(grants);
    for grant in live.iter_mut() {
        if let Some(used) = after
            .iter()
            .find(|a| a.id == grant.id)
            .and_then(|a| a.used_at)
        {
            grant.used_at = Some(grant.used_at.map_or(used, |old| old.max(used)));
        }
    }
}

/// The local HTTP surface, off until somebody switches it on.
pub struct LocalApiControl {
    deps: LocalApiDeps,
    /// Read once per start and per token change, so a request needs no store read.
    grants: Arc<Mutex<Vec<TokenRecord>>>,
    /// Held through each handler, so they run one at a time.
    state: tokio::sync::Mutex<State>,
    /// The client configs this start pointed at the app, and those it left alone.
    rewrites: Mutex<(Vec<PathBuf>, Vec<PathBuf>)>,
}

impl LocalApiControl {
    /// A stopped controller.
    #[must_use]
    pub fn new(deps: LocalApiDeps) -> Self {
        Self {
            deps,
            grants: Arc::default(),
            state: tokio::sync::Mutex::new(State::default()),
            rewrites: Mutex::default(),
        }
    }

    /// Keeps what the start-up config rewrite did, so Settings can say it.
    pub fn set_mcp_rewrites(&self, changed: Vec<PathBuf>, skipped: Vec<PathBuf>) {
        *lock(&self.rewrites) = (changed, skipped);
    }

    /// The address clients use.
    #[must_use]
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.deps.port)
    }

    /// Answers one page call; `channel` may carry the `weaveforge:` prefix.
    pub async fn call(&self, channel: &str, args: &[Value]) -> Value {
        let name = channel.strip_prefix(CHANNEL_PREFIX).unwrap_or(channel);
        if name == "semantic-ranked" {
            self.deps.ranker.answer(args);
            return json!({ "ok": true, "value": null });
        }
        let mut state = self.state.lock().await;
        let first = args.first().unwrap_or(&Value::Null);
        let reply = match name {
            "local-api-state" => Ok(self.snapshot(&state, None)),
            "local-api-set" => self.set(&mut state, first).await,
            "local-api-token-create" => self.create_token(&state, first),
            "local-api-token-revoke" => self.revoke(&state, first),
            "mcp-connect" => self.connect(&mut state).await,
            "mcp-disconnect" => self.disconnect(&state),
            "mcp-open-client" => self.open_client(first),
            _ => Err("Unknown channel.".to_owned()),
        };
        match reply {
            Ok(value) => json!({ "ok": true, "value": value }),
            Err(message) => json!({ "ok": false, "message": message }),
        }
    }

    /// Starts serving at app start when the switch is on and a token exists.
    pub async fn resume(&self) {
        let mut state = self.state.lock().await;
        if !self.enabled() {
            return;
        }
        self.remember(&self.read_tokens());
        if lock(&self.grants).is_empty() {
            return;
        }
        let _ = self.start_if_enabled(&mut state).await;
    }

    /// Closes the door, on the way out of the app.
    pub async fn close(&self) {
        let mut state = self.state.lock().await;
        stop(&mut state).await;
    }

    fn enabled(&self) -> bool {
        matches!(self.deps.prefs.read(PREF), Ok(Some(PrefValue::Flag(true))))
    }

    /// Starts the server unless it runs; the reason when the port is not free.
    async fn start_if_enabled(&self, state: &mut State) -> Option<String> {
        if state.running.is_some() {
            return None;
        }
        match bind(self.deps.port).await {
            Ok(listener) => {
                let (stop, shutdown) = watch::channel(false);
                let task = tokio::spawn(serve(listener, self.handler(), shutdown));
                state.running = Some(Running { stop, task });
                state.start_error = None;
                None
            }
            Err(error) => {
                // Reported rather than retried: two things answering on one port
                // is not something to resolve behind the user's back.
                let message = start_failure(&error, self.deps.port);
                state.start_error = Some(message.clone());
                Some(message)
            }
        }
    }

    fn handler(&self) -> Handler {
        let serving = Arc::new(Serving {
            vault: self.deps.vault.clone(),
            query: self.deps.query.clone(),
            save_artifact: self.deps.save_artifact.clone(),
            mcp: self.deps.mcp.clone(),
            grants: Arc::clone(&self.grants),
        });
        Arc::new(move |request| {
            let serving = Arc::clone(&serving);
            Box::pin(async move { serving.answer(request).await })
        })
    }

    fn read_tokens(&self) -> Vec<TokenRecord> {
        let Ok(Some(stored)) = self.deps.secrets.read(SECRET) else {
            return Vec::new();
        };
        if stored.is_empty() {
            return Vec::new();
        }
        let mut records = parse_local_api_tokens(&stored);
        if records.iter().any(|r| r.legacy) {
            // Drop the old plaintext token from the store; only its hash stays.
            for record in &mut records {
                record.legacy = false;
            }
            let _ = self.write_tokens(&records);
        }
        records
    }

    fn write_tokens(&self, tokens: &[TokenRecord]) -> Result<(), String> {
        if tokens.is_empty() {
            self.deps.secrets.clear(SECRET)?;
        } else {
            let text = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
            self.deps.secrets.write(SECRET, &text)?;
        }
        self.remember(tokens);
        Ok(())
    }

    /// Swaps in the live grants, keeping each one's in-memory last use.
    fn remember(&self, tokens: &[TokenRecord]) {
        let mut live = lock(&self.grants);
        let fresh = tokens
            .iter()
            .map(|token| TokenRecord {
                used_at: live
                    .iter()
                    .find(|g| g.id == token.id)
                    .and_then(|g| g.used_at),
                ..token.clone()
            })
            .collect();
        *live = fresh;
    }

    /// The saved connection, when its token is still live.
    fn saved_mcp(&self, tokens: &[TokenRecord]) -> Option<McpConnection> {
        read_mcp_connection(&self.deps.paths.file).filter(|saved| {
            tokens
                .iter()
                .any(|t| t.id == saved.token_id && t.hash == hash_local_api_token(&saved.token))
        })
    }

    fn snapshot(&self, state: &State, issued: Option<(String, String)>) -> Value {
        let tokens = self.read_tokens();
        let used: HashMap<String, u64> = lock(&self.grants)
            .iter()
            .filter_map(|g| g.used_at.map(|at| (g.id.clone(), at)))
            .collect();
        let saved = self.saved_mcp(&tokens);
        let url = self.url();
        let shown: Vec<Value> = tokens
            .iter()
            .map(|t| shown_token(t, used.get(&t.id).copied()))
            .collect();
        let mut mcp = json!({
            "connected": saved.is_some(),
            "url": format!("{url}/mcp"),
            "launch": mcp_launch(&self.deps.paths, &self.deps.exe),
        });
        if let Some(saved) = &saved {
            mcp["tokenId"] = json!(saved.token_id);
        }
        let (changed, skipped) = &*lock(&self.rewrites);
        if !changed.is_empty() || !skipped.is_empty() {
            mcp["rewrites"] = shown_rewrites(changed, skipped);
        }
        let mut snap = json!({
            "enabled": state.running.is_some() && self.enabled(),
            "url": url,
            "tokens": shown,
            "mcp": mcp,
        });
        if let (None, Some(reason)) = (&state.running, &state.start_error) {
            snap["reason"] = json!(reason);
        }
        if let Some((id, token)) = issued {
            snap["issued"] = json!({ "id": id, "token": token });
        }
        snap
    }

    /// Saves the switch, or says why it did not stick.
    fn save_enabled(&self, on: bool) -> Result<(), String> {
        self.deps
            .prefs
            .write(PREF, Some(PrefValue::Flag(on)))
            .map_err(|m| format!("Could not save the setting: {m}"))
    }

    async fn set(&self, state: &mut State, enabled: &Value) -> Reply {
        if enabled != &Value::Bool(true) {
            // Tokens survive switching off, so scripts work again once it is back on.
            self.save_enabled(false)?;
            stop(state).await;
            state.start_error = None;
            return Ok(self.snapshot(state, None));
        }
        self.remember(&self.read_tokens());
        self.save_enabled(true)?;
        let _ = self.start_if_enabled(state).await;
        Ok(self.snapshot(state, None))
    }

    fn create_token(&self, state: &State, request: &Value) -> Reply {
        let tokens = self.read_tokens();
        if tokens.len() >= MAX_LOCAL_API_TOKENS {
            return Err(format!(
                "At most {MAX_LOCAL_API_TOKENS} tokens. Revoke one first."
            ));
        }
        let name = token_name(request.get("name"), tokens.len());
        let asked = request.get("permissions").and_then(Value::as_array);
        let permissions: Vec<Permission> = Permission::ALL
            .into_iter()
            .filter(|p| asked.is_some_and(|a| a.iter().any(|v| v.as_str() == Some(p.as_str()))))
            .collect();
        if permissions.is_empty() {
            return Err("Pick at least one permission.".to_owned());
        }
        let expires_at = expiry(request.get("expiresAt"), now_ms())?;
        let (token, record) = make_local_api_token(&name, &permissions, expires_at, &now_iso());
        let id = record.id.clone();
        let mut next = tokens;
        next.push(record);
        self.write_tokens(&next)?;
        // The only time the token itself leaves the shell.
        Ok(self.snapshot(state, Some((id, token))))
    }

    fn revoke(&self, state: &State, id: &Value) -> Reply {
        let Some(id) = id.as_str().filter(|id| !id.is_empty()) else {
            return Err("That is not a token to revoke.".to_owned());
        };
        let tokens = self.read_tokens();
        let saved = self.saved_mcp(&tokens);
        let kept: Vec<TokenRecord> = tokens.into_iter().filter(|t| t.id != id).collect();
        self.write_tokens(&kept)?;
        // A revoked token in the file would only make clients fail with a 401.
        if saved.is_some_and(|s| s.token_id == id) {
            remove_mcp_connection(&self.deps.paths.file).map_err(|e| e.to_string())?;
        }
        Ok(self.snapshot(state, None))
    }

    async fn connect(&self, state: &mut State) -> Reply {
        let tokens = self.read_tokens();
        let (connection, issued) = match self.saved_mcp(&tokens) {
            Some(saved) => (saved, false),
            None => {
                if tokens.len() >= MAX_LOCAL_API_TOKENS {
                    return Err(format!(
                        "At most {MAX_LOCAL_API_TOKENS} tokens. Revoke one in Access tokens first."
                    ));
                }
                let (token, record) = make_local_api_token(
                    MCP_CLIENT_TOKEN_NAME,
                    &MCP_CLIENT_PERMISSIONS,
                    None,
                    &now_iso(),
                );
                let token_id = record.id.clone();
                let mut next = tokens.clone();
                next.push(record);
                self.write_tokens(&next)?;
                (
                    McpConnection {
                        url: String::new(),
                        api_url: String::new(),
                        token,
                        token_id,
                    },
                    true,
                )
            }
        };
        let api_url = self.url();
        let connection = McpConnection {
            url: format!("{api_url}/mcp"),
            api_url,
            ..connection
        };
        if let Err(error) =
            write_mcp_connection(&self.deps.paths, &connection, &(self.deps.tools)())
        {
            // A token no client file names is one nobody can use or see to revoke.
            if issued {
                let _ = self.write_tokens(&tokens);
            }
            return Err(format!(
                "Could not write {}: {error}",
                self.deps.paths.file.display()
            ));
        }
        self.remember(&self.read_tokens());
        self.save_enabled(true)?;
        let _ = self.start_if_enabled(state).await;
        Ok(self.snapshot(state, None))
    }

    fn disconnect(&self, state: &State) -> Reply {
        let tokens = self.read_tokens();
        if let Some(saved) = read_mcp_connection(&self.deps.paths.file) {
            let kept: Vec<TokenRecord> = tokens
                .into_iter()
                .filter(|t| t.id != saved.token_id)
                .collect();
            self.write_tokens(&kept)?;
        }
        remove_mcp_connection(&self.deps.paths.file).map_err(|e| e.to_string())?;
        Ok(self.snapshot(state, None))
    }

    fn open_client(&self, client: &Value) -> Reply {
        let Some(client) = client.as_str().filter(|c| MCP_OPEN_CLIENTS.contains(c)) else {
            return Err("Unknown client.".to_owned());
        };
        if self.saved_mcp(&self.read_tokens()).is_none() {
            return Err("Connect first.".to_owned());
        }
        let launch = mcp_launch(&self.deps.paths, &self.deps.exe);
        match client {
            "cursor" => self.deps.opener.open_url(&cursor_install_link(&launch))?,
            "vscode" => self.deps.opener.open_url(&vscode_install_link(&launch))?,
            _ => {
                let bridge = self.bridge_bytes()?;
                let file = write_mcpb(
                    &self.deps.paths,
                    &bridge,
                    &(self.deps.tools)(),
                    &self.deps.version,
                    &launch,
                )
                .map_err(|e| e.to_string())?;
                self.deps.opener.open_path(&file).map_err(|failed| {
                    format!("Claude Desktop did not open {}: {failed}", file.display())
                })?;
            }
        }
        Ok(Value::Null)
    }

    fn bridge_bytes(&self) -> Result<Vec<u8>, String> {
        let source = self
            .deps
            .paths
            .bridge_source
            .as_ref()
            .ok_or("This build ships no MCP bridge.")?;
        std::fs::read(source).map_err(|e| format!("Could not read {}: {e}", source.display()))
    }
}

/// Stops the server task, if one runs.
async fn stop(state: &mut State) {
    if let Some(running) = state.running.take() {
        let _ = running.stop.send(true);
        let _ = running.task.await;
    }
}

/// Why the server did not start. The usual reason is another program on the port.
fn start_failure(error: &io::Error, port: u16) -> String {
    if error.kind() == io::ErrorKind::AddrInUse {
        return format!(
            "Another program is using port {port}, so AI clients cannot reach WeaveForge. Close it, then turn Serve MCP on again."
        );
    }
    let text = error.to_string();
    if text.is_empty() {
        "The port is not available.".to_owned()
    } else {
        text
    }
}

/// A token as the panel sees it: no hash, and its last use when known.
fn shown_token(token: &TokenRecord, used: Option<u64>) -> Value {
    let mut shown = serde_json::to_value(token).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut shown {
        let _ = map.remove("hash");
        if let Some(at) = used {
            let _ = map.insert("lastUsedAt".to_owned(), json!(iso_ms(at)));
        }
    }
    shown
}

/// The trimmed name, cut to 60 characters, or `Token {n}`.
fn token_name(name: Option<&Value>, count: usize) -> String {
    match name.and_then(Value::as_str).map(str::trim) {
        Some(name) if !name.is_empty() => name.chars().take(60).collect(),
        _ => format!("Token {}", count + 1),
    }
}

/// `null` is no expiry; a future ISO time is normalised; anything else is refused.
fn expiry(value: Option<&Value>, now: u64) -> Result<Option<String>, String> {
    match value {
        Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => match parse_iso_ms(text) {
            Some(at) if at > now => Ok(Some(iso_ms(at))),
            _ => Err(FUTURE_EXPIRY.to_owned()),
        },
        _ => Err(FUTURE_EXPIRY.to_owned()),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn now_iso() -> String {
    iso_utc(SystemTime::now())
}

fn iso_ms(ms: u64) -> String {
    iso_utc(UNIX_EPOCH + Duration::from_millis(ms))
}

/// Epoch ms of `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS[.fff]]Z`, as the page sends them.
pub(crate) fn parse_iso_ms(text: &str) -> Option<u64> {
    let (date, time) = match text.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (text, None),
    };
    let mut parts = date.split('-');
    let year = digits(parts.next()?, 4)?;
    let month = digits(parts.next()?, 2)?;
    let day = digits(parts.next()?, 2)?;
    if parts.next().is_some()
        || !(1..=12).contains(&month)
        || day < 1
        || day > days_in_month(year, month)
    {
        return None;
    }
    let ms = match time {
        Some(time) => time_ms(time.strip_suffix('Z')?)?,
        None => 0,
    };
    u64::try_from(days_from_civil(year, month, day) * 86_400_000 + ms).ok()
}

/// Ms into the day of `HH:MM[:SS[.fff]]`.
fn time_ms(time: &str) -> Option<i64> {
    let (clock, fraction) = match time.split_once('.') {
        Some((clock, fraction)) => (clock, Some(fraction)),
        None => (time, None),
    };
    let mut parts = clock.split(':');
    let hour = digits(parts.next()?, 2)?;
    let minute = digits(parts.next()?, 2)?;
    let second = match parts.next() {
        Some(second) => digits(second, 2)?,
        None => 0,
    };
    if parts.next().is_some() || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let milli = match fraction {
        Some(f) if !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()) => {
            format!("{f:0<3}").get(..3)?.parse().ok()?
        }
        Some(_) => return None,
        None => 0,
    };
    Some(((hour * 60 + minute) * 60 + second) * 1000 + milli)
}

/// `text` as a number when it is exactly `width` ASCII digits.
fn digits(text: &str, width: usize) -> Option<i64> {
    if text.len() != width || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

fn days_in_month(year: i64, month: i64) -> i64 {
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted_month = (month + 9) % 12;
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::future::Future;
    use std::path::Path;

    use super::*;

    #[derive(Default)]
    struct FakePrefs(Mutex<HashMap<String, PrefValue>>);

    impl PrefAccess for FakePrefs {
        fn read(&self, name: &str) -> Result<Option<PrefValue>, String> {
            Ok(lock(&self.0).get(name).cloned())
        }
        fn write(&self, name: &str, value: Option<PrefValue>) -> Result<(), String> {
            let mut prefs = lock(&self.0);
            match value {
                Some(value) => drop(prefs.insert(name.to_owned(), value)),
                None => drop(prefs.remove(name)),
            }
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeSecrets(Mutex<HashMap<String, String>>);

    impl SecretAccess for FakeSecrets {
        fn read(&self, name: &str) -> Result<Option<String>, String> {
            Ok(lock(&self.0).get(name).cloned())
        }
        fn write(&self, name: &str, value: &str) -> Result<(), String> {
            drop(lock(&self.0).insert(name.to_owned(), value.to_owned()));
            Ok(())
        }
        fn clear(&self, name: &str) -> Result<(), String> {
            drop(lock(&self.0).remove(name));
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeOpener {
        urls: Mutex<Vec<String>>,
        paths: Mutex<Vec<PathBuf>>,
    }

    impl Opener for FakeOpener {
        fn open_url(&self, url: &str) -> Result<(), String> {
            lock(&self.urls).push(url.to_owned());
            Ok(())
        }
        fn open_path(&self, path: &Path) -> Result<(), String> {
            lock(&self.paths).push(path.to_owned());
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeWindow(Mutex<Vec<(String, Value)>>);

    impl WindowEvents for FakeWindow {
        fn emit(&self, event: &str, payload: Value) {
            lock(&self.0).push((event.to_owned(), payload));
        }
    }

    /// A scratch folder under the temp dir, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "wf-control-{tag}-{}-{}",
                std::process::id(),
                now_ms()
            ));
            fs::create_dir_all(&dir).expect("scratch dir");
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct Rig {
        control: LocalApiControl,
        secrets: Arc<FakeSecrets>,
        opener: Arc<FakeOpener>,
        window: Arc<FakeWindow>,
        file: PathBuf,
        _scratch: Scratch,
    }

    fn rig(tag: &str, port: u16, bridge: bool) -> Rig {
        let scratch = Scratch::new(tag);
        let dir = scratch.0.join("mcp");
        let bridge_source = scratch.0.join("weaveforge-mcp.mjs");
        fs::write(&bridge_source, "// bridge\n").expect("bridge");
        let paths = McpPaths {
            file: dir.join("connection.json"),
            dir,
            bridge_source: bridge.then_some(bridge_source),
        };
        let file = paths.file.clone();
        let secrets = Arc::new(FakeSecrets::default());
        let opener = Arc::new(FakeOpener::default());
        let window = Arc::new(FakeWindow::default());
        let warn: Warn = Arc::new(|_| {});
        let ranker = Arc::new(WindowRanker::new(window.clone(), warn));
        let control = LocalApiControl::new(LocalApiDeps {
            vault: VaultState::new(),
            prefs: Arc::new(FakePrefs::default()),
            secrets: secrets.clone(),
            opener: opener.clone(),
            query: None,
            save_artifact: None,
            mcp: None,
            ranker,
            paths,
            exe: PathBuf::from("weaveforge-shell"),
            version: "1.2.3".to_owned(),
            tools: Arc::new(|| vec![json!({ "name": "search" })]),
            port,
        });
        Rig {
            control,
            secrets,
            opener,
            window,
            file,
            _scratch: scratch,
        }
    }

    fn run<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    async fn ok(control: &LocalApiControl, channel: &str, args: &[Value]) -> Value {
        let reply = control.call(channel, args).await;
        assert_eq!(reply["ok"], json!(true), "{channel}: {reply}");
        reply["value"].clone()
    }

    async fn refused(control: &LocalApiControl, channel: &str, args: &[Value]) -> String {
        let reply = control.call(channel, args).await;
        assert_eq!(reply["ok"], json!(false), "{channel}: {reply}");
        reply["message"].as_str().expect("message").to_owned()
    }

    #[allow(clippy::needless_pass_by_value, reason = "test helper takes literals")]
    fn create_args(permissions: Value, expires_at: Value) -> [Value; 1] {
        [json!({ "name": "  Script  ", "permissions": permissions, "expiresAt": expires_at })]
    }

    #[test]
    fn token_create_validates_and_hides_the_hash() {
        let rig = rig("create", 0, true);
        run(async {
            let c = &rig.control;
            let none = create_args(json!(["nope"]), Value::Null);
            assert_eq!(
                refused(c, "weaveforge:local-api-token-create", &none).await,
                "Pick at least one permission."
            );
            let missing = [json!({ "permissions": ["rest:read"] })];
            assert_eq!(
                refused(c, "local-api-token-create", &missing).await,
                FUTURE_EXPIRY
            );
            let past = create_args(json!(["rest:read"]), json!("2001-01-01T00:00:00.000Z"));
            assert_eq!(
                refused(c, "local-api-token-create", &past).await,
                FUTURE_EXPIRY
            );
            let junk = create_args(json!(["rest:read"]), json!("soon"));
            assert_eq!(
                refused(c, "local-api-token-create", &junk).await,
                FUTURE_EXPIRY
            );

            let good = create_args(
                json!(["mcp:read", "rest:read"]),
                json!("2999-12-01T22:59:59.5Z"),
            );
            let snap = ok(c, "local-api-token-create", &good).await;
            let token = &snap["tokens"][0];
            assert_eq!(token["name"], json!("Script"));
            assert_eq!(token["permissions"], json!(["rest:read", "mcp:read"]));
            assert_eq!(token["expiresAt"], json!("2999-12-01T22:59:59.500Z"));
            assert!(token.get("hash").is_none());
            let issued = snap["issued"]["token"].as_str().expect("issued token");
            assert_eq!(snap["issued"]["id"], token["id"]);
            assert!(lock(&rig.secrets.0)[SECRET].contains(&hash_local_api_token(issued)));
            assert!(!lock(&rig.secrets.0)[SECRET].contains(issued));

            let unnamed = [json!({ "permissions": ["rest:read"], "expiresAt": null })];
            let snap = ok(c, "local-api-token-create", &unnamed).await;
            assert_eq!(snap["tokens"][1]["name"], json!("Token 2"));
            assert_eq!(snap["tokens"][1]["expiresAt"], Value::Null);
            assert!(snap.get("issued").is_some());
            assert!(ok(c, "local-api-state", &[]).await.get("issued").is_none());
        });
    }

    #[test]
    fn at_most_five_tokens() {
        let rig = rig("max", 0, true);
        run(async {
            let args = create_args(json!(["rest:read"]), Value::Null);
            for _ in 0..MAX_LOCAL_API_TOKENS {
                let _ = ok(&rig.control, "local-api-token-create", &args).await;
            }
            let message = refused(&rig.control, "local-api-token-create", &args).await;
            assert_eq!(message, "At most 5 tokens. Revoke one first.");
            let connect = refused(&rig.control, "mcp-connect", &[]).await;
            assert_eq!(
                connect,
                "At most 5 tokens. Revoke one in Access tokens first."
            );
        });
    }

    #[test]
    fn connect_writes_the_file_and_serves_then_revoke_removes_it() {
        let rig = rig("connect", 0, true);
        run(async {
            let c = &rig.control;
            let snap = ok(c, "mcp-connect", &[]).await;
            assert_eq!(snap["enabled"], json!(true));
            assert_eq!(snap["mcp"]["connected"], json!(true));
            let id = snap["tokens"][0]["id"].clone();
            assert_eq!(snap["mcp"]["tokenId"], id);
            assert_eq!(snap["tokens"][0]["name"], json!(MCP_CLIENT_TOKEN_NAME));
            let saved = read_mcp_connection(&rig.file).expect("connection file");
            assert_eq!(saved.url, "http://127.0.0.1:0/mcp");
            assert_eq!(saved.api_url, "http://127.0.0.1:0");

            // A second Connect reuses the live token.
            let again = ok(c, "mcp-connect", &[]).await;
            assert_eq!(again["tokens"].as_array().map(Vec::len), Some(1));

            let after = ok(c, "local-api-token-revoke", &[id]).await;
            assert_eq!(after["mcp"]["connected"], json!(false));
            assert!(!rig.file.exists());
            assert!(!lock(&rig.secrets.0).contains_key(SECRET));
            assert_eq!(
                refused(c, "local-api-token-revoke", &[json!("")]).await,
                "That is not a token to revoke."
            );
            c.close().await;
        });
    }

    #[test]
    fn state_lists_the_mcp_configs_rewritten_and_left_alone() {
        let rig = rig("rewrites", 0, true);
        run(async {
            let c = &rig.control;
            assert!(
                ok(c, "local-api-state", &[]).await["mcp"]
                    .get("rewrites")
                    .is_none()
            );
            let dir = rig
                .file
                .parent()
                .expect("dir")
                .parent()
                .expect("root")
                .to_path_buf();
            let kept = dir.join("kept.json");
            let clean = dir.join("clean.json");
            let jsonc = dir.join("settings.jsonc");
            fs::write(dir.join("kept.json.weaveforge.bak"), "{}").expect("backup");
            c.set_mcp_rewrites(vec![kept.clone(), clean.clone()], vec![jsonc.clone()]);
            let rewrites = ok(c, "local-api-state", &[]).await["mcp"]["rewrites"].clone();
            let shown = |p: &Path| json!(p.display().to_string());
            assert_eq!(
                rewrites,
                json!({
                    "changed": [
                        { "file": shown(&kept), "backup": shown(&dir.join("kept.json.weaveforge.bak")) },
                        { "file": shown(&clean) },
                    ],
                    "skipped": [shown(&jsonc)],
                })
            );
            c.close().await;
        });
    }

    #[test]
    fn disconnect_drops_the_token_and_the_file() {
        let rig = rig("disconnect", 0, true);
        run(async {
            let _ = ok(&rig.control, "mcp-connect", &[]).await;
            let snap = ok(&rig.control, "mcp-disconnect", &[]).await;
            assert_eq!(snap["mcp"]["connected"], json!(false));
            assert_eq!(snap["tokens"], json!([]));
            assert!(!rig.file.exists());
            rig.control.close().await;
        });
    }

    #[test]
    fn open_client_needs_a_known_client_and_a_connection() {
        let rig = rig("open", 0, true);
        run(async {
            let c = &rig.control;
            assert_eq!(
                refused(c, "mcp-open-client", &[json!("emacs")]).await,
                "Unknown client."
            );
            assert_eq!(
                refused(c, "mcp-open-client", &[json!("cursor")]).await,
                "Connect first."
            );
            let _ = ok(c, "mcp-connect", &[]).await;
            assert_eq!(
                ok(c, "mcp-open-client", &[json!("cursor")]).await,
                Value::Null
            );
            assert_eq!(
                ok(c, "mcp-open-client", &[json!("vscode")]).await,
                Value::Null
            );
            assert_eq!(lock(&rig.opener.urls).len(), 2);
            assert_eq!(
                ok(c, "mcp-open-client", &[json!("claude-desktop")]).await,
                Value::Null
            );
            let opened = lock(&rig.opener.paths).clone();
            assert_eq!(opened.len(), 1);
            assert!(opened[0].exists());
            c.close().await;
        });
    }

    #[test]
    fn claude_desktop_without_a_bridge_says_so() {
        let rig = rig("nobridge", 0, false);
        run(async {
            let _ = ok(&rig.control, "mcp-connect", &[]).await;
            let message =
                refused(&rig.control, "mcp-open-client", &[json!("claude-desktop")]).await;
            assert_eq!(message, "This build ships no MCP bridge.");
            rig.control.close().await;
        });
    }

    #[test]
    fn legacy_plaintext_token_is_rewritten_as_a_hash() {
        let rig = rig("legacy", 0, true);
        let plain = "ab".repeat(32);
        drop(lock(&rig.secrets.0).insert(SECRET.to_owned(), plain.clone()));
        run(async {
            let snap = ok(&rig.control, "local-api-state", &[]).await;
            assert_eq!(snap["tokens"][0]["id"], json!("legacy"));
            assert!(snap["tokens"][0].get("legacy").is_none());
            let stored = lock(&rig.secrets.0)[SECRET].clone();
            assert!(stored.contains(&hash_local_api_token(&plain)));
            // The id stays "legacy"; only the flag must be gone.
            assert!(!stored.contains("\"legacy\":"));
            assert!(!stored.contains(&plain));
        });
    }

    #[test]
    fn switch_off_and_on() {
        let rig = rig("switch", 0, true);
        run(async {
            let c = &rig.control;
            let on = ok(c, "local-api-set", &[json!(true)]).await;
            assert_eq!(on["enabled"], json!(true));
            let off = ok(c, "local-api-set", &[json!(false)]).await;
            assert_eq!(off["enabled"], json!(false));
            assert!(off.get("reason").is_none());
        });
    }

    #[test]
    fn resume_waits_for_a_token() {
        let rig = rig("resume", 0, true);
        run(async {
            let c = &rig.control;
            let _ = ok(c, "local-api-set", &[json!(true)]).await;
            c.close().await;
            c.resume().await;
            assert_eq!(ok(c, "local-api-state", &[]).await["enabled"], json!(false));
            let args = create_args(json!(["rest:read"]), Value::Null);
            let _ = ok(c, "local-api-token-create", &args).await;
            c.resume().await;
            assert_eq!(ok(c, "local-api-state", &[]).await["enabled"], json!(true));
            c.close().await;
        });
    }

    #[test]
    fn a_busy_port_is_reported() {
        let busy = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = busy.local_addr().expect("addr").port();
        let rig = rig("busy", port, true);
        run(async {
            let snap = ok(&rig.control, "local-api-set", &[json!(true)]).await;
            assert_eq!(snap["enabled"], json!(false));
            let reason = snap["reason"].as_str().expect("reason");
            assert!(
                reason.starts_with(&format!("Another program is using port {port}")),
                "{reason}"
            );
            assert_eq!(
                ok(&rig.control, "local-api-state", &[]).await["reason"],
                json!(reason)
            );
        });
        drop(busy);
    }

    #[test]
    fn rank_round_trip_and_short_lists() {
        let rig = rig("rank", 0, true);
        let ranker = Arc::clone(&rig.control.deps.ranker);
        run(async {
            assert_eq!(ranker.rank("tea", vec!["a".to_owned()]).await, None);
            assert!(lock(&rig.window.0).is_empty());

            let asked = ranker.rank("tea", vec!["a".to_owned(), "b".to_owned()]);
            let answer = async {
                tokio::task::yield_now().await;
                let (event, payload) = lock(&rig.window.0)[0].clone();
                assert_eq!(event, RANK_EVENT);
                assert_eq!(payload[1], json!("tea"));
                let args = [payload[0].clone(), json!(["b", 3, "a"])];
                let reply = rig.control.call("weaveforge:semantic-ranked", &args);
                assert_eq!(reply.await["ok"], json!(true));
            };
            let (order, ()) = tokio::join!(asked, answer);
            assert_eq!(order, Some(vec!["b".to_owned(), "a".to_owned()]));
        });
    }

    #[test]
    fn rank_times_out_and_logs_window_errors() {
        let window = Arc::new(FakeWindow::default());
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = Arc::clone(&lines);
        let warn: Warn = Arc::new(move |line| lock(&sink).push(line.to_owned()));
        let ranker = WindowRanker::with_timeout(window, warn, Duration::from_millis(20));
        run(async {
            assert_eq!(
                ranker.rank("q", vec!["a".to_owned(), "b".to_owned()]).await,
                None
            );
        });
        assert!(lock(&ranker.pending).is_empty());
        ranker.answer(&[json!(1), Value::Null, json!("boom")]);
        assert!(lock(&lines).is_empty(), "an unknown id is ignored");
        let order = read_rank_answer(Some(&Value::Null), Some(&json!("boom")), &|line| {
            lock(&lines).push(line.to_owned());
        });
        assert_eq!(order, None);
        assert_eq!(
            lock(&lines)[0],
            "[local-api] semantic ranking failed in the window: boom"
        );
    }

    #[test]
    fn iso_parsing() {
        assert_eq!(parse_iso_ms("1970-01-01"), Some(0));
        assert_eq!(parse_iso_ms("1970-01-02T00:00:01.5Z"), Some(86_401_500));
        assert_eq!(
            iso_ms(parse_iso_ms("2026-12-01T22:59:59.000Z").expect("parse")),
            "2026-12-01T22:59:59.000Z"
        );
        assert_eq!(parse_iso_ms("2024-02-29"), Some(1_709_164_800_000));
        assert_eq!(parse_iso_ms("2023-02-29"), None);
        assert_eq!(parse_iso_ms("2026-12-01T22:59:59"), None);
        assert_eq!(parse_iso_ms("2026-13-01"), None);
        assert_eq!(parse_iso_ms("2026-12-01T24:00Z"), None);
        assert_eq!(parse_iso_ms("2026-12-01T10:00.Z"), None);
    }
}

//! Rust client for the Node sidecar: one JSON object per line over stdio.
//!
//! Replies are routed by id, so calls can overlap. Every call is bounded by a timeout and a
//! cap on calls in flight. The child is killed when the client drops, and on Windows a Job
//! Object kills it if the shell dies without running `Drop`.
//!
//! The sidecar can also ask the shell for things and send it events; a `SidecarHost` answers them.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

#[cfg(windows)]
use process_wrap::tokio::JobObject;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot, watch};

/// The sidecar's own request line cap (`MAX_LINE` in apps/shell/sidecar/src/wire.ts, in UTF-16 units).
/// A UTF-8 byte cap at or under it is always under it in UTF-16 units too.
pub const SIDECAR_MAX_LINE: usize = 32 * 1024 * 1024;

/// How long an internal kill waits to reap the child.
const REAP_TIMEOUT: Duration = Duration::from_secs(5);
/// Prefix the sidecar puts on fatal stderr lines; `exit_reason` reads only these.
const FATAL_PREFIX: &str = "weaveforge-sidecar: ";

/// How to start the sidecar and how far to trust it.
#[derive(Debug, Clone)]
pub struct SidecarConfig {
    /// The node binary.
    pub program: PathBuf,
    /// Arguments after the program (script path, flags).
    pub args: Vec<OsString>,
    /// Working directory for the child; `None` keeps the shell's.
    pub cwd: Option<PathBuf>,
    /// Longest wait for one reply.
    pub call_timeout: Duration,
    /// Most calls waiting for a reply at once; one more gets `Busy`.
    pub max_in_flight: usize,
    /// Longest request line in bytes, newline included; longer gets `TooLarge`.
    pub max_request_bytes: usize,
    /// Longest reply line in bytes; a longer one kills the sidecar (`Exited`).
    pub max_reply_bytes: usize,
}

/// Why a call failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidecarError {
    /// The process could not be started.
    Spawn(String),
    /// Too many calls are waiting already.
    Busy,
    /// The request is longer than `max_request_bytes`.
    TooLarge,
    /// No reply within `call_timeout`.
    Timeout,
    /// The sidecar has exited or closed its stdout.
    Exited,
    /// The sidecar answered `ok: false` with this message.
    Remote(String),
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(msg) => write!(f, "sidecar spawn failed: {msg}"),
            Self::Busy => f.write_str("sidecar busy"),
            Self::TooLarge => f.write_str("sidecar request too large"),
            Self::Timeout => f.write_str("sidecar timed out"),
            Self::Exited => f.write_str("sidecar exited"),
            Self::Remote(msg) => write!(f, "sidecar error: {msg}"),
        }
    }
}

impl std::error::Error for SidecarError {}

type Reply = Result<Value, SidecarError>;

/// What the shell does for the sidecar: notices it sends, and questions it asks.
pub trait SidecarHost: Send + Sync + 'static {
    /// A notice from the sidecar. Runs on the reader task, so it must return quickly.
    fn event(&self, name: &str, params: Value);
    /// A question from the sidecar. Runs on a blocking thread; `Err` is sent back as the error text.
    fn ask(&self, method: &str, params: Value) -> Result<Value, String>;
}

/// What the reader needs to serve asks and events.
struct HostLink {
    host: Option<Arc<dyn SidecarHost>>,
    /// Weak, so a pending answer never keeps stdin open after `shutdown`.
    answers: mpsc::WeakSender<String>,
    max_answer_bytes: usize,
}

/// Longest stderr line kept as the exit reason, in chars.
const MAX_REASON_CHARS: usize = 500;

/// State the reader task, the writer task and the callers share.
struct Shared {
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    closed: AtomicBool,
    next_id: AtomicU64,
    child: tokio::sync::Mutex<Option<Box<dyn ChildWrapper>>>,
    /// The child's last stderr line, read by `exit_reason`.
    last_stderr: Mutex<Option<String>>,
    /// Set once stderr reaches EOF.
    stderr_done: watch::Sender<bool>,
}

/// A running sidecar. Dropping it kills the child.
pub struct Sidecar {
    shared: Arc<Shared>,
    writer: Mutex<Option<mpsc::Sender<String>>>,
    pid: Option<u32>,
    call_timeout: Duration,
    max_in_flight: usize,
    max_request_bytes: usize,
}

const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Sidecar>();
};

/// Locks a std mutex, ignoring poison: the map stays usable after a panic elsewhere.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Builds the child command, wrapped so it dies with the shell.
fn wrapped_command(program: PathBuf, args: Vec<OsString>, cwd: Option<PathBuf>) -> CommandWrap {
    let mut wrap = CommandWrap::with_new(program, move |c| {
        let _ = c.args(&args);
        if let Some(dir) = &cwd {
            let _ = c.current_dir(dir);
        }
        let _ = c.stdin(Stdio::piped());
        let _ = c.stdout(Stdio::piped());
        let _ = c.stderr(Stdio::piped());
    });
    let _ = wrap.wrap(KillOnDrop);
    #[cfg(windows)]
    {
        // JobObject overwrites raw creation flags, so CREATE_NO_WINDOW must go through CreationFlags.
        let _ = wrap.wrap(process_wrap::tokio::CreationFlags(
            windows::Win32::System::Threading::CREATE_NO_WINDOW,
        ));
        let _ = wrap.wrap(JobObject);
    }
    wrap
}

/// Rejects settings the client cannot run with.
fn validate(config: &SidecarConfig) -> Result<(), SidecarError> {
    let problem = if config.max_in_flight == 0 {
        "max_in_flight must be at least 1"
    } else if config.max_request_bytes == 0 || config.max_request_bytes > SIDECAR_MAX_LINE {
        "max_request_bytes must be 1..=SIDECAR_MAX_LINE"
    } else if config.max_reply_bytes == 0 {
        "max_reply_bytes must be at least 1"
    } else {
        return Ok(());
    };
    Err(SidecarError::Spawn(problem.to_owned()))
}

/// Routes one stdout line: an event to the host, an ask to be answered, or a reply to its caller.
fn route_line(shared: &Shared, link: &HostLink, line: &str) {
    let Some(value) = serde_json::from_str::<Value>(line).ok() else {
        eprintln!("sidecar: stray line: {line}");
        return;
    };
    if let Some(name) = value.get("event").and_then(Value::as_str) {
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        deliver_event(link, name, params);
        return;
    }
    if let Some(ask) = value.get("ask") {
        match ask.as_u64() {
            Some(n) => serve_ask(link, n, &value),
            None => eprintln!("sidecar: stray line: {line}"),
        }
        return;
    }
    // Lines without a u64 id are logged.
    let Some(id) = value.get("id").and_then(Value::as_u64) else {
        if value.get("id").is_some_and(Value::is_null)
            && value.get("ok").and_then(Value::as_bool) == Some(false)
        {
            let msg = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            eprintln!("sidecar: unroutable error: {msg}");
        } else {
            eprintln!("sidecar: stray line: {line}");
        }
        return;
    };
    // A missing waiter means the caller already timed out.
    let Some(waiter) = lock(&shared.pending).remove(&id) else {
        return;
    };
    let reply = if value.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(value.get("value").cloned().unwrap_or(Value::Null))
    } else {
        let msg = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        Err(SidecarError::Remote(msg.to_owned()))
    };
    let _ = waiter.send(reply);
}

/// Hands a notice to the host. Without a host it is dropped.
fn deliver_event(link: &HostLink, name: &str, params: Value) {
    if let Some(host) = &link.host {
        host.event(name, params);
    }
}

/// Answers an ask in its own task, so the reader never waits on the host.
fn serve_ask(link: &HostLink, n: u64, value: &Value) {
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    let host = link.host.clone();
    let answers = link.answers.clone();
    let max = link.max_answer_bytes;
    // Detached: the task ends once its answer is queued or stdin has closed.
    let _answering = tokio::spawn(async move {
        let result = match (method, host) {
            (None, _) => Err("bad ask".to_owned()),
            (Some(_), None) => Err("no host".to_owned()),
            (Some(method), Some(host)) => {
                tokio::task::spawn_blocking(move || host.ask(&method, params))
                    .await
                    .unwrap_or_else(|_| Err("host failed".to_owned()))
            }
        };
        if let Some(tx) = answers.upgrade() {
            let _ = tx.send(answer_line(n, result, max)).await;
        }
    });
}

/// The stdin line that answers ask `n`. `answer` is the first key, since the sidecar routes on that prefix.
#[must_use]
fn answer_line(n: u64, result: Result<Value, String>, max: usize) -> String {
    match result {
        Ok(v) => {
            let line = format!("{{\"answer\":{n},\"ok\":true,\"value\":{v}}}\n");
            if line.len() > max {
                answer_line(n, Err("answer too large".to_owned()), max)
            } else {
                line
            }
        }
        Err(e) => format!(
            "{{\"answer\":{n},\"ok\":false,\"error\":{}}}\n",
            Value::String(e)
        ),
    }
}

/// Marks the client closed and fails every waiter with `Exited`. The only place that drains `pending`.
fn fail_all(shared: &Shared) {
    // Set before draining so a caller that inserts after the drain sees it.
    shared.closed.store(true, Ordering::SeqCst);
    let drained = std::mem::take(&mut *lock(&shared.pending));
    for (_, waiter) in drained {
        let _ = waiter.send(Err(SidecarError::Exited));
    }
}

/// Kills the child if it is still held, and reaps it so no zombie is left. Does nothing when `shutdown`
/// already took it. The child stays in place: `wait` caches the exit status, so a later `shutdown` still sees it.
async fn kill(shared: &Shared) {
    if let Some(child) = shared.child.lock().await.as_mut() {
        let _ = child.start_kill();
        // Bounded: a kill that does not land must not hold the lock forever.
        let _ = tokio::time::timeout(REAP_TIMEOUT, child.wait()).await;
    }
}

/// Reads replies until EOF or an oversized line, then fails every waiter and kills the child.
async fn read_replies(
    shared: Arc<Shared>,
    stdout: ChildStdout,
    max_reply_bytes: usize,
    link: HostLink,
) {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    let limit = u64::try_from(max_reply_bytes)
        .unwrap_or(u64::MAX)
        .saturating_add(1);
    loop {
        buf.clear();
        match (&mut reader).take(limit).read_until(b'\n', &mut buf).await {
            Ok(0) => break,
            Ok(_) if buf.len() > max_reply_bytes => {
                eprintln!("sidecar: reply over {max_reply_bytes} bytes, killing");
                break;
            }
            Ok(_) => {
                let line = String::from_utf8_lossy(&buf);
                route_line(&shared, &link, line.trim_end_matches(['\r', '\n']));
            }
            Err(e) => {
                eprintln!("sidecar: stdout read failed: {e}");
                break;
            }
        }
    }
    // Killed first, so a waiter woken by the failure never sees the child still running.
    kill(&shared).await;
    fail_all(&shared);
}

/// Owns stdin and writes each queued line whole, so a dropped caller cannot leave half a line.
async fn write_requests(
    shared: Arc<Shared>,
    mut stdin: ChildStdin,
    mut rx: mpsc::Receiver<String>,
) {
    while let Some(line) = rx.recv().await {
        if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
            kill(&shared).await;
            fail_all(&shared);
            return;
        }
    }
    // All senders dropped: stdin drops here and the child sees EOF.
}

/// Forwards the child's stderr to ours and keeps its last line for `exit_reason`.
async fn forward_stderr(shared: Arc<Shared>, stderr: ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("sidecar: {line}");
        *lock(&shared.last_stderr) = Some(line.chars().take(MAX_REASON_CHARS).collect());
    }
    // Receivers may all be gone; the value still lands, so a later `exit_reason` sees it.
    let _ = shared.stderr_done.send_replace(true);
}

/// Removes its id from `pending` when dropped: on timeout, on error, or when the caller's future is dropped.
struct PendingGuard<'a> {
    shared: &'a Shared,
    id: u64,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        let _ = lock(&self.shared.pending).remove(&self.id);
    }
}

/// Queues the line for the writer task, then waits for the reply routed to `rx`.
async fn send_and_wait(
    sender: mpsc::Sender<String>,
    line: String,
    rx: oneshot::Receiver<Reply>,
) -> Reply {
    if sender.send(line).await.is_err() {
        return Err(SidecarError::Exited);
    }
    // A waiting call must not keep the writer open, or shutdown cannot close stdin.
    drop(sender);
    rx.await.unwrap_or(Err(SidecarError::Exited))
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        // The reader and writer tasks hold `Shared`, so kill here: a hung child would outlive us.
        let Ok(mut child) = self.shared.child.try_lock() else {
            return;
        };
        if let Some(child) = child.as_mut() {
            let _ = child.start_kill();
        }
    }
}

impl Sidecar {
    /// Starts the child. Must be called inside a Tokio runtime.
    pub fn spawn(config: SidecarConfig) -> Result<Self, SidecarError> {
        Self::spawn_inner(config, None)
    }

    /// Starts the child with a host that answers its asks and receives its events.
    pub fn spawn_with_host(
        config: SidecarConfig,
        host: Arc<dyn SidecarHost>,
    ) -> Result<Self, SidecarError> {
        Self::spawn_inner(config, Some(host))
    }

    fn spawn_inner(
        config: SidecarConfig,
        host: Option<Arc<dyn SidecarHost>>,
    ) -> Result<Self, SidecarError> {
        validate(&config)?;
        let runtime = tokio::runtime::Handle::try_current()
            .map_err(|_| SidecarError::Spawn("no Tokio runtime".to_owned()))?;
        let SidecarConfig {
            program,
            args,
            cwd,
            call_timeout,
            max_in_flight,
            max_request_bytes,
            max_reply_bytes,
        } = config;
        let mut child = wrapped_command(program, args, cwd)
            .spawn()
            .map_err(|e| SidecarError::Spawn(e.to_string()))?;
        let pid = child.id();
        let (Some(stdin), Some(stdout), Some(stderr)) = (
            child.stdin().take(),
            child.stdout().take(),
            child.stderr().take(),
        ) else {
            return Err(SidecarError::Spawn("missing pipe".to_owned()));
        };
        let shared = Arc::new(Shared {
            pending: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            child: tokio::sync::Mutex::new(Some(child)),
            last_stderr: Mutex::new(None),
            stderr_done: watch::channel(false).0,
        });
        let (tx, rx) = mpsc::channel::<String>(max_in_flight);
        let link = HostLink {
            host,
            answers: tx.downgrade(),
            max_answer_bytes: max_request_bytes,
        };
        // Detached: each task ends on its own when its pipe closes or its queue closes.
        let _reader = runtime.spawn(read_replies(
            Arc::clone(&shared),
            stdout,
            max_reply_bytes,
            link,
        ));
        let _writer = runtime.spawn(write_requests(Arc::clone(&shared), stdin, rx));
        let _errors = runtime.spawn(forward_stderr(Arc::clone(&shared), stderr));
        Ok(Self {
            shared,
            writer: Mutex::new(Some(tx)),
            pid,
            call_timeout,
            max_in_flight,
            max_request_bytes,
        })
    }

    /// Registers a waiter, or returns `Busy` when the in-flight cap is reached.
    fn register(
        &self,
        id: u64,
        tx: oneshot::Sender<Reply>,
    ) -> Result<PendingGuard<'_>, SidecarError> {
        {
            let mut pending = lock(&self.shared.pending);
            if pending.len() >= self.max_in_flight {
                return Err(SidecarError::Busy);
            }
            let _ = pending.insert(id, tx);
        }
        Ok(PendingGuard {
            shared: &self.shared,
            id,
        })
    }

    /// Sends one call and waits for its reply. On `Timeout` the sidecar may still be working on
    /// the request: the slot frees, but the work is not cancelled.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, SidecarError> {
        if self.shared.closed.load(Ordering::SeqCst) {
            return Err(SidecarError::Exited);
        }
        let id = self.shared.next_id.fetch_add(1, Ordering::SeqCst);
        let mut line =
            serde_json::to_string(&json!({"id": id, "method": method, "params": params}))
                .map_err(|e| SidecarError::Remote(e.to_string()))?;
        line.push('\n');
        if line.len() > self.max_request_bytes {
            return Err(SidecarError::TooLarge);
        }
        let sender = lock(&self.writer).clone().ok_or(SidecarError::Exited)?;
        let (tx, rx) = oneshot::channel();
        let _guard = self.register(id, tx)?;
        // The reader may have hit EOF since the check above; the guard cleans up.
        if self.shared.closed.load(Ordering::SeqCst) {
            return Err(SidecarError::Exited);
        }
        match tokio::time::timeout(self.call_timeout, send_and_wait(sender, line, rx)).await {
            Err(_) => Err(SidecarError::Timeout),
            Ok(reply) => reply,
        }
    }

    /// The child's process id.
    #[must_use]
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Calls waiting for a reply right now.
    #[must_use]
    pub fn in_flight(&self) -> usize {
        lock(&self.shared.pending).len()
    }

    /// The child's last stderr line, with `weaveforge-sidecar: ` stripped. Waits up to 1 s for stderr to
    /// close first. Meant for after `Exited`, when the child has said why it stopped.
    /// Only a line with the `weaveforge-sidecar: ` prefix counts; other output is log noise.
    pub async fn exit_reason(&self) -> Option<String> {
        let mut done = self.shared.stderr_done.subscribe();
        let _ = tokio::time::timeout(Duration::from_secs(1), done.wait_for(|d| *d)).await;
        let line = lock(&self.shared.last_stderr).clone()?;
        line.strip_prefix(FATAL_PREFIX).map(str::to_owned)
    }

    /// Stops accepting writes, closes stdin, waits up to `grace` for a clean exit, then kills.
    /// Returns true only when the sidecar exited by itself with status 0. Can take up to `grace`
    /// plus the reap wait of an internal kill already in progress (`REAP_TIMEOUT`), since both hold
    /// the child lock. Later calls get `Exited`.
    pub async fn shutdown(&self, grace: Duration) -> bool {
        let _ = lock(&self.writer).take();
        let Some(mut child) = self.shared.child.lock().await.take() else {
            return false;
        };
        if let Ok(Ok(status)) = tokio::time::timeout(grace, child.wait()).await {
            return status.success();
        }
        let _ = child.start_kill();
        let _ = child.wait().await;
        false
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn exit_reason_is_last_stderr_line() {
        let config = SidecarConfig {
            program: PathBuf::from("node"),
            args: vec![
                OsString::from("-e"),
                OsString::from(
                    "process.stderr.write('weaveforge-sidecar: first\\nweaveforge-sidecar: the old app is running\\n'); process.exit(3)",
                ),
            ],
            cwd: None,
            call_timeout: Duration::from_secs(5),
            max_in_flight: 8,
            max_request_bytes: 4096,
            max_reply_bytes: 1 << 20,
        };
        let s = Sidecar::spawn(config).unwrap();
        assert_eq!(
            s.call("state", Value::Null).await,
            Err(SidecarError::Exited)
        );
        assert_eq!(
            s.exit_reason().await.as_deref(),
            Some("the old app is running")
        );
    }

    fn node_config(script: &str) -> SidecarConfig {
        SidecarConfig {
            program: PathBuf::from("node"),
            args: vec![OsString::from("-e"), OsString::from(script)],
            cwd: None,
            call_timeout: Duration::from_secs(5),
            max_in_flight: 8,
            max_request_bytes: 4096,
            max_reply_bytes: 1 << 20,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn exit_reason_ignores_unprefixed_last_line() {
        let s = Sidecar::spawn(node_config(
            "process.stderr.write('weaveforge-sidecar: earlier\\nready\\n'); process.exit(3)",
        ))
        .unwrap();
        assert_eq!(
            s.call("state", Value::Null).await,
            Err(SidecarError::Exited)
        );
        assert_eq!(s.exit_reason().await, None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn exit_reason_is_none_without_stderr() {
        let s = Sidecar::spawn(node_config("process.exit(3)")).unwrap();
        assert_eq!(
            s.call("state", Value::Null).await,
            Err(SidecarError::Exited)
        );
        assert_eq!(s.exit_reason().await, None);
    }

    #[test]
    fn answer_line_ok_is_compact_json() {
        assert_eq!(
            answer_line(3, Ok(json!({"a": 1})), 1000),
            "{\"answer\":3,\"ok\":true,\"value\":{\"a\":1}}\n"
        );
        assert!(answer_line(3, Ok(json!(1)), 1000).starts_with("{\"answer\":"));
    }

    #[test]
    fn answer_line_escapes_error_text() {
        assert_eq!(
            answer_line(3, Err("a\"b".to_owned()), 1000),
            "{\"answer\":3,\"ok\":false,\"error\":\"a\\\"b\"}\n"
        );
    }

    #[test]
    fn answer_line_too_large_is_an_error() {
        assert_eq!(
            answer_line(3, Ok(json!("x".repeat(100))), 50),
            answer_line(3, Err("answer too large".to_owned()), 50)
        );
    }
}

//! Rust client for the Node sidecar: one JSON object per line over stdio.
//!
//! Replies are routed by id, so calls can overlap. Every call is bounded by a timeout and a
//! cap on calls in flight. The child is killed when the client drops, and on Windows a Job
//! Object kills it if the shell dies without running `Drop`.

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
use tokio::sync::{mpsc, oneshot};

/// The sidecar's own request line cap (`MAX_LINE` in apps/shell/sidecar/src/wire.ts, in UTF-16 units).
/// A UTF-8 byte cap at or under it is always under it in UTF-16 units too.
pub const SIDECAR_MAX_LINE: usize = 32 * 1024 * 1024;

/// How long an internal kill waits to reap the child.
const REAP_TIMEOUT: Duration = Duration::from_secs(5);

/// How to start the sidecar and how far to trust it.
#[derive(Debug, Clone)]
pub struct SidecarConfig {
    /// The node binary.
    pub program: PathBuf,
    /// Arguments after the program (script path, flags).
    pub args: Vec<OsString>,
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

/// State the reader task, the writer task and the callers share.
struct Shared {
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    closed: AtomicBool,
    next_id: AtomicU64,
    child: tokio::sync::Mutex<Option<Box<dyn ChildWrapper>>>,
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
fn wrapped_command(program: PathBuf, args: Vec<OsString>) -> CommandWrap {
    let mut wrap = CommandWrap::with_new(program, move |c| {
        let _ = c.args(&args);
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

/// Turns one stdout line into the reply for its caller. Lines without a u64 id are logged.
fn route_reply(shared: &Shared, line: &str) {
    let Some(value) = serde_json::from_str::<Value>(line).ok() else {
        eprintln!("sidecar: stray line: {line}");
        return;
    };
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
async fn read_replies(shared: Arc<Shared>, stdout: ChildStdout, max_reply_bytes: usize) {
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
                route_reply(&shared, line.trim_end_matches(['\r', '\n']));
            }
            Err(e) => {
                eprintln!("sidecar: stdout read failed: {e}");
                break;
            }
        }
    }
    fail_all(&shared);
    kill(&shared).await;
}

/// Owns stdin and writes each queued line whole, so a dropped caller cannot leave half a line.
async fn write_requests(
    shared: Arc<Shared>,
    mut stdin: ChildStdin,
    mut rx: mpsc::Receiver<String>,
) {
    while let Some(line) = rx.recv().await {
        if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
            fail_all(&shared);
            kill(&shared).await;
            return;
        }
    }
    // All senders dropped: stdin drops here and the child sees EOF.
}

/// Forwards the child's stderr to ours.
async fn forward_stderr(stderr: ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("sidecar: {line}");
    }
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
        validate(&config)?;
        let runtime = tokio::runtime::Handle::try_current()
            .map_err(|_| SidecarError::Spawn("no Tokio runtime".to_owned()))?;
        let SidecarConfig {
            program,
            args,
            call_timeout,
            max_in_flight,
            max_request_bytes,
            max_reply_bytes,
        } = config;
        let mut child = wrapped_command(program, args)
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
        });
        let (tx, rx) = mpsc::channel::<String>(max_in_flight);
        // Detached: each task ends on its own when its pipe closes or its queue closes.
        let _reader = runtime.spawn(read_replies(Arc::clone(&shared), stdout, max_reply_bytes));
        let _writer = runtime.spawn(write_requests(Arc::clone(&shared), stdin, rx));
        let _errors = runtime.spawn(forward_stderr(stderr));
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

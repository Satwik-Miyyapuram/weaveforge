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
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::oneshot;

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

/// State the reader task and the callers share.
struct Shared {
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    closed: AtomicBool,
    next_id: AtomicU64,
}

/// A running sidecar. Dropping it kills the child.
pub struct Sidecar {
    shared: Arc<Shared>,
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    child: tokio::sync::Mutex<Option<Box<dyn ChildWrapper>>>,
    pid: Option<u32>,
    call_timeout: Duration,
    max_in_flight: usize,
    max_request_bytes: usize,
}

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
        #[cfg(windows)]
        let _ = c.creation_flags(0x0800_0000);
    });
    let _ = wrap.wrap(KillOnDrop);
    #[cfg(windows)]
    let _ = wrap.wrap(JobObject);
    wrap
}

/// Turns one stdout line into the reply for its caller. Lines without a u64 id are logged.
fn route_reply(shared: &Shared, line: &str) {
    let value = serde_json::from_str::<Value>(line).ok();
    let id = value
        .as_ref()
        .and_then(|v| v.get("id"))
        .and_then(Value::as_u64);
    let (Some(value), Some(id)) = (value, id) else {
        eprintln!("sidecar: stray line: {line}");
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

/// Reads replies until EOF, then fails every waiter with `Exited`.
async fn read_replies(shared: Arc<Shared>, stdout: ChildStdout) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        route_reply(&shared, &line);
    }
    // Set before draining so a caller that inserts after the drain sees it.
    shared.closed.store(true, Ordering::SeqCst);
    let drained = std::mem::take(&mut *lock(&shared.pending));
    for (_, waiter) in drained {
        let _ = waiter.send(Err(SidecarError::Exited));
    }
}

/// Forwards the child's stderr to ours.
async fn forward_stderr(stderr: ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("sidecar: {line}");
    }
}

impl Sidecar {
    /// Starts the child. Must be called inside a Tokio runtime.
    pub fn spawn(config: SidecarConfig) -> Result<Self, SidecarError> {
        let SidecarConfig {
            program,
            args,
            call_timeout,
            max_in_flight,
            max_request_bytes,
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
        });
        // Detached: each task ends on its own when the pipe closes.
        let _reader = tokio::spawn(read_replies(Arc::clone(&shared), stdout));
        let _errors = tokio::spawn(forward_stderr(stderr));
        Ok(Self {
            shared,
            stdin: tokio::sync::Mutex::new(Some(stdin)),
            child: tokio::sync::Mutex::new(Some(child)),
            pid,
            call_timeout,
            max_in_flight,
            max_request_bytes,
        })
    }

    /// Sends one call and waits for its reply.
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

        let (tx, rx) = oneshot::channel();
        {
            let mut pending = lock(&self.shared.pending);
            if pending.len() >= self.max_in_flight {
                return Err(SidecarError::Busy);
            }
            let _ = pending.insert(id, tx);
        }
        // The reader may have hit EOF since the check above.
        if self.shared.closed.load(Ordering::SeqCst) {
            let _ = lock(&self.shared.pending).remove(&id);
            return Err(SidecarError::Exited);
        }
        if !self.write_line(&line).await {
            let _ = lock(&self.shared.pending).remove(&id);
            self.shared.closed.store(true, Ordering::SeqCst);
            return Err(SidecarError::Exited);
        }

        match tokio::time::timeout(self.call_timeout, rx).await {
            Err(_) => {
                let _ = lock(&self.shared.pending).remove(&id);
                Err(SidecarError::Timeout)
            }
            Ok(Err(_)) => Err(SidecarError::Exited),
            Ok(Ok(reply)) => reply,
        }
    }

    /// Writes one request line and flushes. Returns false when stdin is gone or the write fails.
    async fn write_line(&self, line: &str) -> bool {
        let mut guard = self.stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return false;
        };
        stdin.write_all(line.as_bytes()).await.is_ok() && stdin.flush().await.is_ok()
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

    /// Closes stdin, waits up to `grace` for a clean exit, then kills. Returns true when it exited by itself.
    pub async fn shutdown(self, grace: Duration) -> bool {
        let _ = self.stdin.lock().await.take();
        let Some(mut child) = self.child.lock().await.take() else {
            return false;
        };
        if matches!(tokio::time::timeout(grace, child.wait()).await, Ok(Ok(_))) {
            return true;
        }
        let _ = child.start_kill();
        let _ = child.wait().await;
        false
    }
}

//! Client for the Windows Ink handwriting helper: NDJSON over a child process.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, watch};

/// Per-request answer timeout.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// How long the helper has to print its ready line.
pub const READY_TIMEOUT: Duration = Duration::from_secs(30);
/// Longest protocol line accepted from the helper, in bytes.
pub const INK_MAX_LINE_BYTES: usize = 1024 * 1024;

/// Error text when the helper cannot be used on this machine.
pub const INK_NOT_AVAILABLE: &str = "The Windows handwriting recogniser is not available.";
/// Error text when the helper does not answer within the timeout.
pub const INK_TIMED_OUT: &str = "The handwriting recogniser did not answer in time.";
/// Error text when the helper exits before answering.
pub const INK_STOPPED: &str = "The handwriting recogniser stopped before answering.";
/// Error text for requests cut off by `dispose`.
pub const INK_DISPOSED: &str = "The handwriting recogniser was stopped.";
/// Error text when the helper reports failure without a message.
pub const INK_FAILED: &str = "The handwriting recogniser failed.";
/// Diagnostic when the helper never sends its ready line.
pub const INK_NO_READY: &str = "ink-recogniser: no ready line; giving up on this helper";
/// Diagnostic prefix for a protocol line that is not JSON; the line follows.
pub const INK_UNPARSEABLE_LINE: &str = "ink-recogniser: unparseable line";
/// Diagnostic prefix for a failed spawn; `<path>: <error>` follows.
pub const INK_START_FAILED: &str = "ink-recogniser: could not start";
/// Diagnostic when a protocol line exceeds `INK_MAX_LINE_BYTES`.
pub const INK_LINE_TOO_LONG: &str = "ink-recogniser: line too long; giving up on this helper";

/// Writes and reads of the helper process; the far end is injectable for tests.
pub type HelperIo = (
    Box<dyn AsyncWrite + Send + Unpin>,
    Box<dyn AsyncRead + Send + Unpin>,
);
/// Starts a helper at the given path and returns its stdin and stdout.
pub type Spawner = Arc<dyn Fn(&Path) -> io::Result<HelperIo> + Send + Sync>;

type Diagnostic = Arc<dyn Fn(&str) + Send + Sync>;

/// One stroke list per line; each stroke is a flat list of coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InkRecognitionLineInput {
    /// Strokes of this line, each a flat `[x, y, t, ...]` list.
    pub strokes: Vec<Vec<f64>>,
}

/// A page of ink to recognise.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InkRecognitionRequest {
    /// Lines in reading order.
    pub lines: Vec<InkRecognitionLineInput>,
    /// Expected words; absent when not sent.
    pub vocabulary: Option<Vec<String>>,
    /// BCP 47 language tag; absent when not sent.
    pub lang: Option<String>,
}

/// One recognised word.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InkRecognitionWord {
    /// Readings of the word, best first.
    #[serde(default)]
    pub candidates: Vec<String>,
    /// Per candidate, whether it is in the vocabulary; null when not given.
    #[serde(default)]
    pub known: Option<Vec<bool>>,
    /// Joins with the next word; null when not given.
    #[serde(default)]
    pub join: Option<String>,
}

/// One recognised line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InkRecognitionLine {
    /// Line text.
    pub text: String,
    /// Engine confidence, 0 to 1.
    pub confidence: f64,
    /// Other readings of the whole line, best first; empty when none.
    #[serde(default)]
    pub alternatives: Vec<String>,
    /// Words in the line; empty when the engine gives none.
    #[serde(default)]
    pub words: Vec<InkRecognitionWord>,
}

/// The helper's answer to a recognise request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InkRecognitionResult {
    /// Engine that produced the answer; `windows-ink@1` when the helper leaves it out.
    #[serde(default = "default_engine")]
    pub engine: String,
    /// Engine time in milliseconds; 0 when left out.
    #[serde(default)]
    pub ms: f64,
    /// Recognised lines in the order sent; empty when left out.
    #[serde(default)]
    pub lines: Vec<InkRecognitionLine>,
}

/// The engine name the TS client assumes when the helper does not say.
fn default_engine() -> String {
    "windows-ink@1".to_owned()
}

/// Pen state forwarded to the helper for haptic feedback.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InkHapticsMessage {
    /// The active pen tool changed.
    Tool {
        /// Tool name.
        tool: String,
    },
    /// A pen sample.
    Update {
        /// Normalised pen pressure.
        pressure: f64,
        /// Pen speed.
        velocity: f64,
    },
    /// The pen left the surface.
    Stop,
}

/// Longest tool name sent to the helper, in characters, as the Electron client does.
const HAPTICS_TOOL_MAX_CHARS: usize = 32;

/// The helper's line for a page's pen message; `None` when a number cannot be written.
fn haptics_line(message: &InkHapticsMessage) -> Option<String> {
    match message {
        InkHapticsMessage::Tool { tool } => {
            let tool: String = tool.chars().take(HAPTICS_TOOL_MAX_CHARS).collect();
            Some(format!(
                r#"{{"type":"haptics-tool","tool":{}}}"#,
                serde_json::to_string(&tool).ok()?
            ))
        }
        InkHapticsMessage::Update { pressure, velocity } => Some(format!(
            r#"{{"type":"haptics-update","pressure":{},"velocity":{}}}"#,
            serde_json::to_string(pressure).ok()?,
            serde_json::to_string(velocity).ok()?
        )),
        InkHapticsMessage::Stop => Some(r#"{"type":"haptics-stop"}"#.to_owned()),
    }
}

/// Builds a request from untrusted JSON; `None` when the shape is wrong.
#[must_use]
pub fn read_ink_request(request: &Value) -> Option<InkRecognitionRequest> {
    let object = request.as_object()?;
    let lines = object
        .get("lines")?
        .as_array()?
        .iter()
        .map(read_ink_line)
        .collect::<Option<Vec<_>>>()?;
    let vocabulary = match object.get("vocabulary") {
        None => None,
        Some(value) => Some(
            value
                .as_array()?
                .iter()
                .map(|word| word.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()?,
        ),
    };
    let lang = match object.get("lang") {
        None => None,
        Some(value) => Some(value.as_str()?.to_owned()),
    };
    Some(InkRecognitionRequest {
        lines,
        vocabulary,
        lang,
    })
}

fn read_ink_line(line: &Value) -> Option<InkRecognitionLineInput> {
    let strokes = line
        .get("strokes")?
        .as_array()?
        .iter()
        .map(|stroke| {
            stroke
                .as_array()?
                .iter()
                .map(Value::as_f64)
                .collect::<Option<Vec<f64>>>()
        })
        .collect::<Option<Vec<Vec<f64>>>>()?;
    Some(InkRecognitionLineInput { strokes })
}

/// Location of the bundled helper; `None` off Windows or on an unsupported CPU.
#[must_use]
pub fn ink_recogniser_path(platform: &str, arch: &str, resources: &Path) -> Option<PathBuf> {
    if platform != "windows" {
        return None;
    }
    let rid = match arch {
        "aarch64" => "win-arm64",
        "x86_64" => "win-x64",
        _ => return None,
    };
    Some(
        resources
            .join("native")
            .join("ink-recogniser")
            .join(rid)
            .join("ink-recogniser.exe"),
    )
}

/// Settings for an `InkRecogniser`.
pub struct InkOptions {
    /// Helper executable; `None` when this platform has no helper.
    pub executable: Option<PathBuf>,
    /// Starts the helper; swapped for a fake in tests.
    pub spawner: Spawner,
    /// Per-request timeout.
    pub timeout: Duration,
    /// Time allowed for the ready line.
    pub ready_timeout: Duration,
    /// Receives diagnostic lines.
    pub on_diagnostic: Arc<dyn Fn(&str) + Send + Sync>,
}

/// Spawns the helper as a child process with stdin and stdout piped.
#[must_use]
pub fn process_spawner() -> Spawner {
    Arc::new(|path: &Path| -> io::Result<HelperIo> {
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("helper has no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("helper has no stdout"))?;
        let writer: Box<dyn AsyncWrite + Send + Unpin> = Box::new(OwnedStdin {
            stdin,
            _child: Box::new(child),
        });
        let reader: Box<dyn AsyncRead + Send + Unpin> = Box::new(stdout);
        Ok((writer, reader))
    })
}

/// Keeps the child alive for as long as its stdin is written to.
struct OwnedStdin {
    stdin: ChildStdin,
    _child: Box<Child>,
}

impl AsyncWrite for OwnedStdin {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().stdin).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stdin).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stdin).poll_shutdown(cx)
    }
}

/// Recogniser client; the helper starts lazily on first use.
pub struct InkRecogniser {
    executable: Option<PathBuf>,
    spawner: Spawner,
    timeout: Duration,
    ready_timeout: Duration,
    diagnostic: Diagnostic,
    slot: Mutex<Slot>,
}

#[derive(Clone, Copy, PartialEq)]
enum Ready {
    Waiting,
    Up,
    Closed,
}

type Reply = Result<Value, String>;

struct State {
    open: bool,
    next_id: u64,
    version: Option<String>,
    haptics: Option<bool>,
    pending: HashMap<u64, oneshot::Sender<Reply>>,
}

struct Shared {
    state: Mutex<State>,
    ready: watch::Sender<Ready>,
}

struct Session {
    shared: Arc<Shared>,
    outbox: mpsc::UnboundedSender<String>,
}

#[derive(Default)]
struct Slot {
    disposed: bool,
    session: Option<Arc<Session>>,
}

impl InkRecogniser {
    /// Creates a recogniser that has not started its helper.
    #[must_use]
    pub fn new(options: InkOptions) -> Self {
        Self {
            executable: options.executable,
            spawner: options.spawner,
            timeout: options.timeout,
            ready_timeout: options.ready_timeout,
            diagnostic: options.on_diagnostic,
            slot: Mutex::new(Slot::default()),
        }
    }

    /// Starts the helper if needed and waits for its ready line.
    pub async fn available(&self) -> bool {
        self.ready_session().await.is_some()
    }

    /// Recognises one page of ink.
    pub async fn recognise(
        &self,
        request: InkRecognitionRequest,
    ) -> Result<InkRecognitionResult, String> {
        let session = self
            .ready_session()
            .await
            .ok_or_else(|| INK_NOT_AVAILABLE.to_owned())?;
        let mut body = json!({"type": "recognise", "lines": request.lines});
        if let Some(object) = body.as_object_mut() {
            if let Some(vocabulary) = request.vocabulary {
                let _ = object.insert("vocabulary".to_owned(), json!(vocabulary));
            }
            if let Some(lang) = request.lang {
                let _ = object.insert("lang".to_owned(), json!(lang));
            }
        }
        let reply = self.ask(&session, body).await?;
        serde_json::from_value(reply).map_err(|_| INK_FAILED.to_owned())
    }

    /// Asks the helper whether haptics are available; the answer is cached.
    pub async fn haptics_available(&self) -> bool {
        let Some(session) = self.ready_session().await else {
            return false;
        };
        let cached = lock(&session.shared.state).haptics;
        if let Some(known) = cached {
            return known;
        }
        let Ok(reply) = self.ask(&session, json!({"type": "haptics-probe"})).await else {
            lock(&session.shared.state).haptics = Some(false);
            return false;
        };
        let available = reply.get("available").and_then(Value::as_bool) == Some(true);
        lock(&session.shared.state).haptics = Some(available);
        available
    }

    /// Sends a haptics message without waiting; never starts the helper.
    pub fn haptics(&self, message: &InkHapticsMessage) {
        let Some(session) = self.live_session() else {
            return;
        };
        if lock(&session.shared.state).haptics != Some(true) {
            return;
        }
        if let Some(line) = haptics_line(message) {
            let _ = session.send(line);
        }
    }

    /// Stops the helper; later calls start nothing.
    pub fn dispose(&self) {
        let session = {
            let mut slot = lock(&self.slot);
            slot.disposed = true;
            slot.session.take()
        };
        if let Some(session) = session {
            session.shared.close(INK_DISPOSED);
        }
    }

    /// Helper version from its ready line, when it is running.
    #[must_use]
    pub fn version(&self) -> Option<String> {
        let session = self.live_session()?;
        lock(&session.shared.state).version.clone()
    }

    /// Helper executable this recogniser would start.
    #[must_use]
    pub fn executable(&self) -> Option<PathBuf> {
        self.executable.clone()
    }

    fn live_session(&self) -> Option<Arc<Session>> {
        let slot = lock(&self.slot);
        if slot.disposed {
            return None;
        }
        slot.session
            .clone()
            .filter(|session| session.shared.is_open())
    }

    fn live_or_start(&self) -> Option<Arc<Session>> {
        let mut slot = lock(&self.slot);
        if slot.disposed {
            return None;
        }
        // Drop a dead session so its child is killed; the next call starts a fresh one.
        if slot
            .session
            .as_ref()
            .is_some_and(|session| !session.shared.is_open())
        {
            slot.session = None;
        }
        if slot.session.is_none()
            && let Some(executable) = self.executable.as_deref()
        {
            match (self.spawner)(executable) {
                Ok((writer, reader)) => {
                    slot.session =
                        Some(Session::start(writer, reader, Arc::clone(&self.diagnostic)));
                }
                Err(error) => (self.diagnostic)(&format!(
                    "{INK_START_FAILED} {}: {error}",
                    executable.display()
                )),
            }
        }
        slot.session
            .clone()
            .filter(|session| session.shared.is_open())
    }

    async fn ready_session(&self) -> Option<Arc<Session>> {
        let session = self.live_or_start()?;
        let mut ready = session.shared.ready.subscribe();
        let outcome = tokio::time::timeout(
            self.ready_timeout,
            ready.wait_for(|state| *state != Ready::Waiting),
        )
        .await;
        match outcome {
            Ok(Ok(state)) if *state == Ready::Up && session.shared.is_open() => Some(session),
            Ok(_) => None,
            Err(_) => {
                (self.diagnostic)(INK_NO_READY);
                let mut slot = lock(&self.slot);
                if slot
                    .session
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &session))
                {
                    slot.session = None;
                }
                drop(slot);
                session.shared.close(INK_STOPPED);
                None
            }
        }
    }

    async fn ask(&self, session: &Session, mut body: Value) -> Reply {
        let (id, reply) = {
            let mut state = lock(&session.shared.state);
            if !state.open {
                return Err(INK_STOPPED.to_owned());
            }
            state.next_id += 1;
            let id = state.next_id;
            let (sender, receiver) = oneshot::channel();
            let _ = state.pending.insert(id, sender);
            (id, receiver)
        };
        if let Some(object) = body.as_object_mut() {
            let _ = object.insert("id".to_owned(), json!(id));
        }
        if !session.send(body.to_string()) {
            let _ = lock(&session.shared.state).pending.remove(&id);
            return Err(INK_STOPPED.to_owned());
        }
        match tokio::time::timeout(self.timeout, reply).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(INK_STOPPED.to_owned()),
            Err(_) => {
                let _ = lock(&session.shared.state).pending.remove(&id);
                Err(INK_TIMED_OUT.to_owned())
            }
        }
    }
}

impl Session {
    fn start(
        writer: Box<dyn AsyncWrite + Send + Unpin>,
        reader: Box<dyn AsyncRead + Send + Unpin>,
        diagnostic: Diagnostic,
    ) -> Arc<Self> {
        let shared = Arc::new(Shared::new());
        let (outbox, lines) = mpsc::unbounded_channel();
        let _writer = tokio::spawn(write_lines(writer, lines));
        let _reader = tokio::spawn(read_replies(Arc::clone(&shared), reader, diagnostic));
        Arc::new(Self { shared, outbox })
    }

    fn send(&self, mut line: String) -> bool {
        line.push('\n');
        self.outbox.send(line).is_ok()
    }
}

impl Shared {
    fn new() -> Self {
        let (ready, _) = watch::channel(Ready::Waiting);
        Self {
            state: Mutex::new(State {
                open: true,
                next_id: 0,
                version: None,
                haptics: None,
                pending: HashMap::new(),
            }),
            ready,
        }
    }

    fn is_open(&self) -> bool {
        lock(&self.state).open
    }

    fn become_ready(&self, version: String) {
        {
            let mut state = lock(&self.state);
            if !state.open {
                return;
            }
            state.version = Some(version);
        }
        let _ = self.ready.send_if_modified(|ready| {
            if *ready == Ready::Waiting {
                *ready = Ready::Up;
                true
            } else {
                false
            }
        });
    }

    /// Ends the session: fails every pending call with `message`.
    fn close(&self, message: &str) {
        let pending = {
            let mut state = lock(&self.state);
            state.open = false;
            std::mem::take(&mut state.pending)
        };
        for (_, sender) in pending {
            let _ = sender.send(Err(message.to_owned()));
        }
        let _ = self.ready.send_if_modified(|ready| {
            if *ready == Ready::Waiting {
                *ready = Ready::Closed;
                true
            } else {
                false
            }
        });
    }
}

/// Writes queued lines in order, so haptics and requests keep their sequence.
async fn write_lines(
    mut writer: Box<dyn AsyncWrite + Send + Unpin>,
    mut lines: mpsc::UnboundedReceiver<String>,
) {
    while let Some(line) = lines.recv().await {
        if writer.write_all(line.as_bytes()).await.is_err() || writer.flush().await.is_err() {
            break;
        }
    }
}

async fn read_replies(
    shared: Arc<Shared>,
    reader: Box<dyn AsyncRead + Send + Unpin>,
    diagnostic: Diagnostic,
) {
    let mut reader = BufReader::new(reader);
    let window = INK_MAX_LINE_BYTES + 1;
    let limit = u64::try_from(window).unwrap_or(u64::MAX);
    loop {
        let mut line = Vec::new();
        match (&mut reader).take(limit).read_until(b'\n', &mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if line.len() >= window && line.last() != Some(&b'\n') {
            diagnostic(INK_LINE_TOO_LONG);
            break;
        }
        let text = String::from_utf8_lossy(&line);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(text) {
            Ok(reply) => handle_reply(&shared, reply),
            Err(_) => {
                let snippet: String = text.chars().take(200).collect();
                diagnostic(&format!("{INK_UNPARSEABLE_LINE} {snippet}"));
            }
        }
    }
    shared.close(INK_STOPPED);
}

fn handle_reply(shared: &Shared, reply: Value) {
    let id = reply.get("id").and_then(Value::as_u64);
    let kind = reply.get("type").and_then(Value::as_str).map(str::to_owned);
    match kind.as_deref() {
        Some("ready") => {
            let version = reply.get("version").and_then(Value::as_str);
            shared.become_ready(version.unwrap_or_default().to_owned());
            deliver(shared, id, Ok(reply));
        }
        Some("recognised" | "haptics") => deliver(shared, id, Ok(reply)),
        Some("error") => {
            let message = reply
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or(INK_FAILED)
                .to_owned();
            deliver(shared, id, Err(message));
        }
        _ => {}
    }
}

/// Hands a reply to its caller; a late reply with no caller is dropped.
fn deliver(shared: &Shared, id: Option<u64>, reply: Reply) {
    let Some(id) = id else {
        return;
    };
    let sender = lock(&shared.state).pending.remove(&id);
    if let Some(sender) = sender {
        let _ = sender.send(reply);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

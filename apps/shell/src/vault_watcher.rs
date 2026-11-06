//! Watches the workspace folder and reports other programs' changes in batches.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use wf_store::vault::TEMP_SUFFIX;

use crate::vault_watch::{
    Digest, DigestCache, QUIET, SELF_WRITE_WINDOW, VaultWatch, content_digest, digest_reader,
};

/// Receives each batch of changed folder-relative paths ('/'-separated, sorted).
pub type ChangeSink = Arc<dyn Fn(Vec<String>) + Send + Sync>;

/// Told once, with the reader-facing reason, when the watched folder goes away.
pub type LostSink = Arc<dyn Fn(String) + Send + Sync>;

/// Said when the watched folder is renamed, moved, deleted or its drive unplugged.
pub const WATCH_LOST: &str = "The workspace folder is gone (renamed, moved or unplugged); outside changes are no longer seen. Reconnect it to see them again.";

/// How often the watch thread checks the folder is still there; a rename of the folder
/// itself reports nothing inside it.
const ROOT_CHECK: Duration = Duration::from_secs(1);

/// Largest file whose content is read to tell our own write from someone else's: the
/// vault's largest write (`MAX_BLOB_BYTES`). A bigger file is always reported.
pub const DIGEST_MAX_BYTES: u64 = crate::vault::MAX_BLOB_BYTES;

/// The reason shown when the folder cannot be watched.
pub const CANNOT_WATCH: &str = "This folder cannot be watched for outside changes.";

/// Messages the watch thread takes in: a notify report, or a request to stop.
enum Msg {
    Event(notify::Result<notify::Event>),
    Stop,
}

/// A running folder watch. Dropping it stops the thread and the notify watcher.
pub struct VaultWatcher {
    watcher: Option<RecommendedWatcher>,
    tx: Sender<Msg>,
    thread: Option<JoinHandle<()>>,
    shared: Arc<Mutex<VaultWatch>>,
    halted: Arc<AtomicBool>,
    lost: Arc<Mutex<Option<LostSink>>>,
}

impl VaultWatcher {
    /// Starts watching `root` recursively. Batches go to `sink` from a background thread.
    /// # Errors
    /// The reader-facing reason the folder cannot be watched.
    pub fn start(root: &Path, sink: ChangeSink) -> Result<Self, String> {
        Self::start_with(root, sink, QUIET, SELF_WRITE_WINDOW)
    }

    /// Same, with the quiet period and self-write window given (tests use short ones).
    /// # Errors
    /// The reader-facing reason the folder cannot be watched.
    pub fn start_with(
        root: &Path,
        sink: ChangeSink,
        quiet: Duration,
        window: Duration,
    ) -> Result<Self, String> {
        let mut roots = vec![root.to_path_buf()];
        // notify may report the canonical spelling (a `\\?\` prefix on Windows).
        if let Ok(canonical) = fs::canonicalize(root)
            && canonical.as_path() != root
        {
            roots.push(canonical);
        }
        let (tx, rx) = mpsc::channel();
        let handler_tx = tx.clone();
        // Symlinks are not followed: a link to a folder outside must not leak its names
        // to the page or have its files read.
        let config = notify::Config::default().with_follow_symlinks(false);
        let mut watcher = RecommendedWatcher::new(
            move |res: notify::Result<notify::Event>| {
                let _ = handler_tx.send(Msg::Event(res));
            },
            config,
        )
        .map_err(|_| CANNOT_WATCH.to_owned())?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|_| CANNOT_WATCH.to_owned())?;
        let normalize = Box::new(|p: &str| {
            wf_core::workspace::safe_workspace_path(p).unwrap_or_else(|_| p.to_owned())
        });
        let shared = Arc::new(Mutex::new(VaultWatch::new(normalize, quiet, window)));
        let thread_shared = Arc::clone(&shared);
        let halted = Arc::new(AtomicBool::new(false));
        let thread_halted = Arc::clone(&halted);
        let lost: Arc<Mutex<Option<LostSink>>> = Arc::default();
        let thread_lost = Arc::clone(&lost);
        let thread = std::thread::Builder::new()
            .name("vault-watcher".into())
            .spawn(move || {
                let sinks = Sinks {
                    change: &sink,
                    lost: &thread_lost,
                };
                run(&rx, &roots, &thread_shared, &thread_halted, &sinks);
            })
            .map_err(|_| CANNOT_WATCH.to_owned())?;
        Ok(Self {
            watcher: Some(watcher),
            tx,
            thread: Some(thread),
            shared,
            halted,
            lost,
        })
    }

    /// Where to say the folder went away; a loss seen before this is set is said here once set.
    pub fn report_loss_to(&self, sink: LostSink) {
        *self.lost.lock().unwrap_or_else(PoisonError::into_inner) = Some(sink);
    }

    /// Stops reporting at once, without waiting for the thread; dropping still joins it. Lets a
    /// caller silence the watch under a lock and pay for the join after letting go.
    pub fn halt(&self) {
        self.halted.store(true, Ordering::Release);
        let _ = self.tx.send(Msg::Stop);
    }

    /// The app just wrote `bytes` to `rel` (folder-relative); its echo is not reported.
    pub fn note_self_write(&self, rel: &str, bytes: &[u8]) {
        lock(&self.shared).note_self_write(rel, content_digest(bytes), Instant::now());
    }

    /// The app just deleted `rel` (folder-relative); the report that it is gone is not news.
    pub fn note_self_remove(&self, rel: &str) {
        lock(&self.shared).note_self_remove(rel, Instant::now());
    }
}

impl Drop for VaultWatcher {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        let _ = self.watcher.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// The running folder watch, if any; the vault write commands tell it what they wrote.
#[derive(Clone, Default)]
pub struct WatchSlot {
    running: Arc<Mutex<Option<VaultWatcher>>>,
    lost: Option<LostSink>,
}

impl WatchSlot {
    /// A slot whose every watch says through `lost` when its folder goes away.
    #[must_use]
    pub fn reporting_loss(lost: LostSink) -> Self {
        Self {
            running: Arc::default(),
            lost: Some(lost),
        }
    }

    /// Replaces the running watch; the old one stops.
    pub fn set(&self, watcher: Option<VaultWatcher>) {
        if let (Some(watcher), Some(lost)) = (watcher.as_ref(), self.lost.as_ref()) {
            watcher.report_loss_to(Arc::clone(lost));
        }
        let old = std::mem::replace(
            &mut *self.running.lock().unwrap_or_else(PoisonError::into_inner),
            watcher,
        );
        // Dropped outside the lock: stopping joins the watch thread.
        drop(old);
    }

    /// Takes the running watch out, still running; the caller halts and drops it.
    #[must_use]
    pub fn take(&self) -> Option<VaultWatcher> {
        self.running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }

    /// Whether a watch is running.
    #[must_use]
    pub fn is_watching(&self) -> bool {
        self.running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }

    /// The app is about to write `bytes` to `rel`; does nothing when no watch runs.
    pub fn note_self_write(&self, rel: &str, bytes: &[u8]) {
        if let Some(watcher) = self
            .running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
        {
            watcher.note_self_write(rel, bytes);
        }
    }

    /// The app is about to delete `rel`; does nothing when no watch runs.
    pub fn note_self_remove(&self, rel: &str) {
        if let Some(watcher) = self
            .running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
        {
            watcher.note_self_remove(rel);
        }
    }
}

/// `path` relative to `root` as '/'-joined segments, or None when it is outside `root`,
/// equal to it, or not valid UTF-8.
#[must_use]
pub fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let segments = rel
        .components()
        .map(|part| match part {
            Component::Normal(segment) => segment.to_str().map(str::to_owned),
            _ => None,
        })
        .collect::<Option<Vec<String>>>()?;
    if segments.is_empty() {
        return None;
    }
    Some(segments.join("/"))
}

/// True for paths the page never needs to hear about: atomic-write temp files
/// (ending in `wf_store::vault::TEMP_SUFFIX`) and anything under `.git/` (or `.git` itself).
#[must_use]
pub fn is_ignored(rel: &str) -> bool {
    rel.ends_with(TEMP_SUFFIX) || rel == ".git" || rel.starts_with(".git/")
}

/// Locks the shared batcher; a poisoned lock still holds usable state.
fn lock(shared: &Mutex<VaultWatch>) -> MutexGuard<'_, VaultWatch> {
    shared.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Where the watch thread sends its news.
struct Sinks<'a> {
    change: &'a ChangeSink,
    lost: &'a Mutex<Option<LostSink>>,
}

/// The watch thread: feeds reports to the batcher and releases batches as they come due.
fn run(
    rx: &Receiver<Msg>,
    roots: &[PathBuf],
    shared: &Mutex<VaultWatch>,
    halted: &AtomicBool,
    sinks: &Sinks<'_>,
) {
    let mut digests = DigestCache::default();
    let mut lost_said = false;
    loop {
        let deadline = lock(shared).deadline();
        let wait = deadline.map_or(ROOT_CHECK, |due| {
            due.saturating_duration_since(Instant::now())
                .min(ROOT_CHECK)
        });
        let next = rx.recv_timeout(wait);
        if !lost_said
            && !halted.load(Ordering::Acquire)
            && roots.first().is_some_and(|root| !root.is_dir())
        {
            lost_said = say_lost(sinks.lost);
        }
        match next {
            Ok(Msg::Event(res)) => handle_event(roots, shared, &mut digests, res),
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => {
                lock(shared).stop();
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        let batch = lock(shared).flush(Instant::now());
        // A halted watch belongs to a folder no longer in use: its news must not reach the page.
        if !batch.is_empty() && !halted.load(Ordering::Acquire) {
            (sinks.change)(batch);
        }
    }
}

/// Says the folder is gone, once a sink is there to hear it; true when said.
fn say_lost(lost: &Mutex<Option<LostSink>>) -> bool {
    let sink = lost.lock().unwrap_or_else(PoisonError::into_inner).clone();
    sink.is_some_and(|sink| {
        sink(WATCH_LOST.to_owned());
        true
    })
}

/// Reports each relevant path in a notify event to the batcher.
fn handle_event(
    roots: &[PathBuf],
    shared: &Mutex<VaultWatch>,
    digests: &mut DigestCache,
    res: notify::Result<notify::Event>,
) {
    // A failed notify report (an unplugged drive, say) must not take the app down.
    let Ok(event) = res else {
        return;
    };
    // Opening a file to read it is not a change.
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    for path in &event.paths {
        let Some(rel) = roots.iter().find_map(|root| relative_path(root, path)) else {
            continue;
        };
        if is_ignored(&rel) {
            continue;
        }
        // Only a path we wrote can be an echo; anything else is reported unread,
        // under the same lock so a write noted meanwhile is not mistaken for theirs.
        {
            let mut watch = lock(shared);
            if !watch.expects(&rel) {
                watch.saw(&rel, None, Instant::now());
                continue;
            }
        }
        // Hashed outside the lock: a large file must not stall the app's saves.
        let found = digest_of(digests, path);
        let mut watch = lock(shared);
        match found {
            Found::Gone => watch.saw(&rel, None, Instant::now()),
            Found::Unreadable => watch.saw_unreadable(&rel, Instant::now()),
            Found::Digest(digest) => watch.saw(&rel, Some(digest), Instant::now()),
        }
    }
}

/// What is at a reported path now.
enum Found {
    /// Nothing: the path was removed.
    Gone,
    /// Something we cannot hash: a folder, a link, a file over the cap, or no access.
    Unreadable,
    /// A regular file with this content digest.
    Digest(Digest),
}

/// The content digest of a regular file up to `DIGEST_MAX_BYTES`; not read again while
/// its size and modified time match the last read.
fn digest_of(digests: &mut DigestCache, path: &Path) -> Found {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Found::Gone,
        Err(_) => return Found::Unreadable,
    };
    if !meta.is_file() || meta.len() > DIGEST_MAX_BYTES {
        return Found::Unreadable;
    }
    let Ok(modified) = meta.modified() else {
        return fs::File::open(path)
            .and_then(|mut file| digest_reader(&mut file))
            .map_or(Found::Unreadable, Found::Digest);
    };
    digests
        .digest(path, meta.len(), modified, || {
            fs::File::open(path).and_then(|mut file| digest_reader(&mut file))
        })
        .map_or(Found::Unreadable, Found::Digest)
}

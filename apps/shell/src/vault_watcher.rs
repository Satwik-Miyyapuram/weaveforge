//! Watches the workspace folder and reports other programs' changes in batches.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use wf_store::vault::TEMP_SUFFIX;

use crate::vault_watch::{
    Digest, QUIET, SELF_WRITE_WINDOW, VaultWatch, content_digest, digest_reader,
};

/// Receives each batch of changed folder-relative paths ('/'-separated, sorted).
pub type ChangeSink = Arc<dyn Fn(Vec<String>) + Send + Sync>;

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
        let thread = std::thread::Builder::new()
            .name("vault-watcher".into())
            .spawn(move || run(&rx, &roots, &thread_shared, &sink))
            .map_err(|_| CANNOT_WATCH.to_owned())?;
        Ok(Self {
            watcher: Some(watcher),
            tx,
            thread: Some(thread),
            shared,
        })
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
pub struct WatchSlot(Arc<Mutex<Option<VaultWatcher>>>);

impl WatchSlot {
    /// Replaces the running watch; the old one stops.
    pub fn set(&self, watcher: Option<VaultWatcher>) {
        let old = std::mem::replace(
            &mut *self.0.lock().unwrap_or_else(PoisonError::into_inner),
            watcher,
        );
        // Dropped outside the lock: stopping joins the watch thread.
        drop(old);
    }

    /// Whether a watch is running.
    #[must_use]
    pub fn is_watching(&self) -> bool {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }

    /// The app is about to write `bytes` to `rel`; does nothing when no watch runs.
    pub fn note_self_write(&self, rel: &str, bytes: &[u8]) {
        if let Some(watcher) = self
            .0
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
            .0
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

/// The watch thread: feeds reports to the batcher and releases batches as they come due.
fn run(rx: &Receiver<Msg>, roots: &[PathBuf], shared: &Mutex<VaultWatch>, sink: &ChangeSink) {
    loop {
        let deadline = lock(shared).deadline();
        let next = match deadline {
            Some(due) => rx.recv_timeout(due.saturating_duration_since(Instant::now())),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match next {
            Ok(Msg::Event(res)) => handle_event(roots, shared, res),
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => {
                lock(shared).stop();
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        let batch = lock(shared).flush(Instant::now());
        if !batch.is_empty() {
            sink(batch);
        }
    }
}

/// Reports each relevant path in a notify event to the batcher.
fn handle_event(roots: &[PathBuf], shared: &Mutex<VaultWatch>, res: notify::Result<notify::Event>) {
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
        // Only a path we wrote can be an echo; anything else is reported unread.
        let expected = lock(shared).expects(&rel);
        let current = if expected { digest_of(path) } else { None };
        lock(shared).saw(&rel, current, Instant::now());
    }
}

/// The content digest of a regular file up to `DIGEST_MAX_BYTES`, or None otherwise.
fn digest_of(path: &Path) -> Option<Digest> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > DIGEST_MAX_BYTES {
        return None;
    }
    let mut file = fs::File::open(path).ok()?;
    digest_reader(&mut file).ok()
}

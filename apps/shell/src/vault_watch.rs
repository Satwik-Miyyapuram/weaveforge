//! Batches folder-watcher reports and drops the app's own writes; the caller drives time.
//! A report is our own write only while the file still holds the bytes we wrote.

use std::collections::{BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::{Duration, Instant};

/// A digest of file contents, enough to tell the app's own write from someone else's.
pub type Digest = u64;

/// The digest of `bytes`. Stable within one process run, which is all the watch needs.
#[must_use]
pub fn content_digest(bytes: &[u8]) -> Digest {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Covers a slow write (a big folder reconnecting) and its echo; the content check
/// decides what counts as an echo, so this only bounds how long we keep the entry.
pub const SELF_WRITE_WINDOW: Duration = Duration::from_millis(10_000);

/// Long enough for an editor to finish saving, short enough to feel live.
pub const QUIET: Duration = Duration::from_millis(400);

/// Collects watcher reports and releases them as one batch once things go quiet.
pub struct VaultWatch {
    normalize: Box<dyn Fn(&str) -> String + Send>,
    quiet: Duration,
    self_write_window: Duration,
    /// Normalized path -> when this process wrote it, and the digest of what it wrote.
    mine: HashMap<String, (Instant, Digest)>,
    pending: BTreeSet<String>,
    deadline: Option<Instant>,
}

impl VaultWatch {
    /// A watch that compares paths after `normalize` has put them in one form.
    #[must_use]
    pub fn new(
        normalize: Box<dyn Fn(&str) -> String + Send>,
        quiet: Duration,
        self_write_window: Duration,
    ) -> Self {
        Self {
            normalize,
            quiet,
            self_write_window,
            mine: HashMap::new(),
            pending: BTreeSet::new(),
            deadline: None,
        }
    }

    /// This process wrote `path` at `now` with bytes `digest`; their echo is not news.
    pub fn note_self_write(&mut self, path: &str, digest: Digest, now: Instant) {
        let key = (self.normalize)(path);
        let _ = self.mine.insert(key, (now, digest));
        // Swept here: the map only grows while the app is writing.
        let window = self.self_write_window;
        self.mine
            .retain(|_, (when, _)| now.saturating_duration_since(*when) <= window);
    }

    /// The filesystem reported `path` at `now`; `current` is its digest, None if gone.
    pub fn saw(&mut self, path: &str, current: Option<Digest>, now: Instant) {
        let key = (self.normalize)(path);
        let window = self.self_write_window;
        let echo = self.mine.get(&key).is_some_and(|(written, digest)| {
            now.saturating_duration_since(*written) <= window && current == Some(*digest)
        });
        if echo {
            // Kept, not removed: one save often arrives as several events.
            return;
        }
        // The file no longer holds our bytes, so it is no longer ours.
        let _ = self.mine.remove(&key);
        let _ = self.pending.insert(key);
        self.deadline = Some(now + self.quiet);
    }

    /// When the caller should next call `flush`, or None when nothing is pending.
    #[must_use]
    pub fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    /// The batch due at `now`: each path once, sorted. Empty when not yet quiet.
    #[must_use]
    pub fn flush(&mut self, now: Instant) -> Vec<String> {
        if !self.deadline.is_some_and(|due| now >= due) {
            return Vec::new();
        }
        self.deadline = None;
        std::mem::take(&mut self.pending).into_iter().collect()
    }

    /// Drops anything pending and forgets all self-writes.
    pub fn stop(&mut self) {
        self.pending.clear();
        self.mine.clear();
        self.deadline = None;
    }
}

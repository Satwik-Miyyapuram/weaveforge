//! Batches folder-watcher reports and drops the app's own writes; the caller drives time.

use std::collections::{BTreeSet, HashMap};
use std::time::{Duration, Instant};

/// Long enough to cover a write and its own echo, short enough to feel live.
pub const SELF_WRITE_WINDOW: Duration = Duration::from_millis(2_000);

/// Long enough for an editor to finish saving, short enough to feel live.
pub const QUIET: Duration = Duration::from_millis(400);

/// Collects watcher reports and releases them as one batch once things go quiet.
pub struct VaultWatch {
    normalize: Box<dyn Fn(&str) -> String + Send>,
    quiet: Duration,
    self_write_window: Duration,
    /// Normalized path -> when this process last wrote it.
    mine: HashMap<String, Instant>,
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

    /// This process wrote `path` at `now`; its echo is not news.
    pub fn note_self_write(&mut self, path: &str, now: Instant) {
        let key = (self.normalize)(path);
        let _ = self.mine.insert(key, now);
        // Swept here: the map only grows while the app is writing.
        let window = self.self_write_window;
        self.mine
            .retain(|_, when| now.saturating_duration_since(*when) <= window);
    }

    /// The filesystem reported `path` at `now`.
    pub fn saw(&mut self, path: &str, now: Instant) {
        let key = (self.normalize)(path);
        let window = self.self_write_window;
        let echo = self
            .mine
            .get(&key)
            .is_some_and(|written| now.saturating_duration_since(*written) <= window);
        if echo {
            // Forgotten once, so a second change moments later is still reported.
            let _ = self.mine.remove(&key);
            return;
        }
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

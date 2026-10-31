//! Batches folder-watcher reports and drops the app's own writes; the caller drives time.
//! A report is our own write only while the file still holds the bytes we wrote.

use std::collections::{BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hasher};
use std::io::{self, Read};
use std::time::{Duration, Instant};

/// A digest of file contents, enough to tell the app's own write from someone else's.
///
/// A 64-bit non-cryptographic hash, stable within one process run: fine for matching
/// an echo, never for checking integrity.
pub type Digest = u64;

/// The digest of `bytes`. Stable within one process run, which is all the watch needs.
#[must_use]
pub fn content_digest(bytes: &[u8]) -> Digest {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    hasher.finish()
}

/// The digest of everything `reader` yields, read in chunks; equals `content_digest`
/// of the same bytes.
/// # Errors
/// A read error from `reader`.
pub fn digest_reader(reader: &mut impl Read) -> io::Result<Digest> {
    let mut hasher = DefaultHasher::new();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut chunk)?;
        let Some(bytes) = chunk.get(..read) else {
            return Ok(hasher.finish());
        };
        if bytes.is_empty() {
            return Ok(hasher.finish());
        }
        hasher.write(bytes);
    }
}

/// Covers a slow write (a big folder reconnecting) and its echo; the content check
/// decides what counts as an echo, so this only bounds how long we keep the entry.
pub const SELF_WRITE_WINDOW: Duration = Duration::from_millis(10_000);

/// Long enough for an editor to finish saving, short enough to feel live.
pub const QUIET: Duration = Duration::from_millis(400);

/// The longest a change waits: a file written without pause must not hold back the rest.
pub const MAX_WAIT: Duration = Duration::from_millis(2_000);

/// How many recent writes per path are kept, so a late echo of an earlier save still matches.
const RECENT_WRITES: usize = 8;

/// Collects watcher reports and releases them as one batch once things go quiet.
pub struct VaultWatch {
    normalize: Box<dyn Fn(&str) -> String + Send>,
    quiet: Duration,
    self_write_window: Duration,
    /// Normalized path -> this process's recent writes to it, oldest first: when, and the
    /// digest of what it wrote (None for a delete).
    mine: HashMap<String, Vec<(Instant, Option<Digest>)>>,
    pending: BTreeSet<String>,
    deadline: Option<Instant>,
    /// When the oldest pending path arrived; bounds the wait by `MAX_WAIT`.
    first_pending: Option<Instant>,
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
            first_pending: None,
        }
    }

    /// This process wrote `path` at `now` with bytes `digest`; their echo is not news.
    pub fn note_self_write(&mut self, path: &str, digest: Digest, now: Instant) {
        self.note(path, Some(digest), now);
    }

    /// This process deleted `path` at `now`; the report that it is gone is not news.
    pub fn note_self_remove(&mut self, path: &str, now: Instant) {
        self.note(path, None, now);
    }

    /// Whether a report for `path` could be our own echo, so its contents are worth reading.
    #[must_use]
    pub fn expects(&self, path: &str) -> bool {
        self.mine.contains_key(&(self.normalize)(path))
    }

    fn note(&mut self, path: &str, digest: Option<Digest>, now: Instant) {
        let key = (self.normalize)(path);
        let writes = self.mine.entry(key).or_default();
        writes.push((now, digest));
        if writes.len() > RECENT_WRITES {
            let _ = writes.remove(0);
        }
        // Swept here: the map only grows while the app is writing.
        let window = self.self_write_window;
        self.mine.retain(|_, writes| {
            writes.retain(|(when, _)| now.saturating_duration_since(*when) <= window);
            !writes.is_empty()
        });
    }

    /// The filesystem reported `path` at `now`; `current` is its digest, None if gone.
    pub fn saw(&mut self, path: &str, current: Option<Digest>, now: Instant) {
        let key = (self.normalize)(path);
        let window = self.self_write_window;
        let echo = self.mine.get(&key).is_some_and(|writes| {
            writes.iter().any(|(written, digest)| {
                now.saturating_duration_since(*written) <= window && current == *digest
            })
        });
        if echo {
            // Kept, not removed: one save often arrives as several events.
            return;
        }
        // The file no longer holds our bytes, so it is no longer ours.
        let _ = self.mine.remove(&key);
        let _ = self.pending.insert(key);
        let first = *self.first_pending.get_or_insert(now);
        self.deadline = Some((now + self.quiet).min(first + MAX_WAIT));
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
        self.first_pending = None;
        std::mem::take(&mut self.pending).into_iter().collect()
    }

    /// The filesystem reported `path`, but its contents could not be read (too big, not a
    /// file, no access). It is not gone, so it can never be our echo: always reported.
    pub fn saw_unreadable(&mut self, path: &str, now: Instant) {
        let key = (self.normalize)(path);
        let _ = self.mine.remove(&key);
        self.saw(path, None, now);
    }

    /// Drops anything pending and forgets all self-writes.
    pub fn stop(&mut self) {
        self.pending.clear();
        self.mine.clear();
        self.deadline = None;
        self.first_pending = None;
    }
}

//! The app log. Ported from apps/desktop/src/app-log.ts.

use std::collections::{HashSet, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

use regex::Regex;

/// How many entries are held in memory, and how many are restored from disk.
pub const MAX_ENTRIES: usize = 500;
/// The file size that triggers a trim, in bytes.
pub const MAX_FILE_BYTES: u64 = 1_000_000;
/// What a trim keeps.
pub const TRIM_TO_BYTES: u64 = 500_000;
/// The longest detail kept, in UTF-16 units.
pub const MAX_DETAIL_CHARS: usize = 2000;
/// The longest message kept, in UTF-16 units.
pub const MAX_MESSAGE_CHARS: usize = 4000;
/// The file's name inside the data directory.
pub const LOG_FILE: &str = "weaveforge.log";
/// The warning held in memory when the file cannot be written.
pub const DEGRADED: &str = "The log file is not being written; entries are kept in memory only.";

/// How serious an entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// A failed request or a crash.
    Error,
    /// Something went wrong and the app carried on.
    Warn,
    /// Ordinary activity.
    Info,
}

/// One line of the log, as it is written to disk and answered over IPC.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AppLogEntry {
    /// ISO-8601 time, written by the shell.
    pub at: String,
    /// How serious it is.
    pub level: LogLevel,
    /// Where it came from, e.g. `request` or `main`.
    pub source: String,
    /// What happened, redacted and clipped.
    pub message: String,
    /// Free-form context, omitted when absent.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
}

/// The app log, in memory and in `weaveforge.log`.
///
/// Deviations from the TS module: appends are synchronous under a `Mutex`, not a
/// queued promise chain; there is no console capture, so callers use `record`;
/// the directory, home folder and clock are injected so tests are deterministic.
pub struct AppLog {
    state: Mutex<State>,
    path: PathBuf,
    home: Option<Regex>,
}

/// What `AppLog` guards with its mutex.
struct State {
    entries: VecDeque<AppLogEntry>,
    /// The file's size as this process knows it.
    bytes: u64,
    /// The file write is failing; said once until it recovers.
    degraded: bool,
}

/// Keeps the first `limit` UTF-16 units of `text` and says how many were dropped.
#[must_use]
pub fn clip(text: &str, limit: usize) -> String {
    let total = text.encode_utf16().count();
    if total <= limit {
        return text.to_owned();
    }
    let mut kept = String::new();
    let mut units = 0;
    for ch in text.chars() {
        let width = ch.len_utf16();
        if units + width > limit {
            break;
        }
        units += width;
        kept.push(ch);
    }
    format!("{kept}…[{} more]", total - units)
}

/// Replaces the home folder with `~` (TS homeRedactor). None when redaction is off.
#[must_use]
pub fn home_redactor(home: &str) -> Option<Regex> {
    let trimmed = home.trim_end_matches(['/', '\\']);
    if trimmed.encode_utf16().count() < 3 {
        return None;
    }
    let parts: Vec<String> = trimmed.split(['/', '\\']).map(regex::escape).collect();
    Regex::new(&format!("(?i){}", parts.join(r"[\\/]"))).ok()
}

/// Replaces each match of `re` with `~`, unless the match is followed by a word
/// character, `.` or `-` (the TS lookahead, which the regex crate lacks).
#[must_use]
pub fn redact(re: Option<&Regex>, text: &str) -> String {
    let Some(re) = re else {
        return text.to_owned();
    };
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut from = 0;
    while let Some(found) = re.find_at(text, from) {
        let step = found.start() + char_width(text, found.start());
        let following = text.get(found.end()..).and_then(|rest| rest.chars().next());
        if following.is_some_and(continues_name) {
            from = step;
            continue;
        }
        out.push_str(text.get(copied..found.start()).unwrap_or(""));
        out.push('~');
        copied = found.end();
        from = found.end().max(step);
    }
    out.push_str(text.get(copied..).unwrap_or(""));
    out
}

/// The character set the TS lookahead `(?![\w.-])` excludes (JS `\w` is ASCII).
fn continues_name(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-')
}

/// The UTF-8 width of the character at byte `at`, or 1 past the end.
fn char_width(text: &str, at: usize) -> usize {
    text.get(at..)
        .and_then(|rest| rest.chars().next())
        .map_or(1, char::len_utf8)
}

impl AppLog {
    /// A log that writes `weaveforge.log` under `dir` and writes `home` as `~`.
    #[must_use]
    pub fn new(dir: &Path, home: &str) -> Self {
        Self {
            state: Mutex::new(State {
                entries: VecDeque::new(),
                bytes: 0,
                degraded: false,
            }),
            path: dir.join(LOG_FILE),
            home: home_redactor(home),
        }
    }

    /// Records an entry stamped with the current time.
    pub fn record(&self, level: LogLevel, source: &str, message: &str, detail: Option<&str>) {
        let at = crate::vault::iso_utc(SystemTime::now());
        self.record_at(at, level, source, message, detail);
    }

    /// Records an entry with the given time: redacts and clips it, holds it, appends its line.
    pub fn record_at(
        &self,
        at: String,
        level: LogLevel,
        source: &str,
        message: &str,
        detail: Option<&str>,
    ) {
        let entry = AppLogEntry {
            at,
            level,
            source: source.to_owned(),
            message: clip(&redact(self.home.as_ref(), message), MAX_MESSAGE_CHARS),
            // An empty detail is omitted, as in the TS module.
            detail: detail
                .filter(|text| !text.is_empty())
                .map(|text| clip(&redact(self.home.as_ref(), text), MAX_DETAIL_CHARS)),
        };
        let Ok(json) = serde_json::to_string(&entry) else {
            return;
        };
        let line = format!("{json}\n");
        let mut guard = self.lock();
        let state = &mut *guard;
        hold(state, entry);
        append(&self.path, state, &line);
    }

    /// The entries held in memory, oldest first.
    #[must_use]
    pub fn entries(&self) -> Vec<AppLogEntry> {
        self.lock().entries.iter().cloned().collect()
    }

    /// Takes the newest lines of the file into memory, skipping any already held.
    /// A missing or unreadable file restores nothing.
    pub fn restore_from_disk(&self) {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return;
        };
        let mut guard = self.lock();
        let state = &mut *guard;
        let room = MAX_ENTRIES.saturating_sub(state.entries.len());
        let seen: HashSet<(String, String)> = state
            .entries
            .iter()
            .map(|e| (e.at.clone(), e.message.clone()))
            .collect();
        let fresh: Vec<AppLogEntry> = parse_tail(&text)
            .into_iter()
            .filter(|e| !seen.contains(&(e.at.clone(), e.message.clone())))
            .collect();
        // Prepended: restored lines are older than anything held. Keep the newest `room`.
        let skip = fresh.len().saturating_sub(room);
        for restored in fresh.into_iter().skip(skip).rev() {
            state.entries.push_front(restored);
        }
        state.bytes = byte_len(&text);
    }

    /// Where the file is.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Holds `entry` in memory, dropping the oldest past `MAX_ENTRIES`.
fn hold(state: &mut State, entry: AppLogEntry) {
    state.entries.push_back(entry);
    if state.entries.len() > MAX_ENTRIES {
        let _ = state.entries.pop_front();
    }
}

/// Appends `line` to the file, then trims the file if it has grown past its ceiling.
/// A failure is held once as a warning and never returned: an unwritable log is not an outage.
fn append(path: &Path, state: &mut State, line: &str) {
    if write_line(path, line).is_err() {
        note_degraded(state);
        return;
    }
    state.bytes = state.bytes.saturating_add(byte_len(line));
    if state.bytes > MAX_FILE_BYTES && trim(path, state).is_err() {
        note_degraded(state);
        return;
    }
    state.degraded = false;
}

/// Holds the one warning that the file is not being written, until it recovers.
fn note_degraded(state: &mut State) {
    if state.degraded {
        return;
    }
    state.degraded = true;
    hold(
        state,
        AppLogEntry {
            at: crate::vault::iso_utc(SystemTime::now()),
            level: LogLevel::Warn,
            source: "log".to_owned(),
            message: DEGRADED.to_owned(),
            detail: None,
        },
    );
}

fn write_line(path: &Path, line: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())
}

/// Rewrites the file with its newest lines that fit in `TRIM_TO_BYTES`. A draft is
/// written first, so a crash leaves a whole file. A failed read or write changes nothing.
fn trim(path: &Path, state: &mut State) -> io::Result<()> {
    let text = fs::read_to_string(path)?;
    let mut kept: Vec<&str> = Vec::new();
    let mut size: u64 = 0;
    for line in text.split('\n').filter(|line| !line.is_empty()).rev() {
        let length = byte_len(line).saturating_add(1);
        if size.saturating_add(length) > TRIM_TO_BYTES {
            break;
        }
        size = size.saturating_add(length);
        kept.push(line);
    }
    kept.reverse();
    let mut body = String::new();
    for line in kept {
        body.push_str(line);
        body.push('\n');
    }
    let mut draft = path.as_os_str().to_owned();
    draft.push(".draft");
    let draft = PathBuf::from(draft);
    fs::write(&draft, &body)?;
    fs::rename(&draft, path)?;
    state.bytes = byte_len(&body);
    Ok(())
}

/// The last `MAX_ENTRIES` non-empty lines of `text` that parse as entries, in file order.
/// Half-written or foreign lines are skipped rather than guessed at.
fn parse_tail(text: &str) -> Vec<AppLogEntry> {
    let lines: Vec<&str> = text.split('\n').filter(|line| !line.is_empty()).collect();
    let start = lines.len().saturating_sub(MAX_ENTRIES);
    lines
        .into_iter()
        .skip(start)
        .filter_map(|line| serde_json::from_str::<AppLogEntry>(line).ok())
        .collect()
}

fn byte_len(text: &str) -> u64 {
    u64::try_from(text.len()).unwrap_or(u64::MAX)
}

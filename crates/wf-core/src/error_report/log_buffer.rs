//! Rules for the bug-report log buffer (`apps/web/src/lib/error-report/log-buffer.ts` and
//! `request-log.ts`): which request failures are noise, the line a console message becomes, the
//! bounded ring of lines and the bounded set of seen failures, and the message/detail split of an
//! error. The console and `window.fetch` wrapping, the timers and the body read stay in TS.

use serde::Serialize;

/// Lines the buffer keeps. An older line is dropped rather than kept.
pub const MAX_LINES: usize = 40;
/// Failures remembered for de-duplication. A `Set` of every stack a session produced would leak.
pub const MAX_SEEN: usize = 200;
/// Longest first line kept as an error's message, in UTF-16 units.
pub const MESSAGE_UNITS: usize = 500;

/// URL fragments whose failures are not worth a log line: the app's static assets (relative and
/// `app://` absolute) and the dev hot-reload poll. Matched by substring, not prefix.
const IGNORED: [&str; 4] = ["/_next/", "/__nextjs", "webpack-hmr", ".hot-update."];

/// Whether a failed request to `url` is noise and is not logged.
#[must_use]
pub fn is_noise(url: &str) -> bool {
    IGNORED.iter().any(|needle| url.contains(needle))
}

/// A console argument's line: `[error] text` or `[warn] text`.
#[must_use]
pub fn console_line(level: &str, text: &str) -> String {
    format!("[{level}] {text}")
}

/// Append `line` and drop the oldest line once the buffer is over [`MAX_LINES`].
#[must_use]
pub fn push_line(mut lines: Vec<String>, line: String) -> Vec<String> {
    lines.push(line);
    if lines.len() > MAX_LINES {
        let _ = lines.remove(0);
    }
    lines
}

/// Record a failure that never reached the console. Empty text is ignored.
#[must_use]
pub fn record_uncaught(lines: Vec<String>, text: &str) -> Vec<String> {
    if text.is_empty() {
        return lines;
    }
    push_line(lines, format!("[uncaught] {text}"))
}

/// What the shell's error log gets for one error: a short message and, when the text has more
/// than its first line, the full text as detail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEntry {
    /// The first line of the error, cut to a short length.
    pub message: String,
    /// The full error text, when it differs from the message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// The [`ErrorEntry`] for `text`. The message is the first line, cut to [`MESSAGE_UNITS`] UTF-16
/// units; the detail is the whole text when it differs from the message.
#[must_use]
pub fn error_entry(text: &str) -> ErrorEntry {
    let first = text.split('\n').next().unwrap_or("");
    let message = take_units(first, MESSAGE_UNITS).to_owned();
    let detail = (text != message).then(|| text.to_owned());
    ErrorEntry { message, detail }
}

/// The longest prefix of `text` within `max` UTF-16 units, cut at a character boundary.
fn take_units(text: &str, max: usize) -> &str {
    let mut units = 0;
    for (index, ch) in text.char_indices() {
        units += ch.len_utf16();
        if units > max {
            return &text[..index];
        }
    }
    text
}

/// The seen-set after one check, and whether `text` was already there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Remembered {
    /// The seen-set after the check.
    pub seen: Vec<String>,
    /// Whether the text was already recorded.
    pub recorded: bool,
}

/// Whether `text` was already recorded. Empty text counts as recorded. A new `text` is added and
/// the oldest entry is dropped past [`MAX_SEEN`].
#[must_use]
pub fn remember(mut seen: Vec<String>, text: &str) -> Remembered {
    if text.is_empty() || seen.iter().any(|known| known == text) {
        return Remembered { seen, recorded: true };
    }
    seen.push(text.to_owned());
    if seen.len() > MAX_SEEN {
        let _ = seen.remove(0);
    }
    Remembered { seen, recorded: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    // it: "the app's own static assets are not noise in the log"
    #[test]
    fn the_app_own_static_assets_are_noise_in_every_form() {
        assert!(is_noise("/_next/static/chunks/1601.js"));
        assert!(is_noise("app://weaveforge/_next/static/chunks/1601.js"));
        assert!(is_noise("http://localhost:3000/_next/static/chunks/1601.js"));
        assert!(is_noise("http://localhost:3000/webpack-hmr"));
        assert!(is_noise("/api/.hot-update.json"));
        assert!(!is_noise("https://api.weaveforge.org/rest/v1/papers"));
    }

    // it: "the buffer is bounded, keeping the newest lines"
    #[test]
    fn the_buffer_is_bounded_keeping_the_newest_lines() {
        let mut lines = Vec::new();
        for i in 0..=MAX_LINES {
            lines = push_line(lines, console_line("error", &format!("line {i}")));
        }
        assert_eq!(lines.len(), MAX_LINES);
        assert_eq!(lines.first().map(String::as_str), Some("[error] line 1"));
        assert_eq!(lines.last().map(String::as_str), Some("[error] line 40"));
    }

    // it: "an uncaught error is recorded even though it never reached console.error"
    #[test]
    fn an_uncaught_error_is_recorded_marked_with_where_it_happened() {
        let lines = record_uncaught(Vec::new(), "TypeError: x is not a function\n    at papers/screen.tsx:41:9");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with("[uncaught] "), "marked, so it is not mistaken for a warning");
        assert!(lines[0].contains("papers/screen.tsx:41:9"), "and it carries where it happened");
    }

    // it: "an empty record is a no-op"
    #[test]
    fn an_empty_record_is_a_no_op() {
        assert!(record_uncaught(Vec::new(), "").is_empty());
    }

    // it: "an Error's stack goes in the detail, its first line in the message"
    #[test]
    fn the_first_line_is_the_message_and_the_full_text_the_detail() {
        let entry = error_entry("Error: boom\n    at papers/screen.tsx:41:9");
        assert_eq!(entry.message, "Error: boom");
        assert_eq!(entry.detail.as_deref(), Some("Error: boom\n    at papers/screen.tsx:41:9"));
    }

    #[test]
    fn a_single_line_error_has_no_detail() {
        let entry = error_entry("Failed to fetch");
        assert_eq!(entry.message, "Failed to fetch");
        assert_eq!(entry.detail, None);
    }

    #[test]
    fn a_long_message_is_cut_to_the_unit_limit() {
        let entry = error_entry(&"a".repeat(MESSAGE_UNITS + 10));
        assert_eq!(entry.message.len(), MESSAGE_UNITS);
    }

    // it: "the same error repeated is written once, and still buffered each time"
    // (the "written once" half; the buffering half stays in the TS test)
    #[test]
    fn the_same_error_repeated_is_recorded_once() {
        let first = remember(Vec::new(), "boom");
        assert!(!first.recorded);
        let again = remember(first.seen, "boom");
        assert!(again.recorded);
        assert_eq!(again.seen.len(), 1);
        assert!(remember(Vec::new(), "").recorded);
    }

    #[test]
    fn remember_forgets_the_oldest_past_the_cap() {
        let mut seen = Vec::new();
        for i in 0..=MAX_SEEN {
            seen = remember(seen, &format!("e{i}")).seen;
        }
        assert_eq!(seen.len(), MAX_SEEN);
        assert!(!remember(seen.clone(), "e0").recorded, "e0 was dropped and counts as new again");
    }
}

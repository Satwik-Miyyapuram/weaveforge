#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the app log (ported from apps/desktop/test/app-log.test.ts).
mod common;

use std::fs;

use common::{TempDir, put};
use weaveforge_shell::app_log::{
    AppLog, AppLogEntry, DEGRADED, LOG_FILE, LogLevel, MAX_ENTRIES, MAX_FILE_BYTES, TRIM_TO_BYTES,
    clip, home_redactor, redact,
};

const AT: &str = "2026-01-01T00:00:00.000Z";
const HOME: &str = "C:\\Users\\Ada";

fn entry(at: &str, message: &str) -> AppLogEntry {
    AppLogEntry {
        at: at.to_owned(),
        level: LogLevel::Info,
        source: "test".to_owned(),
        message: message.to_owned(),
        detail: None,
    }
}

fn line(entry: &AppLogEntry) -> String {
    serde_json::to_string(entry).unwrap()
}

fn say(log: &AppLog, source: &str, message: &str) {
    log.record_at(AT.to_owned(), LogLevel::Info, source, message, None);
}

#[test]
fn clip_cases() {
    assert_eq!(clip("abc", 5), "abc");
    assert_eq!(clip("abc", 3), "abc");
    assert_eq!(clip("abcdef", 3), "abc…[3 more]");
    assert_eq!(clip("😀😀", 3), "😀…[2 more]");
}

#[test]
fn redactor_cases() {
    assert!(home_redactor("/").is_none());
    assert!(home_redactor("ab").is_none());
    let re = home_redactor("/home/alice/");
    assert_eq!(redact(re.as_ref(), "/home/alice/x"), "~/x");
    assert_eq!(redact(re.as_ref(), "/HOME/Alice/x"), "~/x");
    assert_eq!(redact(re.as_ref(), "/home/alicex/y"), "/home/alicex/y");
    assert_eq!(redact(re.as_ref(), "/home/alice.b"), "/home/alice.b");
    assert_eq!(redact(re.as_ref(), "/home/alice"), "~");
    assert_eq!(
        redact(re.as_ref(), "/home/alice/a and /home/alice/b"),
        "~/a and ~/b"
    );
    assert_eq!(
        redact(re.as_ref(), "/home/alice.b then /home/alice/c"),
        "/home/alice.b then ~/c"
    );
    let win = home_redactor("C:\\Users\\Alice");
    assert_eq!(redact(win.as_ref(), "c:/users/alice/x"), "~/x");
    assert_eq!(redact(None, "/home/alice/x"), "/home/alice/x");
}

#[test]
fn entry_json() {
    let entry = AppLogEntry {
        at: AT.to_owned(),
        level: LogLevel::Warn,
        source: "main".to_owned(),
        message: "hi".to_owned(),
        detail: None,
    };
    assert_eq!(
        serde_json::to_string(&entry).unwrap(),
        r#"{"at":"2026-01-01T00:00:00.000Z","level":"warn","source":"main","message":"hi"}"#
    );
}

#[test]
fn record_appends_json_line() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    log.record(
        LogLevel::Error,
        "request",
        "GET /x — 403",
        Some("forbidden"),
    );
    let text = fs::read_to_string(log.path()).unwrap();
    assert_eq!(text.lines().count(), 1);
    let parsed: AppLogEntry = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(parsed, log.entries()[0]);
    assert_eq!(parsed.detail.as_deref(), Some("forbidden"));
}

#[test]
fn record_without_detail_omits_the_key() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    log.record_at(AT.to_owned(), LogLevel::Warn, "main", "m", None);
    let text = fs::read_to_string(log.path()).unwrap();
    assert!(!text.contains("detail"), "{text}");
}

#[test]
fn entry_is_kept_in_memory_and_written() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    log.record_at(
        AT.to_owned(),
        LogLevel::Error,
        "request",
        "GET /x — 403",
        Some("forbidden"),
    );
    let held = log.entries();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].message, "GET /x — 403");
    assert_eq!(held[0].detail.as_deref(), Some("forbidden"));
    assert_eq!(log.path(), dir.path().join(LOG_FILE).as_path());
    let text = fs::read_to_string(log.path()).unwrap();
    let first: AppLogEntry = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(first.source, "request");
}

#[test]
fn ring_caps_at_500() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    for i in 0..=MAX_ENTRIES {
        say(&log, "test", &format!("line {i}"));
    }
    let held = log.entries();
    assert_eq!(held.len(), MAX_ENTRIES);
    assert_eq!(held.first().unwrap().message, "line 1");
    assert_eq!(held.last().unwrap().message, format!("line {MAX_ENTRIES}"));
}

#[test]
fn long_message_is_clipped() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    log.record_at(
        AT.to_owned(),
        LogLevel::Error,
        "request",
        &"x".repeat(9000),
        None,
    );
    let held = log.entries();
    let expected = format!("{}…[5000 more]", "x".repeat(4000));
    assert_eq!(held[0].message, expected);
}

#[test]
fn degraded_once() {
    let dir = TempDir::new();
    let blocker = dir.path().join("file");
    put(&blocker, b"x");
    let log = AppLog::new(&blocker, HOME);
    say(&log, "test", "r1");
    say(&log, "test", "r2");
    let held = log.entries();
    assert_eq!(held.len(), 3);
    assert_eq!(held[0].message, "r1");
    assert_eq!(held[1].source, "log");
    assert_eq!(held[1].level, LogLevel::Warn);
    assert_eq!(held[1].message, DEGRADED);
    assert_eq!(held[2].message, "r2");
}

#[test]
fn recovered_log_reports_next_failure_again() {
    let dir = TempDir::new();
    let blocker = dir.path().join("file");
    put(&blocker, b"x");
    let log = AppLog::new(&blocker, HOME);
    say(&log, "test", "a");
    fs::remove_file(&blocker).unwrap();
    fs::create_dir_all(&blocker).unwrap();
    say(&log, "test", "b");
    fs::remove_dir_all(&blocker).unwrap();
    put(&blocker, b"x");
    say(&log, "test", "c");
    let degraded = log.entries().iter().filter(|e| e.source == "log").count();
    assert_eq!(degraded, 2);

    let healthy_dir = TempDir::new();
    let healthy = AppLog::new(healthy_dir.path(), HOME);
    say(&healthy, "test", "fine");
    assert_eq!(healthy.entries().len(), 1);
}

#[test]
fn trim_when_over_limit() {
    let dir = TempDir::new();
    let detail = "d".repeat(2000);
    let mut text = String::new();
    for i in 0..600 {
        let old = AppLogEntry {
            at: AT.to_owned(),
            level: LogLevel::Info,
            source: "test".to_owned(),
            message: format!("old {i}"),
            detail: Some(detail.clone()),
        };
        text.push_str(&line(&old));
        text.push('\n');
    }
    put(&dir.path().join(LOG_FILE), text.as_bytes());
    let log = AppLog::new(dir.path(), HOME);
    log.restore_from_disk();
    assert!(fs::metadata(log.path()).unwrap().len() > MAX_FILE_BYTES);

    say(&log, "test", "newest");
    let len = fs::metadata(log.path()).unwrap().len();
    assert!(len <= TRIM_TO_BYTES, "file is {len} bytes");
    let written = fs::read_to_string(log.path()).unwrap();
    let last: AppLogEntry = serde_json::from_str(written.lines().last().unwrap()).unwrap();
    assert_eq!(last.message, "newest");
    assert!(!dir.path().join(format!("{LOG_FILE}.draft")).exists());
}

#[test]
fn restore_prepends_and_dedupes() {
    let dir = TempDir::new();
    let e1 = entry("2026-01-01T00:00:01.000Z", "e1");
    let e2 = entry("2026-01-01T00:00:02.000Z", "e2");
    let e3 = entry("2026-01-01T00:00:03.000Z", "e3");
    let text = format!("{}\n{}\nnot json\n{}\n", line(&e1), line(&e2), line(&e3));
    put(&dir.path().join(LOG_FILE), text.as_bytes());

    let log = AppLog::new(dir.path(), HOME);
    log.record_at(e3.at.clone(), LogLevel::Info, "test", "e3", None);
    log.restore_from_disk();
    assert_eq!(log.entries(), vec![e1, e2, e3]);
}

#[test]
fn restore_with_missing_file_changes_nothing() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    log.restore_from_disk();
    assert!(log.entries().is_empty());
    assert!(!log.path().exists());
}

#[test]
fn restore_respects_room() {
    let dir = TempDir::new();
    let writer = AppLog::new(dir.path(), HOME);
    for i in 0..MAX_ENTRIES {
        say(&writer, "old", &format!("old {i}"));
    }

    let log = AppLog::new(dir.path(), HOME);
    say(&log, "new", "newest");
    log.restore_from_disk();
    let held = log.entries();
    assert_eq!(held.len(), MAX_ENTRIES);
    assert_eq!(held.last().unwrap().message, "newest");
    assert_eq!(held.first().unwrap().source, "old");
}

#[test]
fn restore_into_full_ring_adds_nothing() {
    let dir = TempDir::new();
    let writer = AppLog::new(dir.path(), HOME);
    say(&writer, "old", "old line");

    let log = AppLog::new(dir.path(), HOME);
    for i in 0..MAX_ENTRIES {
        say(&log, "new", &format!("new {i}"));
    }
    log.restore_from_disk();
    let held = log.entries();
    assert_eq!(held.len(), MAX_ENTRIES);
    assert!(held.iter().all(|e| e.source == "new"));
}

#[test]
fn restore_drops_half_written_last_line() {
    let dir = TempDir::new();
    let whole = line(&entry(AT, "whole"));
    let text = format!("{whole}\n{{\"at\":\"2026-01-01T00:00:01.000Z\",\"lev");
    put(&dir.path().join(LOG_FILE), text.as_bytes());
    let log = AppLog::new(dir.path(), HOME);
    log.restore_from_disk();
    let messages: Vec<String> = log.entries().into_iter().map(|e| e.message).collect();
    assert_eq!(messages, vec!["whole"]);
}

#[test]
fn restore_skips_lines_that_are_not_entries() {
    let dir = TempDir::new();
    let real = line(&entry("2026-01-01T00:00:00.000Z", "real"));
    let lines = [
        "null",
        "42",
        "[1,2,3]",
        r#"{"at":"nope"}"#,
        r#"{"message":"no timestamp"}"#,
        real.as_str(),
        "not json at all",
    ];
    let text = lines.join("\n") + "\n";
    put(&dir.path().join(LOG_FILE), text.as_bytes());
    let log = AppLog::new(dir.path(), HOME);
    log.restore_from_disk();
    let messages: Vec<String> = log.entries().into_iter().map(|e| e.message).collect();
    assert_eq!(messages, vec!["real"]);
}

#[test]
fn restore_twice_does_not_duplicate() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    say(&log, "test", "one line");
    log.restore_from_disk();
    log.restore_from_disk();
    assert_eq!(log.entries().len(), 1);
}

#[test]
fn new_process_reads_previous_session() {
    let dir = TempDir::new();
    let first = AppLog::new(dir.path(), HOME);
    say(&first, "request", "GET /a — 500");
    say(&first, "main", "database slow");

    let second = AppLog::new(dir.path(), HOME);
    assert!(second.entries().is_empty());
    second.restore_from_disk();
    let messages: Vec<String> = second.entries().into_iter().map(|e| e.message).collect();
    assert_eq!(messages, vec!["GET /a — 500", "database slow"]);
    let lines = fs::read_to_string(second.path()).unwrap().lines().count();
    assert_eq!(lines, 2);
}

#[test]
fn home_folder_is_written_as_tilde() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), HOME);
    log.record_at(
        AT.to_owned(),
        LogLevel::Info,
        "main",
        "[local-db] moved: C:\\Users\\Ada\\AppData\\db",
        Some("c:/users/ada/notes"),
    );
    log.record_at(
        AT.to_owned(),
        LogLevel::Info,
        "main",
        "[local-db] backed up to C:\\Users\\Ada\\b1, C:\\Users\\Ada\\b2",
        None,
    );
    log.record_at(
        AT.to_owned(),
        LogLevel::Info,
        "main",
        "C:\\Users\\Adam\\x and C:\\Users\\Ada",
        None,
    );
    let held = log.entries();
    assert_eq!(held[0].message, "[local-db] moved: ~\\AppData\\db");
    assert_eq!(held[0].detail.as_deref(), Some("~/notes"));
    assert_eq!(held[1].message, "[local-db] backed up to ~\\b1, ~\\b2");
    assert_eq!(held[2].message, "C:\\Users\\Adam\\x and ~");
    let text = fs::read_to_string(log.path()).unwrap();
    assert!(!text.contains("Users\\\\Ada\\\\"), "{text}");
}

#[test]
fn short_home_is_not_redacted() {
    for home in ["", "/", "C:"] {
        let dir = TempDir::new();
        let log = AppLog::new(dir.path(), home);
        log.record_at(
            AT.to_owned(),
            LogLevel::Info,
            "main",
            "/srv/data C:/x",
            None,
        );
        assert_eq!(log.entries()[0].message, "/srv/data C:/x", "home {home:?}");
    }
}

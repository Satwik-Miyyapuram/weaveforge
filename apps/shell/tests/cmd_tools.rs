//! Tests for the tool commands (ported from apps/desktop/test/app-log.test.ts and tex.test.ts).
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::TempDir;
use serde_json::json;
use weaveforge_shell::app_log::{AppLog, AppLogEntry, LogLevel, MAX_ENTRIES};
use weaveforge_shell::cmd_tools::{
    AppLogReport, AppLogText, TexCompileReply, compile, format_log_line, read_log, report,
};
use weaveforge_shell::tex::{NO_ENGINE, TexCompileResult, TexEngine, TexError};

const AT: &str = "2026-01-02T03:04:05.000Z";
const HEAD: &str = "2026-01-02 03:04:05.000";

fn entry(at: &str, level: LogLevel, message: &str, detail: Option<&str>) -> AppLogEntry {
    AppLogEntry {
        at: at.to_owned(),
        level,
        source: "main".to_owned(),
        message: message.to_owned(),
        detail: detail.map(str::to_owned),
    }
}

fn report_of(
    level: &str,
    source: Option<&str>,
    message: &str,
    detail: Option<&str>,
) -> AppLogReport {
    AppLogReport {
        level: level.to_owned(),
        source: source.map(str::to_owned),
        message: message.to_owned(),
        detail: detail.map(str::to_owned),
    }
}

fn log_in(dir: &TempDir) -> AppLog {
    AppLog::new(dir.path(), "")
}

fn result(pdf: Option<Vec<u8>>) -> TexCompileResult {
    TexCompileResult {
        ok: true,
        pdf,
        log: "the log".to_owned(),
        errors: vec![TexError {
            file: "main.tex".to_owned(),
            line: 3,
            message: "Undefined control sequence".to_owned(),
        }],
        engine: Some(TexEngine::Tectonic),
    }
}

#[test]
fn format_info_line() {
    let line = format_log_line(&entry(AT, LogLevel::Info, "hi", None));
    assert_eq!(line, format!("{HEAD} INFO  [main] hi"));
}

#[test]
fn format_error_line_is_not_padded() {
    let line = format_log_line(&entry(AT, LogLevel::Error, "hi", None));
    assert_eq!(line, format!("{HEAD} ERROR [main] hi"));
}

#[test]
fn format_warn_line_is_padded() {
    let line = format_log_line(&entry(AT, LogLevel::Warn, "hi", None));
    assert_eq!(line, format!("{HEAD} WARN  [main] hi"));
}

#[test]
fn format_indents_detail_lines() {
    let line = format_log_line(&entry(AT, LogLevel::Info, "hi", Some("a\nb")));
    assert_eq!(line, format!("{HEAD} INFO  [main] hi\n    a\n    b"));
}

#[test]
fn format_empty_detail_is_head_only() {
    let line = format_log_line(&entry(AT, LogLevel::Info, "hi", Some("")));
    assert_eq!(line, format!("{HEAD} INFO  [main] hi"));
}

#[test]
fn format_leaves_a_stamp_without_markers_unchanged() {
    let line = format_log_line(&entry("no-markers", LogLevel::Info, "hi", None));
    assert_eq!(line, "no-markers INFO  [main] hi");
}

#[test]
fn valid_report_shows_in_read_log_with_renderer_source() {
    let dir = TempDir::new();
    let log = log_in(&dir);
    report(&log, report_of("info", None, "hi", None));
    let entries = log.entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries.first().unwrap().source, "renderer");
    let text = read_log(&log).text;
    assert!(text.ends_with(" INFO  [renderer] hi"), "{text}");
    assert_eq!(text.lines().count(), 1);
}

#[test]
fn report_keeps_detail() {
    let dir = TempDir::new();
    let log = log_in(&dir);
    report(
        &log,
        report_of("error", Some("request"), "boom", Some("a\nb")),
    );
    let entries = log.entries();
    assert_eq!(entries.first().unwrap().source, "request");
    assert_eq!(entries.first().unwrap().detail, Some("a\nb".to_owned()));
    let text = read_log(&log).text;
    assert!(
        text.ends_with("ERROR [request] boom\n    a\n    b"),
        "{text}"
    );
}

#[test]
fn report_with_debug_level_is_dropped() {
    let dir = TempDir::new();
    let log = log_in(&dir);
    report(&log, report_of("debug", None, "hi", None));
    assert_eq!(log.entries().len(), 0);
    assert_eq!(read_log(&log).text, "");
}

#[test]
fn report_with_upper_case_level_is_dropped() {
    let dir = TempDir::new();
    let log = log_in(&dir);
    report(&log, report_of("ERROR", None, "hi", None));
    assert_eq!(log.entries().len(), 0);
}

#[test]
fn report_with_empty_message_is_dropped() {
    let dir = TempDir::new();
    let log = log_in(&dir);
    report(&log, report_of("warn", None, "", None));
    assert_eq!(log.entries().len(), 0);
}

#[test]
fn read_log_file_is_the_log_path() {
    let dir = TempDir::new();
    let log = log_in(&dir);
    let read = read_log(&log);
    assert!(read.file.ends_with("weaveforge.log"), "{}", read.file);
    assert_eq!(read.file, log.path().to_string_lossy());
}

#[test]
fn read_log_of_an_empty_log_is_complete() {
    let dir = TempDir::new();
    let read = read_log(&log_in(&dir));
    assert_eq!(read.text, "");
    assert!(read.complete);
}

#[test]
fn read_log_past_the_ring_is_not_complete() {
    let dir = TempDir::new();
    let log = log_in(&dir);
    for _ in 0..=MAX_ENTRIES {
        log.record_at(AT.to_owned(), LogLevel::Info, "main", "m", None);
    }
    assert_eq!(log.entries().len(), MAX_ENTRIES);
    let read = read_log(&log);
    assert!(!read.complete);
    assert_eq!(read.text.lines().count(), MAX_ENTRIES);
}

#[test]
fn reply_encodes_pdf_as_base64() {
    let reply = TexCompileReply::from(result(Some(vec![37, 80, 68, 70])));
    assert_eq!(reply.pdf, Some("JVBERg==".to_owned()));
}

#[test]
fn reply_without_pdf_is_none() {
    let reply = TexCompileReply::from(result(None));
    assert_eq!(reply.pdf, None);
}

#[test]
fn reply_copies_outcome_fields() {
    let reply = TexCompileReply::from(result(None));
    assert!(reply.ok);
    assert_eq!(reply.log, "the log");
    assert_eq!(
        reply.errors,
        vec![TexError {
            file: "main.tex".to_owned(),
            line: 3,
            message: "Undefined control sequence".to_owned(),
        }]
    );
    assert_eq!(reply.engine, Some(TexEngine::Tectonic));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_of_an_empty_project_is_not_ok() {
    let reply = compile(vec![], "main.tex".to_owned()).await;
    assert!(!reply.ok);
    assert!(reply.pdf.is_none());
    assert!(!reply.errors.is_empty());
    if reply.engine.is_none() {
        assert_eq!(
            reply.errors,
            vec![TexError {
                file: "main.tex".to_owned(),
                line: 0,
                message: NO_ENGINE.to_owned(),
            }]
        );
    }
}

#[test]
fn app_log_text_serializes_complete() {
    let value = serde_json::to_value(AppLogText {
        file: "f".to_owned(),
        text: "t".to_owned(),
        complete: true,
    })
    .unwrap();
    assert_eq!(value["complete"], json!(true));
    assert_eq!(value["file"], json!("f"));
    assert_eq!(value["text"], json!("t"));
}

#[test]
fn tex_compile_reply_serializes_its_keys() {
    let value = serde_json::to_value(TexCompileReply::from(result(None))).unwrap();
    for key in ["ok", "pdf", "log", "errors", "engine"] {
        assert!(value.get(key).is_some(), "missing {key}");
    }
    assert_eq!(value.as_object().unwrap().len(), 5);
}

#[test]
fn app_log_report_deserializes_without_optional_fields() {
    let parsed: AppLogReport =
        serde_json::from_value(json!({"level": "info", "message": "m"})).unwrap();
    assert_eq!(parsed.level, "info");
    assert_eq!(parsed.message, "m");
    assert_eq!(parsed.source, None);
    assert_eq!(parsed.detail, None);
}

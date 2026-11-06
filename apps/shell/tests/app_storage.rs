#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for sizing and clearing the app's own folders.
use crate::common;

use std::fs;

use common::{TempDir, put};
use weaveforge_shell_lib::app_log::{AppLog, LogLevel};
use weaveforge_shell_lib::app_storage::{AREAS, Usage, area, clear_dir, dir_usage};

#[test]
fn a_missing_folder_is_empty() {
    let dir = TempDir::new();
    assert_eq!(
        dir_usage(&dir.path().join("nope")),
        Usage { bytes: 0, files: 0 }
    );
}

#[test]
fn usage_counts_nested_files() {
    let dir = TempDir::new();
    put(&dir.path().join("a.bin"), b"12345");
    put(&dir.path().join("sub/deeper/b.bin"), b"123");
    assert_eq!(dir_usage(dir.path()), Usage { bytes: 8, files: 2 });
}

#[test]
fn clear_empties_but_keeps_the_folder() {
    let dir = TempDir::new();
    put(&dir.path().join("a.bin"), b"12345");
    put(&dir.path().join("sub/b.bin"), b"123");
    clear_dir(dir.path()).unwrap();
    assert!(dir.path().is_dir());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn clearing_a_missing_folder_is_fine() {
    let dir = TempDir::new();
    clear_dir(&dir.path().join("nope")).unwrap();
}

#[test]
fn areas_are_known_and_unknown_ids_refused() {
    assert_eq!(AREAS, ["artifacts", "models", "log"]);
    assert_eq!(area("models"), Some("models"));
    assert!(area("../etc").is_none());
}

#[test]
fn log_clear_empties_memory_and_file() {
    let dir = TempDir::new();
    let log = AppLog::new(dir.path(), r"C:\Users\Ada");
    log.record(LogLevel::Info, "test", "hello", None);
    assert!(fs::metadata(log.path()).unwrap().len() > 0);
    log.clear().unwrap();
    assert!(log.entries().is_empty());
    assert_eq!(fs::metadata(log.path()).unwrap().len(), 0);
    log.record(LogLevel::Info, "test", "after", None);
    assert_eq!(log.entries().len(), 1);
}

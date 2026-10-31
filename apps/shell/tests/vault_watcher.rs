//! Tests for the vault folder watcher: which outside changes reach the page.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use common::TempDir;
use weaveforge_shell::vault_watcher::{
    CANNOT_WATCH, ChangeSink, VaultWatcher, WatchSlot, is_ignored, relative_path,
};
use wf_store::vault::TEMP_SUFFIX;

/// Generous: a real folder event can take a moment to arrive on a loaded machine.
const WAIT: Duration = Duration::from_secs(5);

/// Starts a watcher on `root`; the returned sender keeps the batch channel open.
fn start(root: &Path) -> (VaultWatcher, Receiver<Vec<String>>, Sender<Vec<String>>) {
    let (tx, rx) = mpsc::channel();
    let sender = tx.clone();
    let sink: ChangeSink = Arc::new(move |batch: Vec<String>| {
        let _ = sender.send(batch);
    });
    let watcher = VaultWatcher::start_with(
        root,
        sink,
        Duration::from_millis(100),
        Duration::from_secs(10),
    )
    .unwrap();
    (watcher, rx, tx)
}

/// Every path in the batches received until one batch contains `marker`.
fn until_marker(rx: &Receiver<Vec<String>>, marker: &str) -> Vec<String> {
    let mut seen = Vec::new();
    loop {
        let batch = rx.recv_timeout(WAIT).unwrap();
        let done = batch.iter().any(|path| path == marker);
        seen.extend(batch);
        if done {
            return seen;
        }
    }
}

#[test]
fn relative_path_joins_segments_with_slashes() {
    let rel = relative_path(Path::new("root"), Path::new("root/a/b.md"));
    assert_eq!(rel.as_deref(), Some("a/b.md"));
}

#[test]
fn relative_path_outside_root_is_none() {
    let rel = relative_path(Path::new("root"), Path::new("other/a.md"));
    assert_eq!(rel, None);
}

#[test]
fn relative_path_of_the_root_itself_is_none() {
    let rel = relative_path(Path::new("root"), Path::new("root"));
    assert_eq!(rel, None);
}

#[test]
fn temp_files_and_git_internals_are_ignored() {
    let temp = format!("a.md{TEMP_SUFFIX}");
    assert!(is_ignored(&temp));
    assert!(is_ignored(".git"));
    assert!(is_ignored(".git/index"));
    assert!(!is_ignored("notes/a.md"));
    assert!(!is_ignored(".gitignore"));
    assert!(!is_ignored("notes/.git/x"));
}

#[test]
fn an_outside_edit_is_reported() {
    let dir = TempDir::new();
    let (_watcher, rx, _alive) = start(dir.path());
    fs::write(dir.path().join("a.md"), b"hello").unwrap();
    let seen = until_marker(&rx, "a.md");
    assert!(seen.contains(&"a.md".to_owned()));
}

#[test]
fn a_new_file_in_a_subfolder_is_reported_with_a_slash_path() {
    let dir = TempDir::new();
    fs::create_dir(dir.path().join("n")).unwrap();
    let (_watcher, rx, _alive) = start(dir.path());
    fs::write(dir.path().join("n").join("b.md"), b"x").unwrap();
    let seen = until_marker(&rx, "n/b.md");
    assert!(seen.contains(&"n/b.md".to_owned()));
}

#[test]
fn our_own_write_is_not_reported() {
    let dir = TempDir::new();
    let (watcher, rx, _alive) = start(dir.path());
    watcher.note_self_write("ours.md", b"x");
    fs::write(dir.path().join("ours.md"), b"x").unwrap();
    fs::write(dir.path().join("marker.md"), b"m").unwrap();
    let seen = until_marker(&rx, "marker.md");
    assert!(seen.contains(&"marker.md".to_owned()));
    assert!(!seen.contains(&"ours.md".to_owned()));
}

#[test]
fn an_outside_edit_right_after_our_write_is_reported() {
    let dir = TempDir::new();
    let (watcher, rx, _alive) = start(dir.path());
    watcher.note_self_write("a.md", b"ours");
    fs::write(dir.path().join("a.md"), b"theirs").unwrap();
    let seen = until_marker(&rx, "a.md");
    assert!(seen.contains(&"a.md".to_owned()));
}

#[test]
fn temp_files_are_not_reported() {
    let dir = TempDir::new();
    let (_watcher, rx, _alive) = start(dir.path());
    fs::write(dir.path().join(format!("x.md{TEMP_SUFFIX}")), b"x").unwrap();
    fs::write(dir.path().join("marker.md"), b"m").unwrap();
    let seen = until_marker(&rx, "marker.md");
    assert!(seen.contains(&"marker.md".to_owned()));
    assert!(!seen.iter().any(|path| path.ends_with(TEMP_SUFFIX)));
}

#[test]
fn nothing_is_reported_after_drop() {
    let dir = TempDir::new();
    let (watcher, rx, _alive) = start(dir.path());
    drop(watcher);
    fs::write(dir.path().join("late.md"), b"x").unwrap();
    let got = rx.recv_timeout(Duration::from_millis(500));
    assert!(matches!(got, Err(RecvTimeoutError::Timeout)));
}

#[test]
fn a_missing_folder_cannot_be_watched() {
    let dir = TempDir::new();
    let sink: ChangeSink = Arc::new(|_: Vec<String>| {});
    let err = VaultWatcher::start_with(
        &dir.path().join("missing"),
        sink,
        Duration::from_millis(100),
        Duration::from_secs(10),
    )
    .err();
    assert_eq!(err.as_deref(), Some(CANNOT_WATCH));
}

#[test]
fn a_write_noted_through_the_slot_is_not_reported() {
    let dir = TempDir::new();
    let (watcher, rx, _alive) = start(dir.path());
    let slot = WatchSlot::default();
    slot.set(Some(watcher));
    slot.note_self_write("ours.md", b"x");
    fs::write(dir.path().join("ours.md"), b"x").unwrap();
    fs::write(dir.path().join("marker.md"), b"m").unwrap();
    let seen = until_marker(&rx, "marker.md");
    assert!(!seen.contains(&"ours.md".to_owned()));
}

#[test]
fn an_empty_slot_ignores_noted_writes() {
    let slot = WatchSlot::default();
    slot.note_self_write("a.md", b"x");
    assert!(!slot.is_watching());
}

#[test]
fn clearing_the_slot_stops_the_watch() {
    let dir = TempDir::new();
    let (watcher, rx, _alive) = start(dir.path());
    let slot = WatchSlot::default();
    slot.set(Some(watcher));
    assert!(slot.is_watching());
    slot.set(None);
    assert!(!slot.is_watching());
    fs::write(dir.path().join("late.md"), b"x").unwrap();
    let got = rx.recv_timeout(Duration::from_millis(500));
    assert!(matches!(got, Err(RecvTimeoutError::Timeout)));
}

#[test]
fn a_big_self_write_is_not_reported() {
    let dir = TempDir::new();
    let (watcher, rx, _alive) = start(dir.path());
    let bytes = vec![7u8; 9 * 1024 * 1024];
    watcher.note_self_write("big.pdf", &bytes);
    fs::write(dir.path().join("big.pdf"), &bytes).unwrap();
    fs::write(dir.path().join("marker.md"), b"m").unwrap();
    let seen = until_marker(&rx, "marker.md");
    assert!(!seen.contains(&"big.pdf".to_owned()));
}

#[test]
fn our_own_delete_is_not_reported() {
    let dir = TempDir::new();
    fs::write(dir.path().join("gone.md"), b"x").unwrap();
    let (watcher, rx, _alive) = start(dir.path());
    watcher.note_self_remove("gone.md");
    fs::remove_file(dir.path().join("gone.md")).unwrap();
    fs::write(dir.path().join("marker.md"), b"m").unwrap();
    let seen = until_marker(&rx, "marker.md");
    assert!(!seen.contains(&"gone.md".to_owned()));
}

#[test]
fn a_delete_noted_through_the_slot_is_not_reported() {
    let dir = TempDir::new();
    fs::write(dir.path().join("gone.md"), b"x").unwrap();
    let (watcher, rx, _alive) = start(dir.path());
    let slot = WatchSlot::default();
    slot.set(Some(watcher));
    slot.note_self_remove("gone.md");
    fs::remove_file(dir.path().join("gone.md")).unwrap();
    fs::write(dir.path().join("marker.md"), b"m").unwrap();
    let seen = until_marker(&rx, "marker.md");
    assert!(!seen.contains(&"gone.md".to_owned()));
}

#[cfg(unix)]
#[test]
fn a_symlink_to_a_folder_outside_is_not_followed() {
    let dir = TempDir::new();
    let outside = TempDir::new();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
    let (_watcher, rx, _alive) = start(dir.path());
    fs::write(outside.path().join("secret.txt"), b"s").unwrap();
    fs::write(dir.path().join("marker.md"), b"m").unwrap();
    let seen = until_marker(&rx, "marker.md");
    assert!(
        seen.iter().all(|path| !path.starts_with("link/")),
        "{seen:?}"
    );
}

#[test]
fn the_main_window_may_listen_for_vault_changes() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
    let text = fs::read_to_string(path).unwrap();
    let capability: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    let permissions = capability["permissions"].as_array().unwrap();
    assert!(permissions.contains(&serde_json::json!("core:event:default")));
}

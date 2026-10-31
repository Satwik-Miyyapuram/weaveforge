//! Tests for adopting a picked workspace folder: session, remembered folder and watch move together.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use common::TempDir;
use weaveforge_shell::prefs::{PrefValue, Prefs};
use weaveforge_shell::vault::VaultState;
use weaveforge_shell::vault_choice::{
    NOT_REMEMBERED, ROOT_PREF, adopt_choice_with, restore_remembered, watch_root_with,
};
use weaveforge_shell::vault_watcher::{ChangeSink, WatchSlot};

const QUIET: Duration = Duration::from_millis(100);
const WINDOW: Duration = Duration::from_secs(10);

fn sink() -> (ChangeSink, Receiver<Vec<String>>) {
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    let sink: ChangeSink = Arc::new(move |paths: Vec<String>| {
        let _ = tx.send(paths);
    });
    (sink, rx)
}

fn prefs_in(dir: &TempDir) -> Prefs {
    Prefs::new(dir.path().join("preferences.json"))
}

#[test]
fn a_cancelled_pick_with_no_folder_changes_nothing() {
    let tmp = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let slot = WatchSlot::default();
    let (sink, _rx) = sink();

    let choice = adopt_choice_with(&vault, &prefs, &slot, None, sink, QUIET, WINDOW).unwrap();

    assert_eq!(choice.root, None);
    assert!(choice.warnings.is_empty());
    assert_eq!(prefs.read(ROOT_PREF), Ok(None));
    assert!(!slot.is_watching());
}

#[test]
fn a_cancelled_pick_keeps_the_current_folder_and_its_watch() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let slot = WatchSlot::default();
    let (sink1, _rx1) = sink();
    let (sink2, _rx2) = sink();

    let first = adopt_choice_with(
        &vault,
        &prefs,
        &slot,
        Some(folder.path()),
        sink1,
        QUIET,
        WINDOW,
    )
    .unwrap();
    let cancelled = adopt_choice_with(&vault, &prefs, &slot, None, sink2, QUIET, WINDOW).unwrap();

    let first_root = first.root.clone().unwrap();
    assert_eq!(cancelled.root, Some(first_root.clone()));
    assert_eq!(
        prefs.read(ROOT_PREF),
        Ok(Some(PrefValue::Text(first_root.path)))
    );
    assert!(slot.is_watching());
}

#[test]
fn picking_a_folder_remembers_it_and_watches_it() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let slot = WatchSlot::default();
    let (sink, _rx) = sink();

    let choice = adopt_choice_with(
        &vault,
        &prefs,
        &slot,
        Some(folder.path()),
        sink,
        QUIET,
        WINDOW,
    )
    .unwrap();

    let root = choice.root.clone().unwrap();
    assert_eq!(
        prefs.read(ROOT_PREF),
        Ok(Some(PrefValue::Text(root.path.clone())))
    );
    assert!(slot.is_watching());
    assert!(choice.warnings.is_empty());
    assert_eq!(vault.lock().root(), choice.root);
}

#[test]
fn a_refused_pick_changes_nothing() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    let file_dir = TempDir::new();
    let file = file_dir.path().join("x.txt");
    fs::write(&file, "x").unwrap();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let slot = WatchSlot::default();
    let (sink1, _rx1) = sink();
    let (sink2, _rx2) = sink();

    let first = adopt_choice_with(
        &vault,
        &prefs,
        &slot,
        Some(folder.path()),
        sink1,
        QUIET,
        WINDOW,
    )
    .unwrap();
    let first_root = first.root.clone().unwrap();

    let refused = adopt_choice_with(&vault, &prefs, &slot, Some(&file), sink2, QUIET, WINDOW);

    assert!(
        refused.is_err_and(|reason| !reason.is_empty()),
        "a regular file must be refused"
    );
    assert_eq!(vault.lock().root(), Some(first_root.clone()));
    assert_eq!(
        prefs.read(ROOT_PREF),
        Ok(Some(PrefValue::Text(first_root.path)))
    );
    assert!(slot.is_watching());
}

#[test]
fn after_moving_folders_only_the_new_folder_is_watched() {
    let tmp = TempDir::new();
    let folder_a = TempDir::new();
    let folder_b = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let slot = WatchSlot::default();
    // One sink for both watches: a report from the old folder would arrive here too.
    let (sink_a, rx) = sink();
    let sink_b = Arc::clone(&sink_a);

    let a = adopt_choice_with(
        &vault,
        &prefs,
        &slot,
        Some(folder_a.path()),
        sink_a,
        QUIET,
        WINDOW,
    )
    .unwrap()
    .root
    .unwrap();
    let b = adopt_choice_with(
        &vault,
        &prefs,
        &slot,
        Some(folder_b.path()),
        sink_b,
        QUIET,
        WINDOW,
    )
    .unwrap()
    .root
    .unwrap();
    while rx.try_recv().is_ok() {}

    fs::write(std::path::Path::new(&a.path).join("old.md"), "a").unwrap();
    fs::write(std::path::Path::new(&b.path).join("new.md"), "b").unwrap();

    let mut saw_new = false;
    for _ in 0..50 {
        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("no batch arrived");
        assert!(
            !batch.iter().any(|p| p == "old.md"),
            "old folder reported: {batch:?}"
        );
        if batch.iter().any(|p| p == "new.md") {
            saw_new = true;
            break;
        }
    }
    assert!(saw_new, "new folder change never reported");
}

#[test]
fn a_folder_that_cannot_be_remembered_still_works() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    let plain = tmp.path().join("plain");
    fs::write(&plain, "x").unwrap();
    let prefs = Prefs::new(plain.join("preferences.json"));
    let vault = VaultState::new();
    let slot = WatchSlot::default();
    let (sink, _rx) = sink();

    let choice = adopt_choice_with(
        &vault,
        &prefs,
        &slot,
        Some(folder.path()),
        sink,
        QUIET,
        WINDOW,
    )
    .unwrap();

    assert_eq!(choice.warnings, vec![NOT_REMEMBERED.to_owned()]);
    assert!(choice.root.is_some());
    assert!(slot.is_watching());
}

#[test]
fn watching_a_missing_folder_stops_the_old_watch() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    let slot = WatchSlot::default();
    let (sink1, _rx1) = sink();
    let (sink2, _rx2) = sink();

    watch_root_with(&slot, folder.path(), sink1, QUIET, WINDOW).unwrap();
    assert!(slot.is_watching());

    let missing = tmp.path().join("missing");
    let result = watch_root_with(&slot, &missing, sink2, QUIET, WINDOW);

    assert!(result.is_err());
    assert!(!slot.is_watching());
}

/// Waits for a batch naming `name`; false when none arrives in time.
fn reported(rx: &Receiver<Vec<String>>, name: &str) -> bool {
    for _ in 0..50 {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(batch) if batch.iter().any(|p| p == name) => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    false
}

#[test]
fn a_refused_pick_keeps_the_old_folder_reporting() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    let file_dir = TempDir::new();
    let file = file_dir.path().join("x.txt");
    fs::write(&file, "x").unwrap();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let slot = WatchSlot::default();
    let (sink1, _rx1) = sink();
    let (sink2, rx2) = sink();

    let root = adopt_choice_with(
        &vault,
        &prefs,
        &slot,
        Some(folder.path()),
        sink1,
        QUIET,
        WINDOW,
    )
    .unwrap()
    .root
    .unwrap();
    assert!(adopt_choice_with(&vault, &prefs, &slot, Some(&file), sink2, QUIET, WINDOW).is_err());
    while rx2.try_recv().is_ok() {}

    fs::write(Path::new(&root.path).join("still.md"), "s").unwrap();

    assert!(reported(&rx2, "still.md"), "old folder no longer watched");
}

#[test]
fn two_picks_at_once_leave_session_pref_and_watch_on_one_folder() {
    let tmp = TempDir::new();
    let folder_a = TempDir::new();
    let folder_b = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let slot = WatchSlot::default();
    let (sink_a, rx_a) = sink();
    let (sink_b, rx_b) = sink();

    std::thread::scope(|s| {
        let (vault, prefs, slot) = (&vault, &prefs, &slot);
        let a = folder_a.path();
        let b = folder_b.path();
        let _ =
            s.spawn(move || adopt_choice_with(vault, prefs, slot, Some(a), sink_a, QUIET, WINDOW));
        let _ =
            s.spawn(move || adopt_choice_with(vault, prefs, slot, Some(b), sink_b, QUIET, WINDOW));
    });

    let root = vault.lock().root().unwrap();
    assert_eq!(
        prefs.read(ROOT_PREF),
        Ok(Some(PrefValue::Text(root.path.clone())))
    );
    let rx = if Path::new(&root.path).starts_with(folder_a.path()) {
        &rx_a
    } else {
        &rx_b
    };
    while rx.try_recv().is_ok() {}
    fs::write(Path::new(&root.path).join("here.md"), "h").unwrap();
    assert!(
        reported(rx, "here.md"),
        "the watch is not on the session's folder"
    );
}

#[test]
fn restoring_with_nothing_remembered_writes_nothing() {
    let tmp = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);

    assert_eq!(restore_remembered(&vault, &prefs), None);
    assert_eq!(vault.lock().root(), None);
    assert!(!tmp.path().join("preferences.json").exists());
}

#[test]
fn restoring_a_good_folder_adopts_it_and_keeps_the_pref() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let path = folder.path().to_string_lossy().into_owned();
    prefs
        .write(ROOT_PREF, Some(PrefValue::Text(path.clone())))
        .unwrap();

    let root = restore_remembered(&vault, &prefs).unwrap();

    assert_eq!(root.path, path);
    assert_eq!(vault.lock().root(), Some(root));
    assert_eq!(prefs.read(ROOT_PREF), Ok(Some(PrefValue::Text(path))));
}

#[test]
fn restoring_a_missing_folder_keeps_the_pref_for_next_time() {
    let tmp = TempDir::new();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    // An unplugged drive looks like a missing folder; it may be back next start.
    let path = tmp.path().join("unplugged").to_string_lossy().into_owned();
    prefs
        .write(ROOT_PREF, Some(PrefValue::Text(path.clone())))
        .unwrap();

    assert_eq!(restore_remembered(&vault, &prefs), None);
    assert_eq!(vault.lock().root(), None);
    assert_eq!(prefs.read(ROOT_PREF), Ok(Some(PrefValue::Text(path))));
}

#[test]
fn restoring_a_folder_that_is_no_longer_ours_forgets_it() {
    let tmp = TempDir::new();
    let folder = TempDir::new();
    fs::write(folder.path().join("someone-else.txt"), "x").unwrap();
    let vault = VaultState::new();
    let prefs = prefs_in(&tmp);
    let path = folder.path().to_string_lossy().into_owned();
    prefs.write(ROOT_PREF, Some(PrefValue::Text(path))).unwrap();

    assert_eq!(restore_remembered(&vault, &prefs), None);
    assert_eq!(vault.lock().root(), None);
    assert_eq!(prefs.read(ROOT_PREF), Ok(None));
}

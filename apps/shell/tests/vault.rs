#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
mod common;

use std::fs::{self, File, OpenOptions};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::{TempDir, put};
use weaveforge_shell::vault::{
    BAD_ARGUMENT, EntryKindPayload, MAX_BLOB_BYTES, MAX_TEXT_BYTES, NO_ROOT, RootKind, VaultEntry,
    VaultRoot, VaultSession, iso_utc, sweep_temp_files, too_large,
};
use wf_store::root::{RootError, WORKSPACE_SUBDIR};
use wf_store::vault::TEMP_SUFFIX;

const HOUR: Duration = Duration::from_secs(3600);
const SWEEP_AGE: Duration = Duration::from_secs(300);

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Sets a file's modification time an hour into the past.
fn age(path: &Path) {
    let past = SystemTime::now() - HOUR;
    OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(past)
        .unwrap();
}

/// A folder the workspace has already been written to.
fn mark(dir: &Path) {
    fs::create_dir_all(dir.join(".weaveforge")).unwrap();
}

/// A session with `dir` adopted as its (empty) root.
fn session_at(dir: &Path) -> VaultSession {
    let mut session = VaultSession::new();
    let _ = session.adopt(Some(dir)).unwrap();
    session
}

// 1. Constants and too_large
#[test]
fn caps_and_messages_are_the_desktop_values() {
    assert_eq!(MAX_TEXT_BYTES, 8 * 1024 * 1024);
    assert_eq!(MAX_BLOB_BYTES, 80 * 1024 * 1024);
    assert_eq!(
        too_large(MAX_TEXT_BYTES),
        "That file is too large to open here (over 8 MB)."
    );
    assert_eq!(
        too_large(MAX_BLOB_BYTES),
        "That file is too large to open here (over 80 MB)."
    );
    assert_eq!(NO_ROOT, "No workspace folder is chosen yet.");
    assert_eq!(BAD_ARGUMENT, "That is not a path this folder can hold.");
}

// 2. iso_utc
#[test]
fn iso_utc_matches_js_to_iso_string() {
    assert_eq!(iso_utc(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
    assert_eq!(
        iso_utc(UNIX_EPOCH + Duration::from_millis(1_700_000_000_123)),
        "2023-11-14T22:13:20.123Z"
    );
    assert_eq!(
        iso_utc(UNIX_EPOCH + Duration::from_secs(951_782_400)),
        "2000-02-29T00:00:00.000Z"
    );
    assert_eq!(
        iso_utc(UNIX_EPOCH + Duration::from_secs(4_107_542_399)),
        "2100-02-28T23:59:59.000Z"
    );
    assert_eq!(
        iso_utc(UNIX_EPOCH - Duration::from_secs(1)),
        "1970-01-01T00:00:00.000Z"
    );
}

// 3. Fresh session
#[test]
fn fresh_session_has_no_root_and_refuses_every_operation() {
    let session = VaultSession::new();
    assert_eq!(session.root(), None);
    assert_eq!(session.read_text("a.md"), Err(NO_ROOT.to_owned()));
    assert_eq!(session.read_bytes("a.md"), Err(NO_ROOT.to_owned()));
    assert_eq!(session.write_text("a.md", "x"), Err(NO_ROOT.to_owned()));
    assert_eq!(session.write_bytes("a.md", b"x"), Err(NO_ROOT.to_owned()));
    assert_eq!(session.list(None), Err(NO_ROOT.to_owned()));
    assert_eq!(session.stat("a.md"), Err(NO_ROOT.to_owned()));
    assert_eq!(session.remove("a.md"), Err(NO_ROOT.to_owned()));
}

// 4. Cancelled dialogs
#[test]
fn cancelled_dialogs_leave_the_session_unchanged() {
    let dir = TempDir::new();
    let mut session = VaultSession::new();
    assert_eq!(session.choose(None), Ok(None));
    assert_eq!(session.adopt(None), Ok(None));

    let root = session.adopt(Some(dir.path())).unwrap();
    assert!(root.is_some());
    assert_eq!(session.choose(None), Ok(root.clone()));
    assert_eq!(session.adopt(None), Ok(root));
}

// 5. Adopting an empty folder
#[test]
fn adopting_an_empty_folder_uses_exactly_that_folder() {
    let dir = TempDir::new();
    let mut session = VaultSession::new();
    let root = session.adopt(Some(dir.path())).unwrap();
    let expected = VaultRoot {
        path: text(dir.path()),
        state: RootKind::Empty,
    };
    assert_eq!(root, Some(expected.clone()));
    assert_eq!(session.root(), Some(expected));
}

// 6. Choosing a folder that already has someone's files
#[test]
fn choosing_a_foreign_folder_nests_the_workspace() {
    let dir = TempDir::new();
    put(&dir.path().join("taxes.pdf"), b"their bytes");
    let mut session = VaultSession::new();

    let root = session.choose(Some(dir.path())).unwrap();

    let expected = VaultRoot {
        path: text(&dir.path().join(WORKSPACE_SUBDIR)),
        state: RootKind::Empty,
    };
    assert_eq!(root, Some(expected.clone()));
    assert_eq!(session.root(), Some(expected));
    assert_eq!(
        fs::read(dir.path().join("taxes.pdf")).unwrap(),
        b"their bytes"
    );
}

// 7. Adopting a file
#[test]
fn adopting_a_file_is_refused_and_leaves_the_session_alone() {
    let kept = TempDir::new();
    let dir = TempDir::new();
    let file = dir.path().join("note.txt");
    put(&file, b"x");
    let mut session = VaultSession::new();
    let before = session.adopt(Some(kept.path())).unwrap();

    assert_eq!(
        session.adopt(Some(&file)),
        Err(RootError::NotAFolder.to_string())
    );
    assert_eq!(session.root(), before);
}

// 8. Restoring a remembered folder
#[test]
fn restore_refuses_nothing_and_keeps_the_earlier_root_on_failure() {
    let kept = TempDir::new();
    let mut session = VaultSession::new();
    let root = session.adopt(Some(kept.path())).unwrap();

    assert_eq!(session.restore(None), None);
    assert_eq!(session.restore(Some("")), None);
    let gone = text(&kept.path().join("gone"));
    assert_eq!(session.restore(Some(gone.as_str())), None);
    assert_eq!(session.root(), root);

    let mut fresh = VaultSession::new();
    let kept_text = text(kept.path());
    assert_eq!(fresh.restore(Some(kept_text.as_str())), root);
}

// 9. Text round trip
#[test]
fn text_round_trips_through_nested_folders() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    let body = "héllo — ünïcode 日本語\n";

    session.write_text("notes/deep/a.md", body).unwrap();

    assert_eq!(
        session.read_text("notes/deep/a.md"),
        Ok(Some(body.to_owned()))
    );
    assert_eq!(
        fs::read(dir.path().join("notes/deep/a.md")).unwrap(),
        body.as_bytes()
    );
}

// 10. Missing files read as None
#[test]
fn reading_a_missing_file_is_none() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    assert_eq!(session.read_text("missing.md"), Ok(None));
    assert_eq!(session.read_bytes("missing.md"), Ok(None));
}

// 11. Text read cap boundary
#[test]
fn text_read_cap_is_inclusive_at_the_limit() {
    let dir = TempDir::new();
    let session = session_at(dir.path());

    File::create(dir.path().join("at.md"))
        .unwrap()
        .set_len(MAX_TEXT_BYTES)
        .unwrap();
    let read = session.read_text("at.md").unwrap().unwrap();
    assert_eq!(read.len(), usize::try_from(MAX_TEXT_BYTES).unwrap());

    File::create(dir.path().join("over.md"))
        .unwrap()
        .set_len(MAX_TEXT_BYTES + 1)
        .unwrap();
    assert_eq!(session.read_text("over.md"), Err(too_large(MAX_TEXT_BYTES)));
}

// 12. Text write cap
#[test]
fn text_write_over_the_cap_is_refused_before_anything_lands() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    let big = "a".repeat(usize::try_from(MAX_TEXT_BYTES + 1).unwrap());

    assert_eq!(
        session.write_text("big.md", &big),
        Err(too_large(MAX_TEXT_BYTES))
    );
    assert!(!dir.path().join("big.md").exists());
}

// 13. Bytes round trip and blob cap
#[test]
fn bytes_round_trip_and_the_blob_cap_is_enforced_on_read() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    let bytes = [0u8, 1, 2, 255];

    session.write_bytes("img/a.pdf", &bytes).unwrap();
    assert_eq!(session.read_bytes("img/a.pdf"), Ok(Some(bytes.to_vec())));

    File::create(dir.path().join("blob.pdf"))
        .unwrap()
        .set_len(MAX_BLOB_BYTES + 1)
        .unwrap();
    assert_eq!(
        session.read_bytes("blob.pdf"),
        Err(too_large(MAX_BLOB_BYTES))
    );
}

// 14. Escapes are refused and touch nothing
#[test]
fn escaping_paths_are_refused_for_every_operation_and_touch_nothing() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    let name = format!("wf-vault-escape-{}.txt", std::process::id());
    let outside = dir.path().parent().unwrap().join(&name);
    put(&outside, b"outside");
    let escapes = [
        format!("../{name}"),
        format!("a/../../{name}"),
        text(&outside),
    ];

    for rel in &escapes {
        assert!(session.read_text(rel).is_err(), "read {rel}");
        assert!(session.read_bytes(rel).is_err(), "read bytes {rel}");
        assert!(session.write_text(rel, "pwned").is_err(), "write {rel}");
        assert!(
            session.write_bytes(rel, b"pwned").is_err(),
            "write bytes {rel}"
        );
        assert!(session.remove(rel).is_err(), "remove {rel}");
    }

    assert_eq!(fs::read(&outside).unwrap(), b"outside");
    fs::remove_file(&outside).unwrap();
}

// 15. Listing
#[test]
fn list_is_sorted_hides_temp_files_and_lists_a_subfolder() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    put(&dir.path().join("b.md"), b"bb");
    put(&dir.path().join("a.md"), b"aaa");
    put(&dir.path().join("sub/c.md"), b"c");
    put(
        &dir.path().join(format!("x.md.1.0{TEMP_SUFFIX}")),
        b"hidden",
    );

    let listed = session.list(None).unwrap();

    let paths: Vec<&str> = listed.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(paths, ["a.md", "b.md", "sub"]);
    assert_eq!(listed[0].kind, EntryKindPayload::File);
    assert_eq!(listed[0].size, 3);
    assert_eq!(listed[2].kind, EntryKindPayload::Dir);
    for entry in &listed {
        assert_eq!(entry.modified_at.len(), 24);
        assert!(entry.modified_at.ends_with('Z'));
    }

    let sub = session.list(Some("sub")).unwrap();
    assert_eq!(sub.len(), 1);
    assert_eq!(sub[0].path, "sub/c.md");
}

// 16. Stat
#[test]
fn stat_reports_files_folders_and_missing_paths() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    put(&dir.path().join("n.md"), b"hello");
    fs::create_dir_all(dir.path().join("d")).unwrap();

    let file = session.stat("n.md").unwrap().unwrap();
    assert_eq!(file.kind, EntryKindPayload::File);
    assert_eq!(file.size, 5);
    assert_eq!(
        session.stat("d").unwrap().unwrap().kind,
        EntryKindPayload::Dir
    );
    assert_eq!(session.stat("missing.md"), Ok(None));
}

// 17. Remove
#[test]
fn remove_deletes_files_ignores_missing_and_never_recurses() {
    let dir = TempDir::new();
    let session = session_at(dir.path());
    put(&dir.path().join("gone.md"), b"x");
    put(&dir.path().join("d/inner.md"), b"x");

    session.remove("gone.md").unwrap();
    assert!(!dir.path().join("gone.md").exists());
    assert_eq!(session.remove("missing.md"), Ok(()));

    assert!(session.remove("d").is_err());
    assert!(dir.path().join("d/inner.md").exists());
}

// 18. Serialization shape
#[test]
fn payloads_serialize_with_the_keys_the_page_reads() {
    let entry = VaultEntry {
        path: "a.md".to_owned(),
        kind: EntryKindPayload::File,
        size: 3,
        modified_at: "2026-10-30T12:34:56.789Z".to_owned(),
    };
    let json = serde_json::to_value(&entry).unwrap();
    let mut keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["kind", "modifiedAt", "path", "size"]);
    assert_eq!(json["kind"], "file");
    assert_eq!(json["size"], 3);
    assert_eq!(json["modifiedAt"], "2026-10-30T12:34:56.789Z");

    let root = serde_json::to_value(VaultRoot {
        path: "/w".to_owned(),
        state: RootKind::Empty,
    })
    .unwrap();
    assert_eq!(root["state"], "empty");
    assert_eq!(serde_json::to_value(EntryKindPayload::Dir).unwrap(), "dir");
}

// 19. Temp sweep
#[test]
fn sweep_removes_old_temp_files_at_the_root_and_three_folders_down() {
    let dir = TempDir::new();
    let root = dir.path();
    let top = root.join(format!("a.md.123.0{TEMP_SUFFIX}"));
    let deep = root.join(format!("p/q/r/deep.md.9.1{TEMP_SUFFIX}"));
    put(&top, b"x");
    put(&deep, b"x");
    age(&top);
    age(&deep);

    assert_eq!(sweep_temp_files(root, SWEEP_AGE), 2);
    assert!(!top.exists());
    assert!(!deep.exists());
}

#[test]
fn sweep_keeps_fresh_temp_files() {
    let dir = TempDir::new();
    let fresh = dir.path().join(format!("a.md.1.0{TEMP_SUFFIX}"));
    put(&fresh, b"x");

    assert_eq!(sweep_temp_files(dir.path(), SWEEP_AGE), 0);
    assert!(fresh.exists());
}

#[test]
fn sweep_keeps_old_ordinary_files_and_folders_named_like_temp_files() {
    let dir = TempDir::new();
    let notes = dir.path().join("notes.md");
    put(&notes, b"x");
    age(&notes);
    let folder = dir.path().join(format!("x{TEMP_SUFFIX}"));
    fs::create_dir_all(&folder).unwrap();

    assert_eq!(sweep_temp_files(dir.path(), SWEEP_AGE), 0);
    assert!(notes.exists());
    assert!(folder.is_dir());
}

// 20. Adopt sweeps
#[test]
fn adopt_sweeps_old_temp_files_and_keeps_fresh_ones() {
    let dir = TempDir::new();
    mark(dir.path());
    let old = dir.path().join(format!("a.md.1.0{TEMP_SUFFIX}"));
    let fresh = dir.path().join(format!("b.md.2.0{TEMP_SUFFIX}"));
    put(&old, b"x");
    age(&old);
    put(&fresh, b"x");

    let mut session = VaultSession::new();
    assert!(session.adopt(Some(dir.path())).unwrap().is_some());

    assert!(!old.exists());
    assert!(fresh.exists());
}

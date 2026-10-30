//! Integration tests for `wf_store::vault`: root confinement, atomic writes and file ops on a real folder.

use std::fs;
use std::time::{Duration, SystemTime};

#[cfg(test)]
mod common;

use common::{TempDir, make_dir_link, put};
use support::{names, temp_file_left, vault_in};
use wf_store::vault::{EntryKind, TEMP_SUFFIX, Vault, VaultError, WALK_DEPTH_MAX};

/// Helpers live here so `cfg(test)` covers their unwraps, which clippy would otherwise flag.
#[cfg(test)]
mod support {
    use std::fs;
    use std::path::Path;

    use wf_store::vault::{Entry, TEMP_SUFFIX, Vault};

    use crate::common::TempDir;

    pub fn vault_in(dir: &TempDir) -> Vault {
        Vault::new(dir.path().to_path_buf())
    }

    pub fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.path.as_str()).collect()
    }

    /// True when any file under `dir` still carries the temp suffix.
    pub fn temp_file_left(dir: &Path) -> bool {
        fs::read_dir(dir).unwrap().any(|entry| {
            let path = entry.unwrap().path();
            if path.is_dir() {
                temp_file_left(&path)
            } else {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().ends_with(TEMP_SUFFIX))
            }
        })
    }
}

// Ported: vault-folder.test.ts "a file written is a file read back"
#[test]
fn write_then_read_creates_parent_folders() {
    let dir = TempDir::new();
    let v = vault_in(&dir);
    v.write_file("notes/method.note.md", b"Body.").unwrap();
    assert_eq!(v.read_text("notes/method.note.md").unwrap(), "Body.");
    assert!(dir.path().join("notes").is_dir());
}

#[test]
fn overwrite_replaces_the_whole_file() {
    let dir = TempDir::new();
    let v = vault_in(&dir);
    v.write_file("a.md", b"a much longer first body").unwrap();
    v.write_file("a.md", b"short").unwrap();
    assert_eq!(v.read_text("a.md").unwrap(), "short");
}

// Ported: vault-folder.test.ts "bytes go through the byte channel unchanged"
#[test]
fn bytes_round_trip_and_text_is_lossy() {
    let dir = TempDir::new();
    let v = vault_in(&dir);
    let bytes = [0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x80, 0x00];
    v.write_file("blob.bin", &bytes).unwrap();
    assert_eq!(v.read_file("blob.bin").unwrap(), bytes.to_vec());
    assert!(v.read_text("blob.bin").unwrap().contains('\u{FFFD}'));
}

// Ported: vault-folder.test.ts "a path leaving the root is refused before it reaches disk"
#[test]
fn unsafe_paths_are_refused_by_every_op() {
    let dir = TempDir::new();
    let v = vault_in(&dir);
    let unsafe_paths = [
        "../escaped.md",
        "/etc/passwd",
        "C:/x",
        "..\\escaped.md",
        "a/../../x",
    ];
    for rel in unsafe_paths {
        assert!(
            matches!(v.write_file(rel, b"x"), Err(VaultError::UnsafePath(_))),
            "write {rel}"
        );
        assert!(
            matches!(v.read_file(rel), Err(VaultError::UnsafePath(_))),
            "read {rel}"
        );
        assert!(
            matches!(v.remove(rel, false), Err(VaultError::UnsafePath(_))),
            "remove {rel}"
        );
        assert!(
            matches!(v.mkdirp(rel), Err(VaultError::UnsafePath(_))),
            "mkdirp {rel}"
        );
        assert!(
            matches!(v.rename(rel, "ok.md"), Err(VaultError::UnsafePath(_))),
            "rename from {rel}"
        );
        assert!(
            matches!(v.rename("ok.md", rel), Err(VaultError::UnsafePath(_))),
            "rename to {rel}"
        );
    }
    assert!(!dir.path().parent().unwrap().join("escaped.md").exists());
}

// Ported: vault-folder.test.ts "a symlink out of the folder is refused too"
#[test]
fn a_link_out_of_the_root_is_an_escape() {
    let dir = TempDir::new();
    let outside = TempDir::new();
    let link = dir.path().join("away");
    if !make_dir_link(&link, outside.path()) {
        eprintln!("skipped: this machine cannot create a directory link");
        return;
    }
    let v = vault_in(&dir);
    assert!(matches!(
        v.write_file("away/escaped.md", b"x"),
        Err(VaultError::Escape(_))
    ));
    assert!(matches!(
        v.write_file("away/new/deeper/escaped.md", b"x"),
        Err(VaultError::Escape(_))
    ));
    assert!(outside.path().read_dir().unwrap().next().is_none());
    assert!(matches!(v.read_file("away/x"), Err(VaultError::Escape(_))));
    assert!(v.stat("away").is_none());
    assert!(!names(&v.list("").unwrap()).contains(&"away"));
}

#[test]
fn a_link_inside_the_root_to_another_inside_folder_is_allowed() {
    let dir = TempDir::new();
    fs::create_dir_all(dir.path().join("notes")).unwrap();
    if !make_dir_link(&dir.path().join("alias"), &dir.path().join("notes")) {
        eprintln!("skipped: this machine cannot create a directory link");
        return;
    }
    let v = vault_in(&dir);
    v.write_file("alias/x.md", b"hi").unwrap();
    assert_eq!(v.read_text("notes/x.md").unwrap(), "hi");
}

// Ported: vault-folder.test.ts "listing gives one level, walking gives every file"
#[test]
fn list_is_one_level_and_walk_is_recursive_and_sorted() {
    let dir = TempDir::new();
    put(&dir.path().join("notes/a.note.md"), b"a");
    put(&dir.path().join("notes/deep/b.note.md"), b"b");
    let v = vault_in(&dir);

    assert_eq!(names(&v.list("").unwrap()), ["notes"]);
    assert_eq!(v.list(".").unwrap(), v.list("").unwrap());
    assert_eq!(
        names(&v.walk("").unwrap()),
        ["notes/a.note.md", "notes/deep/b.note.md"]
    );

    let notes = v.list("notes").unwrap();
    assert_eq!(names(&notes), ["notes/a.note.md", "notes/deep"]);
    let kinds: Vec<EntryKind> = notes.iter().map(|entry| entry.kind).collect();
    assert_eq!(kinds, [EntryKind::File, EntryKind::Dir]);
}

#[test]
fn missing_folder_lists_empty_and_a_file_is_an_error() {
    let dir = TempDir::new();
    put(&dir.path().join("notes/a.note.md"), b"a");
    let v = vault_in(&dir);

    assert!(v.list("nope").unwrap().is_empty());
    assert!(v.walk("nope").unwrap().is_empty());
    assert!(v.list("notes/a.note.md").is_err());
}

// Ported: vault-folder.test.ts "an unreadable folder is an error, not an empty one (38-10)"
// Ported: vault-folder.test.ts "an unreadable subfolder does not stop the walk (38-10)"
#[cfg(unix)]
#[test]
fn an_unreadable_folder_is_skipped_by_walk_and_refused_by_list() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new();
    put(&dir.path().join("notes/a.note.md"), b"a");
    put(&dir.path().join("notes/open/c.note.md"), b"c");
    put(&dir.path().join("notes/locked/secret.note.md"), b"s");
    let locked = dir.path().join("notes/locked");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::read_dir(&locked).is_ok() {
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        eprintln!("skipped: running with read access to a 0o000 folder");
        return;
    }
    let v = vault_in(&dir);
    let listed = v.list("notes/locked");
    let walked = v.walk("");
    let walked_locked = v.walk("notes/locked");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();

    assert_eq!(
        listed.unwrap_err().io_kind(),
        Some(std::io::ErrorKind::PermissionDenied)
    );
    assert_eq!(
        names(&walked.unwrap()),
        ["notes/a.note.md", "notes/open/c.note.md"]
    );
    assert!(walked_locked.is_err());
}

#[test]
fn stray_temp_files_are_hidden_and_none_survive_writes() {
    let dir = TempDir::new();
    put(&dir.path().join("a.md.1.2.wftmp"), b"stray");
    put(&dir.path().join("notes/a.md.1.2.wftmp"), b"stray");
    let v = vault_in(&dir);

    assert!(!names(&v.list("").unwrap()).contains(&"a.md.1.2.wftmp"));
    assert!(!names(&v.list("notes").unwrap()).contains(&"notes/a.md.1.2.wftmp"));
    assert!(
        !names(&v.walk("").unwrap())
            .iter()
            .any(|p| p.ends_with(TEMP_SUFFIX))
    );
    fs::remove_file(dir.path().join("a.md.1.2.wftmp")).unwrap();
    fs::remove_file(dir.path().join("notes/a.md.1.2.wftmp")).unwrap();

    let bodies: [&[u8]; 3] = [b"1", b"22", b"333"];
    for body in bodies {
        v.write_file("notes/a.md", body).unwrap();
        v.write_file("b.md", body).unwrap();
    }
    assert!(!temp_file_left(dir.path()));
}

#[test]
fn a_failed_write_cleans_up_its_temp_file() {
    let dir = TempDir::new();
    put(&dir.path().join("d/inside.txt"), b"keep");
    let v = vault_in(&dir);

    assert!(v.write_file("d", b"x").is_err());
    assert!(dir.path().join("d").is_dir());
    assert_eq!(fs::read(dir.path().join("d/inside.txt")).unwrap(), b"keep");
    assert!(!temp_file_left(dir.path()));
}

// Ported: vault-folder.test.ts "stat answers null for what is not there"
#[test]
fn stat_reports_files_folders_and_refusals() {
    let dir = TempDir::new();
    let v = vault_in(&dir);
    assert!(v.stat("missing.md").is_none());

    v.write_file("a.md", b"hello").unwrap();
    let file = v.stat("./a.md").unwrap();
    assert_eq!(file.path, "a.md");
    assert_eq!(file.size, 5);
    assert_eq!(file.kind, EntryKind::File);
    let age = SystemTime::now()
        .duration_since(file.modified)
        .unwrap_or_else(|err| err.duration());
    assert!(age < Duration::from_secs(60), "age: {age:?}");

    v.mkdirp("folder").unwrap();
    assert_eq!(v.stat("folder").unwrap().kind, EntryKind::Dir);
    assert!(v.stat("../x").is_none());
}

#[test]
fn remove_handles_files_missing_and_folders() {
    let dir = TempDir::new();
    let v = vault_in(&dir);

    v.write_file("a.md", b"x").unwrap();
    v.remove("a.md", false).unwrap();
    assert_eq!(
        v.read_file("a.md").unwrap_err().io_kind(),
        Some(std::io::ErrorKind::NotFound)
    );
    v.remove("gone.md", false).unwrap();
    v.remove("gone", true).unwrap();

    v.write_file("notes/a.md", b"x").unwrap();
    assert!(v.remove("notes", false).is_err());
    assert_eq!(fs::read(dir.path().join("notes/a.md")).unwrap(), b"x");

    v.remove("notes", true).unwrap();
    assert!(!dir.path().join("notes").exists());
}

#[test]
fn mkdirp_creates_nested_folders_and_is_repeatable() {
    let dir = TempDir::new();
    let v = vault_in(&dir);
    v.mkdirp("a/b/c").unwrap();
    assert!(dir.path().join("a/b/c").is_dir());
    v.mkdirp("a/b/c").unwrap();
}

#[test]
fn rename_moves_creates_parents_and_replaces_targets() {
    let dir = TempDir::new();
    let v = vault_in(&dir);

    v.write_file("a.md", b"keep me").unwrap();
    v.rename("a.md", "x/y/b.md").unwrap();
    assert!(!dir.path().join("a.md").exists());
    assert_eq!(v.read_text("x/y/b.md").unwrap(), "keep me");

    v.write_file("p.md", b"old").unwrap();
    v.write_file("q.md", b"new").unwrap();
    v.rename("q.md", "p.md").unwrap();
    assert_eq!(v.read_text("p.md").unwrap(), "new");

    assert_eq!(
        v.rename("nope.md", "z.md").unwrap_err().io_kind(),
        Some(std::io::ErrorKind::NotFound)
    );

    v.write_file("src.md", b"s").unwrap();
    assert!(matches!(
        v.rename("src.md", "../out.md"),
        Err(VaultError::UnsafePath(_))
    ));
    assert!(dir.path().join("src.md").exists());
}

#[test]
fn a_root_that_is_a_file_fails_without_panicking() {
    let dir = TempDir::new();
    let file = dir.path().join("root.txt");
    fs::write(&file, b"x").unwrap();
    let v = Vault::new(file);

    assert!(matches!(
        v.write_file("a.md", b"x"),
        Err(VaultError::Io { .. })
    ));
    assert!(v.read_file("a.md").is_err());
    assert!(matches!(v.list(""), Err(VaultError::Io { .. })));
}

#[test]
fn vault_error_texts_match_the_desktop_app() {
    let unsafe_err = VaultError::UnsafePath("../x".to_owned());
    assert_eq!(unsafe_err.to_string(), "Unsafe workspace path: ../x");
    assert_eq!(unsafe_err.io_kind(), None);
    assert_eq!(
        VaultError::Escape("away/x".to_owned()).to_string(),
        "Path escapes the workspace folder: away/x"
    );
}

#[test]
fn walk_visits_each_folder_once_even_through_links_back_to_the_root() {
    let dir = TempDir::new();
    put(&dir.path().join("a.md"), b"a");
    put(&dir.path().join("sub/b.md"), b"b");
    // Two links to the root and one from a subfolder: without a visited set the walk is
    // exponential, and the sub/loop link alone never ends.
    let linked = make_dir_link(&dir.path().join("self"), dir.path())
        && make_dir_link(&dir.path().join("twin"), dir.path())
        && make_dir_link(&dir.path().join("sub").join("loop"), dir.path());
    if !linked {
        eprintln!("skipped: this machine cannot create a directory link");
        return;
    }
    let v = vault_in(&dir);
    assert_eq!(names(&v.walk("").unwrap()), ["a.md", "sub/b.md"]);
    // From `sub`, the root is new ground: its file is listed once, under the link's name.
    assert_eq!(
        names(&v.walk("sub").unwrap()),
        ["sub/b.md", "sub/loop/a.md"]
    );
}

#[test]
fn walk_stops_descending_below_the_depth_bound() {
    let dir = TempDir::new();
    let mut rel = String::new();
    for _ in 0..=WALK_DEPTH_MAX {
        rel.push_str("d/");
        put(&dir.path().join(&rel).join("f.md"), b"f");
    }
    let walked = vault_in(&dir).walk("").unwrap();
    // One file in each folder at depth 1..=WALK_DEPTH_MAX; the one below that is not reached.
    assert_eq!(walked.len(), WALK_DEPTH_MAX);
    let paths = names(&walked);
    let deepest = format!("{}f.md", "d/".repeat(WALK_DEPTH_MAX));
    let too_deep = format!("{}f.md", "d/".repeat(WALK_DEPTH_MAX + 1));
    assert!(
        paths.contains(&deepest.as_str()),
        "deepest allowed file missing"
    );
    assert!(
        !paths.contains(&too_deep.as_str()),
        "file below the bound was walked"
    );
}

// Ported: TextDecoder drops a leading byte order mark (vault-folder.ts readText).
#[test]
fn read_text_drops_only_a_leading_byte_order_mark() {
    let dir = TempDir::new();
    let v = vault_in(&dir);
    put(
        &dir.path().join("bom.md"),
        "\u{FEFF}# Title\u{FEFF}".as_bytes(),
    );
    assert_eq!(v.read_text("bom.md").unwrap(), "# Title\u{FEFF}");
    assert_eq!(v.read_file("bom.md").unwrap()[..3], [0xEF, 0xBB, 0xBF]);
    put(&dir.path().join("plain.md"), b"no mark");
    assert_eq!(v.read_text("plain.md").unwrap(), "no mark");
    put(&dir.path().join("empty.md"), b"");
    assert_eq!(v.read_text("empty.md").unwrap(), "");
}

#[test]
fn removing_a_link_to_a_folder_removes_the_link_not_the_folder() {
    let dir = TempDir::new();
    put(&dir.path().join("real/x.md"), b"x");
    if !make_dir_link(&dir.path().join("alias"), &dir.path().join("real")) {
        eprintln!("skipped: this machine cannot create a directory link");
        return;
    }
    let v = vault_in(&dir);
    v.remove("alias", false).unwrap();
    assert!(fs::symlink_metadata(dir.path().join("alias")).is_err());
    assert_eq!(fs::read(dir.path().join("real/x.md")).unwrap(), b"x");
}

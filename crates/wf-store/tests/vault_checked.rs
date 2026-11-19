//! Integration tests for `wf_store::checked_write`: checked writes, trash, rename and temp sweeps.

use std::fs;
use std::time::Duration;

#[cfg(test)]
mod common;

use common::{TempDir, put};
use support::{at, names_containing, vault_in};
use wf_core::sync::frontmatter::{bytes_digest, canonical_digest};
use wf_store::checked_write::{MergeWrite, PREV_SUFFIX, WriteOutcome};

/// Helpers live here so `cfg(test)` covers their unwraps, which clippy would otherwise flag.
#[cfg(test)]
mod support {
    use std::fs;
    use std::path::{Path, PathBuf};

    use wf_store::vault::Vault;

    use crate::common::TempDir;

    pub fn vault_in(dir: &TempDir) -> Vault {
        Vault::new(dir.path().to_path_buf())
    }

    pub fn at(dir: &TempDir, rel: &str) -> PathBuf {
        dir.path().join(rel)
    }

    /// Sorted names of the files directly in `dir` whose name contains `needle`.
    pub fn names_containing(dir: &Path, needle: &str) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(needle))
            .collect();
        names.sort();
        names
    }
}

#[test]
fn file_write_checked_returns_new_hash() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let WriteOutcome::Written { hash: first } =
        vault.write_text_checked("a.md", "a", None).unwrap()
    else {
        panic!("first write should succeed");
    };
    let second = vault
        .write_text_checked("a.md", "b\r\n", Some(first.as_str()))
        .unwrap();
    assert_eq!(
        second,
        WriteOutcome::Written {
            hash: canonical_digest("b\n")
        }
    );
    assert_eq!(fs::read(at(&dir, "a.md")).unwrap(), b"b\n");
}

#[test]
fn file_write_checked_changed() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let _ = vault.write_text_checked("a.md", "a", None).unwrap();
    let stale = canonical_digest("zzz");
    let outcome = vault
        .write_text_checked("a.md", "c", Some(stale.as_str()))
        .unwrap();
    assert_eq!(
        outcome,
        WriteOutcome::Changed {
            disk_hash: canonical_digest("a")
        }
    );
    assert_eq!(fs::read_to_string(at(&dir, "a.md")).unwrap(), "a");

    let missing = vault
        .write_text_checked("new.md", "x", Some(stale.as_str()))
        .unwrap();
    assert_eq!(
        missing,
        WriteOutcome::Changed {
            disk_hash: String::new()
        }
    );
    assert!(!at(&dir, "new.md").exists());
}

#[test]
fn write_expecting_absent_creates_only_when_still_absent() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let created = vault.write_text_checked("new.md", "x", Some("")).unwrap();
    assert_eq!(
        created,
        WriteOutcome::Written {
            hash: canonical_digest("x")
        }
    );
    assert_eq!(fs::read_to_string(at(&dir, "new.md")).unwrap(), "x");

    // A file that appeared after the caller saw it missing is never overwritten.
    put(&at(&dir, "race.md"), b"DISK");
    let lost = vault
        .write_text_checked("race.md", "mine", Some(""))
        .unwrap();
    assert_eq!(
        lost,
        WriteOutcome::Changed {
            disk_hash: canonical_digest("DISK")
        }
    );
    assert_eq!(fs::read_to_string(at(&dir, "race.md")).unwrap(), "DISK");
}

#[test]
fn create_only_write_never_replaces_a_file_that_appears_in_the_window() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let path = at(&dir, "late.md");
    // The file is missing at check time and appears between the temp write and the swap.
    let outcome = vault
        .write_checked_with_hook("late.md", b"mine", true, Some(""), &mut || {
            fs::write(&path, "DISK").unwrap();
        })
        .unwrap();
    assert_eq!(
        outcome,
        WriteOutcome::Changed {
            disk_hash: canonical_digest("DISK")
        }
    );
    assert_eq!(fs::read_to_string(at(&dir, "late.md")).unwrap(), "DISK");
    // Nothing else is left behind: no temp, no `.wfprev`, no conflict copy.
    assert_eq!(names_containing(dir.path(), ""), vec!["late.md".to_owned()]);
}

#[test]
fn file_write_bytes_checked_changed() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let _ = vault
        .write_bytes_checked("b.bin", &[0, 1, 2], None)
        .unwrap();
    let outcome = vault
        .write_bytes_checked("b.bin", &[9], Some("stale"))
        .unwrap();
    assert_eq!(
        outcome,
        WriteOutcome::Changed {
            disk_hash: bytes_digest(&[0, 1, 2])
        }
    );
    assert_eq!(fs::read(at(&dir, "b.bin")).unwrap(), [0, 1, 2]);
}

#[test]
fn file_write_rename_window_displaced_copy() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let WriteOutcome::Written { hash: h1 } = vault.write_text_checked("v.md", "v1", None).unwrap()
    else {
        panic!("first write should succeed");
    };
    let path = at(&dir, "v.md");
    let outcome = vault
        .write_checked_with_hook("v.md", b"v3", true, Some(h1.as_str()), &mut || {
            fs::write(&path, "v2 from other").unwrap();
        })
        .unwrap();
    assert!(matches!(outcome, WriteOutcome::Written { .. }));
    assert_eq!(fs::read_to_string(at(&dir, "v.md")).unwrap(), "v3");
    let copies = names_containing(dir.path(), ".conflict-");
    assert_eq!(copies.len(), 1);
    assert_eq!(
        fs::read_to_string(at(&dir, &copies[0])).unwrap(),
        "v2 from other"
    );
    assert!(names_containing(dir.path(), PREV_SUFFIX).is_empty());
}

#[test]
fn no_conflict_copy_when_nothing_displaced() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let WriteOutcome::Written { hash } = vault.write_text_checked("a.md", "one", None).unwrap()
    else {
        panic!("first write should succeed");
    };
    let _ = vault
        .write_text_checked("a.md", "two", Some(hash.as_str()))
        .unwrap();
    assert!(names_containing(dir.path(), ".conflict-").is_empty());
    assert!(names_containing(dir.path(), PREV_SUFFIX).is_empty());
}

#[test]
fn file_delete_moves_to_trash() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "p/a.md"), b"old");
    let trashed = vault.delete_to_trash("p/a.md").unwrap();
    assert!(!at(&dir, "p/a.md").exists());
    assert!(trashed.starts_with(".weaveforge/trash/"));
    assert!(trashed.ends_with("/p/a.md"));
    assert_eq!(fs::read(at(&dir, &trashed)).unwrap(), b"old");
}

#[test]
fn trash_name_clash_gets_suffix() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "p/a.md"), b"one");
    let first = vault.delete_to_trash("p/a.md").unwrap();
    put(&at(&dir, "p/a.md"), b"two");
    let second = vault.delete_to_trash("p/a.md").unwrap();
    assert_eq!(fs::read(at(&dir, &first)).unwrap(), b"one");
    assert_eq!(fs::read(at(&dir, &second)).unwrap(), b"two");
    assert!(second.ends_with("p/a-2.md"));
}

#[test]
fn rename_keeps_displaced_target() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "a.md"), b"A");
    put(&at(&dir, "b.md"), b"B");
    let aside = vault.rename_checked("a.md", "b.md").unwrap();
    assert_eq!(fs::read_to_string(at(&dir, "b.md")).unwrap(), "A");
    assert!(!at(&dir, "a.md").exists());
    let copies = names_containing(dir.path(), ".conflict-");
    assert_eq!(copies.len(), 1);
    assert_eq!(fs::read_to_string(at(&dir, &copies[0])).unwrap(), "B");
    assert_eq!(aside.as_deref(), Some(copies[0].as_str()));
}

#[test]
fn rename_into_a_free_name_reports_no_conflict_copy() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "a.md"), b"A");
    assert_eq!(vault.rename_checked("a.md", "b.md").unwrap(), None);
    assert_eq!(fs::read_to_string(at(&dir, "b.md")).unwrap(), "A");
}

#[test]
fn case_only_rename_keeps_the_file_and_makes_no_copy() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "A.md"), b"A");
    assert_eq!(vault.rename_checked("A.md", "a.md").unwrap(), None);
    assert_eq!(fs::read_to_string(at(&dir, "a.md")).unwrap(), "A");
    assert!(names_containing(dir.path(), ".conflict-").is_empty());
}

#[test]
fn sweep_removes_old_temps_only() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "x.md.1.2.wftmp"), b"t");
    put(&at(&dir, "y.md.wfprev"), b"p");
    put(&at(&dir, "keep.md"), b"k");
    assert_eq!(vault.sweep_stale_temps(Duration::ZERO).unwrap(), 1);
    assert!(!at(&dir, "x.md.1.2.wftmp").exists());
    assert!(at(&dir, "keep.md").exists());
    assert!(at(&dir, "y.md.wfprev").exists());

    put(&at(&dir, "z.md.1.3.wftmp"), b"fresh");
    assert_eq!(
        vault
            .sweep_stale_temps(Duration::from_secs(60 * 60))
            .unwrap(),
        0
    );
    assert!(at(&dir, "z.md.1.3.wftmp").exists());
}

#[test]
fn sweep_keeps_user_wftmp_files() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "notes.wftmp"), b"mine");
    put(&at(&dir, "x.md.wftmp"), b"mine too");
    assert_eq!(vault.sweep_stale_temps(Duration::ZERO).unwrap(), 0);
    assert!(at(&dir, "notes.wftmp").exists());
    assert!(at(&dir, "x.md.wftmp").exists());
}

#[test]
fn write_never_overwrites_existing_prev() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "v.md.wfprev"), b"only copy");
    let WriteOutcome::Written { hash } = vault.write_text_checked("v.md", "v1", None).unwrap()
    else {
        panic!("first write should succeed");
    };
    let _ = vault
        .write_text_checked("v.md", "v2", Some(hash.as_str()))
        .unwrap();
    assert_eq!(fs::read(at(&dir, "v.md.wfprev")).unwrap(), b"only copy");
    assert_eq!(names_containing(dir.path(), PREV_SUFFIX), ["v.md.wfprev"]);
    assert_eq!(fs::read_to_string(at(&dir, "v.md")).unwrap(), "v2");
}

#[test]
fn non_utf8_conflict_copy_is_byte_identical() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    let disk: &[u8] = &[0xff, 0xfe, b'\n', b'x', 0x80];
    let _ = vault.write_bytes_checked("bin.md", disk, None).unwrap();
    let MergeWrite::Conflict { conflict_copy, .. } =
        vault.write_text_merging("bin.md", "a", "b").unwrap()
    else {
        panic!("invalid UTF-8 on disk should be a conflict");
    };
    assert_eq!(fs::read(at(&dir, &conflict_copy)).unwrap(), disk);
    assert_eq!(fs::read_to_string(at(&dir, "bin.md")).unwrap(), "b");
}

#[test]
fn merge_conflict_keeps_app_text() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    vault.write_file("n.md", b"a\nb\nc").unwrap();
    vault.write_file("n.md", b"a\nDISK\nc").unwrap();
    let result = vault
        .write_text_merging("n.md", "a\nb\nc", "a\nAPP\nc")
        .unwrap();
    assert!(matches!(result, MergeWrite::Conflict { .. }));
    assert_eq!(fs::read_to_string(at(&dir, "n.md")).unwrap(), "a\nAPP\nc");
    let copies = names_containing(dir.path(), ".conflict-");
    assert_eq!(copies.len(), 1);
    assert_eq!(
        fs::read_to_string(at(&dir, &copies[0])).unwrap(),
        "a\nDISK\nc"
    );
}

#[test]
fn merge_clean_writes_merged_text() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    vault.write_file("m.md", b"A\nb\nc").unwrap();
    let result = vault
        .write_text_merging("m.md", "a\nb\nc", "a\nb\nC")
        .unwrap();
    assert_eq!(
        result,
        MergeWrite::Merged {
            hash: canonical_digest("A\nb\nC")
        }
    );
    assert_eq!(fs::read_to_string(at(&dir, "m.md")).unwrap(), "A\nb\nC");
}

#[test]
fn merge_retry_leaves_one_conflict_copy_with_newest_disk_text() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    vault.write_file("r.md", b"a\nDISK\nc").unwrap();
    let mut changed = false;
    let result = vault
        .write_text_merging_with_hook("r.md", "a\nb\nc", "a\nAPP\nc", &mut || {
            if !changed {
                changed = true;
                fs::write(at(&dir, "r.md"), b"a\nDISK2\nc").unwrap();
            }
        })
        .unwrap();
    assert!(matches!(result, MergeWrite::Conflict { .. }));
    assert_eq!(fs::read_to_string(at(&dir, "r.md")).unwrap(), "a\nAPP\nc");
    let copies = names_containing(dir.path(), ".conflict-");
    assert_eq!(
        copies.len(),
        1,
        "a lost attempt must not leave a copy: {copies:?}"
    );
    assert_eq!(
        fs::read_to_string(at(&dir, &copies[0])).unwrap(),
        "a\nDISK2\nc"
    );
}

#[test]
fn bytes_write_expecting_absent_never_overwrites() {
    let dir = TempDir::new();
    let vault = vault_in(&dir);
    put(&at(&dir, "copy.conflict.md"), b"OTHER");
    let lost = vault
        .write_bytes_checked("copy.conflict.md", b"mine", Some(""))
        .unwrap();
    assert_eq!(
        lost,
        WriteOutcome::Changed {
            disk_hash: bytes_digest(b"OTHER")
        }
    );
    assert_eq!(fs::read(at(&dir, "copy.conflict.md")).unwrap(), b"OTHER");
}

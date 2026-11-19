//! The file-safety laws of the workspace folder as property tests: what a write, a trash, a
//! rename and the git excludes may and may not do to files on disk. The catalogue is
//! `docs/building/core/laws.md`; each test names its law.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(test)]
mod common;

use common::{TempDir, put};
use git2::Repository;
use proptest::prelude::*;
use wf_core::sync::folder_layout::{day_stamp, numbered_path, trash_path};
use wf_core::sync::frontmatter::bytes_digest;
use wf_core::sync::git_policy::{STALE_META_EXCLUDE, SYNCED_META_FILES};
use wf_store::checked_write::WriteOutcome;
use wf_store::git::repo::FolderRepo;
use wf_store::vault::Vault;

const TARGET: &str = "target.bin";

/// Every file under `root`, by `/`-separated relative path, with its bytes.
fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let rel = path.strip_prefix(root).unwrap().to_string_lossy();
                let _ = out.insert(rel.replace('\\', "/"), fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

/// Files that are not [`TARGET`], some in a subfolder.
fn others() -> impl Strategy<Value = BTreeMap<String, Vec<u8>>> {
    prop::collection::btree_map(
        "(sub/)?[a-z]{1,6}\\.md",
        prop::collection::vec(any::<u8>(), 0..64),
        0..5,
    )
}

fn bytes() -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(any::<u8>(), 0..64)
}

/// A folder holding `files`, plus `target` at [`TARGET`] when given.
fn folder(files: &BTreeMap<String, Vec<u8>>, target: Option<&[u8]>) -> TempDir {
    let dir = TempDir::new();
    for (rel, data) in files {
        put(&dir.path().join(rel), data);
    }
    if let Some(data) = target {
        put(&dir.path().join(TARGET), data);
    }
    dir
}

/// What the caller last saw as an expected hash: a file's digest, or `""` for "absent".
fn seen_hash(seen: Option<&[u8]>) -> String {
    seen.map(bytes_digest).unwrap_or_default()
}

fn today() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    day_stamp(i64::try_from(ms).unwrap())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// Law V1: a checked write never replaces bytes the caller has not seen. When the file
    /// on disk is not what the caller expected, nothing in the folder changes.
    #[test]
    fn v1_checked_write_never_replaces_unseen_bytes(
        others in others(),
        old in proptest::option::of(bytes()),
        seen in proptest::option::of(bytes()),
        new in bytes(),
    ) {
        prop_assume!(old != seen);
        let dir = folder(&others, old.as_deref());
        let before = snapshot(dir.path());
        let vault = Vault::new(dir.path().to_path_buf());

        let outcome = vault.write_bytes_checked(TARGET, &new, Some(&seen_hash(seen.as_deref()))).unwrap();

        prop_assert!(matches!(outcome, WriteOutcome::Changed { .. }), "{outcome:?}");
        prop_assert_eq!(snapshot(dir.path()), before);
    }

    /// Law V2: a write changes only its target. Every other file keeps its bytes and no
    /// temp or `.wfprev` is left behind; holds for the checked and the unchecked write.
    #[test]
    fn v2_write_changes_only_its_target(
        others in others(),
        old in proptest::option::of(bytes()),
        new in bytes(),
        checked in any::<bool>(),
    ) {
        let dir = folder(&others, old.as_deref());
        let mut want = snapshot(dir.path());
        let vault = Vault::new(dir.path().to_path_buf());

        if checked {
            let outcome = vault.write_bytes_checked(TARGET, &new, Some(&seen_hash(old.as_deref()))).unwrap();
            prop_assert!(matches!(outcome, WriteOutcome::Written { .. }), "{outcome:?}");
        } else {
            vault.write_file(TARGET, &new).unwrap();
        }

        let _ = want.insert(TARGET.to_owned(), new);
        prop_assert_eq!(snapshot(dir.path()), want);
    }

    /// Law V3: a write that dies before its swap leaves the old bytes in place. The only
    /// new file allowed is the generated temp, which the stale-temp sweep removes.
    #[test]
    fn v3_interrupted_write_keeps_old_bytes(others in others(), old in bytes(), new in bytes()) {
        let dir = folder(&others, Some(&old));
        let before = snapshot(dir.path());
        let vault = Vault::new(dir.path().to_path_buf());

        let crashed = catch_unwind(AssertUnwindSafe(|| {
            vault.write_checked_with_hook(TARGET, &new, false, Some(&bytes_digest(&old)), &mut || {
                panic!("simulated crash before the swap");
            }, &mut || {})
        }));

        prop_assert!(crashed.is_err());
        let mut after = snapshot(dir.path());
        after.retain(|rel, _| !rel.ends_with(".wftmp"));
        prop_assert_eq!(after, before);
    }

    /// Law V4: trash never overwrites. A file trashed onto names already used that day gets
    /// the next free numbered name, and every earlier trashed file keeps its bytes.
    #[test]
    fn v4_trash_never_overwrites(
        others in others(),
        content in bytes(),
        earlier in prop::collection::vec(bytes(), 0..4),
    ) {
        let dir = folder(&others, Some(&content));
        let base = trash_path(TARGET, &today());
        for (n, data) in (1u32..).zip(&earlier) {
            put(&dir.path().join(numbered_path(&base, n)), data);
        }
        let mut want = snapshot(dir.path());
        let vault = Vault::new(dir.path().to_path_buf());

        let dest = vault.delete_to_trash(TARGET).unwrap();

        prop_assert!(!want.contains_key(&dest), "trashed onto an existing file: {dest}");
        let _ = want.remove(TARGET);
        let _ = want.insert(dest, content);
        prop_assert_eq!(snapshot(dir.path()), want);
    }

    /// Law V5: a rename never overwrites. A different file at the destination moves to a
    /// conflict copy first, so no bytes are lost.
    #[test]
    fn v5_rename_never_overwrites(
        others in others(),
        moving in bytes(),
        there in proptest::option::of(bytes()),
    ) {
        let dir = folder(&others, Some(&moving));
        if let Some(data) = &there {
            put(&dir.path().join("dest.bin"), data);
        }
        let mut want = snapshot(dir.path());
        let vault = Vault::new(dir.path().to_path_buf());

        let aside = vault.rename_checked(TARGET, "dest.bin").unwrap();

        let _ = want.remove(TARGET);
        let _ = want.insert("dest.bin".to_owned(), moving);
        match (aside, there) {
            (Some(aside), Some(data)) => {
                prop_assert!(!want.contains_key(&aside), "conflict copy onto an existing file: {aside}");
                let _ = want.insert(aside, data);
            }
            (None, None) => {}
            (aside, there) => prop_assert!(false, "aside {aside:?} for destination {there:?}"),
        }
        prop_assert_eq!(snapshot(dir.path()), want);
    }

    /// Law V8: a user delete never destroys a file. The file, or a whole folder, moves into
    /// the trash with its bytes; every other file is untouched.
    #[test]
    fn v8_user_delete_moves_into_the_trash(others in others(), content in bytes(), whole_folder in any::<bool>()) {
        let dir = folder(&others, Some(&content));
        let before = snapshot(dir.path());
        let vault = Vault::new(dir.path().to_path_buf());
        let folder_gone = whole_folder && others.keys().any(|rel| rel.starts_with("sub/"));

        if folder_gone {
            let _ = vault.delete_to_trash("sub").unwrap();
        } else {
            let _ = vault.delete_to_trash(TARGET).unwrap();
        }

        let day = today();
        let want: BTreeMap<String, Vec<u8>> = before
            .into_iter()
            .map(|(rel, data)| {
                let gone = if folder_gone { rel.starts_with("sub/") } else { rel == TARGET };
                (if gone { trash_path(&rel, &day) } else { rel }, data)
            })
            .collect();
        prop_assert_eq!(snapshot(dir.path()), want);
    }

    /// Law V9: a plain write (no expected digest) still goes through the checked write, so a
    /// change another process makes while it runs is kept: in the file when the write is
    /// refused, or in a conflict copy when it goes ahead.
    #[test]
    fn v9_plain_write_keeps_a_change_made_mid_write(
        others in others(),
        old in proptest::option::of(bytes()),
        theirs in bytes(),
        new in bytes(),
    ) {
        prop_assume!(old.as_ref() != Some(&theirs));
        let dir = folder(&others, old.as_deref());
        let before = snapshot(dir.path());
        let vault = Vault::new(dir.path().to_path_buf());
        let target = dir.path().join(TARGET);

        let outcome = vault.write_file_with_hook(TARGET, &new, &mut || put(&target, &theirs));

        let after = snapshot(dir.path());
        if outcome.is_ok() {
            prop_assert_eq!(after.get(TARGET), Some(&new));
        }
        let kept = after.iter().any(|(rel, data)| {
            data == &theirs && (if rel == TARGET { outcome.is_err() } else { !before.contains_key(rel) })
        });
        prop_assert!(kept, "the mid-write change was lost: {:?}", outcome);
        prop_assert!(after.keys().all(|rel| !rel.ends_with(".wftmp")), "temp file left behind");
    }

    /// Law G1: the git excludes the app writes never hide a synced settings file, whatever the
    /// user already had in the exclude file, and still hide this machine's own state.
    #[test]
    fn g1_excludes_never_hide_synced_settings(
        user_lines in prop::collection::vec("[a-z]{1,6}/|\\*\\.[a-z]{1,4}|#[ -~]{0,10}", 0..4),
        stale in any::<bool>(),
        local in "[a-z]{1,8}\\.json",
    ) {
        prop_assume!(!SYNCED_META_FILES.contains(&local.as_str()));
        // A user line ending in `.json` would be the user's own choice to hide those files.
        prop_assume!(user_lines.iter().all(|line| line != "*.json"));
        let dir = TempDir::new();
        let repo = FolderRepo::new(dir.path());
        repo.init().unwrap();
        let mut existing = user_lines.join("\n");
        if stale {
            existing.push('\n');
            existing.push_str(STALE_META_EXCLUDE);
        }
        put(&dir.path().join(".git/info/exclude"), existing.as_bytes());

        let _ = repo.status().unwrap();

        let git = Repository::open(dir.path()).unwrap();
        for name in SYNCED_META_FILES {
            let path = format!(".weaveforge/{name}");
            prop_assert!(!git.is_path_ignored(&path).unwrap(), "{path} is hidden");
        }
        let path = format!(".weaveforge/{local}");
        prop_assert!(git.is_path_ignored(&path).unwrap(), "{path} is not hidden");
    }
}

/// Law V8 scope: `Vault::remove` is the plain unlink for temp files, internal state, caches
/// and rename sources, so it never fills the trash. User deletes call `delete_to_trash`.
#[test]
fn v8_plain_remove_does_not_fill_the_trash() {
    let dir = TempDir::new();
    put(&dir.path().join("notes/a.md.1.2.wftmp"), b"temp");
    put(&dir.path().join(".weaveforge/state.json"), b"{}");
    put(&dir.path().join("keep.md"), b"keep");
    let vault = Vault::new(dir.path().to_path_buf());

    vault.remove("notes/a.md.1.2.wftmp", false).unwrap();
    vault.remove(".weaveforge/state.json", false).unwrap();

    let want = BTreeMap::from([("keep.md".to_owned(), b"keep".to_vec())]);
    assert_eq!(snapshot(dir.path()), want);
}

/// Law V8 edge: a dangling link is still something the user can delete; it moves into the
/// trash instead of failing as missing.
#[test]
fn v8_user_delete_takes_a_dangling_link() {
    let dir = TempDir::new();
    let link = dir.path().join("broken.md");
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(dir.path().join("gone.md"), &link);
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(dir.path().join("gone.md"), &link);
    if made.is_err() {
        // Windows without symlink rights (no developer mode): nothing to test here.
        return;
    }
    let vault = Vault::new(dir.path().to_path_buf());

    let trashed = vault.delete_to_trash("broken.md").unwrap();

    assert!(fs::symlink_metadata(&link).is_err());
    assert!(fs::symlink_metadata(dir.path().join(&trashed)).is_ok());
}

#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
//! Behaviour of `MemoryWorkspaceFs`, pinned to the TypeScript `MemoryWorkspaceFs` it ports.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::rc::Rc;

use wf_core::sync::memory_fs::MemoryWorkspaceFs;
use wf_core::sync::workspace_fs::{FsError, FsKind, WorkspaceFs, WorkspaceStat, walk_by_list};
use wf_core::workspace::UnsafePath;

fn fixed() -> MemoryWorkspaceFs {
    MemoryWorkspaceFs::with_clock(Box::new(|| 42_u64))
}

fn file(path: &str, size: u64) -> WorkspaceStat {
    WorkspaceStat {
        path: path.to_owned(),
        size,
        modified_ms: 42,
        kind: FsKind::File,
    }
}

fn dir(path: &str) -> WorkspaceStat {
    WorkspaceStat {
        path: path.to_owned(),
        size: 0,
        modified_ms: 42,
        kind: FsKind::Dir,
    }
}

fn tree() -> MemoryWorkspaceFs {
    let mut fs = fixed();
    fs.write_file("a/x.md", b"1").expect("write");
    fs.write_file("a/y/z.md", b"22").expect("write");
    fs.write_file("b.md", b"333").expect("write");
    fs
}

#[test]
fn write_then_read_round_trips() {
    let mut fs = fixed();
    fs.write_file("notes/a.md", b"hello").expect("write");
    assert_eq!(fs.read_file("notes/a.md"), Ok(b"hello".to_vec()));
    assert_eq!(fs.read_text("notes/a.md"), Ok("hello".to_owned()));
}

#[test]
fn read_text_strips_bom_and_replaces_invalid_utf8() {
    let mut fs = fixed();
    fs.write_file("bom.md", b"\xEF\xBB\xBFhi").expect("write");
    fs.write_file("bad.md", &[0xff]).expect("write");
    assert_eq!(fs.read_text("bom.md"), Ok("hi".to_owned()));
    assert_eq!(fs.read_text("bad.md"), Ok("\u{FFFD}".to_owned()));
}

#[test]
fn missing_read_is_not_found_with_enoent_message() {
    let fs = fixed();
    let err = fs.read_file("nope.md").unwrap_err();
    assert_eq!(err, FsError::NotFound("nope.md".into()));
    assert_eq!(err.to_string(), "ENOENT: nope.md");
    assert_eq!(
        fs.read_text("nope.md"),
        Err(FsError::NotFound("nope.md".into()))
    );
}

#[test]
fn unsafe_paths_are_refused_on_write() {
    let mut fs = fixed();
    for input in ["../x", "/abs", "C:/x", ""] {
        assert_eq!(
            fs.write_file(input, b"x"),
            Err(FsError::Unsafe(UnsafePath(input.to_owned())))
        );
    }
    assert_eq!(fs.stat("../x"), None);
    assert_eq!(
        FsError::Unsafe(UnsafePath("../x".into())).to_string(),
        "Unsafe workspace path: ../x"
    );
}

#[test]
fn backslash_path_is_stored_with_forward_slashes() {
    let mut fs = fixed();
    fs.write_file("a\\b.md", b"x").expect("write");
    assert_eq!(fs.read_file("a/b.md"), Ok(b"x".to_vec()));
    assert_eq!(fs.stat("a/b.md"), Some(file("a/b.md", 1)));
}

#[test]
fn write_creates_parent_dirs() {
    let mut fs = fixed();
    fs.write_file("a/b/c.md", b"x").expect("write");
    assert_eq!(fs.stat("a"), Some(dir("a")));
    assert_eq!(fs.stat("a/b"), Some(dir("a/b")));
    assert_eq!(fs.stat("a/b/c.md"), Some(file("a/b/c.md", 1)));
}

#[test]
fn stat_of_file_is_exact() {
    let mut fs = fixed();
    fs.write_file("a/n.md", b"abc").expect("write");
    assert_eq!(
        fs.stat("a/n.md"),
        Some(WorkspaceStat {
            path: "a/n.md".into(),
            size: 3,
            modified_ms: 42,
            kind: FsKind::File,
        })
    );
    assert_eq!(fs.stat("missing.md"), None);
}

#[test]
fn list_root_and_subdir_collapse_dirs() {
    let fs = tree();
    assert_eq!(fs.list(""), Ok(vec![dir("a"), file("b.md", 3)]));
    assert_eq!(fs.list("a"), Ok(vec![file("a/x.md", 1), dir("a/y")]));
}

#[test]
fn list_of_dir_with_only_empty_subdir_is_empty() {
    let mut fs = fixed();
    fs.mkdirp("e/f").expect("mkdirp");
    assert_eq!(fs.list("e"), Ok(vec![]));
}

#[test]
fn walk_root_returns_all_files_sorted() {
    let fs = tree();
    assert_eq!(
        fs.walk(""),
        Ok(vec![
            file("a/x.md", 1),
            file("a/y/z.md", 2),
            file("b.md", 3)
        ])
    );
}

#[test]
fn walk_subdir_excludes_sibling_with_shared_prefix() {
    let mut fs = tree();
    fs.write_file("ab.md", b"4").expect("write");
    assert_eq!(
        fs.walk("a"),
        Ok(vec![file("a/x.md", 1), file("a/y/z.md", 2)])
    );
}

#[test]
fn walk_by_list_matches_walk_when_orders_agree() {
    let fs = tree();
    assert_eq!(walk_by_list(&fs, ""), fs.walk(""));
}

#[test]
fn remove_non_recursive_removes_only_that_file() {
    let mut fs = fixed();
    fs.write_file("d/1.md", b"1").expect("write");
    fs.write_file("d/e/2.md", b"1").expect("write");
    fs.remove("d/1.md", false).expect("remove");
    assert_eq!(fs.stat("d/1.md"), None);
    assert_eq!(fs.stat("d/e/2.md"), Some(file("d/e/2.md", 1)));
}

#[test]
fn remove_recursive_drops_subtree_but_not_prefix_sibling() {
    let mut fs = fixed();
    fs.write_file("d/1.md", b"1").expect("write");
    fs.write_file("d/e/2.md", b"1").expect("write");
    fs.write_file("dd/3.md", b"1").expect("write");
    fs.remove("d", true).expect("remove");
    assert_eq!(fs.stat("d/1.md"), None);
    assert_eq!(fs.stat("d/e/2.md"), None);
    assert_eq!(fs.stat("d"), None);
    assert_eq!(fs.stat("d/e"), None);
    assert_eq!(fs.stat("dd/3.md"), Some(file("dd/3.md", 1)));
    assert_eq!(fs.stat("dd"), Some(dir("dd")));
}

#[test]
fn remove_missing_is_ok() {
    let mut fs = fixed();
    assert_eq!(fs.remove("nope.md", false), Ok(()));
    assert_eq!(fs.remove("nope/x", true), Ok(()));
}

#[test]
fn mkdirp_creates_every_level() {
    let mut fs = fixed();
    fs.mkdirp("x/y").expect("mkdirp");
    assert_eq!(fs.stat("x"), Some(dir("x")));
    assert_eq!(fs.stat("x/y"), Some(dir("x/y")));
}

#[test]
fn rename_moves_bytes_and_sets_target_time() {
    let now = Rc::new(Cell::new(10_u64));
    let clock = Rc::clone(&now);
    let mut fs = MemoryWorkspaceFs::with_clock(Box::new(move || clock.get()));
    fs.write_file("a.md", b"hi").expect("write");
    now.set(99);
    fs.rename("a.md", "b/c.md").expect("rename");
    assert_eq!(fs.stat("a.md"), None);
    assert_eq!(fs.read_file("b/c.md"), Ok(b"hi".to_vec()));
    assert_eq!(
        fs.stat("b/c.md"),
        Some(WorkspaceStat {
            path: "b/c.md".into(),
            size: 2,
            modified_ms: 99,
            kind: FsKind::File,
        })
    );
    assert_eq!(fs.stat("b").map(|s| s.kind), Some(FsKind::Dir));
}

#[test]
fn rename_missing_source_is_not_found() {
    let mut fs = fixed();
    assert_eq!(
        fs.rename("missing.md", "x.md"),
        Err(FsError::NotFound("missing.md".into()))
    );
}

#[test]
fn to_record_decodes_every_file() {
    let mut fs = fixed();
    fs.write_file("a/b.md", b"hi").expect("write");
    fs.write_file("c.md", b"\xEF\xBB\xBFyo").expect("write");
    assert_eq!(
        fs.to_record(),
        BTreeMap::from([
            ("a/b.md".to_owned(), "hi".to_owned()),
            ("c.md".to_owned(), "yo".to_owned()),
        ])
    );
}

#[test]
fn rewrite_updates_modified_ms() {
    let now = Rc::new(Cell::new(10_u64));
    let clock = Rc::clone(&now);
    let mut fs = MemoryWorkspaceFs::with_clock(Box::new(move || clock.get()));
    fs.write_file("n.md", b"1").expect("write");
    assert_eq!(fs.stat("n.md").map(|s| s.modified_ms), Some(10));
    now.set(20);
    fs.write_file("n.md", b"2").expect("write");
    assert_eq!(fs.stat("n.md").map(|s| s.modified_ms), Some(20));
}

#[test]
fn new_uses_system_clock() {
    let mut fs = MemoryWorkspaceFs::new();
    fs.write_file("a.md", b"x").expect("write");
    let stat = fs.stat("a.md").expect("stat");
    assert!(stat.modified_ms > 1_700_000_000_000);
}

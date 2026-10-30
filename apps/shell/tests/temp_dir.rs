#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the shared test helpers in `tests/common/mod.rs`.

mod common;

use common::{TempDir, put};

#[test]
fn two_temp_dirs_are_distinct_folders_that_exist() {
    let a = TempDir::new();
    let b = TempDir::new();
    assert_ne!(a.path(), b.path());
    assert!(a.path().is_dir());
    assert!(b.path().is_dir());
}

#[test]
fn a_temp_dir_and_its_contents_are_removed_on_drop() {
    let dir = TempDir::new();
    let path = dir.path().to_path_buf();
    put(&path.join("a/b/c.txt"), b"x");
    drop(dir);
    assert!(!path.exists());
}

#[test]
fn put_creates_parents_and_writes_the_bytes() {
    let dir = TempDir::new();
    let file = dir.path().join("nested/deeper/file.bin");
    put(&file, &[0, 1, 255]);
    assert_eq!(std::fs::read(&file).unwrap(), vec![0, 1, 255]);
}

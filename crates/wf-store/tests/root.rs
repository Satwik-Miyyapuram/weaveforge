//! Integration tests for `wf_store::root`: which folders may hold a workspace, and nesting.

#[cfg(test)]
mod common;

use std::fs;

use common::{TempDir, mkdir, put};
use wf_core::workspace::WORKSPACE_META_DIR;
use wf_store::root::{RootError, RootState, WORKSPACE_SUBDIR, verify_root, workspace_root_for};

// Ported: vault-folder.test.ts "an empty folder may become the workspace"
#[test]
fn empty_folder_is_empty() {
    let dir = TempDir::new();
    assert_eq!(verify_root(dir.path()), Ok(RootState::Empty));
}

// Ported: vault-folder.test.ts "a folder we already wrote is recognized as ours"
#[test]
fn mark_dir_with_notes_is_existing() {
    let dir = TempDir::new();
    mkdir(&dir.path().join(WORKSPACE_META_DIR));
    put(&dir.path().join("notes.md"), b"x");
    assert_eq!(verify_root(dir.path()), Ok(RootState::Existing));
}

#[test]
fn mark_alone_and_mark_as_file_are_existing() {
    let alone = TempDir::new();
    mkdir(&alone.path().join(WORKSPACE_META_DIR));
    assert_eq!(verify_root(alone.path()), Ok(RootState::Existing));

    let as_file = TempDir::new();
    put(&as_file.path().join(WORKSPACE_META_DIR), b"x");
    put(&as_file.path().join("taxes.pdf"), b"x");
    assert_eq!(verify_root(as_file.path()), Ok(RootState::Existing));
}

// Ported: vault-folder.test.ts "somebody's Documents folder is refused as-is"
#[test]
fn folder_with_a_person_file_is_not_empty() {
    let dir = TempDir::new();
    put(&dir.path().join("taxes.pdf"), b"x");
    assert_eq!(verify_root(dir.path()), Err(RootError::NotEmpty));
}

// Ported: vault-folder.test.ts "…but choosing it puts the workspace in a WeaveForge folder inside it"
#[test]
fn choosing_a_folder_with_files_nests_the_workspace() {
    let theirs = TempDir::new();
    let taxes = theirs.path().join("taxes.pdf");
    fs::write(&taxes, b"their bytes").unwrap();
    let nested = theirs.path().join(WORKSPACE_SUBDIR);

    let choice = workspace_root_for(theirs.path()).unwrap();

    assert_eq!(choice.root, nested);
    assert_eq!(choice.state, RootState::Empty);
    assert_eq!(fs::read(&taxes).unwrap(), b"their bytes");
    assert_eq!(verify_root(&nested), Ok(RootState::Empty));
}

// Ported: vault-folder.test.ts "choosing it again reuses the same WeaveForge folder"
#[test]
fn choosing_again_reuses_the_nested_workspace() {
    let theirs = TempDir::new();
    put(&theirs.path().join("taxes.pdf"), b"x");
    let nested = theirs.path().join(WORKSPACE_SUBDIR);
    mkdir(&nested.join(WORKSPACE_META_DIR));

    let choice = workspace_root_for(theirs.path()).unwrap();

    assert_eq!(choice.root, nested);
    assert_eq!(choice.state, RootState::Existing);
    assert!(!nested.join(WORKSPACE_SUBDIR).exists());
}

// Ported: vault-folder.test.ts "an empty folder is the workspace itself, not a parent"
#[test]
fn empty_folder_is_its_own_root() {
    let dir = TempDir::new();
    let choice = workspace_root_for(dir.path()).unwrap();
    assert_eq!(choice.root, dir.path().to_path_buf());
    assert_eq!(choice.state, RootState::Empty);
    assert!(!dir.path().join(WORKSPACE_SUBDIR).exists());
}

// Ported: vault-folder.test.ts "dotfiles nobody chose to put there do not count as contents"
#[test]
fn ds_store_only_is_empty() {
    let dir = TempDir::new();
    put(&dir.path().join(".DS_Store"), b"x");
    assert_eq!(verify_root(dir.path()), Ok(RootState::Empty));
}

// Ported: vault-folder.test.ts "a file is not a folder"
#[test]
fn a_file_is_not_a_folder() {
    let dir = TempDir::new();
    let file = dir.path().join("note.txt");
    put(&file, b"x");
    assert_eq!(verify_root(&file), Err(RootError::NotAFolder));
    assert_eq!(workspace_root_for(&file), Err(RootError::NotAFolder));
    assert!(!dir.path().join(WORKSPACE_SUBDIR).exists());
}

#[test]
fn a_missing_path_is_not_a_folder_and_stays_missing() {
    let dir = TempDir::new();
    let missing = dir.path().join("missing");
    assert_eq!(verify_root(&missing), Err(RootError::NotAFolder));
    assert_eq!(workspace_root_for(&missing), Err(RootError::NotAFolder));
    assert!(!missing.exists());
}

#[test]
fn nested_name_taken_by_a_file_cannot_write() {
    let theirs = TempDir::new();
    put(&theirs.path().join("taxes.pdf"), b"x");
    put(&theirs.path().join(WORKSPACE_SUBDIR), b"x");
    assert_eq!(
        workspace_root_for(theirs.path()),
        Err(RootError::CannotWrite)
    );
}

#[test]
fn strangers_nested_folder_is_not_adopted() {
    let theirs = TempDir::new();
    let nested = theirs.path().join(WORKSPACE_SUBDIR);
    mkdir(&nested);
    put(&nested.join("x.txt"), b"x");
    assert_eq!(workspace_root_for(theirs.path()), Err(RootError::NotEmpty));
}

#[test]
fn root_error_texts_match_the_desktop_app() {
    assert_eq!(RootError::NotAFolder.to_string(), "That is not a folder.");
    assert_eq!(
        RootError::NotEmpty.to_string(),
        "That folder already has files in it. Pick an empty folder, or one WeaveForge already writes to."
    );
    assert_eq!(
        RootError::CannotWrite.to_string(),
        "WeaveForge could not write inside that folder."
    );
}

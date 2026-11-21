#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Reading and patching this machine's settings file, `.weaveforge/local/device.json`.
use crate::common;

use std::fs;

use serde_json::{Value, json};
use weaveforge_shell_lib::device_settings::{patch_device_settings, read_device_settings};
use wf_store::vault::Vault;

use common::TempDir;

const DEVICE: &str = ".weaveforge/local/device.json";

fn empty_vault() -> (TempDir, Vault) {
    let dir = TempDir::new();
    let vault = Vault::new(dir.path().to_path_buf());
    (dir, vault)
}

fn vault_with(text: &str) -> (TempDir, Vault) {
    let (dir, vault) = empty_vault();
    fs::create_dir_all(dir.path().join(".weaveforge/local")).unwrap();
    fs::write(dir.path().join(DEVICE), text).unwrap();
    (dir, vault)
}

fn on_disk(dir: &TempDir) -> Value {
    serde_json::from_str(&fs::read_to_string(dir.path().join(DEVICE)).unwrap()).unwrap()
}

fn parsed(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

#[test]
fn missing_file_reads_as_empty_object() {
    let (_dir, vault) = empty_vault();
    assert_eq!(parsed(&read_device_settings(&vault).unwrap()), json!({}));
}

#[test]
fn read_returns_the_file() {
    let (_dir, vault) = vault_with(r#"{"zoom":1.2,"pen":{"size":2}}"#);
    assert_eq!(
        parsed(&read_device_settings(&vault).unwrap()),
        json!({"zoom": 1.2, "pen": {"size": 2}})
    );
}

#[test]
fn patch_creates_the_file() {
    let (dir, vault) = empty_vault();
    let reply = patch_device_settings(&vault, r#"{"zoom":1.5}"#).unwrap();
    assert_eq!(parsed(&reply), json!({"zoom": 1.5}));
    assert_eq!(on_disk(&dir), json!({"zoom": 1.5}));
}

#[test]
fn patch_sets_named_keys_and_null_removes() {
    let (dir, vault) = vault_with(r#"{"zoom":1.2,"pen":{"size":2},"keep":true}"#);
    let reply = patch_device_settings(&vault, r#"{"zoom":2,"pen":null,"new":"x"}"#).unwrap();
    let want = json!({"zoom": 2, "keep": true, "new": "x"});
    assert_eq!(parsed(&reply), want);
    assert_eq!(on_disk(&dir), want);
}

#[test]
fn patch_with_a_secret_is_refused_and_file_kept() {
    let original = r#"{"zoom":1.2}"#;
    let (dir, vault) = vault_with(original);
    let err = patch_device_settings(&vault, r#"{"githubToken":"abc"}"#).unwrap_err();
    assert!(err.contains("githubToken"), "{err}");
    assert!(!err.contains("abc"), "the refusal must not echo the value");
    assert_eq!(
        fs::read_to_string(dir.path().join(DEVICE)).unwrap(),
        original
    );
}

#[test]
fn patch_that_is_not_an_object_is_refused() {
    let (_dir, vault) = empty_vault();
    assert!(patch_device_settings(&vault, "[1]").is_err());
    assert!(patch_device_settings(&vault, "not json").is_err());
    assert!(!vault.root().join(DEVICE).exists());
}

#[test]
fn corrupt_file_is_never_overwritten() {
    let (dir, vault) = vault_with("{broken");
    assert!(read_device_settings(&vault).is_err());
    assert!(patch_device_settings(&vault, r#"{"zoom":1}"#).is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join(DEVICE)).unwrap(),
        "{broken"
    );
}

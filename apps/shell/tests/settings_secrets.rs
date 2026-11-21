#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Moving secrets an older version left in `.weaveforge/settings.json` to the keychain.
use crate::common;

use std::fs;
use std::sync::Arc;

use keyring_core::CredentialStore;
use serde_json::{Value, json};
use weaveforge_shell_lib::secrets::Secrets;
use weaveforge_shell_lib::settings_secrets::{LEGACY_SECRET, move_legacy_secrets};
use wf_store::vault::Vault;

use common::TempDir;

const SERVICE: &str = "org.weaveforge.test";
const SETTINGS: &str = ".weaveforge/settings.json";

fn mock() -> Arc<CredentialStore> {
    keyring_core::mock::Store::new().expect("mock store")
}

fn vault_with(settings: &Value) -> (TempDir, Vault) {
    let dir = TempDir::new();
    fs::create_dir_all(dir.path().join(".weaveforge")).unwrap();
    fs::write(dir.path().join(SETTINGS), settings.to_string()).unwrap();
    let vault = Vault::new(dir.path().to_path_buf());
    (dir, vault)
}

fn on_disk(dir: &TempDir) -> Value {
    serde_json::from_str(&fs::read_to_string(dir.path().join(SETTINGS)).unwrap()).unwrap()
}

fn legacy() -> Value {
    json!({
        "theme": "crt",
        "zoteroApiKey": "zk",
        "integrations": {"zotero": {"apiKey": "k", "library": "users/1"}},
    })
}

#[test]
fn moves_secrets_then_strips_the_file() {
    let (dir, vault) = vault_with(&legacy());
    let store = mock();
    let secrets = Secrets::new(Some(Arc::clone(&store)), SERVICE);
    let moved = move_legacy_secrets(&vault, &secrets).expect("moved");
    assert_eq!(moved, vec!["integrations.zotero.apiKey", "zoteroApiKey"]);
    assert_eq!(
        on_disk(&dir),
        json!({"theme": "crt", "integrations": {"zotero": {"library": "users/1"}}})
    );
    let kept: Value = serde_json::from_str(&secrets.read(LEGACY_SECRET).unwrap().unwrap()).unwrap();
    assert_eq!(
        kept,
        json!({"zoteroApiKey": "zk", "integrations.zotero.apiKey": "k"})
    );
}

#[test]
fn no_keychain_leaves_the_file_alone() {
    let (dir, vault) = vault_with(&legacy());
    let secrets = Secrets::new(None, SERVICE);
    assert!(move_legacy_secrets(&vault, &secrets).is_err());
    assert_eq!(on_disk(&dir), legacy());
}

#[test]
fn second_run_does_nothing() {
    let (dir, vault) = vault_with(&legacy());
    let secrets = Secrets::new(Some(mock()), SERVICE);
    let _ = move_legacy_secrets(&vault, &secrets).expect("first");
    let after = fs::read(dir.path().join(SETTINGS)).unwrap();
    assert_eq!(move_legacy_secrets(&vault, &secrets), Ok(Vec::new()));
    assert_eq!(fs::read(dir.path().join(SETTINGS)).unwrap(), after);
}

#[test]
fn merges_with_an_earlier_move() {
    let (_dir, vault) = vault_with(&json!({"zoteroApiKey": "new"}));
    let secrets = Secrets::new(Some(mock()), SERVICE);
    secrets
        .write(LEGACY_SECRET, r#"{"zoteroApiKey":"old","githubToken":"g"}"#)
        .unwrap();
    let _ = move_legacy_secrets(&vault, &secrets).expect("moved");
    let kept: Value = serde_json::from_str(&secrets.read(LEGACY_SECRET).unwrap().unwrap()).unwrap();
    assert_eq!(kept, json!({"zoteroApiKey": "new", "githubToken": "g"}));
}

#[test]
fn missing_or_clean_settings_do_nothing() {
    let dir = TempDir::new();
    let vault = Vault::new(dir.path().to_path_buf());
    let secrets = Secrets::new(Some(mock()), SERVICE);
    assert_eq!(move_legacy_secrets(&vault, &secrets), Ok(Vec::new()));
    let (dir, vault) = vault_with(&json!({"theme": "crt"}));
    assert_eq!(move_legacy_secrets(&vault, &secrets), Ok(Vec::new()));
    assert_eq!(on_disk(&dir), json!({"theme": "crt"}));
    assert_eq!(secrets.read(LEGACY_SECRET), Ok(None));
}

#[test]
fn secret_in_an_array_leaves_the_file_alone() {
    let settings = json!({"zoteroApiKey": "zk", "keys": ["ghp_abcdefghijklmnopqrstuvwxyz"]});
    let (dir, vault) = vault_with(&settings);
    let secrets = Secrets::new(Some(mock()), SERVICE);
    assert!(move_legacy_secrets(&vault, &secrets).is_err());
    assert_eq!(on_disk(&dir), settings);
}

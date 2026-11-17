//! Workspace-scoped secrets: each workspace sees only its own tokens, the page can only write
//! them into an open workspace, and an unscoped token from 0.9.2 moves into the workspace on
//! first use without being lost or leaking into another workspace.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use keyring_core::CredentialStore;
use keyring_core::mock::Cred;

use super::{PAGE_WRITABLE, SecretError, Secrets};

const SERVICE: &str = "org.weaveforge.test";
const WS_A: &str = "0c6f2a1e-7d3b-5f1a-9a2e-000000000001";
const WS_B: &str = "0c6f2a1e-7d3b-5f1a-9a2e-000000000002";
const WORKSPACE_NAMES: [&str; 5] = [
    "git-sync-token",
    "overleaf-token",
    "zotero-api-key",
    "mattermost-token",
    "repo-link-token",
];

fn store() -> Arc<CredentialStore> {
    keyring_core::mock::Store::new().expect("mock store")
}

fn secrets(store: &Arc<CredentialStore>) -> Secrets {
    Secrets::new(Some(Arc::clone(store)), SERVICE)
}

/// The password filed under `user` in the OS store, read without going through `Secrets`.
fn raw(store: &Arc<CredentialStore>, user: &str) -> Option<String> {
    store
        .build(SERVICE, user, None)
        .ok()?
        .get_password()
        .ok()
}

/// Makes the next keychain call on `user` fail once with `err`.
fn inject(store: &Arc<CredentialStore>, user: &str, err: keyring_core::Error) {
    let entry = store.build(SERVICE, user, None).expect("entry");
    entry
        .as_any()
        .downcast_ref::<Cred>()
        .expect("mock credential")
        .set_error(err);
}

#[test]
fn page_list_has_the_new_workspace_names() {
    for name in ["zotero-api-key", "mattermost-token", "repo-link-token"] {
        assert!(PAGE_WRITABLE.contains(&name), "{name}");
    }
}

#[test]
fn workspaces_do_not_see_each_others_tokens() {
    let st = store();
    let s = secrets(&st);
    s.set_open_workspace(Some(WS_A)).expect("open a");
    s.page_write("git-sync-token", "token-a").expect("write a");
    assert_eq!(raw(&st, &format!("{WS_A}/git-sync-token")).as_deref(), Some("token-a"));

    s.set_open_workspace(Some(WS_B)).expect("open b");
    assert_eq!(s.read("git-sync-token"), Ok(None));
    s.page_write("git-sync-token", "token-b").expect("write b");

    s.set_open_workspace(Some(WS_A)).expect("back to a");
    assert_eq!(s.read("git-sync-token"), Ok(Some("token-a".to_owned())));
    s.set_open_workspace(Some(WS_B)).expect("back to b");
    assert_eq!(s.read("git-sync-token"), Ok(Some("token-b".to_owned())));
}

#[test]
fn device_names_ignore_the_open_workspace() {
    let st = store();
    let s = secrets(&st);
    s.page_write("ai-provider", "one").expect("write");
    s.set_open_workspace(Some(WS_A)).expect("open");
    assert_eq!(s.read("ai-provider"), Ok(Some("one".to_owned())));
    assert_eq!(raw(&st, "ai-provider").as_deref(), Some("one"));
}

#[test]
fn every_workspace_name_is_refused_without_an_open_workspace() {
    let st = store();
    let s = secrets(&st);
    for name in WORKSPACE_NAMES {
        assert_eq!(s.page_write(name, "x"), Err(SecretError::NoWorkspace), "{name}");
        assert_eq!(s.page_clear(name), Err(SecretError::NoWorkspace), "{name}");
    }
    assert_eq!(raw(&st, "git-sync-token"), None);
}

#[test]
fn a_workspace_id_must_be_a_plain_key_part() {
    let st = store();
    let s = secrets(&st);
    for bad in ["", "a/b", "../x", "a b", " 0c6f", "0c6f\n"] {
        assert_eq!(
            s.set_open_workspace(Some(bad)),
            Err(SecretError::BadWorkspace),
            "{bad:?}"
        );
    }
    s.set_open_workspace(Some(WS_A)).expect("a uuid is fine");
    s.set_open_workspace(None).expect("closing is fine");
    assert_eq!(s.page_write("git-sync-token", "x"), Err(SecretError::NoWorkspace));
}

#[test]
fn upgrade_moves_an_unscoped_token_into_the_open_workspace() {
    // 0.9.2 wrote the tokens under their fixed names, with no workspace scope.
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.write("overleaf-token", "old-ov").expect("old write");

    s.set_open_workspace(Some(WS_A)).expect("open");
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
    assert_eq!(s.read("overleaf-token"), Ok(Some("old-ov".to_owned())));

    assert_eq!(raw(&st, "git-sync-token"), None, "old key removed");
    assert_eq!(raw(&st, "overleaf-token"), None, "old key removed");
    assert_eq!(
        raw(&st, &format!("{WS_A}/git-sync-token")).as_deref(),
        Some("old-git")
    );
    assert_eq!(
        raw(&st, &format!("{WS_A}/overleaf-token")).as_deref(),
        Some("old-ov")
    );
}

#[test]
fn upgrade_is_idempotent_and_never_reaches_another_workspace() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open a");
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));

    s.set_open_workspace(Some(WS_B)).expect("open b");
    assert_eq!(s.read("git-sync-token"), Ok(None), "b must not inherit a's token");

    s.set_open_workspace(Some(WS_A)).expect("back to a");
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
}

#[test]
fn a_failed_read_leaves_the_old_key_for_the_next_read() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    inject(
        &st,
        "git-sync-token",
        keyring_core::Error::PlatformFailure("boom".into()),
    );

    s.set_open_workspace(Some(WS_A)).expect("open");
    assert_eq!(s.read("git-sync-token"), Ok(None), "the failed read reads as nothing");
    assert_eq!(raw(&st, "git-sync-token").as_deref(), Some("old-git"), "old key kept");

    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
    assert_eq!(raw(&st, "git-sync-token"), None);
}

#[test]
fn clearing_a_workspace_token_also_retires_the_unscoped_one() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open");
    s.page_clear("git-sync-token").expect("clear");

    assert_eq!(s.read("git-sync-token"), Ok(None));
    assert_eq!(raw(&st, "git-sync-token"), None, "a cleared token never comes back");
    s.set_open_workspace(Some(WS_B)).expect("open b");
    assert_eq!(s.read("git-sync-token"), Ok(None));
}

#[test]
fn writing_in_a_workspace_retires_the_unscoped_key() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open");
    s.page_write("git-sync-token", "new-git").expect("write");

    assert_eq!(raw(&st, "git-sync-token"), None);
    assert_eq!(s.read("git-sync-token"), Ok(Some("new-git".to_owned())));
    s.set_open_workspace(Some(WS_B)).expect("open b");
    assert_eq!(s.read("git-sync-token"), Ok(None));
}

#[test]
fn with_no_workspace_open_the_unscoped_key_still_works() {
    // Existing callers (Overleaf, sync) keep their behaviour before any workspace is open.
    let st = store();
    let s = secrets(&st);
    s.write("overleaf-token", "tok").expect("write");
    assert_eq!(s.read("overleaf-token"), Ok(Some("tok".to_owned())));
    assert_eq!(raw(&st, "overleaf-token").as_deref(), Some("tok"));
}

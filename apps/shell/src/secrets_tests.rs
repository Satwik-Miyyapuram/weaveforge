//! Workspace-scoped secrets: each workspace sees only its own tokens, the page can only write
//! them into an open workspace, and an unscoped token from 0.9.2 is copied into each workspace on
//! first use. The unscoped token is never deleted, so every other workspace can still inherit it,
//! and a workspace that cleared a token never re-imports it.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::{Arc, mpsc};
use std::thread;
use std::time::Duration;

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
    store.build(SERVICE, user, None).ok()?.get_password().ok()
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
    assert_eq!(
        raw(&st, &format!("{WS_A}/git-sync-token")).as_deref(),
        Some("token-a")
    );

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
        assert_eq!(
            s.page_write(name, "x"),
            Err(SecretError::NoWorkspace),
            "{name}"
        );
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
    assert_eq!(
        s.page_write("git-sync-token", "x"),
        Err(SecretError::NoWorkspace)
    );
}

#[test]
fn upgrade_copies_an_unscoped_token_into_the_open_workspace() {
    // 0.9.2 wrote the tokens under their fixed names, with no workspace scope.
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.write("overleaf-token", "old-ov").expect("old write");

    s.set_open_workspace(Some(WS_A)).expect("open");
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
    assert_eq!(s.read("overleaf-token"), Ok(Some("old-ov".to_owned())));

    assert_eq!(
        raw(&st, &format!("{WS_A}/git-sync-token")).as_deref(),
        Some("old-git")
    );
    assert_eq!(
        raw(&st, &format!("{WS_A}/overleaf-token")).as_deref(),
        Some("old-ov")
    );
    assert_eq!(
        raw(&st, "git-sync-token").as_deref(),
        Some("old-git"),
        "the unscoped token is kept for other workspaces"
    );
    assert_eq!(
        raw(&st, "overleaf-token").as_deref(),
        Some("old-ov"),
        "the unscoped token is kept for other workspaces"
    );
}

#[test]
fn every_workspace_inherits_the_unscoped_token() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");

    s.set_open_workspace(Some(WS_A)).expect("open a");
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));

    s.set_open_workspace(Some(WS_B)).expect("open b");
    assert_eq!(
        s.read("git-sync-token"),
        Ok(Some("old-git".to_owned())),
        "b inherits the token that 0.9.2 shared"
    );
}

#[test]
fn clearing_in_one_workspace_leaves_the_other_and_never_reimports() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");

    s.set_open_workspace(Some(WS_A)).expect("open a");
    s.page_clear("git-sync-token").expect("clear a");
    assert_eq!(s.read("git-sync-token"), Ok(None));
    assert_eq!(s.read("git-sync-token"), Ok(None), "a stays cleared");
    assert_eq!(
        raw(&st, &format!("{WS_A}/git-sync-token")),
        None,
        "a cleared token never comes back"
    );
    assert_eq!(
        raw(&st, "git-sync-token").as_deref(),
        Some("old-git"),
        "clear never touches the unscoped token"
    );

    s.set_open_workspace(Some(WS_B)).expect("open b");
    assert_eq!(
        s.read("git-sync-token"),
        Ok(Some("old-git".to_owned())),
        "b still inherits it"
    );
}

#[test]
fn writing_in_a_workspace_leaves_the_unscoped_token_for_others() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open");
    s.page_write("git-sync-token", "new-git").expect("write");

    assert_eq!(s.read("git-sync-token"), Ok(Some("new-git".to_owned())));
    assert_eq!(
        raw(&st, "git-sync-token").as_deref(),
        Some("old-git"),
        "a write never touches the unscoped token"
    );
    s.set_open_workspace(Some(WS_B)).expect("open b");
    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
}

#[test]
fn a_failed_legacy_read_is_retried_on_the_next_read() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    inject(
        &st,
        "git-sync-token",
        keyring_core::Error::PlatformFailure("boom".into()),
    );

    s.set_open_workspace(Some(WS_A)).expect("open");
    assert_eq!(
        s.read("git-sync-token"),
        Ok(None),
        "the failed read reads as nothing"
    );
    assert_eq!(
        raw(&st, &format!("{WS_A}/git-sync-token")),
        None,
        "nothing was copied from a failed read"
    );

    assert_eq!(s.read("git-sync-token"), Ok(Some("old-git".to_owned())));
}

#[test]
fn an_unreadable_workspace_slot_is_never_overwritten_by_the_unscoped_token() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open");
    s.page_write("git-sync-token", "new-git").expect("write");
    inject(
        &st,
        &format!("{WS_A}/git-sync-token"),
        keyring_core::Error::PlatformFailure("boom".into()),
    );

    assert_eq!(
        s.read("git-sync-token"),
        Ok(None),
        "an unreadable slot reads as nothing"
    );
    assert_eq!(
        raw(&st, &format!("{WS_A}/git-sync-token")).as_deref(),
        Some("new-git"),
        "the stored workspace token survives"
    );
}

#[test]
fn an_unreadable_cleared_marker_does_not_reimport_the_unscoped_token() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open");
    s.page_clear("git-sync-token").expect("clear");
    inject(
        &st,
        &format!("{WS_A}/migrated/git-sync-token"),
        keyring_core::Error::PlatformFailure("boom".into()),
    );

    assert_eq!(
        s.read("git-sync-token"),
        Ok(None),
        "an unreadable marker fails closed"
    );
    assert_eq!(s.read("git-sync-token"), Ok(None), "still cleared");
}

#[test]
fn a_write_waits_for_a_migration_in_flight() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open");

    // Holding the storage lock stands in for a read that is migrating right now.
    let migration = s
        .storage
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (done, finished) = mpsc::channel();
    let writer = s.clone();
    let handle = thread::spawn(move || {
        writer
            .page_write("git-sync-token", "new-git")
            .expect("write");
        done.send(()).expect("signal");
    });
    assert!(
        finished.recv_timeout(Duration::from_millis(150)).is_err(),
        "the write must wait behind the migration"
    );
    drop(migration);
    finished
        .recv_timeout(Duration::from_secs(5))
        .expect("write finishes once the migration is done");
    handle.join().expect("join");

    assert_eq!(s.read("git-sync-token"), Ok(Some("new-git".to_owned())));
}

#[test]
fn a_clear_waits_for_a_migration_in_flight_and_stays_cleared() {
    let st = store();
    let s = secrets(&st);
    s.write("git-sync-token", "old-git").expect("old write");
    s.set_open_workspace(Some(WS_A)).expect("open");

    let migration = s
        .storage
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (done, finished) = mpsc::channel();
    let clearer = s.clone();
    let handle = thread::spawn(move || {
        clearer.page_clear("git-sync-token").expect("clear");
        done.send(()).expect("signal");
    });
    assert!(
        finished.recv_timeout(Duration::from_millis(150)).is_err(),
        "the clear must wait behind the migration"
    );
    drop(migration);
    finished
        .recv_timeout(Duration::from_secs(5))
        .expect("clear finishes once the migration is done");
    handle.join().expect("join");

    assert_eq!(s.read("git-sync-token"), Ok(None));
    assert_eq!(raw(&st, &format!("{WS_A}/git-sync-token")), None);
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

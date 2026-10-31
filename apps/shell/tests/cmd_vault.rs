#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]
mod common;

use std::fs;
use std::path::Path;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use common::TempDir;
use weaveforge_shell::cmd_vault::{
    BAD_BYTES, list, read, read_bytes, remove, root, stat, write, write_bytes,
};
use weaveforge_shell::vault::{EntryKindPayload, NO_ROOT, RootKind, VaultState};

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// A shared session with `dir` adopted as its root.
fn state_at(dir: &Path) -> VaultState {
    let state = VaultState::new();
    let _ = state.lock().adopt(Some(dir)).unwrap();
    state
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_root_everywhere() {
    let state = VaultState::new();
    assert_eq!(root(&state).await, None);
    assert_eq!(
        read(&state, "a.md".to_owned()).await,
        Err(NO_ROOT.to_owned())
    );
    assert_eq!(
        write(&state, "a.md".to_owned(), "x".to_owned()).await,
        Err(NO_ROOT.to_owned())
    );
    assert_eq!(
        read_bytes(&state, "a.md".to_owned()).await,
        Err(NO_ROOT.to_owned())
    );
    assert_eq!(
        write_bytes(&state, "a.md".to_owned(), "aGk=".to_owned()).await,
        Err(NO_ROOT.to_owned())
    );
    assert_eq!(list(&state, None).await, Err(NO_ROOT.to_owned()));
    assert_eq!(
        stat(&state, "a.md".to_owned()).await,
        Err(NO_ROOT.to_owned())
    );
    assert_eq!(
        remove(&state, "a.md".to_owned()).await,
        Err(NO_ROOT.to_owned())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn text_round_trip() {
    let dir = TempDir::new();
    let state = state_at(dir.path());

    write(&state, "notes/a.md".to_owned(), "héllo\n".to_owned())
        .await
        .unwrap();

    assert_eq!(
        read(&state, "notes/a.md".to_owned()).await,
        Ok(Some("héllo\n".to_owned()))
    );
    assert_eq!(read(&state, "missing.md".to_owned()).await, Ok(None));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bytes_round_trip() {
    let dir = TempDir::new();
    let state = state_at(dir.path());

    write_bytes(
        &state,
        "a.pdf".to_owned(),
        STANDARD.encode([0u8, 255, 1, 2]),
    )
    .await
    .unwrap();

    assert_eq!(
        read_bytes(&state, "a.pdf".to_owned()).await,
        Ok(Some("AP8BAg==".to_owned()))
    );
    assert_eq!(
        fs::read(dir.path().join("a.pdf")).unwrap(),
        [0u8, 255, 1, 2]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bytes_empty_round_trip() {
    let dir = TempDir::new();
    let state = state_at(dir.path());

    write_bytes(&state, "e.pdf".to_owned(), String::new())
        .await
        .unwrap();

    assert_eq!(fs::metadata(dir.path().join("e.pdf")).unwrap().len(), 0);
    assert_eq!(
        read_bytes(&state, "e.pdf".to_owned()).await,
        Ok(Some(String::new()))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_base64_writes_nothing() {
    let dir = TempDir::new();
    let state = state_at(dir.path());

    assert_eq!(
        write_bytes(&state, "b.pdf".to_owned(), "not base64!!".to_owned()).await,
        Err(BAD_BYTES.to_owned())
    );
    assert!(!dir.path().join("b.pdf").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn list_and_stat() {
    let dir = TempDir::new();
    let state = state_at(dir.path());
    write(&state, "x/one.md".to_owned(), "1".to_owned())
        .await
        .unwrap();
    write(&state, "two.md".to_owned(), "abc".to_owned())
        .await
        .unwrap();

    let listed = list(&state, None).await.unwrap();
    assert_eq!(listed.len(), 2);
    assert!(
        listed
            .iter()
            .any(|e| e.path == "two.md" && e.kind == EntryKindPayload::File)
    );
    assert!(
        listed
            .iter()
            .any(|e| e.path == "x" && e.kind == EntryKindPayload::Dir)
    );

    let sub = list(&state, Some("x".to_owned())).await.unwrap();
    assert_eq!(sub.len(), 1);
    assert_eq!(sub[0].path, "x/one.md");
    assert_eq!(sub[0].kind, EntryKindPayload::File);

    assert_eq!(
        stat(&state, "two.md".to_owned())
            .await
            .unwrap()
            .map(|e| e.size),
        Some(3)
    );
    assert_eq!(stat(&state, "nope".to_owned()).await, Ok(None));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remove_then_gone() {
    let dir = TempDir::new();
    let state = state_at(dir.path());
    write(&state, "gone.md".to_owned(), "x".to_owned())
        .await
        .unwrap();

    remove(&state, "gone.md".to_owned()).await.unwrap();

    assert_eq!(stat(&state, "gone.md".to_owned()).await, Ok(None));
    assert_eq!(read(&state, "gone.md".to_owned()).await, Ok(None));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn traversal_refused() {
    let dir = TempDir::new();
    let state = state_at(dir.path());
    let name = format!("wf-cmd-vault-{}", std::process::id());
    let rel = format!("../{name}");
    let refusal = format!("Unsafe workspace path: {rel}");

    assert_eq!(read(&state, rel.clone()).await, Err(refusal.clone()));
    assert_eq!(
        write(&state, rel.clone(), "a".to_owned()).await,
        Err(refusal.clone())
    );
    assert_eq!(remove(&state, rel.clone()).await, Err(refusal));
    assert!(!dir.path().parent().unwrap().join(&name).exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_state_clones() {
    let dir = TempDir::new();
    let state = VaultState::new();
    let clone = state.clone();

    let _ = state.lock().adopt(Some(dir.path())).unwrap();

    assert_eq!(root(&clone).await.map(|r| r.path), Some(text(dir.path())));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn root_reports_folder() {
    let dir = TempDir::new();
    let state = state_at(dir.path());

    let reported = root(&state).await;
    let expected = state.lock().root();

    assert_eq!(reported, expected);
    assert_eq!(
        reported.as_ref().map(|r| r.path.clone()),
        Some(text(dir.path()))
    );
    assert_eq!(reported.map(|r| r.state), Some(RootKind::Empty));
}

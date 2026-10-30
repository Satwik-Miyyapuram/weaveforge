#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Launches the real dev sidecar (`node --import tsx`) against the repo's own database code.

use std::path::PathBuf;
use std::time::Duration;

use weaveforge_shell::commands::LocalDb;
use weaveforge_shell::launch::{SidecarSource, sidecar_config};
use weaveforge_shell::sidecar::Sidecar;

/// Drops the `\\?\` verbatim prefix Windows adds, which node cannot resolve as a module path.
fn without_verbatim_prefix(path: PathBuf) -> PathBuf {
    match path.to_string_lossy().strip_prefix(r"\\?\") {
        Some(plain) => PathBuf::from(plain),
        None => path,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs npm ci and npm run build:core; run with --ignored"]
async fn dev_sidecar_opens_the_database() {
    let canonical =
        std::fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let repo = without_verbatim_prefix(canonical);
    let data = std::env::temp_dir()
        .join(format!("wf-launch-test-{}", std::process::id()))
        .join("local-db");
    let config = sidecar_config(&SidecarSource::Dev { repo }, &data);
    let db = LocalDb::new(Sidecar::spawn(config), data.to_string_lossy().into_owned());
    let rows = db
        .query("select 1 as x".to_owned(), Vec::new())
        .await
        .unwrap();
    assert_eq!(rows, vec![serde_json::json!({"x": 1})]);
    let state = db.state().await.unwrap();
    assert_eq!(state.failure, None);
    assert!(db.shutdown(Duration::from_secs(5)).await);
    let _ = std::fs::remove_dir_all(data.parent().unwrap());
}

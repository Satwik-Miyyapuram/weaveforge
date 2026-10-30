#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Launches the real dev sidecar (`node --import tsx`) against the repo's own database code.

use std::path::PathBuf;
use std::time::Duration;

use weaveforge_shell::commands::LocalDb;
use weaveforge_shell::launch::{SidecarSource, sidecar_config};
use weaveforge_shell::sidecar::Sidecar;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs npm ci and npm run build:core; run with --ignored"]
async fn dev_sidecar_opens_the_database() {
    // Canonical, so `\\?\`-prefixed on Windows like Tauri's resource dir: sidecar_config must drop it.
    let repo =
        std::fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let data = std::env::temp_dir()
        .join(format!("wf-launch-test-{}", std::process::id()))
        .join("local-db");
    let backups = data.parent().unwrap().join("local-db-backups");
    let config = sidecar_config(&SidecarSource::Dev { repo }, &data, &backups);
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

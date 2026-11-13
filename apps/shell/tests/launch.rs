#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Launches the real dev sidecar (`node --import tsx`) to read the old PGlite database for the import.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::json;
use weaveforge_shell_lib::launch::{ApiArgs, SidecarSource, sidecar_config};
use weaveforge_shell_lib::old_db::OldDb;
use weaveforge_shell_lib::sidecar::SidecarConfig;

/// Local API args for a data dir: artifacts go next to it.
fn api_args(data: &Path) -> ApiArgs {
    ApiArgs {
        artifacts: data.parent().unwrap().join("artifacts"),
        app_version: "0.0.0-test".to_owned(),
        product_name: "WeaveForge".to_owned(),
    }
}

/// Dev sidecar config for a data dir; backups go next to it.
fn dev_config(data: &Path) -> SidecarConfig {
    // Canonical, so `\\?\`-prefixed on Windows like Tauri's resource dir: sidecar_config must drop it.
    let repo =
        std::fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let backups = data.parent().unwrap().join("local-db-backups");
    sidecar_config(
        &SidecarSource::Dev { repo },
        data,
        &backups,
        &api_args(data),
        None,
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs npm ci and npm run build:core; run with --ignored"]
async fn dev_sidecar_reads_the_old_database() {
    let data = std::env::temp_dir()
        .join(format!("wf-launch-test-{}", std::process::id()))
        .join("local-db");
    let old = OldDb::new(dev_config(&data));
    let rows = old.rows("select 1 as x".to_owned()).await.unwrap();
    assert_eq!(rows, vec![json!({"x": 1})]);
    old.stop(Duration::from_secs(5)).await;
    assert!(!old.running().await);
    let _ = std::fs::remove_dir_all(data.parent().unwrap());
}

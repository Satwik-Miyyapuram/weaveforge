#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Launches the real dev sidecar (`node --import tsx`) against the repo's own database code.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::json;
use weaveforge_shell::commands::LocalDb;
use weaveforge_shell::launch::{SidecarSource, sidecar_config};
use weaveforge_shell::sidecar::{Sidecar, SidecarConfig};

/// Dev sidecar config for a data dir; backups go next to it.
fn dev_config(data: &Path) -> SidecarConfig {
    // Canonical, so `\\?\`-prefixed on Windows like Tauri's resource dir: sidecar_config must drop it.
    let repo =
        std::fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let backups = data.parent().unwrap().join("local-db-backups");
    sidecar_config(&SidecarSource::Dev { repo }, data, &backups)
}

/// Whether the process with `pid` still runs.
fn alive(pid: u32) -> bool {
    if cfg!(windows) {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .any(|word| word == pid.to_string())
    } else {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .unwrap()
            .success()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs npm ci and npm run build:core; run with --ignored"]
async fn dev_sidecar_opens_the_database() {
    let data = std::env::temp_dir()
        .join(format!("wf-launch-test-{}", std::process::id()))
        .join("local-db");
    let db = LocalDb::new(
        Sidecar::spawn(dev_config(&data)),
        data.to_string_lossy().into_owned(),
    );
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

/// Runs as the helper for `real_orphan_frees_the_database`: opens the real sidecar on the data dir, prints its pid, sleeps.
#[test]
fn real_orphan_helper() {
    let Some(data) = std::env::var_os("WF_REAL_ORPHAN_DATA") else {
        return;
    };
    let data = PathBuf::from(data);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let sidecar = Sidecar::spawn(dev_config(&data));
        let pid = sidecar.as_ref().unwrap().pid().unwrap();
        let db = LocalDb::new(sidecar, data.to_string_lossy().into_owned());
        assert!(
            db.query("select 1 as x".to_owned(), Vec::new())
                .await
                .is_ok()
        );
        println!("PID {pid}");
        let _ = std::io::stdout().flush();
        std::thread::sleep(Duration::from_secs(120));
    });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs npm ci and npm run build:core; run with --ignored"]
async fn real_orphan_frees_the_database() {
    let parent = std::env::temp_dir().join(format!("wf-orphan-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&parent);
    let data = parent.join("local-db");

    let exe = std::env::current_exe().unwrap();
    let mut helper = std::process::Command::new(exe)
        .args([
            "real_orphan_helper",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("WF_REAL_ORPHAN_DATA", &data)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = helper.stdout.take().unwrap();
    let sidecar_pid = BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
        // Under --nocapture the harness prints "test real_orphan_helper ... " before our line.
        .find_map(|line| line.split("PID ").nth(1)?.trim().parse::<u32>().ok())
        .unwrap();

    // The helper holds the lock, so a second sidecar on the same dir fails its first query.
    let second = LocalDb::new(
        Sidecar::spawn(dev_config(&data)),
        data.to_string_lossy().into_owned(),
    );
    assert!(
        second
            .query("select 1".to_owned(), Vec::new())
            .await
            .is_err()
    );
    let _ = second.shutdown(Duration::from_secs(5)).await;

    helper.kill().unwrap();
    let _ = helper.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    while alive(sidecar_pid) && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        !alive(sidecar_pid),
        "real sidecar {sidecar_pid} outlived its parent"
    );

    // The stale lock from the dead pid must be taken over.
    let third = LocalDb::new(
        Sidecar::spawn(dev_config(&data)),
        data.to_string_lossy().into_owned(),
    );
    let rows = third
        .query("select 1 as x".to_owned(), Vec::new())
        .await
        .unwrap();
    assert_eq!(rows, vec![json!({"x": 1})]);
    let state = third.state().await.unwrap();
    assert_eq!(state.failure, None);
    assert!(third.shutdown(Duration::from_secs(5)).await);
    let _ = std::fs::remove_dir_all(&parent);
}

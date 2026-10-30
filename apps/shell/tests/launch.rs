#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Launches the real dev sidecar (`node --import tsx`) against the repo's own database code.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
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
    sidecar_config(&SidecarSource::Dev { repo }, data, &backups, None)
}

/// Dev sidecar config that first copies the Electron data dir `old` into `data`'s parent.
fn dev_config_from(data: &Path, old: &Path) -> SidecarConfig {
    let repo =
        std::fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let backups = data.parent().unwrap().join("local-db-backups");
    sidecar_config(&SidecarSource::Dev { repo }, data, &backups, Some(old))
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

/// Kills and reaps the helper when the test ends, also when it panics first.
struct KillOnDrop(Child);

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
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
    let mut helper = KillOnDrop(
        std::process::Command::new(exe)
            .args([
                "real_orphan_helper",
                "--exact",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("WF_REAL_ORPHAN_DATA", &data)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let stdout = helper.0.stdout.take().unwrap();
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

    // On Windows the Job Object hard-kills the sidecar with the helper, so its lock goes stale.
    // Elsewhere the sidecar exits on stdin EOF and releases its lock, so kill it hard first to
    // leave a stale lock (its exit on stdin EOF is what every clean shutdown here proves).
    #[cfg(unix)]
    assert!(
        std::process::Command::new("kill")
            .args(["-9", &sidecar_pid.to_string()])
            .status()
            .unwrap()
            .success()
    );
    helper.0.kill().unwrap();
    let _ = helper.0.wait().unwrap();
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs npm ci and npm run build:core; run with --ignored"]
async fn real_sidecar_migrates_electron_data() {
    let root = std::env::temp_dir().join(format!("wf-migrate-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let old = root.join("old");
    let new_data = root.join("new").join("local-db");

    let electron = LocalDb::new(
        Sidecar::spawn(dev_config(&old.join("local-db"))),
        old.join("local-db").to_string_lossy().into_owned(),
    );
    // DDL is refused for the app role, so the probe is a row written into the existing `sync_state` table.
    assert!(
        electron
            .query("update sync_state set watermark = 5".to_owned(), Vec::new())
            .await
            .is_ok()
    );
    assert!(electron.shutdown(Duration::from_secs(15)).await);
    std::fs::write(old.join("preferences.json"), r#"{"theme":"dark"}"#).unwrap();
    std::fs::create_dir_all(old.join("models")).unwrap();
    std::fs::write(old.join("models").join("m.bin"), b"abc").unwrap();

    let fresh = LocalDb::new(
        Sidecar::spawn(dev_config_from(&new_data, &old)),
        new_data.to_string_lossy().into_owned(),
    );
    let rows = fresh
        .query(
            "select watermark::int as x from sync_state".to_owned(),
            Vec::new(),
        )
        .await
        .unwrap();
    assert_eq!(rows, vec![json!({"x": 5})]);
    assert!(fresh.shutdown(Duration::from_secs(15)).await);

    assert_eq!(
        std::fs::read(root.join("new").join("preferences.json")).unwrap(),
        std::fs::read(old.join("preferences.json")).unwrap()
    );
    assert_eq!(
        std::fs::read(root.join("new").join("models").join("m.bin")).unwrap(),
        b"abc"
    );
    assert!(old.join("migrated").exists());
    assert!(root.join("new").join("migrated-from-electron").exists());
    assert!(old.join("local-db").exists());
    assert!(old.join("preferences.json").exists());
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs npm ci and npm run build:core; run with --ignored"]
async fn real_sidecar_reports_old_app_running() {
    let root = std::env::temp_dir().join(format!("wf-busy-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let old = root.join("old");
    let new_data = root.join("new").join("local-db");
    std::fs::create_dir_all(old.join("local-db")).unwrap();
    // A live holder that is not the sidecar; `at` is in the future so it cannot predate this boot.
    let holder = format!(
        r#"{{"pid":{},"app":"WeaveForge","at":"2100-01-01T00:00:00.000Z"}}"#,
        std::process::id()
    );
    std::fs::write(old.join("local-db.lock"), holder).unwrap();

    let fresh = LocalDb::new(
        Sidecar::spawn(dev_config_from(&new_data, &old)),
        new_data.to_string_lossy().into_owned(),
    );
    let state = fresh.state().await.unwrap();
    let failure = state.failure.unwrap_or_default();
    assert!(
        failure.contains("old WeaveForge app is running"),
        "failure: {failure}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

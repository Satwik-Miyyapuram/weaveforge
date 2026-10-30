#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the local database commands, run against `tests/fixtures/fake-sidecar.mjs`.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::json;
use weaveforge_shell::commands::{DbState, Json, LocalDb, ShellError, export_bindings};
use weaveforge_shell::sidecar::{Sidecar, SidecarConfig, SidecarError};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-sidecar.mjs")
}

fn config(extra: &[&str]) -> SidecarConfig {
    let args = std::iter::once(fixture().into_os_string())
        .chain(extra.iter().map(|s| OsString::from(*s)))
        .collect();
    SidecarConfig {
        program: PathBuf::from("node"),
        args,
        cwd: None,
        call_timeout: Duration::from_secs(5),
        max_in_flight: 8,
        max_request_bytes: 4096,
        max_reply_bytes: 1 << 20,
    }
}

fn db(extra: &[&str]) -> LocalDb {
    LocalDb::new(Sidecar::spawn(config(extra)), "/d".to_owned())
}

fn shell_error(message: &str) -> ShellError {
    ShellError {
        message: message.to_owned(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn query_returns_rows() {
    let rows = db(&[])
        .query("select 1".into(), vec![json!(1), json!({"$bytes": "AQI="})])
        .await;
    assert_eq!(
        rows,
        Ok(vec![
            json!({"sql": "select 1", "params": [1, {"$bytes": "AQI="}]})
        ])
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn query_error_is_verbatim() {
    let rows = db(&[]).query("fail".into(), vec![]).await;
    assert_eq!(rows, Err(shell_error("relation missing")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn query_non_list_reply() {
    let rows = db(&[]).query("scalar".into(), vec![]).await;
    assert_eq!(
        rows,
        Err(shell_error("local database: reply is not a list"))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_failure_is_reported() {
    let db = LocalDb::new(Err(SidecarError::Spawn("nope".into())), "/d".into());
    assert_eq!(
        db.query("select 1".into(), vec![]).await,
        Err(shell_error("local database failed to start: nope"))
    );
    assert_eq!(
        db.state().await,
        Ok(DbState {
            failure: Some("local database failed to start: nope".into()),
            data_dir: "/d".into(),
            restored_from: None,
        })
    );
    assert!(!db.shutdown(Duration::from_secs(1)).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_passes_through() {
    assert_eq!(
        db(&[]).state().await,
        Ok(DbState {
            failure: None,
            data_dir: "/fake".into(),
            restored_from: None,
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_after_stop() {
    let db = db(&[]);
    assert!(db.shutdown(Duration::from_secs(5)).await);
    assert_eq!(
        db.state().await,
        Ok(DbState {
            failure: Some("local database stopped".into()),
            data_dir: "/d".into(),
            restored_from: None,
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_state_reply() {
    assert_eq!(
        db(&["--bad-state"]).state().await,
        Ok(DbState {
            failure: Some("local database: bad state reply".into()),
            data_dir: "/d".into(),
            restored_from: None,
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_timeout_is_an_error() {
    let mut cfg = config(&["--slow-state"]);
    cfg.call_timeout = Duration::from_millis(200);
    let db = LocalDb::new(Sidecar::spawn(cfg), "/d".to_owned());
    assert_eq!(
        db.state().await,
        Err(shell_error("local database timed out"))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_busy_is_an_error() {
    let mut cfg = config(&["--slow-state"]);
    cfg.max_in_flight = 1;
    let db = LocalDb::new(Sidecar::spawn(cfg), "/d".to_owned());
    let (a, b) = tokio::join!(db.state(), db.state());
    let busy = Err(shell_error("local database is busy"));
    assert!(a == busy || b == busy, "{a:?} {b:?}");
    assert!(a.is_ok() || b.is_ok(), "{a:?} {b:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_not_supported() {
    assert_eq!(
        db(&[]).reset().await,
        Err(shell_error("reset is not supported yet"))
    );
}

#[test]
fn db_state_is_camel_case() {
    let state = DbState {
        failure: None,
        data_dir: "/x".into(),
        restored_from: None,
    };
    assert_eq!(
        serde_json::to_value(state).unwrap(),
        json!({"failure": null, "dataDir": "/x", "restoredFrom": null})
    );
    let parsed: DbState = serde_json::from_value(json!({"failure": "f", "dataDir": "/y"})).unwrap();
    assert_eq!(parsed.restored_from, None);
}

#[test]
fn json_wrapper_round_trips() {
    let input = json!({"$bigint": "9007199254740993"});
    let it: Json = serde_json::from_value(input.clone()).unwrap();
    assert_eq!(serde_json::to_value(&it).unwrap(), input);
}

#[test]
fn bindings_are_fresh() {
    let want = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bridge/bindings.ts");
    let tmp = std::env::temp_dir().join(format!("wf-bindings-{}.ts", std::process::id()));
    export_bindings(&tmp).unwrap();
    let generated = std::fs::read_to_string(&tmp).unwrap();
    std::fs::remove_file(&tmp).unwrap();

    if std::env::var("WF_UPDATE_BINDINGS").as_deref() == Ok("1") {
        std::fs::create_dir_all(want.parent().unwrap()).unwrap();
        std::fs::write(&want, &generated).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(&want).unwrap();
    assert_eq!(
        committed.replace("\r\n", "\n"),
        generated.replace("\r\n", "\n"),
        "bridge/bindings.ts is stale: run WF_UPDATE_BINDINGS=1 cargo test --test commands"
    );
}

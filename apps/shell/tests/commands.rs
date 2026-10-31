#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the local database commands, run against `tests/fixtures/fake-sidecar.mjs`.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
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

static MARKERS: AtomicUsize = AtomicUsize::new(0);

/// A marker path unique to this run; the fixture creates it to ask for a restart.
fn marker() -> PathBuf {
    let n = MARKERS.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("wf-restart-{}-{n}", std::process::id()))
}

fn restartable(extra: &[&str]) -> LocalDb {
    let cfg = config(extra);
    LocalDb::new(Sidecar::spawn(cfg.clone()), "/d".to_owned()).restartable(cfg)
}

async fn pid(db: &LocalDb) -> u64 {
    let rows = db.query("pid".into(), vec![]).await.unwrap();
    rows[0]["pid"].as_u64().unwrap()
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
async fn reset_refusal_is_verbatim() {
    assert_eq!(
        db(&["--reset-refuse"]).reset().await,
        Err(shell_error("nothing to reset"))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_without_restart_keeps_the_sidecar() {
    let m = marker();
    std::fs::write(&m, "").unwrap();
    let arg = m.to_string_lossy().into_owned();
    let db = restartable(&["--restart-marker", &arg]);
    let before = pid(&db).await;
    assert_eq!(db.reset().await, Ok(()));
    assert_eq!(pid(&db).await, before);
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_with_restart_respawns() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let db = restartable(&["--restart-marker", &arg]);
    let before = pid(&db).await;
    assert_eq!(db.reset().await, Ok(()));
    assert!(m.exists());
    let after = pid(&db).await;
    assert_ne!(after, before);
    let _ = std::fs::remove_file(&m);
}

/// The pid of the current sidecar and the last `vault.root` params it got.
async fn root_seen(db: &LocalDb) -> (u64, serde_json::Value) {
    let rows = db.query("root".into(), vec![]).await.unwrap();
    (rows[0]["pid"].as_u64().unwrap(), rows[0]["root"].clone())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_with_restart_sends_the_vault_root_to_the_new_sidecar() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let db = restartable(&["--restart-marker", &arg]).with_vault_root(std::sync::Arc::new(
        || json!({"root": "/v", "kind": "local"}),
    ));
    let (before, root) = root_seen(&db).await;
    assert_eq!(
        root,
        serde_json::Value::Null,
        "nothing sent before a restart"
    );
    assert_eq!(db.reset().await, Ok(()));
    let (after, root) = root_seen(&db).await;
    assert_ne!(after, before);
    assert_eq!(root, json!({"root": "/v", "kind": "local"}));
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_with_restart_succeeds_when_the_sidecar_refuses_the_vault_root() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let warned = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let sink = std::sync::Arc::clone(&warned);
    let db = restartable(&["--restart-marker", &arg])
        .with_vault_root(std::sync::Arc::new(|| json!({"refuse": true})))
        .with_warn(std::sync::Arc::new(move |line: &str| {
            sink.lock().unwrap().push(line.to_owned());
        }));
    let (before, _) = root_seen(&db).await;
    assert_eq!(
        db.reset().await,
        Ok(()),
        "the respawn worked, so the reset did"
    );
    let (after, root) = root_seen(&db).await;
    assert_ne!(after, before, "a new sidecar runs");
    assert_eq!(
        root,
        serde_json::Value::Null,
        "the refused folder was not kept"
    );
    assert_eq!(
        *warned.lock().unwrap(),
        vec!["the restarted sidecar did not get the workspace folder: folder refused".to_owned()],
        "the refusal goes to the warn sink"
    );
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_with_restart_sends_the_vault_root_read_at_restart() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let calls = std::sync::Arc::new(AtomicUsize::new(0));
    let seen = std::sync::Arc::clone(&calls);
    let db = restartable(&["--restart-marker", &arg]).with_vault_root(std::sync::Arc::new(
        move || json!({"root": seen.fetch_add(1, Ordering::Relaxed)}),
    ));
    let (before, _) = root_seen(&db).await;
    assert!(db.state().await.is_ok());
    let (after, root) = root_seen(&db).await;
    assert_ne!(after, before);
    assert_eq!(root, json!({"root": 0}));
    assert_eq!(
        calls.load(Ordering::Relaxed),
        1,
        "read once, at the restart"
    );
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_without_restart_sends_no_vault_root() {
    let m = marker();
    std::fs::write(&m, "").unwrap();
    let arg = m.to_string_lossy().into_owned();
    let db = restartable(&["--restart-marker", &arg])
        .with_vault_root(std::sync::Arc::new(|| json!({"root": "/v"})));
    assert_eq!(db.reset().await, Ok(()));
    assert_eq!(root_seen(&db).await.1, serde_json::Value::Null);
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_with_restart_respawns_once() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let db = restartable(&["--restart-marker", &arg]);
    let before = pid(&db).await;
    assert_eq!(
        db.state().await,
        Ok(DbState {
            failure: None,
            data_dir: "/fake".into(),
            restored_from: None,
        })
    );
    assert_ne!(pid(&db).await, before);
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_after_restart_opens_the_new_database() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let db = restartable(&["--restart-marker", &arg, "--report-open"]);
    let state = db.state().await.unwrap();
    assert_eq!(state.restored_from.as_deref(), Some("opened"));
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_restart_requests_restart_once() {
    let m = marker();
    let log = m.with_extension("spawns");
    let (m_arg, log_arg) = (
        m.to_string_lossy().into_owned(),
        log.to_string_lossy().into_owned(),
    );
    let db = restartable(&["--restart-marker", &m_arg, "--spawn-log", &log_arg]);
    let (a, b) = tokio::join!(db.state(), db.reset());
    assert!(a.is_ok(), "{a:?}");
    assert_eq!(b, Ok(()));
    let spawns = std::fs::read_to_string(&log).unwrap().lines().count();
    assert_eq!(spawns, 2, "one start plus one restart");
    let _ = std::fs::remove_file(&m);
    let _ = std::fs::remove_file(&log);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_needs_a_config() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let db = db(&["--restart-marker", &arg]);
    assert_eq!(
        db.reset().await,
        Err(shell_error(
            "local database: restart the app to finish the reset"
        ))
    );
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_without_config_still_answers() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let db = db(&["--restart-marker", &arg]);
    let state = db.state().await;
    assert_eq!(state.map(|s| s.data_dir), Ok("/fake".to_owned()));
    let _ = std::fs::remove_file(&m);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_respawn_is_reported_in_state() {
    let m = marker();
    let arg = m.to_string_lossy().into_owned();
    let mut bad = config(&[]);
    bad.program = PathBuf::from("wf-no-such-program");
    let db = LocalDb::new(
        Sidecar::spawn(config(&["--restart-marker", &arg])),
        "/d".to_owned(),
    )
    .restartable(bad);
    let state = db.state().await.unwrap();
    assert_eq!(state.data_dir, "/d");
    assert!(
        state
            .failure
            .as_deref()
            .is_some_and(|f| f.starts_with("local database failed to start")),
        "{state:?}"
    );
    let _ = std::fs::remove_file(&m);
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

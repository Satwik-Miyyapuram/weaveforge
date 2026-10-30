#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the Rust sidecar client, run against `tests/fixtures/fake-sidecar.mjs`.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
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
        call_timeout: Duration::from_secs(5),
        max_in_flight: 8,
        max_request_bytes: 4096,
    }
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

/// Polls `alive` until it is false or `within` has passed. Returns true when it died in time.
async fn dies_within(pid: u32, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    while alive(pid) {
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    true
}

/// Runs the test binary as `orphan_helper`, which spawns a sidecar and prints its pid.
/// Returns the sidecar pid and the helper process.
fn spawn_orphan_helper(sidecar_args: &str) -> (u32, std::process::Child) {
    let exe = std::env::current_exe().unwrap();
    let mut helper = std::process::Command::new(exe)
        .args([
            "orphan_helper",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("WF_ORPHAN_HELPER", "1")
        .env("WF_ORPHAN_ARGS", sidecar_args)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = helper.stdout.take().unwrap();
    let pid = BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
        // Under --nocapture the harness prints "test orphan_helper ... " before our line.
        .find_map(|line| line.split("PID ").nth(1)?.trim().parse::<u32>().ok())
        .unwrap();
    (pid, helper)
}

/// Kills the helper and asserts the sidecar it started dies within 5 s.
fn assert_orphan_dies(sidecar_pid: u32, mut helper: std::process::Child) {
    helper.kill().unwrap();
    let _ = helper.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while alive(sidecar_pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        !alive(sidecar_pid),
        "sidecar {sidecar_pid} outlived its parent"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn echo_round_trip() {
    let s = Sidecar::spawn(config(&[])).unwrap();
    let params = json!({"a": [1, "x"]});
    let value = s.call("echo", params.clone()).await;
    assert_eq!(value, Ok(params));
    assert_eq!(s.in_flight(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn out_of_order_replies() {
    let s = Sidecar::spawn(config(&[])).unwrap();
    let slow = async {
        let r = s.call("slow", json!({"ms": 300})).await;
        (r, Instant::now())
    };
    let fast = async {
        let r = s.call("echo", json!(1)).await;
        (r, Instant::now())
    };
    let ((slow_r, slow_at), (fast_r, fast_at)) = tokio::join!(slow, fast);
    assert_eq!(slow_r, Ok(json!({"ms": 300})));
    assert_eq!(fast_r, Ok(json!(1)));
    assert!(fast_at < slow_at, "echo should finish before slow");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remote_error() {
    let s = Sidecar::spawn(config(&[])).unwrap();
    assert_eq!(
        s.call("fail", Value::Null).await,
        Err(SidecarError::Remote("boom".to_owned()))
    );
    assert_eq!(
        s.call("bogus", Value::Null).await,
        Err(SidecarError::Remote("unknown method: bogus".to_owned()))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn timeout_frees_slot() {
    let mut cfg = config(&[]);
    cfg.call_timeout = Duration::from_millis(300);
    let s = Sidecar::spawn(cfg).unwrap();
    assert_eq!(
        s.call("noreply", Value::Null).await,
        Err(SidecarError::Timeout)
    );
    assert_eq!(s.in_flight(), 0);
    assert_eq!(s.call("echo", json!(1)).await, Ok(json!(1)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn busy_when_full() {
    let mut cfg = config(&[]);
    cfg.max_in_flight = 2;
    cfg.call_timeout = Duration::from_secs(2);
    let s = Arc::new(Sidecar::spawn(cfg).unwrap());

    let first = tokio::spawn({
        let s = Arc::clone(&s);
        async move { s.call("noreply", Value::Null).await }
    });
    let second = tokio::spawn({
        let s = Arc::clone(&s);
        async move { s.call("noreply", Value::Null).await }
    });

    let deadline = Instant::now() + Duration::from_secs(2);
    while s.in_flight() < 2 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(s.in_flight(), 2);
    assert_eq!(s.call("echo", json!(1)).await, Err(SidecarError::Busy));

    assert_eq!(first.await.unwrap(), Err(SidecarError::Timeout));
    assert_eq!(second.await.unwrap(), Err(SidecarError::Timeout));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn too_large_writes_nothing() {
    let mut cfg = config(&[]);
    cfg.max_request_bytes = 100;
    let s = Sidecar::spawn(cfg).unwrap();
    let big = "x".repeat(200);
    assert_eq!(
        s.call("echo", json!(big)).await,
        Err(SidecarError::TooLarge)
    );
    assert_eq!(s.in_flight(), 0);
    assert_eq!(s.call("echo", json!(1)).await, Ok(json!(1)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn junk_line_is_skipped() {
    let s = Sidecar::spawn(config(&[])).unwrap();
    assert_eq!(s.call("junk", Value::Null).await, Ok(json!("after-junk")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn crash_fails_pending_and_later_calls() {
    let s = Sidecar::spawn(config(&[])).unwrap();

    let start = Instant::now();
    assert_eq!(
        s.call("crash", Value::Null).await,
        Err(SidecarError::Exited)
    );
    assert!(start.elapsed() < Duration::from_secs(3));

    let start = Instant::now();
    assert_eq!(s.call("echo", json!(1)).await, Err(SidecarError::Exited));
    assert!(start.elapsed() < Duration::from_secs(1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_error() {
    let mut cfg = config(&[]);
    cfg.program = PathBuf::from("definitely-not-a-real-binary-wf");
    assert!(matches!(Sidecar::spawn(cfg), Err(SidecarError::Spawn(_))));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_clean() {
    let s = Sidecar::spawn(config(&[])).unwrap();
    let pid = s.pid().unwrap();
    assert!(s.shutdown(Duration::from_secs(5)).await);
    assert!(!alive(pid));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_kills_hung_child() {
    let s = Sidecar::spawn(config(&["--ignore-eof"])).unwrap();
    let pid = s.pid().unwrap();

    let start = Instant::now();
    assert!(!s.shutdown(Duration::from_millis(300)).await);
    assert!(start.elapsed() < Duration::from_secs(3));
    assert!(dies_within(pid, Duration::from_secs(3)).await);
}

#[test]
fn orphan_helper() {
    if std::env::var_os("WF_ORPHAN_HELPER").is_none() {
        return;
    }
    let args: Vec<OsString> = std::env::var("WF_ORPHAN_ARGS")
        .unwrap()
        .split('|')
        .map(OsString::from)
        .collect();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let mut cfg = config(&[]);
        cfg.args = args;
        let sidecar = Sidecar::spawn(cfg).unwrap();
        println!("PID {}", sidecar.pid().unwrap());
        let _ = std::io::stdout().flush();
        std::thread::sleep(Duration::from_secs(60));
    });
}

#[test]
fn orphan_dies_with_parent_stdin_eof() {
    let (pid, helper) = spawn_orphan_helper(&fixture().display().to_string());
    assert_orphan_dies(pid, helper);
}

#[cfg(windows)]
#[test]
fn orphan_dies_with_job_object() {
    let args = format!("{}|--ignore-eof", fixture().display());
    let (pid, helper) = spawn_orphan_helper(&args);
    assert_orphan_dies(pid, helper);
}

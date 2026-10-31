//! Crash safety of `Vault::write_file`: a writer killed mid-write must never leave a torn
//! target, and the `WorkspaceFs` port must map vault results onto its own error type.
//!
//! The kill test re-runs this test binary as a child writer (`crash_child_writer`, ignored
//! unless `WF_CRASH_ROOT` is set), kills it at seeded moments, and checks the target holds
//! exactly one whole version.

#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use wf_core::sync::workspace_fs::{FsError, FsKind, WorkspaceFs};
use wf_store::vault::{TEMP_SUFFIX, Vault};

const TARGET: &str = "notes/target.md";
const A_LEN: usize = 4 * 1024 * 1024;
const B_LEN: usize = 3 * 1024 * 1024 + 17;
const ROUNDS: u32 = 25;
const SEED: u64 = 0x9E37_79B9_7F4A_7C15;

/// The first whole version: every byte is `a`.
fn version_a() -> Vec<u8> {
    vec![b'a'; A_LEN]
}

/// The second whole version: every byte is `b`, with a different length from `a`.
fn version_b() -> Vec<u8> {
    vec![b'b'; B_LEN]
}

/// Child writer: when `WF_CRASH_ROOT` is set, writes forever until the parent kills it.
#[test]
#[ignore]
fn crash_child_writer() {
    let Some(root) = std::env::var_os("WF_CRASH_ROOT") else {
        return;
    };
    let vault = Vault::new(PathBuf::from(root));
    let (a, b) = (version_a(), version_b());
    vault.write_file(TARGET, &a).expect("first write");
    fs::write(vault.root().join("ready"), b"1").expect("ready marker");
    loop {
        vault.write_file(TARGET, &a).expect("write a");
        vault.write_file(TARGET, &b).expect("write b");
    }
}

/// A fresh, empty temp root for one round.
fn fresh_root(round: u32) -> PathBuf {
    let root = std::env::temp_dir().join(format!("wf-crash-{}-{round}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create crash root");
    root
}

/// One xorshift64 step; no `rand` crate needed.
fn xorshift(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

/// Starts a child writer under `root`, spawned from this test binary.
fn spawn_child(root: &Path) -> Child {
    Command::new(std::env::current_exe().expect("current test binary"))
        .args([
            "crash_child_writer",
            "--exact",
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("WF_CRASH_ROOT", root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn child writer")
}

/// Polls for the child's `ready` marker; kills the child and panics after 30 s.
fn wait_for_ready(root: &Path, child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !root.join("ready").exists() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            panic!("child writer never reported ready in {}", root.display());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Runs one round: starts a child, waits until it is writing, kills it after a seeded
/// 1..=40 ms, and returns the root for inspection.
fn kill_writer_at_seeded_moment(round: u32) -> PathBuf {
    let root = fresh_root(round);
    let mut child = spawn_child(&root);
    wait_for_ready(&root, &mut child);
    let mut state = SEED ^ u64::from(round);
    let delay_ms = 1 + xorshift(&mut state) % 40;
    std::thread::sleep(Duration::from_millis(delay_ms));
    child.kill().expect("kill child writer");
    let _ = child.wait();
    root
}

/// Asserts `bytes` is exactly version a or version b. Panics with the round, length and first
/// differing index only, never the whole buffer.
fn assert_whole_version(bytes: &[u8], round: u32) {
    let want = match bytes.len() {
        A_LEN => b'a',
        B_LEN => b'b',
        len => panic!("round {round}: torn target, len {len} is neither {A_LEN} nor {B_LEN}"),
    };
    if let Some(index) = bytes.iter().position(|&byte| byte != want) {
        panic!(
            "round {round}: torn target, len {}, first differing index {index}",
            bytes.len()
        );
    }
}

/// Unwraps a port result; the port's error type need not implement `Debug`.
fn ok<T>(result: Result<T, FsError>, what: &str) -> T {
    match result {
        Ok(value) => value,
        Err(_) => panic!("{what} failed"),
    }
}

/// A killed writer never leaves the target torn: it is always exactly one whole version.
#[test]
fn killed_writer_never_leaves_a_torn_file() {
    for round in 0..ROUNDS {
        let root = kill_writer_at_seeded_moment(round);
        let bytes = fs::read(root.join(TARGET)).expect("target exists after the first write");
        assert_whole_version(&bytes, round);
        let _ = Vault::new(root.clone())
            .read_text(TARGET)
            .expect("target reads back through the vault");
        let _ = fs::remove_dir_all(&root);
    }
}

/// A kill may leave a `*.wftmp` sibling; listings must skip it and the target stays whole.
#[test]
fn leftover_temp_file_is_not_listed_as_a_note() {
    // Round 1000 keeps this test's folder apart from the rounds the other test uses.
    let round = 1000;
    let root = kill_writer_at_seeded_moment(round);
    let walked = Vault::new(root.clone()).walk("").expect("walk root");
    assert!(
        walked
            .iter()
            .all(|entry| !entry.path.ends_with(TEMP_SUFFIX)),
        "a temp file was listed"
    );
    let bytes = fs::read(root.join(TARGET)).expect("target exists");
    assert_whole_version(&bytes, round);
    let _ = fs::remove_dir_all(&root);
}

/// The vault answers every `WorkspaceFs` call with the port's types and error mapping.
#[test]
fn vault_satisfies_workspace_fs() {
    let root = std::env::temp_dir().join(format!("wf-port-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create port root");
    let mut vault = Vault::new(root.clone());
    let port: &mut dyn WorkspaceFs = &mut vault;

    ok(port.write_file("a/b.md", b"x"), "write");
    assert_eq!(ok(port.read_text("a/b.md"), "read"), "x");
    let file = port.stat("a/b.md").expect("file stat");
    assert!(matches!(file.kind, FsKind::File));
    assert_eq!(file.size, 1);
    assert!(matches!(port.stat("a").map(|s| s.kind), Some(FsKind::Dir)));
    assert!(matches!(
        port.read_text("missing.md"),
        Err(FsError::NotFound(ref p)) if p == "missing.md"
    ));
    assert!(matches!(
        port.write_file("../x", b""),
        Err(FsError::Unsafe(_))
    ));

    ok(port.remove("a/b.md", false), "remove file");
    assert!(port.stat("a/b.md").is_none());
    ok(port.remove("missing.md", false), "remove missing");

    ok(port.write_file("c.md", b"moved"), "write c");
    ok(port.rename("c.md", "d/e.md"), "rename");
    assert_eq!(ok(port.read_text("d/e.md"), "read renamed"), "moved");
    assert!(port.stat("c.md").is_none());
    let _ = fs::remove_dir_all(&root);
}

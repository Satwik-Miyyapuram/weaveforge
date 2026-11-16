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

#[cfg(test)]
mod common;

use common::{TempDir, make_dir_link};
use wf_core::sync::workspace_fs::{FsError, FsKind, WorkspaceFs, WorkspaceStat};
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

/// Polls for the child's `ready` marker; panics at once if the child exits, and after 30 s.
fn wait_for_ready(root: &Path, child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !root.join("ready").exists() {
        if let Ok(Some(status)) = child.try_wait() {
            panic!("child writer exited before ready: {status}");
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("child writer never reported ready in {}", root.display());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Runs one round: starts a child, waits until it is writing, kills it after a seeded
/// 1..=40 ms, and returns the root for inspection. The root is removed on drop.
fn kill_writer_at_seeded_moment(round: u32) -> TempDir {
    let root = TempDir::new();
    let mut child = spawn_child(root.path());
    wait_for_ready(root.path(), &mut child);
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
        let bytes =
            fs::read(root.path().join(TARGET)).expect("target exists after the first write");
        assert_whole_version(&bytes, round);
        let _ = Vault::new(root.path().to_path_buf())
            .read_text(TARGET)
            .expect("target reads back through the vault");
    }
}

/// A kill may leave a `*.wftmp` sibling; listings must skip it and the target stays whole.
/// One is planted too, so the skip is exercised even when the kill lands between writes.
#[test]
fn leftover_temp_file_is_not_listed_as_a_note() {
    let round = 1000;
    let root = kill_writer_at_seeded_moment(round);
    let planted = root
        .path()
        .join(format!("notes/target.md.1.0{TEMP_SUFFIX}"));
    fs::write(&planted, b"torn").expect("plant temp file");
    let vault = Vault::new(root.path().to_path_buf());
    let walked = vault.walk("").expect("walk root");
    assert!(
        walked
            .iter()
            .all(|entry| !entry.path.ends_with(TEMP_SUFFIX)),
        "a temp file was listed"
    );
    assert!(walked.iter().any(|entry| entry.path == TARGET));
    let listed = vault.list("notes").expect("list notes");
    assert!(
        listed
            .iter()
            .all(|entry| !entry.path.ends_with(TEMP_SUFFIX))
    );
    let port: &dyn WorkspaceFs = &vault;
    let port_walk = ok(port.walk(""), "port walk");
    let port_list = ok(port.list("notes"), "port list");
    assert!(port_walk.iter().any(|entry| entry.path == TARGET));
    assert!(
        port_walk
            .iter()
            .chain(&port_list)
            .all(|entry| !entry.path.ends_with(TEMP_SUFFIX))
    );
    let bytes = fs::read(root.path().join(TARGET)).expect("target exists");
    assert_whole_version(&bytes, round);
}

/// The vault answers every `WorkspaceFs` call with the port's types and error mapping.
#[test]
fn vault_satisfies_workspace_fs() {
    let root = TempDir::new();
    let mut vault = Vault::new(root.path().to_path_buf());
    let port: &mut dyn WorkspaceFs = &mut vault;

    ok(port.write_file("a/b.md", b"x"), "write");
    assert_eq!(ok(port.read_text("a/b.md"), "read"), "x");
    assert_eq!(ok(port.read_file("a/b.md"), "read bytes"), b"x");
    ok(port.mkdirp("m/n"), "mkdirp");
    assert!(matches!(
        port.stat("m/n").map(|s| s.kind),
        Some(FsKind::Dir)
    ));
    let paths = |entries: Vec<WorkspaceStat>| -> Vec<String> {
        entries.into_iter().map(|entry| entry.path).collect()
    };
    assert_eq!(paths(ok(port.list("a"), "list")), ["a/b.md"]);
    assert_eq!(paths(ok(port.walk(""), "walk")), ["a/b.md"]);
    // Reading a folder as a file is a disk error, not a missing path.
    assert!(matches!(port.read_text("m/n"), Err(FsError::Io(_))));
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

    assert!(matches!(
        port.rename("gone.md", "f.md"),
        Err(FsError::NotFound(ref p)) if p == "gone.md"
    ));
}

/// A link out of the root is refused as unsafe through the port, not reported as a disk error.
#[test]
fn port_maps_a_link_escape_to_unsafe() {
    let root = TempDir::new();
    let outside = TempDir::new();
    if !make_dir_link(&root.path().join("away"), outside.path()) {
        eprintln!("skipped: this machine cannot create a directory link");
        return;
    }
    let mut vault = Vault::new(root.path().to_path_buf());
    let port: &mut dyn WorkspaceFs = &mut vault;
    assert!(matches!(
        port.write_file("away/escaped.md", b"x"),
        Err(FsError::Unsafe(_))
    ));
    assert!(matches!(
        port.read_text("away/escaped.md"),
        Err(FsError::Unsafe(_))
    ));
    assert!(
        outside
            .path()
            .read_dir()
            .expect("read outside")
            .next()
            .is_none()
    );
}

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use common::{Reply, response, serve};
use wf_relay_server::overleaf_git::{
    clone_failure, clone_settings, collect_text_files, read_overleaf_project,
    read_overleaf_project_within,
};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "wf-overleaf-git-test-{tag}-{}-{n}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn write(root: &Path, rel: &str, content: &[u8]) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "user.email=t@t", "-c", "user.name=t"])
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(status.success());
}

/// Returns `(git base dir, project id)`; the repo is `base/id`.
fn make_repo(files: &[(&str, &str)]) -> (PathBuf, String) {
    let base = unique_dir("base");
    let id = format!("proj-{}", COUNTER.fetch_add(1, Ordering::Relaxed));
    let repo = base.join(&id);
    std::fs::create_dir_all(&repo).unwrap();
    for (rel, content) in files {
        write(&repo, rel, content.as_bytes());
    }
    git(&repo, &["init", "-q"]);
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "init"]);
    (base, id)
}

/// Temp clone dirs for one project. Scoped to `project_id` because the other
/// tests in this binary clone at the same time.
fn count_temp_entries(project_id: &str) -> usize {
    let prefix = format!("weaveforge-overleaf-{project_id}-");
    std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .count()
}

#[tokio::test]
async fn clone_success_reads_text_files_only() {
    let (base, id) = make_repo(&[
        ("main.tex", "\\section{Intro}\nHello"),
        ("refs.bib", "@article{x}"),
        ("img.png", "bin"),
        ("sub/a.tex", "x"),
    ]);
    let read = read_overleaf_project(&slash(&base), &id, "./main.tex", "tok")
        .await
        .unwrap();
    let paths: Vec<&str> = read.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(paths, ["main.tex", "refs.bib", "sub/a.tex"]);
    assert_eq!(read.entry_file, "main.tex");
    assert_eq!(read.section_tree.roots[0].title, "Intro");
    assert_eq!(
        read.overleaf_url,
        format!("https://www.overleaf.com/project/{id}")
    );
    assert_eq!(read.project_id, id);
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn invalid_project_id_fails_before_clone() {
    let base = unique_dir("invalid");
    let err = read_overleaf_project(&slash(&base), "a/b", "main.tex", "tok")
        .await
        .unwrap_err();
    assert_eq!(err, "Overleaf project id is invalid.");
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn missing_entry_file_is_an_error() {
    let (base, id) = make_repo(&[("main.tex", "Hello")]);
    let err = read_overleaf_project(&slash(&base), &id, "nope.tex", "tok")
        .await
        .unwrap_err();
    // Fixed wording: the caller's entry name is not echoed.
    assert_eq!(err, "Entry file not found.");
    let _ = std::fs::remove_dir_all(&base);
}

/// The temp clone dirs for one project, by name.
fn temp_entries(project_id: &str) -> Vec<String> {
    let prefix = format!("weaveforge-overleaf-{project_id}-");
    std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(&prefix))
        .collect()
}

#[tokio::test]
async fn stalled_clone_is_killed_and_its_checkout_removed() {
    const LIMIT: Duration = Duration::from_secs(15);
    // Unique per run (process id plus clock; Windows reuses process ids), so a checkout left
    // by another run on this machine is never counted.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let id: &'static str =
        Box::leak(format!("stall{}x{nanos}", std::process::id()).into_boxed_str());
    let refs: &'static str = Box::leak(format!("/{id}/info/refs").into_boxed_str());
    let up = serve(vec![(refs, vec![Reply::Silent])]).await;
    let git_base = up.base.as_str().trim_end_matches('/').to_string();
    let started = Instant::now();
    let read = tokio::spawn(async move {
        read_overleaf_project_within(&git_base, id, "main.tex", "tok", LIMIT).await
    });
    // Once git has asked the stand-in for refs it is stalled, and its checkout sits under an
    // unguessable name with the usual prefix. Polling has the whole clone limit, so a slow
    // spawn on a loaded runner does not fail the test.
    let mut during = Vec::new();
    let wait_until = Instant::now() + LIMIT;
    while during.is_empty() && Instant::now() < wait_until {
        tokio::time::sleep(Duration::from_millis(50)).await;
        during = temp_entries(id);
    }
    assert_eq!(during.len(), 1, "{during:?}");
    let suffix = &during[0][format!("weaveforge-overleaf-{id}-").len()..];
    assert_eq!(suffix.len(), 32, "{suffix}");
    assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()), "{suffix}");
    let err = read.await.unwrap().unwrap_err();
    assert_eq!(err, "Overleaf git clone timed out.");
    assert!(started.elapsed() < LIMIT * 2);
    // The checkout is removed before the error returns; allow a few seconds for a slow disk.
    let gone_by = Instant::now() + Duration::from_secs(5);
    while count_temp_entries(id) != 0 && Instant::now() < gone_by {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(count_temp_entries(id), 0);
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test]
async fn redirect_is_not_followed_so_the_token_stays_on_the_first_host() {
    let other = serve(vec![(
        "/elsewhere/info/refs",
        vec![response(200, &[], b"")],
    )])
    .await;
    let location = format!("http://127.0.0.1:{}/elsewhere/info/refs", other.port);
    let first = serve(vec![(
        "/redirproj/info/refs",
        vec![response(302, &[("Location", location.as_str())], b"")],
    )])
    .await;
    let git_base = first.base.as_str().trim_end_matches('/');
    let err = read_overleaf_project_within(
        git_base,
        "redirproj",
        "main.tex",
        "tok",
        Duration::from_secs(30),
    )
    .await
    .unwrap_err();
    assert!(err.starts_with("Overleaf git clone failed"), "{err}");
    // git's default (follow the first redirect, then send later requests, header and all,
    // to the new host) would reach `other`; with redirects off it gets nothing.
    assert!(other.seen().is_empty(), "{:?}", other.seen());
    let sent = first.seen();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].header("authorization"), Some("Basic Z2l0OnRvaw=="));
    assert_eq!(count_temp_entries("redirproj"), 0);
}

#[test]
fn clone_turns_redirects_off_and_stops_a_slow_transfer() {
    let settings = clone_settings("Authorization: Basic x".to_string());
    let pairs: Vec<(&str, &str)> = settings.iter().map(|(k, v)| (*k, v.as_str())).collect();
    assert_eq!(
        pairs,
        [
            ("http.extraHeader", "Authorization: Basic x"),
            ("http.followRedirects", "false"),
            ("http.lowSpeedLimit", "1000"),
            ("http.lowSpeedTime", "30"),
        ]
    );
}

fn nested(dir: &Path, levels: usize) -> PathBuf {
    let mut deep = dir.to_path_buf();
    for _ in 0..levels {
        deep.push("d");
    }
    deep
}

#[test]
fn folders_nested_past_the_depth_cap_are_an_error() {
    let dir = unique_dir("deep");
    let deep = nested(&dir, 33);
    std::fs::create_dir_all(&deep).unwrap();
    write(&deep, "a.tex", b"x");
    let err = collect_text_files(&dir).unwrap_err();
    assert_eq!(err, "Overleaf project nests folders too deeply.");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn folders_nested_to_the_depth_cap_are_read() {
    let dir = unique_dir("deep-ok");
    let deep = nested(&dir, 32);
    std::fs::create_dir_all(&deep).unwrap();
    write(&deep, "a.tex", b"x");
    let files = collect_text_files(&dir).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, format!("{}a.tex", "d/".repeat(32)));
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn clone_failure_is_reported() {
    let base = unique_dir("empty");
    let err = read_overleaf_project(&slash(&base), "missing-1", "main.tex", "tok")
        .await
        .unwrap_err();
    // Fixed wording: git's stderr (with the temp path and the URL) stays out.
    assert_eq!(err, "Overleaf git clone failed: project not found.");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn clone_failure_maps_stderr_to_fixed_wording() {
    let cases = [
        (
            "fatal: Authentication failed for 'https://git.overleaf.com/p1/'",
            "Overleaf git clone failed: access refused.",
            "auth",
        ),
        (
            "fatal: unable to access 'https://git.overleaf.com/p1/': The requested URL returned error: 403",
            "Overleaf git clone failed: access refused.",
            "auth",
        ),
        (
            "fatal: could not read Username for 'https://git.overleaf.com': terminal prompts disabled",
            "Overleaf git clone failed: access refused.",
            "auth",
        ),
        (
            "fatal: repository 'https://git.overleaf.com/p1/' not found",
            "Overleaf git clone failed: project not found.",
            "not-found",
        ),
        (
            "fatal: unable to access 'https://git.overleaf.com/p1/': The requested URL returned error: 404",
            "Overleaf git clone failed: project not found.",
            "not-found",
        ),
        (
            "fatal: repository 'C:/tmp/x/missing-1' does not exist",
            "Overleaf git clone failed: project not found.",
            "not-found",
        ),
        (
            "fatal: unable to access 'https://git.overleaf.com/p1/': Could not resolve host: git.overleaf.com",
            "Overleaf git clone failed: could not connect.",
            "network",
        ),
        (
            "fatal: unable to access 'https://git.overleaf.com/p1/': Failed to connect to git.overleaf.com port 443",
            "Overleaf git clone failed: could not connect.",
            "network",
        ),
        (
            "fatal: something else with tok and https://user:secret@host/p401",
            "Overleaf git clone failed: unknown error.",
            "other",
        ),
        ("", "Overleaf git clone failed: unknown error.", "other"),
    ];
    for (stderr, message, code) in cases {
        assert_eq!(clone_failure(stderr), (message, code), "{stderr}");
    }
}

#[test]
fn collect_skips_git_dir_and_non_text_and_keeps_uppercase_extension() {
    let dir = unique_dir("collect");
    write(&dir, ".git/x.txt", b"x");
    write(&dir, "main.TEX", b"\\section{A}");
    write(&dir, "notes.md", b"notes");
    write(&dir, "skip.png", b"png");
    let files = collect_text_files(&dir).unwrap();
    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(paths, ["main.TEX", "notes.md"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn file_count_limit_is_enforced() {
    let dir = unique_dir("count");
    for i in 0..251 {
        write(&dir, &format!("f{i:03}.txt"), b"x");
    }
    let err = collect_text_files(&dir).unwrap_err();
    assert_eq!(err, "Overleaf project exceeds the supported file limit.");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn files_that_are_not_read_do_not_count_toward_the_file_limit() {
    let dir = unique_dir("countskip");
    for i in 0..250 {
        write(&dir, &format!("f{i:03}.txt"), b"x");
    }
    write(&dir, "zz.png", b"png");
    write(&dir, "zz/inner.png", b"png");
    let files = collect_text_files(&dir).unwrap();
    assert_eq!(files.len(), 250);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn per_file_size_limit_is_enforced() {
    let dir = unique_dir("size");
    write(&dir, "big.txt", &vec![b'a'; 2_000_001]);
    let err = collect_text_files(&dir).unwrap_err();
    assert_eq!(
        err,
        "Overleaf project exceeds the supported text size limit."
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn no_temp_dir_left_after_failed_read() {
    let (base, id) = make_repo(&[("main.tex", "Hello")]);
    let result = read_overleaf_project(&slash(&base), &id, "nope.tex", "tok").await;
    assert!(result.is_err());
    assert_eq!(count_temp_entries(&id), 0);
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn read_serializes_with_camel_case_keys() {
    let (base, id) = make_repo(&[("main.tex", "Hello")]);
    let read = read_overleaf_project(&slash(&base), &id, "main.tex", "tok")
        .await
        .unwrap();
    let value = serde_json::to_value(&read).unwrap();
    let object = value.as_object().unwrap();
    for key in [
        "projectId",
        "entryFile",
        "files",
        "sectionTree",
        "overleafUrl",
    ] {
        assert!(object.contains_key(key), "missing key {key}");
    }
    let _ = std::fs::remove_dir_all(&base);
}

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use wf_relay_server::overleaf_git::{collect_text_files, read_overleaf_project};

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

fn count_temp_entries() -> usize {
    std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("weaveforge-overleaf-")
        })
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
    assert_eq!(err, "Entry file not found: nope.tex");
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn clone_failure_is_reported() {
    let base = unique_dir("empty");
    let err = read_overleaf_project(&slash(&base), "missing-1", "main.tex", "tok")
        .await
        .unwrap_err();
    assert!(err.starts_with("Overleaf git clone failed:"), "{err}");
    let _ = std::fs::remove_dir_all(&base);
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
    let before = count_temp_entries();
    let result = read_overleaf_project(&slash(&base), &id, "nope.tex", "tok").await;
    assert!(result.is_err());
    let after = count_temp_entries();
    assert!(after <= before, "before={before} after={after}");
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

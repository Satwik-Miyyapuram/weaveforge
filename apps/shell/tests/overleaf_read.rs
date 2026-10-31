#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]
//! Tests for the Overleaf read (ported from apps/desktop/src/overleaf-source.ts and the web reader and error helpers).

mod common;

use std::path::Path;
use std::sync::{Arc, LazyLock};

use common::{TempDir, put};
use keyring_core::CredentialStore;
use weaveforge_shell::overleaf_read::{
    collect_text_files, overleaf_read_with, read_project, safe_error,
};
use weaveforge_shell::secrets::Secrets;

const SERVICE: &str = "org.weaveforge.test";
const NO_TOKEN_TEXT: &str =
    "No Overleaf token is stored on this computer. Link the report again to add one.";
const INVALID_ID_TEXT: &str = "Overleaf project id is invalid.";
const FILE_LIMIT_TEXT: &str = "Overleaf project exceeds the supported file limit.";
const SIZE_LIMIT_TEXT: &str = "Overleaf project exceeds the supported text size limit.";

/// Clone tests share one temp folder prefix, so the folder counts only make sense one clone at a time.
static CLONES: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

fn mock() -> Arc<CredentialStore> {
    keyring_core::mock::Store::new().expect("mock store")
}

fn secrets(store: &Arc<CredentialStore>) -> Secrets {
    Secrets::new(Some(Arc::clone(store)), SERVICE)
}

/// A git repo with `main.tex` and `sections/a.tex` committed, in `dir`.
fn make_repo(dir: &Path) {
    let repo = git2::Repository::init(dir).expect("init");
    put(&dir.join("main.tex"), b"\\input{sections/a}");
    put(&dir.join("sections").join("a.tex"), b"\\section{A}");
    let mut index = repo.index().expect("index");
    index.add_path(Path::new("main.tex")).expect("add main");
    index.add_path(Path::new("sections/a.tex")).expect("add a");
    index.write().expect("write index");
    let tree_id = index.write_tree().expect("tree");
    let tree = repo.find_tree(tree_id).expect("find tree");
    let sig = git2::Signature::now("WeaveForge", "test@example.com").expect("sig");
    let _ = repo
        .commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .expect("commit");
}

/// How many checkout folders this process has left in the temp dir.
fn checkouts_left() -> usize {
    let prefix = format!("weaveforge-overleaf-{}-", std::process::id());
    std::fs::read_dir(std::env::temp_dir())
        .expect("temp dir")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .count()
}

fn names(files: &[weaveforge_shell::overleaf_read::OverleafFile]) -> Vec<&str> {
    files.iter().map(|f| f.path.as_str()).collect()
}

#[cfg(unix)]
fn link_file(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn link_file(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

// ---- overleaf-source.test.ts ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nothing_stored_is_a_sentence_not_a_git_failure() {
    let store = mock();
    let result = overleaf_read_with(&secrets(&store), "abc".into(), "main.tex".into()).await;
    assert_eq!(result, Err(NO_TOKEN_TEXT.to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_project_id_is_refused_before_any_clone_even_with_a_token() {
    let _guard = CLONES.lock().await;
    let store = mock();
    let s = secrets(&store);
    s.write("overleaf-token", "tok").expect("write token");
    let before = checkouts_left();
    let result = overleaf_read_with(&s, "../etc".into(), "main.tex".into()).await;
    assert_eq!(result, Err(INVALID_ID_TEXT.to_owned()));
    assert_eq!(checkouts_left(), before);
}

// ---- collect_text_files (overleaf-git-reader.test.ts) ----

#[test]
fn text_files_come_back_with_relative_paths() {
    let root = TempDir::new();
    put(
        &root.path().join("chapters").join("one.tex"),
        b"\\section{One}",
    );
    put(&root.path().join("main.tex"), b"\\input{chapters/one}");
    put(&root.path().join("figure.png"), b"not text");
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(names(&files), ["chapters/one.tex", "main.tex"]);
    assert_eq!(
        files.first().map(|f| f.content.as_str()),
        Some("\\section{One}")
    );
}

#[test]
fn nested_folders_use_slash_paths() {
    let root = TempDir::new();
    put(
        &root.path().join("sections").join("intro").join("a.tex"),
        b"A",
    );
    put(&root.path().join("main.tex"), b"M");
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(names(&files), ["main.tex", "sections/intro/a.tex"]);
}

#[test]
fn git_folder_is_skipped() {
    let root = TempDir::new();
    put(&root.path().join(".git").join("notes.tex"), b"GIT");
    put(
        &root.path().join(".git").join("objects").join("x.md"),
        b"GIT",
    );
    put(&root.path().join("main.tex"), b"M");
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(names(&files), ["main.tex"]);
}

#[test]
fn non_text_and_binary_files_are_skipped_by_extension() {
    let root = TempDir::new();
    put(&root.path().join("data.bin"), &[0_u8, 159, 146, 150]);
    put(&root.path().join("image.PNG"), b"png");
    put(&root.path().join("refs.bib"), b"@article{}");
    put(&root.path().join("CAPS.TEX"), b"upper");
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(names(&files), ["CAPS.TEX", "refs.bib"]);
}

#[test]
fn symlinked_tex_is_not_followed() {
    let outside = TempDir::new();
    let root = TempDir::new();
    let secret = outside.path().join("secret.txt");
    put(&secret, b"SECRET");
    put(&root.path().join("main.tex"), b"hello");
    let linked = link_file(&secret, &root.path().join("leak.tex"));
    // Windows needs developer mode for file symlinks; there the link cannot be made, so skip.
    if cfg!(windows) && linked.is_err() {
        return;
    }
    linked.expect("symlink");
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(names(&files), ["main.tex"]);
    assert!(!files.iter().any(|f| f.content.contains("SECRET")));
}

#[test]
fn file_count_at_limit_is_accepted() {
    let root = TempDir::new();
    for i in 0..250 {
        put(&root.path().join(format!("f{i:04}.tex")), b"x");
    }
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(files.len(), 250);
}

#[test]
fn file_count_over_limit_is_refused() {
    let root = TempDir::new();
    for i in 0..251 {
        put(&root.path().join(format!("f{i:04}.tex")), b"x");
    }
    assert_eq!(
        collect_text_files(root.path()),
        Err(FILE_LIMIT_TEXT.to_owned())
    );
}

#[test]
fn one_file_at_the_size_limit_is_accepted() {
    let root = TempDir::new();
    put(&root.path().join("big.tex"), &vec![b'a'; 2_000_000]);
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(files.first().map(|f| f.content.len()), Some(2_000_000));
}

#[test]
fn one_file_over_the_size_limit_is_refused() {
    let root = TempDir::new();
    put(&root.path().join("big.tex"), &vec![b'a'; 2_000_001]);
    assert_eq!(
        collect_text_files(root.path()),
        Err(SIZE_LIMIT_TEXT.to_owned())
    );
}

#[test]
fn total_at_the_size_limit_is_accepted() {
    let root = TempDir::new();
    for i in 0..10 {
        put(
            &root.path().join(format!("p{i}.tex")),
            &vec![b'a'; 2_000_000],
        );
    }
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(files.len(), 10);
}

#[test]
fn total_over_the_size_limit_is_refused() {
    let root = TempDir::new();
    for i in 0..10 {
        put(
            &root.path().join(format!("p{i}.tex")),
            &vec![b'a'; 2_000_000],
        );
    }
    put(&root.path().join("extra.tex"), b"x");
    assert_eq!(
        collect_text_files(root.path()),
        Err(SIZE_LIMIT_TEXT.to_owned())
    );
}

// ---- read_project (the clone, against a local repo) ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_project_ids_are_refused_before_cloning() {
    for bad in ["../etc", "a/b", "abc?x=1", "", "abc def"] {
        let result = read_project("http://127.0.0.1:9/nowhere", bad, "main.tex", "token").await;
        assert_eq!(result, Err(INVALID_ID_TEXT.to_owned()), "{bad:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_project_reads_a_local_repo() {
    let _guard = CLONES.lock().await;
    let src = TempDir::new();
    make_repo(src.path());
    let url = src.path().to_str().expect("utf8 path");
    let source = read_project(url, "Abc_123-x", "main.tex", "")
        .await
        .expect("read");
    assert_eq!(source.project_id, "Abc_123-x");
    assert_eq!(source.entry_file, "main.tex");
    assert_eq!(
        source.overleaf_url,
        "https://www.overleaf.com/project/Abc_123-x"
    );
    let pairs: Vec<(&str, &str)> = source
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.content.as_str()))
        .collect();
    assert_eq!(
        pairs,
        [
            ("main.tex", "\\input{sections/a}"),
            ("sections/a.tex", "\\section{A}"),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dot_slash_and_backslash_entries_normalise_to_main_tex() {
    let _guard = CLONES.lock().await;
    let src = TempDir::new();
    make_repo(src.path());
    let url = src.path().to_str().expect("utf8 path");
    for entry in ["./main.tex", ".\\main.tex"] {
        let source = read_project(url, "abc123", entry, "").await.expect("read");
        assert_eq!(source.entry_file, "main.tex", "{entry}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_entry_gives_the_exact_message() {
    let _guard = CLONES.lock().await;
    let src = TempDir::new();
    make_repo(src.path());
    let url = src.path().to_str().expect("utf8 path");
    let result = read_project(url, "abc123", "missing.tex", "").await;
    assert_eq!(result, Err("Entry file not found: missing.tex".to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn checkout_folder_is_gone_after_a_success() {
    let _guard = CLONES.lock().await;
    let src = TempDir::new();
    make_repo(src.path());
    let url = src.path().to_str().expect("utf8 path");
    let before = checkouts_left();
    let _ = read_project(url, "abc123", "main.tex", "")
        .await
        .expect("read");
    assert_eq!(checkouts_left(), before);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn checkout_folder_is_gone_after_a_failed_clone() {
    let _guard = CLONES.lock().await;
    let src = TempDir::new();
    let missing = src.path().join("missing");
    let url = missing.to_str().expect("utf8 path");
    let before = checkouts_left();
    let result = read_project(url, "abc123", "main.tex", "").await;
    assert!(result.is_err());
    assert_eq!(checkouts_left(), before);
}

// ---- overleaf_read_with and safe_error (overleaf-error.test.ts) ----

#[test]
fn safe_error_redacts_the_token_and_url_credentials() {
    let token = "secret-overleaf-token";
    let message = format!("clone failed for https://git:{token}@git.overleaf.com/project/abc");
    let safe = safe_error(&message, token);
    assert_eq!(
        safe,
        "clone failed for https://git.overleaf.com/project/abc"
    );
    assert!(!safe.contains(token));
    assert!(!safe.contains("git:"));
}

#[test]
fn safe_error_is_bounded_to_500_characters() {
    let safe = safe_error(&"x".repeat(2_000), "");
    assert_eq!(safe.chars().count(), 500);
}

#[test]
fn safe_error_uses_the_ts_redacted_marker() {
    let safe = safe_error("bad token tok-123 refused", "tok-123");
    assert_eq!(safe, "bad token [redacted] refused");
}

#[test]
fn files_sort_case_insensitively_like_locale_compare() {
    let root = TempDir::new();
    put(&root.path().join("b.tex"), b"b");
    put(&root.path().join("A.tex"), b"a");
    put(&root.path().join("c.tex"), b"c");
    let files = collect_text_files(root.path()).expect("collect");
    assert_eq!(names(&files), ["A.tex", "b.tex", "c.tex"]);
}

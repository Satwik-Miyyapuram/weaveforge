#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
mod common;

use std::path::Path;

use common::{TempDir, put};
use weaveforge_shell::vault::VaultSession;
use weaveforge_shell::vault_search::{
    CONTEXT, MAX_MATCHES_PER_FILE, SEARCH_LIMIT, VaultSearchHit, search_vault, walk_vault,
};

/// A session with `dir` adopted as its (empty) root.
fn session_at(dir: &Path) -> VaultSession {
    let mut session = VaultSession::new();
    let _ = session.adopt(Some(dir)).unwrap();
    session
}

/// The contexts of one hit, in order.
fn contexts(hit: &VaultSearchHit) -> Vec<&str> {
    hit.matches.iter().map(|m| m.context.as_str()).collect()
}

#[test]
fn finds_markdown_lines() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("a.md"), b"hello World\nnope\nworld again");

    let hits = search_vault(&session, "WORLD", "");

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].filename, "a.md");
    assert_eq!(contexts(&hits[0]), vec!["hello World", "world again"]);
}

#[test]
fn only_markdown() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("b.txt"), b"the word is here");

    assert!(search_vault(&session, "word", "").is_empty());
}

#[test]
fn nested_dirs_and_dot_dirs_skipped() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("notes/x.md"), b"needle here");
    put(&root.path().join(".git/y.md"), b"needle here");
    put(&root.path().join("notes/.hidden/z.md"), b"needle here");

    let hits = search_vault(&session, "needle", "");

    let names: Vec<&str> = hits.iter().map(|h| h.filename.as_str()).collect();
    assert_eq!(names, vec!["notes/x.md"]);
}

#[test]
fn dot_file_not_skipped() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join(".x.md"), b"needle here");

    let hits = search_vault(&session, "needle", "");

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].filename, ".x.md");
}

#[test]
fn crlf_lines() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("c.md"), b"one\r\nTwo\r\n");

    let hits = search_vault(&session, "two", "");

    assert_eq!(hits.len(), 1);
    assert_eq!(contexts(&hits[0]), vec!["Two"]);
}

#[test]
fn five_matches_max() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    let body = (1..=8)
        .map(|i| format!("hit {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    put(&root.path().join("many.md"), body.as_bytes());

    let hits = search_vault(&session, "hit", "");

    assert_eq!(MAX_MATCHES_PER_FILE, 5);
    assert_eq!(
        contexts(&hits[0]),
        vec!["hit 1", "hit 2", "hit 3", "hit 4", "hit 5"]
    );
}

#[test]
fn context_cut_120() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    let long = "a".repeat(300);
    put(&root.path().join("long.md"), long.as_bytes());

    let hits = search_vault(&session, "a", "");

    assert_eq!(CONTEXT, 120);
    assert_eq!(hits[0].matches[0].context.len(), 120);
}

#[test]
fn context_drops_surrogate_pair_straddling_limit() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    let line = format!("{}😀x", "a".repeat(119));
    put(&root.path().join("emoji.md"), line.as_bytes());

    let hits = search_vault(&session, "x", "");

    assert_eq!(hits[0].matches[0].context, "a".repeat(119));
}

#[test]
fn case_insensitive_unicode() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("u.md"), "ÄBC".as_bytes());

    let hits = search_vault(&session, "äbc", "");

    assert_eq!(hits.len(), 1);
    assert_eq!(contexts(&hits[0]), vec!["ÄBC"]);
}

#[test]
fn dir_argument() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("notes/a.md"), b"hello");
    put(&root.path().join("top.md"), b"hello");

    let hits = search_vault(&session, "hello", "notes");

    let names: Vec<&str> = hits.iter().map(|h| h.filename.as_str()).collect();
    assert_eq!(names, vec!["notes/a.md"]);
}

#[test]
fn no_root_is_empty() {
    let session = VaultSession::new();

    assert!(search_vault(&session, "anything", "").is_empty());
}

#[test]
fn walk_cap() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("d/a"), b"1");
    put(&root.path().join("d/b"), b"2");
    put(&root.path().join("d/c"), b"3");

    let mut full = vec![String::from("x"); SEARCH_LIMIT];
    walk_vault(&session, "d", &mut full);
    assert_eq!(full.len(), SEARCH_LIMIT);

    let mut almost = vec![String::from("x"); SEARCH_LIMIT - 1];
    walk_vault(&session, "d", &mut almost);
    assert_eq!(almost.len(), SEARCH_LIMIT);
}

#[test]
fn empty_query_matches_all_lines() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("e.md"), b"a\nb");

    let hits = search_vault(&session, "", "");

    assert_eq!(hits.len(), 1);
    assert_eq!(contexts(&hits[0]), vec!["a", "b"]);
}

#[test]
fn hit_json() {
    let root = TempDir::new();
    // Adopt the empty folder first: adopt refuses one that already has files.
    let session = session_at(root.path());
    put(&root.path().join("a.md"), b"x");

    let hits = search_vault(&session, "x", "");
    let json = serde_json::to_value(&hits[0]).unwrap();

    assert_eq!(
        json,
        serde_json::json!({"filename": "a.md", "matches": [{"context": "x"}]})
    );
}

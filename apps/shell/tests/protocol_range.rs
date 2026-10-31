#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Tests for `protocol::respond` with a `Range` header: whole, part, 416, and too-large files.

mod common;

use std::fs::File;

use common::{TempDir, put};
use weaveforge_shell::protocol::{Reply, TOO_LARGE, respond};
use weaveforge_shell::range::WHOLE_BYTES_MAX;

fn header<'a>(r: &'a Reply, name: &str) -> Option<&'a str> {
    r.headers
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, v)| v.as_str())
}

/// A bundle with `index.html` and a 100-byte `file.bin` holding bytes 0..100.
fn bundle(dir: &TempDir) {
    put(&dir.path().join("index.html"), b"<p>home</p>");
    put(
        &dir.path().join("file.bin"),
        &(0u8..100).collect::<Vec<u8>>(),
    );
}

#[test]
fn no_range_is_whole_body_with_accept_ranges_and_csp() {
    let dir = TempDir::new();
    bundle(&dir);
    let r = respond(dir.path(), Some("localhost"), "/file.bin", None, None);
    assert_eq!(r.status, 200);
    assert_eq!(r.body, (0u8..100).collect::<Vec<u8>>());
    assert_eq!(header(&r, "accept-ranges"), Some("bytes"));

    let page = respond(dir.path(), Some("localhost"), "/", None, None);
    assert_eq!(page.status, 200);
    assert!(header(&page, "content-security-policy").is_some());
    assert_eq!(header(&page, "accept-ranges"), Some("bytes"));
}

#[test]
fn bytes_10_to_19_is_206_with_ten_bytes() {
    let dir = TempDir::new();
    bundle(&dir);
    let r = respond(
        dir.path(),
        Some("localhost"),
        "/file.bin",
        None,
        Some("bytes=10-19"),
    );
    assert_eq!(r.status, 206);
    assert_eq!(r.body.len(), 10);
    assert_eq!(r.body, (10u8..20).collect::<Vec<u8>>());
    assert_eq!(header(&r, "content-range"), Some("bytes 10-19/100"));
}

#[test]
fn start_past_end_is_416() {
    let dir = TempDir::new();
    bundle(&dir);
    let r = respond(
        dir.path(),
        Some("localhost"),
        "/file.bin",
        None,
        Some("bytes=200-"),
    );
    assert_eq!(r.status, 416);
    assert!(r.body.is_empty());
}

#[test]
fn file_over_whole_limit_is_500_without_range_and_ranges_fine() {
    let dir = TempDir::new();
    bundle(&dir);
    let big = dir.path().join("big.bin");
    File::create(&big)
        .unwrap()
        .set_len(WHOLE_BYTES_MAX + 1)
        .unwrap();

    let whole = respond(dir.path(), Some("localhost"), "/big.bin", None, None);
    assert_eq!(whole.status, 500);
    assert_eq!(whole.body, TOO_LARGE.as_bytes().to_vec());
    assert_eq!(
        header(&whole, "content-type"),
        Some("text/plain; charset=utf-8")
    );

    let part = respond(
        dir.path(),
        Some("localhost"),
        "/big.bin",
        None,
        Some("bytes=0-9"),
    );
    assert_eq!(part.status, 206);
    assert_eq!(part.body.len(), 10);
}

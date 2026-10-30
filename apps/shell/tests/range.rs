#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for `range::pick` and `range::serve_file`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use weaveforge_shell::protocol::Reply;
use weaveforge_shell::range::{MAX_PART_BYTES, Pick, pick, serve_file};

static DIRS: AtomicU64 = AtomicU64::new(0);

/// A fresh directory under the system temp dir, removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let n = DIRS.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("wf-range-test-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn part(start_byte: u64, end_byte: u64) -> Pick {
    Pick::Part {
        start_byte,
        end_byte,
    }
}

fn p(header: &str, len_bytes: u64) -> Pick {
    pick(Some(header), len_bytes)
}

fn us(n: u64) -> usize {
    usize::try_from(n).unwrap()
}

fn content_type() -> Vec<(&'static str, String)> {
    vec![("content-type", "application/pdf".to_owned())]
}

fn serve(file: &Path, header: Option<&str>) -> Reply {
    let reply = serve_file(file, header, content_type()).unwrap();
    assert!(
        reply
            .headers
            .iter()
            .all(|(name, _)| *name != "content-length")
    );
    reply
}

#[test]
fn no_header_is_whole() {
    assert_eq!(pick(None, 100), Pick::Whole);
}

#[test]
fn simple_forms() {
    assert_eq!(p("bytes=0-9", 100), part(0, 9));
    assert_eq!(p("bytes=10-", 100), part(10, 99));
    assert_eq!(p("bytes=-10", 100), part(90, 99));
}

#[test]
fn end_is_clamped_to_body() {
    assert_eq!(p("bytes=50-1000", 100), part(50, 99));
    assert_eq!(p("bytes=0-99", 100), part(0, 99));
    assert_eq!(p("bytes=99-99", 100), part(99, 99));
}

#[test]
fn suffix_longer_than_body_is_whole_body() {
    assert_eq!(p("bytes=-500", 100), part(0, 99));
}

#[test]
fn unsatisfiable_ranges() {
    assert_eq!(p("bytes=100-", 100), Pick::Unsatisfiable);
    assert_eq!(p("bytes=100-200", 100), Pick::Unsatisfiable);
    assert_eq!(p("bytes=-0", 100), Pick::Unsatisfiable);
    assert_eq!(p("bytes=500-600", 100), Pick::Unsatisfiable);
}

#[test]
fn unsatisfiable_on_empty_body() {
    assert_eq!(p("bytes=0-", 0), Pick::Unsatisfiable);
    assert_eq!(p("bytes=-5", 0), Pick::Unsatisfiable);
    assert_eq!(p("bytes=0-0", 0), Pick::Unsatisfiable);
}

#[test]
fn unit_is_case_insensitive_and_space_tolerant() {
    assert_eq!(p("BYTES=0-9", 100), part(0, 9));
    assert_eq!(p("Bytes=0-9", 100), part(0, 9));
    assert_eq!(p("  bytes=0-9  ", 100), part(0, 9));
    assert_eq!(p("bytes= 0-9 ", 100), part(0, 9));
}

#[test]
fn other_units_are_whole() {
    for header in ["items=0-9", "bytes0-9", "bytes 0-9", "bytesx=0-9", ""] {
        assert_eq!(p(header, 100), Pick::Whole, "{header:?}");
    }
}

#[test]
fn malformed_is_whole() {
    for header in [
        "bytes=",
        "bytes=-",
        "bytes=9-0",
        "bytes=a-b",
        "bytes=1-2-3",
        "bytes=+1-2",
        "bytes=1 -2",
        "bytes=1- 2",
        "bytes=0x1-2",
        "bytes=1.5-2",
        "bytes=-+3",
    ] {
        assert_eq!(p(header, 100), Pick::Whole, "{header:?}");
    }
}

#[test]
fn several_ranges_are_whole() {
    for header in ["bytes=0-1,5-6", "bytes=0-1,", "bytes=,0-1"] {
        assert_eq!(p(header, 100), Pick::Whole, "{header:?}");
    }
}

#[test]
fn overflow_and_extremes() {
    assert_eq!(p("bytes=18446744073709551616-", 100), Pick::Whole);
    assert_eq!(p("bytes=0-18446744073709551615", 100), part(0, 99));
    assert_eq!(p("bytes=-18446744073709551615", 100), part(0, 99));

    let max = u64::MAX;
    assert_eq!(p("bytes=-1", max), part(max - 1, max - 1));
    assert_eq!(
        p("bytes=18446744073709551614-", max),
        part(max - 1, max - 1)
    );
    assert_eq!(p("bytes=18446744073709551615-", max), Pick::Unsatisfiable);
}

#[test]
fn one_byte_body() {
    assert_eq!(p("bytes=0-", 1), part(0, 0));
    assert_eq!(p("bytes=-1", 1), part(0, 0));
    assert_eq!(p("bytes=1-", 1), Pick::Unsatisfiable);
}

#[test]
fn serve_whole_without_header() {
    let dir = TempDir::new();
    let data: Vec<u8> = (0u8..100).collect();
    let file = dir.file("a.pdf", &data);
    let reply = serve(&file, None);
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, data);
    assert_eq!(
        reply.headers,
        vec![
            ("content-type", "application/pdf".to_owned()),
            ("accept-ranges", "bytes".to_owned()),
        ]
    );
}

#[test]
fn serve_part() {
    let dir = TempDir::new();
    let data: Vec<u8> = (0u8..100).collect();
    let file = dir.file("a.pdf", &data);
    let reply = serve(&file, Some("bytes=10-19"));
    assert_eq!(reply.status, 206);
    assert_eq!(reply.body, data[10..=19].to_vec());
    assert_eq!(
        reply.headers,
        vec![
            ("content-type", "application/pdf".to_owned()),
            ("accept-ranges", "bytes".to_owned()),
            ("content-range", "bytes 10-19/100".to_owned()),
        ]
    );
}

#[test]
fn serve_suffix_part() {
    let dir = TempDir::new();
    let data: Vec<u8> = (0u8..100).collect();
    let file = dir.file("a.pdf", &data);
    let reply = serve(&file, Some("bytes=-5"));
    assert_eq!(reply.status, 206);
    assert_eq!(reply.body, data[95..=99].to_vec());
    assert!(
        reply
            .headers
            .contains(&("content-range", "bytes 95-99/100".to_owned()))
    );
}

#[test]
fn serve_unsatisfiable_is_416() {
    let dir = TempDir::new();
    let data: Vec<u8> = (0u8..100).collect();
    let file = dir.file("a.pdf", &data);
    let reply = serve(&file, Some("bytes=100-"));
    assert_eq!(reply.status, 416);
    assert!(reply.body.is_empty());
    assert_eq!(
        reply.headers,
        vec![
            ("accept-ranges", "bytes".to_owned()),
            ("content-range", "bytes */100".to_owned()),
        ]
    );
}

#[test]
fn serve_malformed_is_whole() {
    let dir = TempDir::new();
    let data: Vec<u8> = (0u8..100).collect();
    let file = dir.file("a.pdf", &data);
    let reply = serve(&file, Some("bytes=9-0"));
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, data);
}

#[test]
fn serve_empty_file() {
    let dir = TempDir::new();
    let file = dir.file("empty.pdf", b"");
    let whole = serve(&file, None);
    assert_eq!(whole.status, 200);
    assert!(whole.body.is_empty());

    let reply = serve(&file, Some("bytes=0-"));
    assert_eq!(reply.status, 416);
    assert!(reply.body.is_empty());
    assert!(
        reply
            .headers
            .contains(&("content-range", "bytes */0".to_owned()))
    );
}

#[test]
fn serve_caps_part_at_max_part_bytes() {
    let dir = TempDir::new();
    let total = MAX_PART_BYTES + 10;
    let data: Vec<u8> = (0..total).map(|i| u8::try_from(i % 251).unwrap()).collect();
    let file = dir.file("big.bin", &data);

    let reply = serve(&file, Some("bytes=0-"));
    assert_eq!(reply.status, 206);
    assert_eq!(reply.body.len(), us(MAX_PART_BYTES));
    assert_eq!(reply.body, data[..us(MAX_PART_BYTES)].to_vec());
    assert!(reply.headers.contains(&(
        "content-range",
        format!("bytes 0-{}/{}", MAX_PART_BYTES - 1, total),
    )));

    let reply = serve(&file, Some("bytes=5-"));
    assert_eq!(reply.status, 206);
    assert_eq!(reply.body.len(), us(MAX_PART_BYTES));
    assert_eq!(reply.body, data[5..us(5 + MAX_PART_BYTES)].to_vec());
    assert!(reply.headers.contains(&(
        "content-range",
        format!("bytes 5-{}/{}", 5 + MAX_PART_BYTES - 1, total),
    )));

    let reply = serve(&file, Some("bytes=-20"));
    assert_eq!(reply.status, 206);
    assert_eq!(reply.body, data[us(total - 20)..].to_vec());
    assert!(reply.headers.contains(&(
        "content-range",
        format!("bytes {}-{}/{}", total - 20, total - 1, total),
    )));
}

#[test]
fn serve_missing_file_is_not_found() {
    let dir = TempDir::new();
    let err = serve_file(&dir.0.join("missing.pdf"), None, content_type()).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
}

#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Tests for `local_artifacts`: the port of `apps/shell/sidecar/test/local-artifacts.test.ts` plus the spec's extra cases.

mod common;

use std::path::Path;

use common::TempDir;
use weaveforge_shell_lib::local_artifacts::{
    ARTIFACT_CSP, ARTIFACT_HOST, ARTIFACT_URL_PREFIX, MAX_LOCAL_ARTIFACT_BYTES, SAME_ORIGIN_PREFIX,
    TOO_BIG, UNSAFE, delete_local_artifacts, is_safe_segment, serve_local_artifact,
    write_local_artifact,
};
use weaveforge_shell_lib::protocol::Reply;

fn header<'a>(r: &'a Reply, name: &str) -> Option<&'a str> {
    r.headers
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, v)| v.as_str())
}

/// The URL path after the host: `app://artifacts/exp/uuid/name` gives `/exp/uuid/name`.
fn url_path(url: &str) -> String {
    format!("/{}", url.strip_prefix(ARTIFACT_URL_PREFIX).unwrap())
}

fn count_entries(dir: &Path) -> usize {
    std::fs::read_dir(dir).unwrap().count()
}

#[test]
fn artifact_host_and_prefix() {
    assert_eq!(ARTIFACT_HOST, "artifacts");
    // The web app selects and syncs records by this prefix; it must stay as Electron wrote it.
    assert_eq!(ARTIFACT_URL_PREFIX, "app://artifacts/");
    assert_eq!(SAME_ORIGIN_PREFIX, "/artifacts/");
}

// TS: "a saved artifact is served back from its URL"
#[test]
fn saved_artifact_is_served_back_from_its_url() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp-1", "loss.png", b"png bytes").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), None);
    assert_eq!(r.status, 200);
    assert_eq!(r.body, b"png bytes".to_vec());
}

// TS: "a URL with the wrong number of segments is a 404"
#[test]
fn wrong_segment_count_is_404() {
    let dir = TempDir::new();
    let r = serve_local_artifact(dir.path(), "/exp-1/loss.png", None);
    assert_eq!(r.status, 404);
    assert!(r.body.is_empty());
}

// TS: "a segment that would leave the folder is a 404"
#[test]
fn encoded_dot_dot_segment_is_404() {
    let dir = TempDir::new();
    let r = serve_local_artifact(dir.path(), "/exp-1/%2E%2E/loss.png", None);
    assert_eq!(r.status, 404);
    assert!(r.body.is_empty());
}

// TS: "a malformed percent escape is a 400, not a rejected handler"
#[test]
fn malformed_percent_escape_is_400() {
    let dir = TempDir::new();
    let r = serve_local_artifact(dir.path(), "/exp-1/%E0%A4/loss.png", None);
    assert_eq!(r.status, 400);
    assert!(r.body.is_empty());
}

#[test]
fn is_safe_segment_cases() {
    assert!(is_safe_segment("a.b-c_1"));
    assert!(is_safe_segment(&"a".repeat(128)));
    assert!(!is_safe_segment(""));
    assert!(!is_safe_segment("."));
    assert!(!is_safe_segment(".."));
    assert!(!is_safe_segment("a/b"));
    assert!(!is_safe_segment("a\\b"));
    assert!(!is_safe_segment("a b"));
    assert!(!is_safe_segment(&"a".repeat(129)));
    assert!(!is_safe_segment("é"));
}

#[test]
fn write_then_serve_round_trips_bytes_and_type() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp", "data.json", b"{}").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), None);
    assert_eq!(r.status, 200);
    assert_eq!(r.body, b"{}".to_vec());
    assert_eq!(
        header(&r, "content-type"),
        Some("application/json; charset=utf-8")
    );
}

#[test]
fn url_has_prefix_and_three_segments() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp", "a.txt", b"x").unwrap();
    assert!(url.starts_with(ARTIFACT_URL_PREFIX));
    let rest = url.strip_prefix(ARTIFACT_URL_PREFIX).unwrap();
    let parts: Vec<&str> = rest.split('/').collect();
    assert_eq!(parts.len(), 3);
    assert_eq!(parts.first().copied(), Some("exp"));
    assert_eq!(parts.get(2).copied(), Some("a.txt"));
}

#[test]
fn two_writes_of_same_name_give_different_urls() {
    let dir = TempDir::new();
    let first = write_local_artifact(dir.path(), "exp", "a.txt", b"1").unwrap();
    let second = write_local_artifact(dir.path(), "exp", "a.txt", b"2").unwrap();
    assert_ne!(first, second);
}

#[test]
fn unsafe_experiment_id_is_refused_and_root_stays_empty() {
    let dir = TempDir::new();
    let r = write_local_artifact(dir.path(), "a/b", "x.txt", b"x");
    assert_eq!(r, Err(UNSAFE.to_owned()));
    let r = write_local_artifact(dir.path(), "..", "x.txt", b"x");
    assert_eq!(r, Err(UNSAFE.to_owned()));
    assert_eq!(count_entries(dir.path()), 0);
}

#[test]
fn unsafe_name_is_refused_and_root_stays_empty() {
    let dir = TempDir::new();
    let r = write_local_artifact(dir.path(), "exp", "a b.txt", b"x");
    assert_eq!(r, Err(UNSAFE.to_owned()));
    assert_eq!(count_entries(dir.path()), 0);
}

#[test]
fn unsafe_message_is_the_ts_text() {
    assert_eq!(UNSAFE, "Unsafe artifact path.");
}

#[test]
fn bad_segment_shapes_are_404() {
    let dir = TempDir::new();
    assert_eq!(serve_local_artifact(dir.path(), "/a/b", None).status, 404);
    assert_eq!(
        serve_local_artifact(dir.path(), "/a/b/c/d", None).status,
        404
    );
}

#[test]
fn bad_escape_is_400_before_count_check() {
    let dir = TempDir::new();
    assert_eq!(
        serve_local_artifact(dir.path(), "/a/%zz/c", None).status,
        400
    );
}

#[test]
fn missing_file_is_404() {
    let dir = TempDir::new();
    let r = serve_local_artifact(dir.path(), "/exp/uuid/none.txt", None);
    assert_eq!(r.status, 404);
    assert!(r.body.is_empty());
}

#[test]
fn ok_reply_carries_nosniff() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp", "a.txt", b"x").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), None);
    assert_eq!(r.status, 200);
    assert_eq!(header(&r, "x-content-type-options"), Some("nosniff"));
}

#[test]
fn ok_reply_is_sandboxed_and_loads_nothing() {
    let dir = TempDir::new();
    let url =
        write_local_artifact(dir.path(), "exp-1", "page.html", b"<script>1</script>").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), None);
    assert_eq!(r.status, 200);
    let csp = header(&r, "content-security-policy").unwrap();
    assert_eq!(csp, ARTIFACT_CSP);
    let directives: Vec<&str> = csp.split(';').map(str::trim).collect();
    assert!(directives.contains(&"sandbox"));
    assert!(directives.contains(&"default-src 'none'"));
    assert!(!csp.contains("script-src"));
}

#[test]
fn pdf_is_a_sandboxed_download_as_in_electron() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp-1", "report.pdf", b"%PDF-1.7").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), None);
    assert_eq!(r.status, 200);
    assert_eq!(header(&r, "content-type"), Some("application/octet-stream"));
    assert_eq!(header(&r, "content-security-policy"), Some(ARTIFACT_CSP));
    assert_eq!(header(&r, "x-content-type-options"), Some("nosniff"));
}

#[test]
fn svg_reply_is_sandboxed() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp-1", "plot.svg", b"<svg/>").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), None);
    assert_eq!(header(&r, "content-security-policy"), Some(ARTIFACT_CSP));
}

#[test]
fn range_request_gets_part_of_the_file() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp", "report.pdf", b"0123456789").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), Some("bytes=2-5"));
    assert_eq!(r.status, 206);
    assert_eq!(r.body, b"2345");
    assert_eq!(header(&r, "content-range"), Some("bytes 2-5/10"));
    assert_eq!(header(&r, "content-security-policy"), Some(ARTIFACT_CSP));
}

#[test]
fn range_past_the_end_is_416() {
    let dir = TempDir::new();
    let url = write_local_artifact(dir.path(), "exp", "a.bin", b"0123").unwrap();
    let r = serve_local_artifact(dir.path(), &url_path(&url), Some("bytes=10-20"));
    assert_eq!(r.status, 416);
}

#[test]
fn writer_refuses_over_25_mb_and_saves_nothing() {
    let dir = TempDir::new();
    let big = vec![0_u8; MAX_LOCAL_ARTIFACT_BYTES + 1];
    assert_eq!(
        write_local_artifact(dir.path(), "exp", "big.bin", &big),
        Err(TOO_BIG.to_owned())
    );
    assert_eq!(count_entries(dir.path()), 0);
    let exact = vec![0_u8; MAX_LOCAL_ARTIFACT_BYTES];
    assert!(write_local_artifact(dir.path(), "exp", "ok.bin", &exact).is_ok());
}

#[test]
fn whole_read_over_25_mb_is_413_but_a_range_still_works() {
    let dir = TempDir::new();
    let folder = dir.path().join("exp").join("uuid");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(
        folder.join("big.bin"),
        vec![7_u8; MAX_LOCAL_ARTIFACT_BYTES + 1],
    )
    .unwrap();
    assert_eq!(
        serve_local_artifact(dir.path(), "/exp/uuid/big.bin", None).status,
        413
    );
    let r = serve_local_artifact(dir.path(), "/exp/uuid/big.bin", Some("bytes=0-3"));
    assert_eq!(r.status, 206);
    assert_eq!(r.body, vec![7_u8; 4]);
}

#[test]
fn deleting_an_experiment_removes_its_files_only() {
    let dir = TempDir::new();
    let gone = write_local_artifact(dir.path(), "exp-1", "a.png", b"a").unwrap();
    let kept = write_local_artifact(dir.path(), "exp-2", "b.png", b"b").unwrap();
    delete_local_artifacts(dir.path(), "exp-1").unwrap();
    assert_eq!(
        serve_local_artifact(dir.path(), &url_path(&gone), None).status,
        404
    );
    assert_eq!(
        serve_local_artifact(dir.path(), &url_path(&kept), None).status,
        200
    );
    assert!(
        delete_local_artifacts(dir.path(), "exp-1").is_ok(),
        "nothing saved is fine"
    );
}

#[test]
fn delete_refuses_an_unsafe_id_and_touches_nothing() {
    let dir = TempDir::new();
    let _ = write_local_artifact(dir.path(), "exp", "a.png", b"a").unwrap();
    assert_eq!(
        delete_local_artifacts(dir.path(), ".."),
        Err(UNSAFE.to_owned())
    );
    assert_eq!(
        delete_local_artifacts(dir.path(), "a/b"),
        Err(UNSAFE.to_owned())
    );
    assert_eq!(count_entries(dir.path()), 1);
}

//! Ported cases from `apps/shell/sidecar/test/app-protocol.test.ts`. A made-up
//! bundle stands in for the disk: `resolve` tries each candidate against a set
//! of files, the way the TS shim tries `isFile`.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use wf_core::app_protocol::{
    APP_CSP, app_file_candidates, app_headers, canonical_app_url, content_type_for, is_page_request,
};

const ROOT: &str = "/bundle";

/// The files an export of a few pages would produce.
const FILES: &[&str] = &[
    "/bundle/index.html",
    "/bundle/settings/index.html",
    "/bundle/_next/static/chunk.js",
    "/bundle/icons/icon-512.png",
    "/bundle/__next.__PAGE__.txt",
    "/bundle/plan/__next._tree.txt",
    "/bundle/plan/__next.plan/__PAGE__.txt",
];

/// The first candidate that is a file in the bundle, the way the shim picks one.
fn resolve(url: &str) -> Option<String> {
    let candidates = app_file_candidates(ROOT, url, '/')?;
    candidates
        .into_iter()
        .find(|file| FILES.contains(&file.as_str()))
}

/// The sources of one directive in the policy an HTML response carries.
fn directive(name: &str) -> Vec<String> {
    let headers = app_headers("text/html; charset=utf-8");
    let policy = headers["content-security-policy"]
        .as_str()
        .expect("policy string");
    let entry = policy
        .split("; ")
        .find(|entry| entry.starts_with(&format!("{name} ")))
        .expect("directive present");
    entry
        .split_whitespace()
        .skip(1)
        .map(str::to_owned)
        .collect()
}

fn connect_src() -> Vec<String> {
    directive("connect-src")
}

fn frame_src() -> Vec<String> {
    directive("frame-src")
}

#[test]
fn the_root_is_the_exports_index() {
    assert_eq!(
        resolve("app://weaveforge/").as_deref(),
        Some("/bundle/index.html")
    );
}

#[test]
fn a_directory_request_lands_on_its_index() {
    assert_eq!(
        resolve("app://weaveforge/settings/").as_deref(),
        Some("/bundle/settings/index.html")
    );
}

#[test]
fn the_same_page_without_the_trailing_slash_still_lands() {
    assert_eq!(
        resolve("app://weaveforge/settings").as_deref(),
        Some("/bundle/settings/index.html")
    );
}

#[test]
fn a_segment_prefetch_lands_on_the_folder_the_export_wrote_it_to() {
    assert_eq!(
        resolve("app://weaveforge/plan/__next.plan.__PAGE__.txt?_rsc=abc").as_deref(),
        Some("/bundle/plan/__next.plan/__PAGE__.txt")
    );
}

#[test]
fn flat_segment_files_are_still_served_as_themselves() {
    assert_eq!(
        resolve("app://weaveforge/__next.__PAGE__.txt").as_deref(),
        Some("/bundle/__next.__PAGE__.txt")
    );
    assert_eq!(
        resolve("app://weaveforge/plan/__next._tree.txt").as_deref(),
        Some("/bundle/plan/__next._tree.txt")
    );
}

#[test]
fn an_asset_is_served_as_itself() {
    assert_eq!(
        resolve("app://weaveforge/_next/static/chunk.js").as_deref(),
        Some("/bundle/_next/static/chunk.js")
    );
}

#[test]
fn an_escaped_path_is_decoded_before_it_is_looked_up() {
    assert_eq!(
        resolve("app://weaveforge/icons%2Ficon-512.png").as_deref(),
        Some("/bundle/icons/icon-512.png")
    );
}

#[test]
fn a_page_the_bundle_does_not_have_is_a_miss_not_a_guess() {
    assert_eq!(resolve("app://weaveforge/nowhere"), None);
}

#[test]
fn traversal_out_of_the_bundle_is_refused_by_where_it_ends_up() {
    // The URL parser folds these onto `/etc/passwd` and `/secrets`, which are outside
    // no folder we have, so every candidate is inside the root and none exists.
    for url in [
        "app://weaveforge/../../etc/passwd",
        "app://weaveforge/settings/../../../secrets",
    ] {
        let candidates = app_file_candidates(ROOT, url, '/').expect("inside the root");
        assert!(
            candidates.iter().all(|file| file.starts_with("/bundle/")),
            "{url}"
        );
        assert_eq!(resolve(url), None, "{url}");
    }
}

#[test]
fn an_encoded_separator_cannot_climb_out_of_the_bundle() {
    // Decoded to `../../etc/passwd` only after the URL parser has run, so the
    // containment check on the joined path has to catch it.
    assert_eq!(
        app_file_candidates(ROOT, "app://weaveforge/..%2F..%2Fetc%2Fpasswd", '/'),
        None
    );
}

#[test]
fn a_malformed_escape_is_a_miss_rather_than_a_throw() {
    assert_eq!(
        app_file_candidates(ROOT, "app://weaveforge/%E0%A4%A", '/'),
        None
    );
    assert_eq!(app_file_candidates(ROOT, "app://weaveforge/%ZZ", '/'), None);
}

#[test]
fn a_bytes_sequence_that_is_not_utf8_is_a_miss() {
    assert_eq!(app_file_candidates(ROOT, "app://weaveforge/%FF", '/'), None);
}

#[test]
fn a_folder_is_never_offered_as_a_candidate_itself() {
    let candidates =
        app_file_candidates(ROOT, "app://weaveforge/settings", '/').expect("candidates");
    assert_eq!(candidates[0], "/bundle/settings");
    assert!(candidates.contains(&"/bundle/settings/index.html".to_owned()));
}

#[test]
fn the_separator_is_the_platforms_and_the_root_is_kept_whole() {
    let candidates =
        app_file_candidates("C:\\bundle", "app://weaveforge/settings/", '\\').expect("candidates");
    assert_eq!(
        candidates,
        vec!["C:\\bundle\\settings\\index.html".to_owned()]
    );
}

#[test]
fn content_types_cover_the_exports_files_and_unknown_means_bytes() {
    assert_eq!(
        content_type_for("/bundle/index.html"),
        "text/html; charset=utf-8"
    );
    assert_eq!(
        content_type_for("/bundle/app.CSS"),
        "text/css; charset=utf-8"
    );
    assert_eq!(content_type_for("/bundle/pglite.wasm"), "application/wasm");
    assert_eq!(
        content_type_for("/bundle/whatever.zzz"),
        "application/octet-stream"
    );
    assert_eq!(
        content_type_for("/bundle/.html"),
        "application/octet-stream"
    );
}

#[test]
fn every_response_carries_the_headers_the_server_used_to_send() {
    let headers = app_headers("text/html; charset=utf-8");
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert_eq!(
        headers["referrer-policy"],
        "strict-origin-when-cross-origin"
    );
    assert_eq!(headers["content-type"], "text/html; charset=utf-8");
    let policy = headers["content-security-policy"].as_str().expect("policy");
    assert!(policy.contains("frame-ancestors 'none'"));
}

#[test]
fn only_a_document_carries_a_policy() {
    let script = app_headers("text/javascript; charset=utf-8");
    assert!(!script.contains_key("content-security-policy"));
}

#[test]
fn connect_src_allows_cache_which_the_model_cache_needs() {
    let sources = connect_src();
    assert!(
        sources.iter().any(|s| s == "cache:"),
        "the Cache API scheme is allowed"
    );
    for kept in ["'self'", "https:", "wss:"] {
        assert!(sources.iter().any(|s| s == kept), "{kept}");
    }
    assert!(!sources.iter().any(|s| s == "*"), "no bare wildcard source");
    assert!(
        !sources.iter().any(|s| s.contains(":/*")),
        "no wildcard host"
    );
    assert!(
        !sources.iter().any(|s| s == "cache:*"),
        "the cache scheme is not wildcarded"
    );
}

#[test]
fn connect_src_allows_app_because_the_weights_live_on_their_own_host() {
    assert!(connect_src().iter().any(|s| s == "app:"));
}

#[test]
fn a_missed_page_is_told_apart_from_a_missed_asset() {
    assert!(is_page_request("app://weaveforge/org/"));
    assert!(is_page_request("app://weaveforge/supervision"));
    assert!(is_page_request("app://weaveforge/old.html"));
    assert!(!is_page_request("app://weaveforge/_next/static/gone.js"));
    assert!(!is_page_request("app://weaveforge/icons/missing.png"));
    assert!(!is_page_request("not a url"));
}

#[test]
fn a_path_with_doubled_slashes_is_sent_to_its_collapsed_form() {
    assert_eq!(
        canonical_app_url("app://weaveforge//").as_deref(),
        Some("app://weaveforge/")
    );
    assert_eq!(
        canonical_app_url("app://weaveforge///notes//x/").as_deref(),
        Some("app://weaveforge/notes/x/")
    );
    assert_eq!(
        canonical_app_url("app://weaveforge//notes/?page=a//b#c//d").as_deref(),
        Some("app://weaveforge/notes/?page=a//b#c//d")
    );
}

#[test]
fn a_clean_path_or_no_url_at_all_needs_no_redirect() {
    assert_eq!(canonical_app_url("app://weaveforge/"), None);
    assert_eq!(canonical_app_url("app://weaveforge/notes/?page=a//b"), None);
    assert_eq!(canonical_app_url("not a url"), None);
}

#[test]
fn frame_src_allows_blob_which_the_workshop_pdf_viewer_needs() {
    assert_eq!(frame_src(), vec!["'self'".to_owned(), "blob:".to_owned()]);
}

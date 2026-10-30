//! Tests for the update check (ported from apps/desktop/src/update-check.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "common/upstream.rs"]
mod upstream;

use upstream::{Upstream, response, serve};
use weaveforge_shell::update_check::{
    Release, UPDATE_CHECK_FAILED, Update, Version, check_update_reply, fetch_releases,
    find_update_at, is_newer, newest_release, parse_tag, parse_version,
};

const NO_HOST: &str = "http://127.0.0.1:9/releases";

/// A release object as GitHub sends it; `extra` is `,"draft":true` style, or empty.
fn rel(tag: &str, extra: &str) -> String {
    format!(r#"{{"tag_name":"{tag}","html_url":"https://example.invalid/{tag}"{extra}}}"#)
}

/// A `Release` struct for the pure functions.
fn release(tag: &str) -> Release {
    Release {
        tag_name: tag.to_string(),
        html_url: format!("https://example.invalid/{tag}"),
        draft: false,
        prerelease: false,
    }
}

/// Serves `body` at `/releases` with `status`; returns the server and the releases URL.
async fn serve_releases(status: u16, body: &str) -> (Upstream, String) {
    let reply = response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    );
    let up = serve(vec![("/releases", vec![reply])]).await;
    let url = up.url("/releases?per_page=30").to_string();
    (up, url)
}

#[test]
fn parse_tag_reads_desktop_release_tag() {
    assert_eq!(parse_tag("v0.5.2"), Some((0, 5, 2)));
    assert_eq!(parse_tag("  v1.0.0 "), Some((1, 0, 0)));
}

#[test]
fn parse_tag_refuses_android_tags() {
    // `android-v0.9.0` is newer than every desktop release and would send desktop
    // readers to download an APK.
    assert_eq!(parse_tag("android-v0.9.0"), None);
    assert_eq!(parse_tag("v0.5"), None);
    assert_eq!(parse_tag("0.5.2"), None);
    assert_eq!(parse_tag(""), None);
}

#[test]
fn parse_tag_cases() {
    let cases: &[(&str, Option<Version>)] = &[
        ("v1.2.3", Some((1, 2, 3))),
        ("v1.2", None),
        ("v1.2.3.4", None),
        ("1.2.3", None),
        ("v01.2.3", Some((1, 2, 3))),
        (" v1.2.3 ", Some((1, 2, 3))),
        ("v1.2.3\n", Some((1, 2, 3))),
        (
            "v18446744073709551615.0.0",
            Some((18446744073709551615, 0, 0)),
        ),
        ("v18446744073709551616.0.0", None),
        ("V1.2.3", None),
        ("v\u{0661}.2.3", None),
        ("v+1.2.3", None),
        ("v1..3", None),
        ("", None),
    ];
    for (tag, want) in cases {
        assert_eq!(parse_tag(tag), *want, "{tag:?}");
    }
}

#[test]
fn parse_version_reads_stamped_version() {
    assert_eq!(parse_version("0.5.2"), Some((0, 5, 2)));
    assert_eq!(parse_version(" 0.5.2 "), Some((0, 5, 2)));
    assert_eq!(parse_version("0.5.2-beta"), None);
}

#[test]
fn is_newer_compares_by_component() {
    assert!(is_newer((0, 10, 0), (0, 9, 9)));
    assert!(is_newer((1, 0, 0), (0, 99, 99)));
    assert!(is_newer((0, 5, 3), (0, 5, 2)));
}

#[test]
fn is_newer_is_false_for_equal_and_older() {
    assert!(!is_newer((0, 5, 2), (0, 5, 2)));
    assert!(!is_newer((0, 5, 1), (0, 5, 2)));
}

#[test]
fn newer_cases() {
    let cases: &[(Version, Version, bool)] = &[
        ((1, 2, 4), (1, 2, 3), true),
        ((2, 0, 0), (1, 9, 9), true),
        ((1, 2, 3), (1, 2, 3), false),
        ((1, 2, 2), (1, 2, 3), false),
    ];
    for (candidate, current, want) in cases {
        assert_eq!(
            is_newer(*candidate, *current),
            *want,
            "{candidate:?} vs {current:?}"
        );
    }
}

#[test]
fn newest_picks_highest_version_not_first() {
    // GitHub lists by creation time, so a patch to an old line sits above the current minor.
    let releases = vec![release("v0.4.9"), release("v0.6.0"), release("v0.5.2")];
    assert_eq!(newest_release(&releases).map(|(v, _)| v), Some((0, 6, 0)));
}

#[test]
fn newest_skips_draft_prerelease_and_bad_tags() {
    let releases = vec![
        release("android-v9.9.9"),
        Release {
            prerelease: true,
            ..release("v0.9.0")
        },
        Release {
            draft: true,
            ..release("v0.8.0")
        },
        release("v0.5.2"),
    ];
    assert_eq!(newest_release(&releases).map(|(v, _)| v), Some((0, 5, 2)));
}

#[test]
fn newest_keeps_first_of_equal() {
    let releases = vec![
        Release {
            html_url: "first".to_string(),
            ..release("v0.5.2")
        },
        Release {
            html_url: "second".to_string(),
            ..release("v0.5.2")
        },
    ];
    let (_, found) = newest_release(&releases).unwrap();
    assert_eq!(found.html_url, "first");
}

#[test]
fn newest_is_none_when_no_desktop_release() {
    assert!(newest_release(&[release("android-v1.0.0")]).is_none());
    assert!(newest_release(&[]).is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_sends_headers() {
    let (up, url) = serve_releases(200, "[]").await;
    let _ = fetch_releases(&url).await.unwrap();
    let seen = up.seen();
    let first = seen.first().unwrap();
    assert_eq!(first.header("accept"), Some("application/vnd.github+json"));
    assert_eq!(first.header("user-agent"), Some("WeaveForge-Desktop"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_non_2xx() {
    let (_up, url) = serve_releases(403, "{}").await;
    assert_eq!(fetch_releases(&url).await, Err("releases: 403".to_string()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_non_array() {
    let (_up, url) = serve_releases(200, r#"{"message":"x"}"#).await;
    assert_eq!(fetch_releases(&url).await, Ok(Vec::new()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_skips_items_that_do_not_parse() {
    // TS would crash on a bad item; the port keeps the good ones.
    let body = format!("[null,{{}},{}]", rel("v0.5.2", ""));
    let (_up, url) = serve_releases(200, &body).await;
    let found = fetch_releases(&url).await.unwrap();
    assert_eq!(found, vec![release("v0.5.2")]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn find_update_newer() {
    let body = format!("[{},{}]", rel("v0.6.0", ""), rel("v0.5.2", ""));
    let (_up, url) = serve_releases(200, &body).await;
    let update = find_update_at("0.5.2", &url).await;
    assert_eq!(
        update,
        Some(Update {
            version: "0.6.0".to_string(),
            url: "https://example.invalid/v0.6.0".to_string()
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn find_update_same_or_ahead() {
    let body = format!("[{},{}]", rel("v0.6.0", ""), rel("v0.5.2", ""));
    let (_up, url) = serve_releases(200, &body).await;
    for current in ["0.6.0", "0.7.0"] {
        assert_eq!(find_update_at(current, &url).await, None, "{current}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn find_update_keeps_offering_same_release() {
    // Deliberate: a dismissed dialog does not make a stale shell less stale.
    let body = format!("[{}]", rel("v0.6.0", ""));
    let (_up, url) = serve_releases(200, &body).await;
    assert_eq!(
        find_update_at("0.5.2", &url).await.map(|u| u.version),
        Some("0.6.0".to_string())
    );
    assert_eq!(
        find_update_at("0.5.2", &url).await.map(|u| u.version),
        Some("0.6.0".to_string())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn find_update_fetch_fails() {
    let (_up, url) = serve_releases(500, "{}").await;
    assert_eq!(find_update_at("0.5.2", &url).await, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn find_update_unreachable_is_none() {
    // A courtesy, not a dependency: an unreachable network is not an error.
    assert_eq!(find_update_at("0.5.2", NO_HOST).await, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn find_update_bad_current_makes_no_request() {
    let body = format!("[{}]", rel("v0.6.0", ""));
    let (up, url) = serve_releases(200, &body).await;
    assert_eq!(find_update_at("not-a-version", &url).await, None);
    assert!(up.seen().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn not_packaged_is_none() {
    // A dev build asks nothing, so the real GitHub URL is never reached.
    assert_eq!(check_update_reply(false, "0.5.2").await, Ok(None));
}

#[test]
fn update_check_failed_message() {
    assert_eq!(UPDATE_CHECK_FAILED, "Could not check for an update.");
}

#[test]
fn update_json() {
    let update = Update {
        version: "1.2.3".to_string(),
        url: "u".to_string(),
    };
    assert_eq!(
        serde_json::to_string(&update).unwrap(),
        r#"{"version":"1.2.3","url":"u"}"#
    );
}

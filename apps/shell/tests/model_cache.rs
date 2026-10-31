//! Tests for the encoder weights cache (ported from apps/desktop/test/model-cache.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
#[path = "common/upstream.rs"]
mod upstream;

use std::fs;
use std::path::{Path, PathBuf};

use common::{TempDir, put};
use upstream::{Reply as Canned, Upstream, redirect, response, serve};
use weaveforge_shell::model_cache::{
    MAX_FILE_BYTES, MAX_HOPS, cache_path_for, is_cache_part, is_upstream_host, is_upstream_url,
    model_client, model_path, serve_model_file, serve_model_file_capped,
};
use weaveforge_shell::protocol::Reply as Answer;
use weaveforge_shell::range::WHOLE_BYTES_MAX;

const NO_HOST: &str = "http://127.0.0.1:9";
const CONFIG: &str = "/Xenova/all-MiniLM-L6-v2/resolve/main/config.json";
const CONFIG_FILE: &str = "Xenova/all-MiniLM-L6-v2/resolve/main/config.json";

fn root() -> PathBuf {
    PathBuf::from("C:").join("cache").join("models")
}

fn client() -> reqwest::Client {
    model_client(|u| u.host_str() == Some("127.0.0.1")).unwrap()
}

fn base(up: &Upstream) -> String {
    up.base.as_str().trim_end_matches('/').to_string()
}

fn header<'a>(answer: &'a Answer, name: &str) -> Option<&'a str> {
    answer
        .headers
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, v)| v.as_str())
}

/// The names in `dir`, sorted; empty when the folder does not exist.
fn names(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

// ------------------------------------------------------------ paths

#[test]
fn cache_path_for_repository_path_becomes_file_under_root() {
    let at = cache_path_for(&root(), "/Xenova/all-MiniLM-L6-v2/resolve/main/config.json");
    assert_eq!(
        at,
        Some(
            root()
                .join("Xenova")
                .join("all-MiniLM-L6-v2")
                .join("resolve")
                .join("main")
                .join("config.json")
        )
    );
}

#[test]
fn cache_path_for_traversal_cannot_reach_outside_the_cache() {
    // The URL parser resolves a plain `..` before the cache sees it.
    assert_eq!(
        cache_path_for(&root(), "/secrets.txt"),
        Some(root().join("secrets.txt"))
    );
    // An encoded one survives that, and is what the check is for.
    assert_eq!(cache_path_for(&root(), "/a%2F..%2F..%2Fb"), None);
}

#[test]
fn cache_path_for_request_for_nothing_in_particular_is_refused() {
    assert_eq!(cache_path_for(&root(), "/"), None);
}

#[test]
fn cache_path_for_refuses_dot_segments_and_backslashes() {
    for path in ["/a/../b", "/a/%2e%2e/b", "/a\\b", "/a/%5Cb"] {
        assert_eq!(cache_path_for(&root(), path), None, "{path}");
    }
    assert_eq!(
        cache_path_for(&root(), "/a/b"),
        Some(root().join("a").join("b"))
    );
}

#[test]
fn model_path_strips_the_folder_on_the_app_host() {
    assert_eq!(
        model_path("localhost", "/models/a/b"),
        Some("/a/b".to_string())
    );
}

#[test]
fn model_path_takes_the_path_as_is_on_the_models_host() {
    assert_eq!(model_path("models", "/a/b"), Some("/a/b".to_string()));
}

#[test]
fn model_path_refuses_other_paths() {
    assert_eq!(model_path("localhost", "/other"), None);
}

#[test]
fn model_path_only_the_models_folder_of_the_app_host_is_a_weights_request() {
    assert_eq!(model_path("localhost", "/settings/index.html"), None);
    assert_eq!(model_path("localhost", "/modelsx/a/config.json"), None);
    assert_eq!(model_path("localhost", "/models"), None);
    assert_eq!(model_path("elsewhere", "/models/a/config.json"), None);
}

#[test]
fn model_path_same_origin_names_the_same_cached_file() {
    let path = model_path("localhost", "/models/Xenova/m/resolve/main/config.json").unwrap();
    assert_eq!(path, "/Xenova/m/resolve/main/config.json");
    assert_eq!(
        cache_path_for(&root(), &path),
        Some(
            root()
                .join("Xenova")
                .join("m")
                .join("resolve")
                .join("main")
                .join("config.json")
        )
    );
}

#[test]
fn model_path_encoded_traversal_under_same_origin_is_still_refused() {
    let path = model_path("localhost", "/models/a%2F..%2F..%2Fb").unwrap();
    assert_eq!(cache_path_for(&root(), &path), None);
}

#[test]
fn upstream_host_family_is_hugging_faces_own_and_nothing_else() {
    for host in [
        "huggingface.co",
        "cdn-lfs.huggingface.co",
        "hf.co",
        "us.aws.cdn.hf.co",
        "HF.CO",
    ] {
        assert!(is_upstream_host(host), "{host} should be allowed");
    }
    for host in ["evilhf.co", "huggingface.co.evil.com", ""] {
        assert!(!is_upstream_host(host), "{host} should be refused");
    }
}

// ------------------------------------------------------------ serving

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn miss_downloads_stores_and_serves_with_content_type() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(CONFIG, vec![response(200, &[], b"weights")])]).await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, b"weights".to_vec());
    assert_eq!(header(&answer, "content-type"), Some("application/json"));
    assert_eq!(fs::read(root.join(CONFIG_FILE)).unwrap(), b"weights");
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cached_file_is_served_from_disk_without_an_upstream_call() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(CONFIG, vec![response(200, &[], b"weights")])]).await;
    let _ = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    let cached = serve_model_file(&client(), &root, CONFIG, NO_HOST, None).await;

    assert_eq!(cached.status, 200);
    assert_eq!(cached.body, b"weights".to_vec());
    assert_eq!(header(&cached, "content-type"), Some("application/json"));
    assert_eq!(up.seen().len(), 1, "the second ask hits disk");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_access_control_allow_origin_on_download_or_hit() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(CONFIG, vec![response(200, &[], b"weights")])]).await;

    let first = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;
    let second = serve_model_file(&client(), &root, CONFIG, NO_HOST, None).await;

    assert_eq!(header(&first, "access-control-allow-origin"), None);
    assert_eq!(header(&second, "access-control-allow-origin"), None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn range_on_a_cached_file_is_206() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    put(&root.join(CONFIG_FILE), b"weights");

    let answer = serve_model_file(&client(), &root, CONFIG, NO_HOST, Some("bytes=0-3")).await;

    assert_eq!(answer.status, 206);
    assert_eq!(answer.body, b"weig".to_vec());
    assert_eq!(header(&answer, "content-range"), Some("bytes 0-3/7"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn asks_upstream_once_for_the_composed_target() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(CONFIG, vec![response(200, &[], b"weights")])]).await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 200);
    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "GET");
    assert_eq!(seen[0].target, CONFIG);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn renderer_cannot_point_the_download_at_another_path_or_host() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![("/anything", vec![response(200, &[], b"{}")])]).await;

    let _ = serve_model_file(&client(), &root, "/anything", &base(&up), None).await;

    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].target, "/anything");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn upstream_404_is_404_and_nothing_is_stored() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![]).await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 404);
    assert!(!root.join(CONFIG_FILE).exists());
    assert_eq!(up.seen().len(), 1, "a refusal is asked once, not retried");
    assert!(names(&root).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn upstream_down_is_502() {
    let dir = TempDir::new();
    let root = dir.path().join("models");

    let answer = serve_model_file(&client(), &root, CONFIG, NO_HOST, None).await;

    assert_eq!(answer.status, 502);
    assert!(names(&root).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirect_to_a_refused_host_is_502_not_a_bare_3xx() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(
        CONFIG,
        vec![redirect("http://localhost:9/elsewhere")],
    )])
    .await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 502);
    assert!(names(&root).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_download_leaves_no_file_behind() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(CONFIG, vec![response(404, &[], b"")])]).await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 404);
    assert!(names(&root).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rename_that_fails_still_serves_the_download_and_removes_the_part() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    // A non-empty folder where the file belongs: the read misses and the rename cannot land.
    put(&root.join(CONFIG_FILE).join("blocker"), b"x");
    let up = serve(vec![(CONFIG, vec![response(200, &[], b"{}")])]).await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, b"{}".to_vec());
    let parent = root.join(CONFIG_FILE).parent().unwrap().to_path_buf();
    assert_eq!(
        names(&parent),
        vec!["config.json".to_string()],
        "no .part left"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_asks_for_one_file_at_once_download_it_once() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(CONFIG, vec![response(200, &[], b"weights")])]).await;
    let client = client();
    let target = base(&up);

    let (a, b) = tokio::join!(
        serve_model_file(&client, &root, CONFIG, &target, None),
        serve_model_file(&client, &root, CONFIG, &target, None),
    );

    assert_eq!([a.status, b.status], [200, 200]);
    assert_eq!(a.body, b"weights".to_vec());
    assert_eq!(b.body, b"weights".to_vec());
    assert_eq!(up.seen().len(), 1, "one download, not two");
    let parent = root.join(CONFIG_FILE).parent().unwrap().to_path_buf();
    assert_eq!(
        names(&parent),
        vec!["config.json".to_string()],
        "no .part left"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_later_ask_after_a_finished_download_downloads_again() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let other = dir.path().join("other");
    let up = serve(vec![(CONFIG, vec![response(200, &[], b"weights")])]).await;

    let _ = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;
    let again = serve_model_file(&client(), &other, CONFIG, &base(&up), None).await;

    assert_eq!(again.status, 200);
    assert_eq!(up.seen().len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn declared_content_length_over_the_cap_is_502_and_nothing_is_stored() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(CONFIG, vec![response(200, &[], &[b'x'; 17])])]).await;

    let answer = serve_model_file_capped(&client(), &root, CONFIG, &base(&up), None, 16).await;

    assert_eq!(answer.status, 502);
    assert!(!root.join(CONFIG_FILE).exists());
    assert!(names(&root).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn chunked_body_over_the_cap_is_502_and_no_file_or_part_is_left() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let body = "x".repeat(20);
    let raw = format!(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n14\r\n{body}\r\n0\r\n\r\n"
    )
    .into_bytes();
    let up = serve(vec![(CONFIG, vec![Canned::Raw(raw)])]).await;

    let answer = serve_model_file_capped(&client(), &root, CONFIG, &base(&up), None, 16).await;

    assert_eq!(answer.status, 502);
    assert!(!root.join(CONFIG_FILE).exists());
    assert!(names(&root).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_content_length_still_downloads() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(
        CONFIG,
        vec![Canned::Raw(
            b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{}".to_vec(),
        )],
    )])
    .await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, b"{}".to_vec());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirect_to_the_same_server_is_followed_to_200() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![
        (CONFIG, vec![redirect("/final/config.json")]),
        ("/final/config.json", vec![response(200, &[], b"weights")]),
    ])
    .await;

    let answer = serve_model_file(&client(), &root, CONFIG, &base(&up), None).await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, b"weights".to_vec());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirect_chain_longer_than_max_hops_is_not_200() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![("/loop", vec![redirect("/loop")])]).await;

    let answer = serve_model_file(&client(), &root, "/loop", &base(&up), None).await;

    assert_ne!(answer.status, 200);
    // The policy stops at the hop past MAX_HOPS; that 3xx has no use to the page, so it is a 502.
    assert_eq!(answer.status, 502);
    assert!(up.seen().len() <= MAX_HOPS + 1);
    assert!(names(&root).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn same_origin_path_downloads_the_repository_path_without_the_folder() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let up = serve(vec![(
        "/Xenova/m/resolve/main/config.json",
        vec![response(200, &[], b"{}")],
    )])
    .await;
    let path = model_path("localhost", "/models/Xenova/m/resolve/main/config.json").unwrap();

    let answer = serve_model_file(&client(), &root, &path, &base(&up), None).await;

    assert_eq!(answer.status, 200);
    assert_eq!(up.seen()[0].target, "/Xenova/m/resolve/main/config.json");
}

// Skipped, by name, from model-cache.test.ts:
// - "a rename that fails is logged, and the download is still served": the
//   served part is ported (rename_that_fails_still_serves_the_download_and_removes_the_part);
//   the console.warn assertion has no Rust counterpart, as the shell does not log here.
// - "a normal download logs nothing": no logging in this port.
// - "a missing or bad content-length still downloads", bad case "abc": not ported;
//   the missing case is ported (missing_content_length_still_downloads). Reqwest's
//   handling of a non-numeric content-length is not verified here.
// - "a redirect is not policed..." (hop-by-hop walk): replaced by the Rust policy tests
//   (redirect_to_the_same_server_is_followed_to_200, redirect_chain_longer_than_max_hops_is_not_200).

#[test]
fn cache_path_for_refuses_parts_windows_would_change_or_open_as_devices() {
    for path in [
        "/a/.. ",
        "/a/a.",
        "/a/a:b",
        "/a/a%3Ab",
        "/a/NUL",
        "/a/nul.json",
        "/a/Com1",
        "/a/LPT9.onnx",
        "/a/CON",
        "/a/aux.txt",
        "/a/prn",
        "/a/b c",
        "/a/b%20",
        "/a/b%00",
    ] {
        assert_eq!(cache_path_for(&root(), path), None, "{path}");
    }
    for ok in [
        "CONSOLE.json",
        "COM10",
        "nullable",
        "model_quantized.onnx",
        ".gitattributes",
    ] {
        assert!(is_cache_part(ok), "{ok}");
    }
    assert!(!is_cache_part(""));
    assert!(!is_cache_part(&"a".repeat(256)));
    assert!(is_cache_part(&"a".repeat(255)));
}

#[test]
fn upstream_url_must_be_https_on_hugging_face() {
    let url = |s: &str| reqwest::Url::parse(s).unwrap();
    assert!(is_upstream_url(&url("https://huggingface.co/x")));
    assert!(is_upstream_url(&url("https://cdn-lfs.hf.co/x")));
    assert!(!is_upstream_url(&url("http://huggingface.co/x")));
    assert!(!is_upstream_url(&url("http://cdn-lfs.hf.co/x")));
    assert!(!is_upstream_url(&url("https://evil.example/x")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cached_file_over_the_page_limit_is_still_served_whole() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    let file = root.join(CONFIG_FILE);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    let big = fs::File::create(&file).unwrap();
    big.set_len(WHOLE_BYTES_MAX + 1).unwrap();
    drop(big);
    const { assert!(WHOLE_BYTES_MAX < MAX_FILE_BYTES) };

    let answer = serve_model_file(&client(), &root, CONFIG, NO_HOST, None).await;

    assert_eq!(answer.status, 200);
    assert_eq!(
        u64::try_from(answer.body.len()).unwrap(),
        WHOLE_BYTES_MAX + 1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cached_file_over_the_model_cap_is_500_without_a_range() {
    let dir = TempDir::new();
    let root = dir.path().join("models");
    put(&root.join(CONFIG_FILE), b"0123456789");

    let whole = serve_model_file_capped(&client(), &root, CONFIG, NO_HOST, None, 4).await;
    let part =
        serve_model_file_capped(&client(), &root, CONFIG, NO_HOST, Some("bytes=0-1"), 4).await;

    assert_eq!(whole.status, 500);
    assert_eq!(part.status, 206);
    assert_eq!(part.body, b"01".to_vec());
}

//! Tests for the relay router (ported from apps/desktop/src/app-relays.ts, answerRelay).

#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "common/upstream.rs"]
mod upstream;

use std::time::Duration;

use reqwest::Url;
use reqwest::header::HeaderMap;
use upstream::{Upstream, response, serve};
use weaveforge_shell::relay::arxiv::{ARXIV_TIMEOUT, ARXIV_UPSTREAM};
use weaveforge_shell::relay::blob::{BLOB_TIMEOUT, BLOB_UPSTREAM};
use weaveforge_shell::relay::html::HTML_TIMEOUT;
use weaveforge_shell::relay::pdf::PDF_TIMEOUT;
use weaveforge_shell::relay::route::{RelayConfig, answer_relay};
use weaveforge_shell::relay::semantic_scholar::{
    RETRY_UNIT, SEMANTIC_SCHOLAR_TIMEOUT, SEMANTIC_SCHOLAR_UPSTREAM,
};
use weaveforge_shell::relay::shared::{Answer, RelayRequest, relay_client};

const SHORT: Duration = Duration::from_secs(5);
const NO_HOST: &str = "http://127.0.0.1:9";
const METHOD_NOT_ALLOWED: &str = r#"{"error":"Method not allowed"}"#;

fn get(path: &str) -> RelayRequest {
    RelayRequest {
        method: "GET".to_string(),
        url: Url::parse(&format!("app://localhost{path}")).unwrap(),
        headers: HeaderMap::new(),
        body: vec![],
    }
}

fn body_text(answer: &Answer) -> String {
    String::from_utf8(answer.body.clone()).unwrap()
}

fn local(up: &Upstream) -> RelayConfig {
    let base = up.base.as_str().trim_end_matches('/').to_string();
    RelayConfig {
        hosted_app: base.clone(),
        semantic_scholar: base.clone(),
        arxiv: format!("{base}/api/query"),
        timeout: SHORT,
        retry_unit: Duration::from_millis(1),
        semantic_scholar_timeout: SHORT,
        arxiv_timeout: SHORT,
    }
}

fn dead() -> RelayConfig {
    RelayConfig {
        hosted_app: NO_HOST.to_string(),
        semantic_scholar: NO_HOST.to_string(),
        arxiv: NO_HOST.to_string(),
        timeout: SHORT,
        retry_unit: Duration::from_millis(1),
        semantic_scholar_timeout: SHORT,
        arxiv_timeout: SHORT,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pdf_and_html_relays_refuse_a_missing_url() {
    let cfg = dead();
    let client = relay_client().unwrap();

    // The PDF relay: no `url`, so it refuses itself.
    let answer = answer_relay(&client, &get("/api/pdf-proxy"), &cfg)
        .await
        .expect("pdf is relayed");
    assert_eq!(answer.status, 400);
    assert_eq!(body_text(&answer), r#"{"error":"url is required"}"#);

    // The HTML relay: no `url`, so it refuses itself.
    let answer = answer_relay(&client, &get("/api/html-proxy"), &cfg)
        .await
        .expect("html is relayed");
    assert_eq!(answer.status, 400);
    assert_eq!(body_text(&answer), r#"{"error":"url is required"}"#);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn each_relay_kind_reaches_its_relay() {
    let up = serve(vec![
        (
            "/graph/v1/paper/x",
            vec![response(
                200,
                &[("Content-Type", "application/json")],
                br#"{"ok":1}"#,
            )],
        ),
        (
            "/api/query",
            vec![response(
                200,
                &[("Content-Type", "application/atom+xml")],
                b"<feed/>",
            )],
        ),
        (
            "/api/blobs/abc",
            vec![response(
                200,
                &[("Content-Type", "application/octet-stream")],
                b"blob",
            )],
        ),
    ])
    .await;
    let cfg = local(&up);
    let client = relay_client().unwrap();

    // Semantic Scholar: the path and query reach the upstream.
    let answer = answer_relay(
        &client,
        &get("/api/semantic-scholar/graph/v1/paper/x?fields=title"),
        &cfg,
    )
    .await
    .expect("semantic scholar is relayed");
    assert_eq!(answer.status, 200);
    assert_eq!(body_text(&answer), r#"{"ok":1}"#);

    // arXiv: the id list goes to the query address.
    let answer = answer_relay(&client, &get("/api/arxiv?id_list=1607.06450"), &cfg)
        .await
        .expect("arxiv is relayed");
    assert_eq!(answer.status, 200);

    // Blob: the path reaches the hosted app.
    let answer = answer_relay(&client, &get("/api/blobs/abc"), &cfg)
        .await
        .expect("blob is relayed");
    assert_eq!(answer.status, 200);
    assert_eq!(body_text(&answer), "blob");

    // Account: GET is refused before anything is sent.
    let answer = answer_relay(&client, &get("/api/account/delete-user"), &cfg)
        .await
        .expect("account is relayed");
    assert_eq!(answer.status, 405);
    assert_eq!(body_text(&answer), METHOD_NOT_ALLOWED);

    // Overleaf: GET is refused before anything is sent.
    let answer = answer_relay(&client, &get("/api/overleaf/workshop/projects"), &cfg)
        .await
        .expect("overleaf is relayed");
    assert_eq!(answer.status, 405);
    assert_eq!(body_text(&answer), METHOD_NOT_ALLOWED);

    let targets: Vec<String> = up.seen().into_iter().map(|s| s.target).collect();
    assert_eq!(
        targets,
        vec![
            "/graph/v1/paper/x?fields=title".to_string(),
            "/api/query?id_list=1607.06450".to_string(),
            "/api/blobs/abc".to_string(),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn index_html_and_unknown_api_are_not_relayed() {
    let client = relay_client().unwrap();
    for path in ["/index.html", "/api/unknown", "/api/blobs"] {
        let answer = answer_relay(&client, &get(path), &dead()).await;
        assert!(answer.is_none(), "{path}");
    }
}

#[test]
fn production_holds_the_ts_values() {
    let cfg = RelayConfig::production();
    // apps/desktop/src/blob-proxy.ts:18
    assert_eq!(cfg.hosted_app, BLOB_UPSTREAM);
    assert_eq!(cfg.hosted_app, "https://app.weaveforge.org");
    // apps/web/src/lib/semantic-scholar-relay.ts:11, used by apps/desktop/src/semantic-scholar-proxy.ts:21
    assert_eq!(cfg.semantic_scholar, SEMANTIC_SCHOLAR_UPSTREAM);
    assert_eq!(cfg.semantic_scholar, "https://api.semanticscholar.org");
    // apps/desktop/src/arxiv-proxy.ts:17
    assert_eq!(cfg.arxiv, ARXIV_UPSTREAM);
    assert_eq!(cfg.arxiv, "https://export.arxiv.org/api/query");
    // apps/desktop/src/blob-proxy.ts:57
    assert_eq!(cfg.timeout, BLOB_TIMEOUT);
    assert_eq!(cfg.timeout, Duration::from_secs(120));
    // apps/desktop/src/semantic-scholar-proxy.ts:51
    assert_eq!(cfg.semantic_scholar_timeout, SEMANTIC_SCHOLAR_TIMEOUT);
    assert_eq!(cfg.semantic_scholar_timeout, Duration::from_secs(30));
    // apps/desktop/src/arxiv-proxy.ts:39
    assert_eq!(cfg.arxiv_timeout, ARXIV_TIMEOUT);
    assert_eq!(cfg.arxiv_timeout, Duration::from_secs(10));
    // apps/desktop/src/semantic-scholar-proxy.ts:58 (1000 * (attempt + 1) ms)
    assert_eq!(cfg.retry_unit, RETRY_UNIT);
    assert_eq!(cfg.retry_unit, Duration::from_secs(1));
    // apps/desktop/src/pdf-proxy.ts:58 and apps/desktop/src/html-proxy.ts:40: the relays own these
    assert_eq!(PDF_TIMEOUT, Duration::from_secs(90));
    assert_eq!(HTML_TIMEOUT, Duration::from_secs(60));
}

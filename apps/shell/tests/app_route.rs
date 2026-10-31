//! The `app://` router: which handler answers which request.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempDir, put};
use weaveforge_shell::app_route::{AppRoutes, from_reply, page_host, route};
use weaveforge_shell::local_artifacts::write_local_artifact;
use weaveforge_shell::protocol::Reply;
use weaveforge_shell::relay::route::RelayConfig;
use weaveforge_shell::relay::shared::Answer;

fn routes(web: &TempDir, data: &TempDir) -> AppRoutes {
    AppRoutes {
        web: web.path().to_path_buf(),
        models: data.path().join("models"),
        artifacts: data.path().join("artifacts"),
        model_client: None,
        relay_client: None,
        relay_config: RelayConfig::production(),
    }
}

fn get(uri: &str) -> tauri::http::Request<Vec<u8>> {
    tauri::http::Request::builder()
        .uri(uri)
        .body(Vec::new())
        .unwrap()
}

async fn ask(routes: &AppRoutes, uri: &str) -> Answer {
    route(routes, get(uri)).await
}

#[test]
fn page_host_drops_the_windows_app_prefix() {
    assert_eq!(page_host("app.artifacts"), "artifacts");
    assert_eq!(page_host("app.localhost"), "localhost");
    assert_eq!(page_host("localhost"), "localhost");
    assert_eq!(page_host("models"), "models");
}

#[test]
fn from_reply_keeps_status_headers_and_body() {
    let answer = from_reply(Reply {
        status: 206,
        headers: vec![("content-range", "bytes 0-1/4".to_owned())],
        body: b"ab".to_vec(),
    });
    assert_eq!(answer.status, 206);
    assert_eq!(
        answer.headers,
        vec![("content-range".to_owned(), "bytes 0-1/4".to_owned())]
    );
    assert_eq!(answer.body, b"ab".to_vec());
}

#[tokio::test]
async fn an_unknown_host_is_404() {
    let (web, data) = (TempDir::new(), TempDir::new());
    put(&web.path().join("index.html"), b"<html>home</html>");
    let answer = ask(&routes(&web, &data), "app://evil.example/").await;
    assert_eq!(answer.status, 404);
    assert!(answer.body.is_empty());
}

#[tokio::test]
async fn a_model_file_without_a_client_is_502() {
    let (web, data) = (TempDir::new(), TempDir::new());
    let routes = routes(&web, &data);
    assert_eq!(ask(&routes, "app://models/org/m/x.bin").await.status, 502);
    assert_eq!(
        ask(&routes, "http://app.localhost/models/org/m/x.bin")
            .await
            .status,
        502
    );
}

#[tokio::test]
async fn a_saved_artifact_is_served_on_both_url_forms() {
    let (web, data) = (TempDir::new(), TempDir::new());
    let routes = routes(&web, &data);
    let url = write_local_artifact(&routes.artifacts, "exp-1", "loss.png", b"png bytes").unwrap();
    let path = url.strip_prefix("app://artifacts").unwrap();
    for uri in [
        format!("app://artifacts{path}"),
        format!("http://app.artifacts{path}"),
    ] {
        let answer = ask(&routes, &uri).await;
        assert_eq!(answer.status, 200, "{uri}");
        assert_eq!(answer.body, b"png bytes".to_vec(), "{uri}");
    }
}

#[tokio::test]
async fn an_app_page_comes_from_the_web_export() {
    let (web, data) = (TempDir::new(), TempDir::new());
    put(&web.path().join("index.html"), b"<html>home</html>");
    let routes = routes(&web, &data);
    for uri in ["app://localhost/", "http://app.localhost/"] {
        let answer = ask(&routes, uri).await;
        assert_eq!(answer.status, 200, "{uri}");
        assert_eq!(answer.body, b"<html>home</html>".to_vec(), "{uri}");
    }
}

#[tokio::test]
async fn an_api_path_without_a_relay_client_falls_through_to_the_export() {
    let (web, data) = (TempDir::new(), TempDir::new());
    put(&web.path().join("index.html"), b"<html>home</html>");
    let answer = ask(&routes(&web, &data), "app://localhost/api/storage/x").await;
    // No relay ran: the answer is the export's, never a relay 502.
    assert_ne!(answer.status, 502);
}

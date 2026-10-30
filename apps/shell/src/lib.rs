//! WeaveForge desktop shell on Tauri 2.
//!
//! Serves the static web export over the `app` scheme. There is no bridge yet,
//! so the UI runs in browser mode.

use std::path::PathBuf;
use std::sync::Arc;

pub mod protocol;

/// Where the static web export lives: `WF_WEB_DIST`, else `web/` beside the binary.
fn web_root() -> PathBuf {
    if let Some(dir) = std::env::var_os("WF_WEB_DIST").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("web")))
    {
        return dir;
    }
    PathBuf::from("web")
}

/// Starts the shell window and blocks until it closes.
pub fn run() -> tauri::Result<()> {
    let root = Arc::new(web_root());
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            protocol::APP_SCHEME,
            move |_ctx, request, responder| {
                let root = Arc::clone(&root);
                let path = request.uri().path().to_owned();
                let query = request.uri().query().map(str::to_owned);
                // Disk reads stay off the webview thread.
                let _task = tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(to_response(protocol::respond(
                        &root,
                        &path,
                        query.as_deref(),
                    )));
                });
            },
        )
        .run(tauri::generate_context!())
}

/// Turns a protocol reply into the window's response; a bad header becomes a bare 500.
fn to_response(reply: protocol::Reply) -> tauri::http::Response<Vec<u8>> {
    let mut builder = tauri::http::Response::builder().status(reply.status);
    for (name, value) in reply.headers {
        builder = builder.header(name, value);
    }
    match builder.body(reply.body) {
        Ok(response) => response,
        Err(_) => {
            let mut response = tauri::http::Response::new(Vec::new());
            *response.status_mut() = tauri::http::StatusCode::INTERNAL_SERVER_ERROR;
            response
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::StatusCode;

    #[test]
    fn to_response_carries_status_headers_body() {
        let reply = protocol::Reply {
            status: 200,
            headers: vec![
                ("content-type", "text/plain".to_owned()),
                ("x-a", "b".to_owned()),
            ],
            body: b"hi".to_vec(),
        };
        let response = to_response(reply);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("text/plain")
        );
        assert_eq!(
            response.headers().get("x-a").and_then(|v| v.to_str().ok()),
            Some("b")
        );
        assert_eq!(response.body(), &b"hi".to_vec());
    }

    #[test]
    fn to_response_bad_header_is_500() {
        let reply = protocol::Reply {
            status: 200,
            headers: vec![("x-bad", "bad\nvalue".to_owned())],
            body: b"hi".to_vec(),
        };
        let response = to_response(reply);
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(response.body().is_empty());
    }

    #[test]
    fn window_url_uses_app_scheme() {
        let conf = include_str!("../tauri.conf.json");
        assert!(conf.contains(&format!(
            "\"url\": \"{}://localhost/\"",
            protocol::APP_SCHEME
        )));
    }
}

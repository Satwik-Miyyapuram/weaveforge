//! WeaveForge desktop shell on Tauri 2.
//!
//! Serves the static web export over the `app` scheme and starts the local database sidecar behind the
//! typed DB commands. The `window.weaveforge` shim is not injected yet, so the UI still runs in browser mode.

use std::path::PathBuf;
use std::sync::Arc;

pub mod commands;
pub mod launch;
pub mod prefs;
pub mod protocol;
pub mod secrets;
pub mod sidecar;

/// Where the static web export lives: `WF_WEB_DIST` (debug builds only), else `web/` beside the binary.
fn web_root() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Some(dir) = std::env::var_os("WF_WEB_DIST").filter(|d| !d.is_empty()) {
            return PathBuf::from(dir);
        }
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
    let app = tauri::Builder::default()
        .invoke_handler(commands::specta_builder().invoke_handler())
        .setup(|app| {
            start_local_db(app.handle());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(
            protocol::APP_SCHEME,
            move |_ctx, request, responder| {
                let root = Arc::clone(&root);
                let host = request.uri().host().map(str::to_owned);
                let path = request.uri().path().to_owned();
                let query = request.uri().query().map(str::to_owned);
                // Disk reads stay off the webview thread.
                let _task = tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(to_response(protocol::respond(
                        &root,
                        host.as_deref(),
                        &path,
                        query.as_deref(),
                    )));
                });
            },
        )
        .build(tauri::generate_context!())?;
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            stop_local_db(handle);
        }
    });
    Ok(())
}

/// Starts the sidecar and manages its `LocalDb`. Any failure is reported through `db_state`, never aborts startup.
fn start_local_db(app: &tauri::AppHandle) {
    use tauri::Manager;
    let paths = app.path();
    let db = match (paths.app_data_dir(), paths.resource_dir()) {
        (Ok(data), Ok(resources)) => {
            let data_dir = data.join("local-db");
            let backups_dir = data.join("local-db-backups");
            let source = launch::sidecar_source(resources);
            let old = paths
                .config_dir()
                .ok()
                .and_then(|c| launch::electron_data_dir(&source, &c));
            let config = launch::sidecar_config(&source, &data_dir, &backups_dir, old.as_deref());
            // Sidecar::spawn needs a Tokio runtime; setup runs outside one.
            let sidecar =
                tauri::async_runtime::block_on(async { sidecar::Sidecar::spawn(config.clone()) });
            commands::LocalDb::new(sidecar, data_dir.to_string_lossy().into_owned())
                .restartable(config)
        }
        (Err(e), _) | (_, Err(e)) => commands::LocalDb::new(
            Err(sidecar::SidecarError::Spawn(e.to_string())),
            String::new(),
        ),
    };
    let _ = app.manage(db);
}

/// Closes the sidecar's stdin and waits up to `SHUTDOWN_GRACE` for it to exit.
fn stop_local_db(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(db) = app.try_state::<commands::LocalDb>() {
        let _ = tauri::async_runtime::block_on(db.shutdown(launch::SHUTDOWN_GRACE));
    }
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

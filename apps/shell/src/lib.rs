//! WeaveForge desktop shell on Tauri 2.
//!
//! Serves the static web export over the `app` scheme and starts the local database sidecar behind the
//! typed DB commands. The `window.weaveforge` shim is not injected yet, so the UI still runs in browser mode.

use std::path::PathBuf;
use std::sync::Arc;

pub mod app_log;
pub mod cmd_tools;
pub mod cmd_vault;
pub mod commands;
pub mod fetch;
pub mod git;
pub mod launch;
pub mod prefs;
pub mod protocol;
pub mod range;
pub mod relay;
pub mod secrets;
pub mod sidecar;
pub mod tex;
pub mod update_check;
pub mod vault;
pub mod vault_search;
pub mod vault_sync;
pub mod zotero_local;

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
            start_stores(app.handle());
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

/// Manages the preferences, keychain secrets, app log, git queue and the chosen vault folder.
///
/// A missing app folder leaves preferences and the log in the working directory; startup never aborts.
fn start_stores(app: &tauri::AppHandle) {
    use tauri::Manager;
    let paths = app.path();
    let data = paths.app_data_dir().unwrap_or_default();
    let logs = paths.app_log_dir().unwrap_or_else(|_| data.clone());
    let home = paths
        .home_dir()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();
    let prefs = prefs::Prefs::new(data.join("preferences.json"));
    let vault = vault::VaultState::new();
    let remembered = match prefs.read("vault-root") {
        Ok(Some(prefs::PrefValue::Text(path))) => Some(path),
        _ => None,
    };
    let _ = vault.lock().restore(remembered.as_deref());
    let secrets = secrets::Secrets::new(native_store(), app.config().identifier.clone());
    let _ = app.manage(prefs);
    let _ = app.manage(vault);
    let _ = app.manage(secrets);
    let _ = app.manage(app_log::AppLog::new(&logs, &home));
    let _ = app.manage(git::GitQueue::default());
}

/// This platform's keychain, or `None` when it cannot be opened.
fn native_store() -> Option<Arc<keyring_core::CredentialStore>> {
    #[cfg(windows)]
    let store = windows_native_keyring_store::Store::new()
        .ok()
        .map(|s| s as Arc<keyring_core::CredentialStore>);
    #[cfg(target_os = "macos")]
    let store = apple_native_keyring_store::keychain::Store::new()
        .ok()
        .map(|s| s as Arc<keyring_core::CredentialStore>);
    #[cfg(target_os = "linux")]
    let store = dbus_secret_service_keyring_store::Store::new()
        .ok()
        .map(|s| s as Arc<keyring_core::CredentialStore>);
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let store = None;
    store
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

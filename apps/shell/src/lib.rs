//! WeaveForge desktop shell on Tauri 2.
//!
//! Serves the static web export over the `app` scheme and starts the local database sidecar behind the
//! typed DB commands. The `window.weaveforge` shim is not injected yet, so the UI still runs in browser mode.

use std::path::PathBuf;
use std::sync::Arc;

pub mod app_log;
pub mod app_route;
pub mod cmd_ink;
pub mod cmd_tools;
pub mod cmd_vault;
pub mod commands;
pub mod fetch;
pub mod git;
pub mod host;
pub mod ink;
pub mod launch;
pub mod local_artifacts;
pub mod mattermost;
pub mod menu;
pub mod model_cache;
pub mod overleaf_links;
pub mod overleaf_read;
pub mod plan_widget;
pub mod prefs;
pub mod protocol;
pub mod range;
pub mod relay;
pub mod secrets;
pub mod sidecar;
pub mod tex;
pub mod update_check;
pub mod vault;
pub mod vault_choice;
pub mod vault_search;
pub mod vault_sync;
pub mod vault_watch;
pub mod vault_watcher;
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(commands::specta_builder().invoke_handler())
        .setup(|app| {
            start_stores(app.handle());
            start_ink(app.handle());
            start_vault_watch(app.handle());
            start_routes(app.handle());
            start_local_db(app.handle());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(
            protocol::APP_SCHEME,
            |ctx, request, responder| {
                let app = ctx.app_handle().clone();
                // Network and disk work stay off the webview thread.
                let _task = tauri::async_runtime::spawn(async move {
                    use tauri::Manager;
                    let answer = match app.try_state::<app_route::AppRoutes>() {
                        Some(routes) => app_route::route(&routes, request).await,
                        None => relay::shared::Answer {
                            status: 503,
                            headers: Vec::new(),
                            body: Vec::new(),
                        },
                    };
                    responder.respond(to_response(answer));
                });
            },
        )
        .build(tauri::generate_context!())?;
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            stop_local_db(handle);
            stop_helpers(handle);
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
    let _ = vault_choice::restore_remembered(&vault, &prefs);
    let secrets = secrets::Secrets::new(native_store(), app.config().identifier.clone());
    let _ = app.manage(prefs);
    let _ = app.manage(vault);
    let _ = app.manage(secrets);
    let _ = app.manage(app_log::AppLog::new(&logs, &home));
    let _ = app.manage(git::GitQueue::default());
}

/// The event that carries folder-relative paths changed by other programs to the page.
pub const VAULT_CHANGED_EVENT: &str = "vault-changed";

/// The sink a folder watch reports to: each batch of paths goes to the page as a `vault-changed` event.
pub(crate) fn change_sink(app: &tauri::AppHandle) -> vault_watcher::ChangeSink {
    use tauri::Emitter as _;
    let emitter = app.clone();
    Arc::new(move |paths: Vec<String>| {
        let _ = emitter.emit(VAULT_CHANGED_EVENT, paths);
    })
}

/// Logs a vault-watch or remembering problem; the folder still works without it.
pub(crate) fn log_vault_warning(app: &tauri::AppHandle, reason: &str, path: &str) {
    use tauri::Manager as _;
    if let Some(log) = app.try_state::<app_log::AppLog>() {
        log.record(app_log::LogLevel::Warn, "vault-watch", reason, Some(path));
    }
}

/// Manages the handwriting recogniser; its helper starts on first use, never at startup.
fn start_ink(app: &tauri::AppHandle) {
    use tauri::Manager;
    // No resource folder means no helper: never fall back to the working directory.
    let executable = app.path().resource_dir().ok().and_then(|resources| {
        ink::ink_recogniser_path(std::env::consts::OS, std::env::consts::ARCH, &resources)
    });
    let log_app = app.clone();
    let on_diagnostic = Arc::new(move |line: &str| {
        if let Some(log) = log_app.try_state::<app_log::AppLog>() {
            log.record(app_log::LogLevel::Warn, "ink", line, None);
        }
    });
    let _ = app.manage(ink::InkRecogniser::new(ink::InkOptions {
        executable,
        spawner: ink::process_spawner(),
        timeout: ink::REQUEST_TIMEOUT,
        ready_timeout: ink::READY_TIMEOUT,
        on_diagnostic,
    }));
}

/// Watches the remembered workspace folder so edits made in other programs reach the page.
///
/// A folder that cannot be watched is logged; the app still runs without the watch.
fn start_vault_watch(app: &tauri::AppHandle) {
    use tauri::Manager as _;
    let slot = vault_watcher::WatchSlot::default();
    let root = app
        .try_state::<vault::VaultState>()
        .and_then(|vault| vault.lock().root());
    if let Some(root) = root
        && let Err(reason) =
            vault_choice::watch_root(&slot, std::path::Path::new(&root.path), change_sink(app))
    {
        log_vault_warning(app, &reason, &root.path);
    }
    let _ = app.manage(slot);
}

/// Stops the folder watch and the handwriting helper before the process exits.
fn stop_helpers(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(slot) = app.try_state::<vault_watcher::WatchSlot>() {
        slot.set(None);
    }
    if let Some(ink) = app.try_state::<ink::InkRecogniser>() {
        ink.dispose();
    }
}

/// This platform's keychain, or `None` when it cannot be opened.
fn native_store() -> Option<Arc<keyring_core::CredentialStore>> {
    #[cfg(windows)]
    let store = windows_native_keyring_store::Store::new()
        .ok()
        .map(|s| -> Arc<keyring_core::CredentialStore> { s });
    #[cfg(target_os = "macos")]
    let store = apple_native_keyring_store::keychain::Store::new()
        .ok()
        .map(|s| -> Arc<keyring_core::CredentialStore> { s });
    #[cfg(target_os = "linux")]
    let store = dbus_secret_service_keyring_store::Store::new()
        .ok()
        .map(|s| -> Arc<keyring_core::CredentialStore> { s });
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

/// Makes the `app://` routes' folders and clients; the folders sit in app data, as in Electron.
fn start_routes(app: &tauri::AppHandle) {
    use tauri::Manager;
    let data = app.path().app_data_dir().unwrap_or_default();
    let routes = app_route::AppRoutes {
        web: web_root(),
        models: data.join("models"),
        artifacts: data.join("artifacts"),
        model_client: model_cache::model_client(model_cache::is_upstream_url).ok(),
        relay_client: relay::shared::relay_client().ok(),
        relay_config: relay::route::RelayConfig::production(),
    };
    let _ = app.manage(routes);
}

/// Turns an answer into the window's response; a bad header becomes a bare 500.
fn to_response(reply: relay::shared::Answer) -> tauri::http::Response<Vec<u8>> {
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
        let reply = relay::shared::Answer {
            status: 200,
            headers: vec![
                ("content-type".to_owned(), "text/plain".to_owned()),
                ("x-a".to_owned(), "b".to_owned()),
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
        let reply = relay::shared::Answer {
            status: 200,
            headers: vec![("x-bad".to_owned(), "bad\nvalue".to_owned())],
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

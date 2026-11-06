//! WeaveForge desktop shell on Tauri 2.
//!
//! Serves the static web export over the `app` scheme and starts the local database sidecar behind the
//! typed DB commands. The main window gets the `window.weaveforge` bridge as an init script (`shim`),
//! and the sign-in redirect comes back through the loopback listener (`auth_loopback`).

use std::path::PathBuf;
use std::sync::Arc;

pub mod app_log;
pub mod app_route;
pub mod app_storage;
pub mod auth_link;
pub mod auth_loopback;
pub mod cmd_ink;
pub mod cmd_tools;
pub mod cmd_vault;
pub mod commands;
pub mod db_lock;
#[cfg(desktop)]
pub mod embed;
#[cfg(mobile)]
#[path = "embed_phone.rs"]
pub mod embed;
pub mod git;
pub mod github_file;
pub mod host;
pub mod ink;
pub mod launch;
pub mod local_api;
pub mod local_artifacts;
pub mod local_files;
pub mod local_http;
pub mod local_pg;
pub mod mattermost;
pub mod mcp_bridge;
pub mod menu;
pub mod migrate;
pub mod model_cache;
pub mod old_db;
pub mod overleaf_links;
pub mod overleaf_read;
pub mod overleaf_signin;
pub mod overleaf_workshop;
pub mod paste_commands;
pub mod plan_widget;
pub mod plan_widget_window;
pub mod prefs;
pub mod protocol;
pub mod range;
pub mod secrets;
pub mod shim;
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

pub use wf_relay::{fetch, relay, tls};

/// Where the static web export lives: `dev_dir` (`WF_WEB_DIST`, debug builds only) if set, else `web/` in
/// Tauri's resource dir (beside the exe on Windows, `/usr/lib/<product>` on Linux, `Contents/Resources` on macOS).
fn web_root_in(
    dev_dir: Option<std::ffi::OsString>,
    resources: Option<&std::path::Path>,
) -> PathBuf {
    if let Some(dir) = dev_dir.filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    resources.map_or_else(|| PathBuf::from("web"), |r| r.join("web"))
}

/// The app's web export, found through `web_root_in` with the app's resource dir.
fn web_root(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    #[cfg(debug_assertions)]
    let dev = std::env::var_os("WF_WEB_DIST");
    #[cfg(not(debug_assertions))]
    let dev = None;
    let resources = app.path().resource_dir().ok();
    web_root_in(dev, resources.as_deref())
}

/// The phone entry point. Android and iOS start the app through the symbols Tauri's macro makes;
/// the desktop starts it from `main.rs`.
#[cfg(mobile)]
#[allow(
    unsafe_code,
    missing_docs,
    reason = "tauri::mobile_entry_point emits no_mangle and JNI glue without docs"
)]
mod mobile_entry {
    /// Runs the app; a failed start is printed, as `main` does on desktops.
    #[tauri::mobile_entry_point]
    fn start() {
        if let Err(error) = super::run() {
            eprintln!("weaveforge: {error}");
        }
    }
}

/// Starts the shell window and blocks until it closes.
pub fn run() -> tauri::Result<()> {
    install_tls_provider();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    // The pen surface over the WebView (phase 4, step 4.3a); desktops ink in the web app.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_ink::init());
    // Sign-in returns through an App Link on phones (phase 4, step 4.5).
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    let app = builder
        .invoke_handler(commands::specta_builder().invoke_handler())
        .setup(|app| {
            start_stores(app.handle());
            start_ink(app.handle());
            start_vault_watch(app.handle());
            start_routes(app.handle());
            start_local_db(app.handle());
            start_local_api(app.handle());
            open_main_window(app.handle())?;
            plan_widget_window::open_at_start(app.handle());
            start_sign_in(app.handle());
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
            stop_local_api(handle);
            stop_local_db(handle);
            stop_helpers(handle);
        }
    });
    Ok(())
}

/// Phones build reqwest with `rustls-no-provider`, so its clients need a process-wide crypto
/// provider before the first one is made. Desktops use the platform's TLS and need none.
#[cfg(mobile)]
fn install_tls_provider() {
    // Err only means a provider is already installed, which is just as good.
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[cfg(desktop)]
const fn install_tls_provider() {}

/// Manages the preferences, keychain secrets, app log, git queue, offline files and the chosen
/// vault folder.
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
    let _ = app.manage(embed::EmbedSlot::default());
    let _ = app.manage(cmd_tools::TexStop::default());
    let _ = app.manage(local_files::LocalFiles::new(data.join("local-files")));
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

/// Copies the old Electron app's data into `data` once. `Some(reason)` when the database must stay closed.
fn migration_blocker(old: &std::path::Path, data: &std::path::Path) -> Option<String> {
    match migrate::migrate_from_electron(old, data, std::time::SystemTime::now()) {
        Ok(migrate::Outcome::Busy(reason)) => Some(format!(
            "the old WeaveForge app is running; close it, then restart WeaveForge so its data can be copied ({reason})"
        )),
        Ok(_) => None,
        Err(e) => Some(format!(
            "could not copy the old WeaveForge app's data, so the database stays closed: {e}"
        )),
    }
}

/// The lock name the native database holds while this app has it open.
const NATIVE_LOCK_APP: &str = "weaveforge-native-db";

/// The native database's folder under the app data dir.
fn native_root(data: &std::path::Path) -> PathBuf {
    data.join("local-pg")
}

/// The native Postgres database. `Err` says why it cannot run; the caller reports it.
fn native_db(
    app: &tauri::AppHandle,
    data: &std::path::Path,
    resources: &std::path::Path,
    source: &launch::SidecarSource,
) -> Result<commands::NativeDb, String> {
    let bin_override = std::env::var_os("WEAVEFORGE_PG_BIN").map(PathBuf::from);
    // initdb cannot run postgres from a `\\?\` path, which Tauri's resource dir has on Windows.
    let resources = launch::without_verbatim_prefix(resources);
    let bin = local_pg::server::locate_bin(bin_override.as_deref(), Some(&resources))
        .map_err(|e| format!("the native database has no Postgres: {e}"))?;
    let root = native_root(data);
    db_lock::acquire(&root, NATIVE_LOCK_APP, std::time::SystemTime::now())
        .map_err(|e| e.to_string())?;
    let log = app.clone();
    let backups = local_pg::backup::Backups::new(vec![data.join("local-db-backups")]);
    let mut host = local_pg::host::PgHost::new(
        local_pg::host::PgEngine::new(bin, root, Some(backups.clone())),
        launch::migration_dirs(source),
    )
    .with_log(Arc::new(move |line: &str| local_api::warn(&log, line)))
    .with_backups(backups);
    // A failed copy fails the open, so old data is never hidden behind an empty database.
    if let Some(old) = migrate::old_pglite_dir(data) {
        local_api::warn(
            app,
            &format!("[local-db] old database to copy: {}", old.display()),
        );
        host = host.with_first_open(Arc::new(old_db_import(app, data, &old, source)));
    }
    let host = Arc::new(host);
    spawn_backups(app, &host);
    Ok(host)
}

/// How often the native database is backed up while it changes (the sidecar's `BACKUP_EVERY_MS`).
const BACKUP_EVERY: std::time::Duration = std::time::Duration::from_secs(600);

/// Backs up the native database every `BACKUP_EVERY` when it changed; quitting takes the last one.
fn spawn_backups(app: &tauri::AppHandle, host: &commands::NativeDb) {
    let app = app.clone();
    let host = Arc::downgrade(host);
    let _task = tauri::async_runtime::spawn(async move {
        let start = tokio::time::Instant::now() + BACKUP_EVERY;
        let mut every = tokio::time::interval_at(start, BACKUP_EVERY);
        loop {
            let _ = every.tick().await;
            let Some(host) = host.upgrade() else { return };
            if let Err(e) = host.backup_if_changed(std::time::SystemTime::now()).await {
                local_api::warn(&app, &format!("[local-db] backup failed: {}", e.message));
            }
        }
    });
}

/// Copies the old PGlite database into the native one on its first open, through a sidecar that
/// runs only for the copy. The marker sits beside the native folder, so discarding that folder does
/// not copy again.
fn old_db_import(
    app: &tauri::AppHandle,
    data: &std::path::Path,
    old_dir: &std::path::Path,
    source: &launch::SidecarSource,
) -> old_db::StopAfter<local_pg::import::OnceImport> {
    use tauri::Manager as _;
    let api = launch::ApiArgs {
        artifacts: data.join("artifacts"),
        app_version: app.package_info().version.to_string(),
        product_name: app.package_info().name.clone(),
    };
    // The sidecar migrates the folder it opens, so it gets a copy; the old folder is only read.
    let copy = data.join("local-pg-import-src");
    let config = launch::sidecar_config(source, &copy, &data.join("local-db-backups"), &api, None);
    let old = Arc::new(old_db::OldDb::new(config).with_snapshot(old_dir.to_path_buf(), copy));
    let _ = app.manage(Arc::clone(&old));
    let reader = Arc::clone(&old);
    let rows: local_pg::import::RowsFn = Arc::new(move |sql: String| {
        let reader = Arc::clone(&reader);
        Box::pin(async move { reader.rows(sql).await })
    });
    old_db::StopAfter {
        job: local_pg::import::OnceImport {
            marker: data.join("local-pg.imported"),
            source: rows,
            page_rows: 500,
        },
        old,
    }
}

/// Opens the native database and manages its `LocalDb`. Any failure is reported through
/// `db_state`, never aborts startup.
fn start_local_db(app: &tauri::AppHandle) {
    use tauri::Manager;
    let paths = app.path();
    let db = match (paths.app_data_dir(), paths.resource_dir()) {
        (Ok(data), Ok(resources)) => {
            let source = launch::sidecar_source(resources.clone());
            let product = app.package_info().name.clone();
            let old = paths
                .config_dir()
                .ok()
                .and_then(|c| launch::electron_data_dir(&source, &product, &c));
            // Copied before the database opens, so it never reads a half-copied or empty one.
            let native = match old.as_deref().and_then(|old| migration_blocker(old, &data)) {
                Some(reason) => Err(reason),
                None => native_db(app, &data, &resources, &source),
            };
            if let Err(reason) = &native {
                local_api::warn(app, reason);
            }
            let data_dir = native_root(&data).join("data");
            commands::LocalDb::new(native, data_dir.to_string_lossy().into_owned())
        }
        (Err(e), _) | (_, Err(e)) => commands::LocalDb::new(Err(e.to_string()), String::new()),
    };
    let _ = app.manage(db);
}

/// What the local API needs from the app, or `None` when the stores are not managed yet.
fn local_api_deps(app: &tauri::AppHandle) -> Option<(local_http::control::LocalApiDeps, bool)> {
    use tauri::Manager;
    let prefs = app.try_state::<prefs::Prefs>()?.inner().clone();
    let secrets = app.try_state::<secrets::Secrets>()?.inner().clone();
    let vault = app.try_state::<vault::VaultState>()?.inner().clone();
    let paths = app.path();
    let product = app.package_info().name.clone();
    // Without a resource dir the build is unknown, so it is treated as Dev: it must never
    // touch the installed app's MCP home or configs.
    let variant = paths
        .resource_dir()
        .ok()
        .map(launch::sidecar_source)
        .map_or(Some("dev"), |s| launch::home_variant(&s, &product));
    let release = !cfg!(debug_assertions) && variant.is_none();
    let home = paths.home_dir().unwrap_or_default();
    let mcp_paths = local_http::connect::mcp_paths(&home, variant, None);
    let log = app.clone();
    let ranker = Arc::new(local_http::control::WindowRanker::new(
        Arc::new(app.clone()),
        Arc::new(move |line: &str| local_api::warn(&log, line)),
    ));
    let query: Arc<dyn local_http::SdkQuery> = Arc::new(local_api::AppQuery(app.clone()));
    let mcp = local_http::mcp::LocalMcp::new(
        vault.clone(),
        Some(query.clone()),
        Some(ranker.clone()),
        Some(local_http::McpHome {
            api_url: format!("http://127.0.0.1:{}", local_http::server::LOCAL_API_PORT),
            token_file: mcp_paths.file.to_string_lossy().into_owned(),
        }),
    );
    let artifacts = paths.app_data_dir().unwrap_or_default().join("artifacts");
    let deps = local_http::control::LocalApiDeps {
        vault,
        prefs: Arc::new(prefs),
        secrets: Arc::new(secrets),
        opener: Arc::new(local_api::TauriOpener(app.clone())),
        query: Some(query),
        save_artifact: Some(Arc::new(local_api::AppArtifacts(artifacts))),
        mcp: Some(Arc::new(mcp)),
        ranker,
        paths: mcp_paths,
        exe: std::env::current_exe().unwrap_or_default(),
        version: app.package_info().version.to_string(),
        tools: Arc::new(|| local_http::mcp::listed_tools(true)),
        port: local_http::server::LOCAL_API_PORT,
    };
    Some((deps, release))
}

/// Manages the local API switch and turns the API on if the user left it on. A release build
/// also points the MCP clients' configs at this app.
fn start_local_api(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some((deps, release)) = local_api_deps(app) else {
        local_api::warn(app, "no prefs, secrets or vault: the local API is off");
        return;
    };
    let launch = local_http::connect::mcp_launch(&deps.paths, &deps.exe);
    let _ = app.manage(local_http::control::LocalApiControl::new(deps));
    let handle = app.clone();
    let _task = tauri::async_runtime::spawn(async move {
        if let Some(control) = handle.try_state::<local_http::control::LocalApiControl>() {
            control.resume().await;
        }
        if !release {
            return;
        }
        let paths = handle.path();
        let home = paths.home_dir().unwrap_or_default();
        let data = paths.data_dir().ok();
        let targets =
            local_http::rewrite::mcp_client_configs(&home, std::env::consts::OS, data.as_deref());
        let (changed, skipped) = local_http::rewrite::rewrite_mcp_client_configs(&targets, &launch);
        for file in changed {
            local_api::warn(
                &handle,
                &format!("pointed MCP config at this app: {}", file.display()),
            );
        }
        for file in skipped {
            local_api::warn(
                &handle,
                &format!("left MCP config alone: {}", file.display()),
            );
        }
    });
}

/// Stops the local API server, if it runs.
fn stop_local_api(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(control) = app.try_state::<local_http::control::LocalApiControl>() {
        tauri::async_runtime::block_on(control.close());
    }
}

/// Stops Postgres and an import sidecar still running, then drops the database lock.
fn stop_local_db(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(db) = app.try_state::<commands::LocalDb>() {
        tauri::async_runtime::block_on(db.shutdown());
    }
    if let Some(old) = app.try_state::<Arc<old_db::OldDb>>() {
        tauri::async_runtime::block_on(old.stop(launch::SHUTDOWN_GRACE));
    }
    // Drops only this process's lock, after Postgres stopped; a no-op when it never opened.
    if let Ok(data) = app.path().app_data_dir() {
        db_lock::release(&native_root(&data));
    }
}

/// Makes the `app://` routes' folders and clients; the folders sit in app data, as in Electron.
fn start_routes(app: &tauri::AppHandle) {
    use tauri::Manager;
    let data = app.path().app_data_dir().unwrap_or_default();
    let routes = app_route::AppRoutes {
        web: web_root(app),
        models: data.join("models"),
        artifacts: data.join("artifacts"),
        model_client: model_cache::model_client(model_cache::is_upstream_url).ok(),
        relay_client: relay::shared::relay_client().ok(),
        relay_config: relay::route::RelayConfig::production(),
        prefs: app.try_state::<prefs::Prefs>().map(|s| s.inner().clone()),
        secrets: app
            .try_state::<secrets::Secrets>()
            .map(|s| s.inner().clone()),
        workshop: overleaf_workshop::WorkshopSessions::default(),
    };
    let _ = app.manage(routes);
}

/// The label of the one app window, as `tauri.conf.json` names it.
pub(crate) const MAIN_WINDOW: &str = "main";

/// Opens the main window from its `tauri.conf.json` entry (`create: false`), with the bridge as its init script.
/// The window stays on the app's own pages: other http(s) links and popups open in the OS browser, as in Electron.
pub(crate) fn open_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW)
    else {
        log_warn(
            app,
            "shell",
            "tauri.conf.json has no main window",
            MAIN_WINDOW,
        );
        return Err(tauri::Error::WindowNotFound);
    };
    let script = shim::init_script(
        &app.package_info().version.to_string(),
        std::env::consts::OS,
    );
    let nav_app = app.clone();
    let popup_app = app.clone();
    let builder = tauri::WebviewWindowBuilder::from_config(app, config)?
        .initialization_script(script)
        .on_navigation(move |url| {
            let stays = shim::main_window_keeps(url);
            if !stays {
                open_outside(&nav_app, url);
            }
            stays
        })
        .on_new_window(move |url, _features| {
            if shim::is_app_blob(&url) {
                // A file the app made, such as a compiled PDF: show it in its own window.
                return tauri::webview::NewWindowResponse::Allow;
            }
            open_outside(&popup_app, &url);
            tauri::webview::NewWindowResponse::Deny
        });
    // Windows and Linux: no system frame; the page's title bar draws the menu and window buttons.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.decorations(false);
    // A cold-start sign-in waits until the page (and the shim's listener) exists.
    #[cfg(mobile)]
    let builder = builder.on_page_load(|window, payload| {
        use tauri::Manager as _;
        if payload.event() != tauri::webview::PageLoadEvent::Finished {
            return;
        }
        let app = window.app_handle();
        let query = app
            .try_state::<PendingSignIn>()
            .and_then(|pending| pending.0.lock().ok().and_then(|mut slot| slot.take()));
        if let Some(query) = query {
            deliver_sign_in(app, query);
        }
    });
    builder
        .build()
        .inspect_err(|error| {
            log_warn(
                app,
                "shell",
                "The main window did not open",
                &error.to_string(),
            );
        })
        .map(|_| ())
}

/// Opens a public http(s) address in the OS browser, by the same URL-shape rule as Electron's
/// `mayOpenExternally`. Anything else (credentials, odd ports, local hosts, other schemes) is dropped
/// and logged, as is a failure to open.
fn open_outside(app: &tauri::AppHandle, url: &tauri::Url) {
    use tauri_plugin_opener::OpenerExt as _;
    if let Err(rejection) = fetch::url_shape::check_url_shape(url) {
        log_warn(
            app,
            "shell",
            "A link was not opened",
            &format!("{rejection:?} ({})", url.scheme()),
        );
        return;
    }
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        log_warn(
            app,
            "shell",
            "A link could not open in the browser",
            &error.to_string(),
        );
    }
}

/// Listens for the sign-in redirect; a taken port is logged and sign-in falls back to pasting the link.
#[cfg(desktop)]
fn start_sign_in(app: &tauri::AppHandle) {
    let app = app.clone();
    let _task = tauri::async_runtime::spawn(async move {
        match auth_loopback::bind().await {
            Ok(listener) => {
                let handle = app.clone();
                auth_loopback::serve(listener, move |query| deliver_sign_in(&handle, query)).await;
            }
            Err(error) => log_warn(
                &app,
                "sign-in",
                "The sign-in listener did not start",
                &error.to_string(),
            ),
        }
    });
}

/// A sign-in App Link that cold-started the app, held until the page has loaded.
#[cfg(mobile)]
#[derive(Default)]
struct PendingSignIn(std::sync::Mutex<Option<String>>);

/// Hands each sign-in App Link the OS opens to the page; phones have no loopback port.
/// A link that cold-starts the app is held and handed over once the page has loaded.
#[cfg(mobile)]
fn start_sign_in(app: &tauri::AppHandle) {
    use tauri::Manager as _;
    use tauri_plugin_deep_link::DeepLinkExt as _;
    let handle = app.clone();
    // The listener lives as long as the app, so its id is never needed to remove it.
    let _listener = app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if let Some(query) = auth_link::callback_query(&url) {
                deliver_sign_in(&handle, query);
            }
        }
    });
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            if let Some(query) = auth_link::newest_callback_query(&urls) {
                let _ = app.manage(PendingSignIn(std::sync::Mutex::new(Some(query))));
            }
        }
        Ok(None) => {}
        Err(error) => log_warn(
            app,
            "sign-in",
            "The cold-start sign-in link was not read",
            &error.to_string(),
        ),
    }
}

/// Hands a sign-in query to the page and brings the window forward, as Electron did.
/// A closed main window is reopened first.
fn deliver_sign_in(app: &tauri::AppHandle, query: String) {
    use tauri::{Emitter as _, Manager as _};
    if app.get_webview_window(MAIN_WINDOW).is_none() && open_main_window(app).is_err() {
        return;
    }
    if let Err(error) = app.emit_to(MAIN_WINDOW, auth_loopback::SIGN_IN_EVENT, query) {
        log_warn(
            app,
            "sign-in",
            "The sign-in did not reach the page",
            &error.to_string(),
        );
    }
    // Phone windows cannot be minimized.
    #[cfg(desktop)]
    let unminimize = |window: &tauri::WebviewWindow| window.unminimize();
    #[cfg(mobile)]
    let unminimize = |_: &tauri::WebviewWindow| Ok(());
    if let Some(window) = app.get_webview_window(MAIN_WINDOW)
        && let Err(error) = unminimize(&window)
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
    {
        log_warn(
            app,
            "sign-in",
            "The window could not come forward",
            &error.to_string(),
        );
    }
}

/// Records a warning in the app log, when the log is up.
fn log_warn(app: &tauri::AppHandle, source: &str, message: &str, detail: &str) {
    use tauri::Manager as _;
    if let Some(log) = app.try_state::<app_log::AppLog>() {
        log.record(app_log::LogLevel::Warn, source, message, Some(detail));
    }
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
    use std::path::Path;
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

    #[test]
    fn web_root_uses_the_resource_dir() {
        assert_eq!(
            web_root_in(None, Some(Path::new("res"))),
            PathBuf::from("res").join("web")
        );
    }

    #[test]
    fn web_root_prefers_the_dev_dir() {
        assert_eq!(
            web_root_in(Some("dist".into()), Some(Path::new("res"))),
            PathBuf::from("dist")
        );
    }

    #[test]
    fn web_root_ignores_an_empty_dev_dir() {
        assert_eq!(
            web_root_in(Some("".into()), Some(Path::new("res"))),
            PathBuf::from("res").join("web")
        );
    }

    #[test]
    fn web_root_without_resources_is_relative() {
        assert_eq!(web_root_in(None, None), PathBuf::from("web"));
    }

    #[test]
    fn bundle_ships_the_web_export() {
        let bundle = include_str!("../tauri.bundle.json");
        assert!(bundle.contains("\"../desktop/dist/web/\": \"web/\""));
        assert!(bundle.contains("\"target/stage/sidecar/\": \"sidecar/\""));
        // `local_pg::server::locate_bin` looks in `<resources>/postgres/bin`.
        assert!(bundle.contains("\"target/stage/postgres/\": \"postgres/\""));
    }

    #[test]
    fn dev_overlay_names_the_dev_product_with_its_own_identifier() {
        let dev = include_str!("../tauri.dev.json");
        let name = format!("\"productName\": \"{}\"", launch::DEV_PRODUCT_NAME);
        assert!(dev.contains(&name));
        assert!(dev.contains("\"identifier\": \"dev.weaveforge.desktop.dev\""));
        assert!(!include_str!("../tauri.conf.json").contains("dev.weaveforge.desktop.dev"));
    }
}

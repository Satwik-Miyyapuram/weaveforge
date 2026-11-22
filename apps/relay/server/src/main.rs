//! Starts the relay server: reads the environment, binds, and serves until Ctrl-C.

#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use wf_relay::relay::route::RelayConfig;
use wf_relay::relay::shared::relay_client;
use wf_relay_server::collab::routes::SessionAuth;
use wf_relay_server::collab::store::PgStore;
use wf_relay_server::collab::{CollabConfig, CollabState, SystemClock, hub};
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::seal_legacy::seal_legacy_credentials;
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

#[tokio::main]
async fn main() -> ExitCode {
    let result = if std::env::args().nth(1).as_deref() == Some("seal-legacy-credentials") {
        seal_legacy_credentials_command(std::env::args().any(|arg| arg == "--dry-run")).await
    } else {
        run().await
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

/// `seal-legacy-credentials [--dry-run]`: seals the legacy plaintext keys once, then exits.
/// Prints counts only; it never prints a value.
async fn seal_legacy_credentials_command(dry_run: bool) -> Result<(), String> {
    let config = Config::from_env(|key| std::env::var(key).ok())?;
    let settings = SettingsConfig::from_env(|key| std::env::var(key).ok());
    let client = relay_client().map_err(|e| format!("cannot build the HTTP client: {e}"))?;
    let report = seal_legacy_credentials(
        &config,
        &client,
        settings.credential_key.as_deref(),
        dry_run,
    )
    .await?;
    let verb = if report.dry_run {
        "would seal"
    } else {
        "sealed"
    };
    println!(
        "legacy credential rows found: {}; {verb}: {}; sealed rows still holding plaintext (left as is): {}",
        report.found, report.converted, report.left_plaintext
    );
    Ok(())
}

async fn run() -> Result<(), String> {
    let config = Config::from_env(|key| std::env::var(key).ok())?;
    let client = relay_client().map_err(|e| format!("cannot build the HTTP client: {e}"))?;
    let bind = config.bind;
    let state = Arc::new(AppState {
        config,
        client,
        relay: RelayConfig::production(),
        upstreams: MetaUpstreams::production(),
        pages: RateLimiter::new(PAGE_FETCH_LIMIT),
        pastes: RateLimiter::new(PASTE_FETCH_LIMIT),
        storage: StorageConfig::from_env(|key| std::env::var(key).ok()),
        settings: SettingsConfig::from_env(|key| std::env::var(key).ok()),
    });
    let collab = Arc::new(CollabState {
        config: CollabConfig::production(PathBuf::from(
            std::env::var("COLLAB_LOG_DIR").unwrap_or_else(|_| "./collab-log".into()),
        )),
        store: Arc::new(PgStore::new(
            state.client.clone(),
            state.config.data_url.clone(),
            state.config.service_role_key.clone(),
        )),
        auth: Arc::new(SessionAuth {
            client: state.client.clone(),
            config: state.config.clone(),
        }),
        clock: Arc::new(SystemClock),
        hub: hub::Hub::new(),
    });
    let recovered = hub::recover(&collab).await;
    eprintln!("recovered {recovered} co-edited document(s) from update logs");
    let _persist = hub::spawn_persist_loop(collab.clone());
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|e| format!("cannot bind {bind}: {e}"))?;
    let served = axum::serve(
        listener,
        app(state).merge(wf_relay_server::collab::routes::router(collab.clone())),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await;
    hub::persist_all(&collab).await;
    served.map_err(|e| format!("server stopped: {e}"))
}

/// Resolves on Ctrl-C, or on SIGTERM on Unix (what `docker stop` sends); a
/// handler that cannot be installed never resolves, so the server keeps running.
async fn shutdown_signal() {
    let ctrl_c = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                let _ = signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
}

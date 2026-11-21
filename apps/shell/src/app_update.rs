//! One-click updates for the desktop shell. The shell checks the release manifest
//! (`latest.json`, attached to the newest GitHub release), downloads the installer in
//! the background, and runs it passive (a progress bar, no wizard). The installer
//! relaunches the app. Signature verification stays on: the plugin refuses an
//! installer whose `.sig` does not match `plugins.updater.pubkey`.
//!
//! Desktop only: Tauri has no updater plugin on phones.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Emitter as _, Manager as _};

use crate::app_log::{AppLog, LogLevel};

/// The platform seam: the updater plugin on desktop, nothing on phones (no updater there).
#[cfg(desktop)]
mod platform {
    use tauri::AppHandle;
    use tauri_plugin_updater::{Update, UpdaterExt as _};

    pub const AVAILABLE: bool = true;
    pub type Pending = Update;

    pub async fn fetch(app: &AppHandle) -> Result<Option<Pending>, String> {
        let updater = app.updater().map_err(|error| error.to_string())?;
        updater.check().await.map_err(|error| error.to_string())
    }

    pub fn version(update: &Pending) -> String {
        update.version.clone()
    }

    pub async fn download_and_install<C, D>(
        update: Pending,
        on_chunk: C,
        on_done: D,
    ) -> Result<(), String>
    where
        C: FnMut(usize, Option<u64>),
        D: FnOnce(),
    {
        update
            .download_and_install(on_chunk, on_done)
            .await
            .map_err(|error| error.to_string())
    }
}

/// Phones: the updater is never available, so nothing is fetched or installed.
#[cfg(not(desktop))]
mod platform {
    use tauri::AppHandle;

    pub const AVAILABLE: bool = false;
    pub enum Pending {}

    pub async fn fetch(_app: &AppHandle) -> Result<Option<Pending>, String> {
        Ok(None)
    }

    pub fn version(update: &Pending) -> String {
        match *update {}
    }

    pub async fn download_and_install<C, D>(
        update: Pending,
        _on_chunk: C,
        _on_done: D,
    ) -> Result<(), String>
    where
        C: FnMut(usize, Option<u64>),
        D: FnOnce(),
    {
        match update {}
    }
}

/// The event carrying the whole [`AppUpdateStatus`] after every change.
pub const APP_UPDATE_EVENT: &str = "app-update";
/// How often a running shell asks the manifest again.
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// The first check waits, so it never competes with the first paint.
pub const FIRST_CHECK_AFTER: Duration = Duration::from_secs(30);
/// Shown when the manifest could not be read. Never reads as "up to date".
pub const CHECK_FAILED: &str = "Could not check for an update.";
/// Shown when the download or the installer failed. The page offers Try again.
pub const INSTALL_FAILED: &str = "The update did not install. Try again.";

/// Where the shell is in the update cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// No updater configured (no signing key yet) or a dev build: nothing is checked.
    Unsupported,
    /// Configured, nothing asked yet.
    Idle,
    /// Asking the manifest.
    Checking,
    /// The manifest has no newer release.
    UpToDate,
    /// A newer release is known and waiting for one click.
    Available,
    /// The installer is downloading; `percent` says how far.
    Downloading,
    /// The installer is running; the app is about to close and reopen.
    Installing,
    /// The last check or install failed; `error` says so and a retry is allowed.
    Failed,
}

/// What the page needs to draw the notice and the Settings row.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    /// Where the cycle is now.
    pub phase: Phase,
    /// The version running now, `major.minor.patch`.
    pub current: String,
    /// The newer version offered, when there is one.
    pub version: Option<String>,
    /// Download progress, 0 to 100, when the size is known.
    pub percent: Option<u8>,
    /// A message the page can show as it is.
    pub error: Option<String>,
}

/// Whether the updater has a signing key to verify with. An empty key means
/// nothing can be verified, so nothing is checked.
#[must_use]
pub fn configured(pubkey: &str) -> bool {
    !pubkey.trim().is_empty()
}

/// Download progress as a whole percent, capped at 100; `None` when the total is unknown.
#[must_use]
pub fn percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|total| *total > 0)?;
    let value = downloaded.saturating_mul(100) / total;
    Some(u8::try_from(value.min(100)).unwrap_or(100))
}

/// A check may start unless one is running or an install is in progress.
#[must_use]
pub fn can_check(phase: Phase) -> bool {
    !matches!(
        phase,
        Phase::Checking | Phase::Downloading | Phase::Installing | Phase::Unsupported
    )
}

/// An install may start only when a release is offered, or after a failure (which re-checks first).
#[must_use]
pub fn can_install(phase: Phase) -> bool {
    matches!(phase, Phase::Available | Phase::Failed)
}

/// The shell's update state, managed by Tauri.
pub struct AppUpdateState {
    status: Mutex<AppUpdateStatus>,
    /// The offered release, kept between the check and the click.
    pending: Mutex<Option<platform::Pending>>,
}

fn guard<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(PoisonError::into_inner)
}

impl AppUpdateState {
    fn new(current: String, phase: Phase) -> Self {
        Self {
            status: Mutex::new(AppUpdateStatus {
                phase,
                current,
                version: None,
                percent: None,
                error: None,
            }),
            pending: Mutex::new(None),
        }
    }

    fn snapshot(&self) -> AppUpdateStatus {
        guard(&self.status).clone()
    }

    /// Replaces the status and tells the page.
    fn set(&self, app: &AppHandle, next: AppUpdateStatus) -> AppUpdateStatus {
        *guard(&self.status) = next.clone();
        let _ = app.emit(APP_UPDATE_EVENT, &next);
        next
    }
}

/// The signing key from `plugins.updater` in the Tauri config, or empty.
fn configured_pubkey(app: &AppHandle) -> String {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Sets up the state and, when a signing key is configured in a packaged build, starts the
/// background checks. Called from the app's setup.
pub fn start(app: &AppHandle) {
    let current = app.package_info().version.to_string();
    let supported = platform::AVAILABLE && !tauri::is_dev() && configured(&configured_pubkey(app));
    let phase = if supported {
        Phase::Idle
    } else {
        Phase::Unsupported
    };
    let _ = app.manage(AppUpdateState::new(current, phase));
    if !supported {
        return;
    }
    let handle = app.clone();
    drop(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            let _ = check(&handle).await;
            tokio::time::sleep(CHECK_EVERY).await;
        }
    }));
}

/// Asks the manifest. A failure is logged and shown; it never becomes "up to date".
pub async fn check(app: &AppHandle) -> AppUpdateStatus {
    let state = app.state::<AppUpdateState>();
    let before = state.snapshot();
    if !can_check(before.phase) {
        return before;
    }
    let _ = state.set(
        app,
        AppUpdateStatus {
            phase: Phase::Checking,
            error: None,
            ..before.clone()
        },
    );
    match platform::fetch(app).await {
        Ok(Some(update)) => {
            let version = platform::version(&update);
            *guard(&state.pending) = Some(update);
            state.set(
                app,
                AppUpdateStatus {
                    phase: Phase::Available,
                    version: Some(version),
                    ..before
                },
            )
        }
        Ok(None) => {
            *guard(&state.pending) = None;
            state.set(
                app,
                AppUpdateStatus {
                    phase: Phase::UpToDate,
                    version: None,
                    ..before
                },
            )
        }
        Err(detail) => {
            log_failure(app, CHECK_FAILED, &detail);
            state.set(
                app,
                AppUpdateStatus {
                    phase: Phase::Failed,
                    error: Some(CHECK_FAILED.to_string()),
                    ..before
                },
            )
        }
    }
}

/// What [`claim_install`] decided.
enum Claim<T> {
    /// No install may start now; the status as it is.
    Refused(AppUpdateStatus),
    /// Nothing is offered (after a failure): check first.
    CheckFirst,
    /// The offered release, the status before, and the `Downloading` status now stored.
    Start {
        update: T,
        before: AppUpdateStatus,
        downloading: AppUpdateStatus,
    },
}

/// Checks the phase, takes the offered release and marks the status `Downloading` under
/// one hold of the status lock, so two clicks cannot both start an install.
fn claim_install<T>(
    status: &Mutex<AppUpdateStatus>,
    pending: &Mutex<Option<T>>,
    version: impl Fn(&T) -> String,
) -> Claim<T> {
    let mut current = guard(status);
    if !can_install(current.phase) {
        return Claim::Refused(current.clone());
    }
    let Some(update) = guard(pending).take() else {
        return Claim::CheckFirst;
    };
    let before = current.clone();
    let downloading = AppUpdateStatus {
        phase: Phase::Downloading,
        version: Some(version(&update)),
        percent: Some(0),
        error: None,
        ..before.clone()
    };
    *current = downloading.clone();
    Claim::Start {
        update,
        before,
        downloading,
    }
}

/// Downloads the offered release and runs its installer. With nothing offered (after a
/// failure), it checks first. On Windows the installer closes the app and relaunches it.
pub async fn install(app: &AppHandle) -> AppUpdateStatus {
    let state = app.state::<AppUpdateState>();
    let (update, before, downloading) =
        match claim_install(&state.status, &state.pending, platform::version) {
            Claim::Refused(status) => return status,
            Claim::CheckFirst => return check(app).await,
            Claim::Start {
                update,
                before,
                downloading,
            } => (update, before, downloading),
        };
    let version = downloading.version.clone().unwrap_or_default();
    let _ = state.set(app, downloading);
    let mut last = Some(0_u8);
    let progress_app = app.clone();
    let on_chunk = move |downloaded: usize, total: Option<u64>| {
        let now = percent(u64::try_from(downloaded).unwrap_or(u64::MAX), total);
        if now != last {
            last = now;
            let state = progress_app.state::<AppUpdateState>();
            let current = state.snapshot();
            let _ = state.set(
                &progress_app,
                AppUpdateStatus {
                    percent: now,
                    ..current
                },
            );
        }
    };
    let installing_app = app.clone();
    let on_done = move || {
        let state = installing_app.state::<AppUpdateState>();
        let current = state.snapshot();
        let _ = state.set(
            &installing_app,
            AppUpdateStatus {
                phase: Phase::Installing,
                percent: None,
                ..current
            },
        );
        // Windows exits inside the install, so the page saves before it starts.
        crate::close_flush::flush_and_wait(&installing_app);
    };
    match platform::download_and_install(update, on_chunk, on_done).await {
        Ok(()) => {
            // Windows closes the app inside the plugin; other platforms relaunch here.
            app.restart();
        }
        Err(detail) => {
            // The release is dropped: a retry checks the manifest again before it downloads.
            log_failure(app, INSTALL_FAILED, &detail);
            state.set(
                app,
                AppUpdateStatus {
                    phase: Phase::Failed,
                    version: Some(version),
                    percent: None,
                    error: Some(INSTALL_FAILED.to_string()),
                    ..before
                },
            )
        }
    }
}

fn log_failure(app: &AppHandle, message: &str, detail: &str) {
    if let Some(log) = app.try_state::<AppLog>() {
        log.record(LogLevel::Warn, "update", message, Some(detail));
    }
}

/// The status now, for the page on load.
#[tauri::command]
#[specta::specta]
pub async fn app_update_status(app: AppHandle) -> AppUpdateStatus {
    app.state::<AppUpdateState>().snapshot()
}

/// Asks for a newer release now.
#[tauri::command]
#[specta::specta]
pub async fn app_update_check(app: AppHandle) -> AppUpdateStatus {
    check(&app).await
}

/// Downloads and runs the offered release.
#[tauri::command]
#[specta::specta]
pub async fn app_update_install(app: AppHandle) -> AppUpdateStatus {
    install(&app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(phase: Phase) -> Mutex<AppUpdateStatus> {
        Mutex::new(AppUpdateStatus {
            phase,
            current: "0.9.6".to_owned(),
            version: None,
            percent: None,
            error: None,
        })
    }

    #[test]
    fn two_installs_at_once_start_one_download() {
        let status = status(Phase::Available);
        let pending = Mutex::new(Some("0.9.7".to_owned()));
        let (first, second) = std::thread::scope(|s| {
            let a = s.spawn(|| claim_install(&status, &pending, String::clone));
            let b = s.spawn(|| claim_install(&status, &pending, String::clone));
            (a.join().unwrap(), b.join().unwrap())
        });
        let started = [&first, &second]
            .iter()
            .filter(|c| matches!(c, Claim::Start { .. }))
            .count();
        assert_eq!(started, 1);
        for claim in [&first, &second] {
            match claim {
                Claim::Start { downloading, .. } => {
                    assert_eq!(downloading.version.as_deref(), Some("0.9.7"));
                }
                Claim::Refused(seen) => assert_eq!(seen.phase, Phase::Downloading),
                Claim::CheckFirst => panic!("the second click must not re-check"),
            }
        }
        assert_eq!(guard(&status).phase, Phase::Downloading);
    }
}

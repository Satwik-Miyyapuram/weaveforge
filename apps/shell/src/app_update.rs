//! One-click updates for the desktop shell. The shell checks the release manifest
//! (`latest-v2.json`, attached to the newest GitHub release), downloads the installer in
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
/// Shown when `install_allowed` refuses a version. The log keeps the exact reason.
pub const UPDATE_HELD: &str =
    "This update is held: export and verify your data in 0.9.7 first, then try again.";

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
    /// The release is offered but refused until local data is exported and verified. Not a
    /// failure: `error` names the rule. No install starts from here; a new check may offer it
    /// again.
    Held,
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
    // A held offer is not installed from `Held` (the page shows no install button): a new
    // check re-runs the gate and offers it again once local data is verified.
    matches!(phase, Phase::Available | Phase::Failed)
}

/// Whether `pg` (the `local-pg` directory) holds a native database. The cluster lives in
/// `pg/data`, as the host creates it, and only its `PG_VERSION` file counts: a directory with
/// stray files is not a database.
#[must_use]
pub fn native_database_present(pg: &std::path::Path) -> bool {
    pg.join("data").join("PG_VERSION").is_file()
}

/// What the local database holds, as far as an update decision cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalData {
    /// No local database on this machine.
    None,
    /// A local database whose export was verified.
    Verified,
    /// A local database that has not been exported and verified.
    Unverified,
}

/// 0.9.7 still holds local data, so it may move to a newer release only once that data is
/// exported and verified, or when there is none. Otherwise the data would be unreachable.
/// An offer that is not `X.Y.Z` counts as newer, so it is held too.
///
/// A current version that is not `X.Y.Z` (a pre-release such as `0.9.7-rc1`) counts as 0.9.7.
pub fn install_allowed(current: &str, offered: &str, local: LocalData) -> Result<(), String> {
    const BRIDGE: (u64, u64, u64) = (0, 9, 7);
    let newer = parse_version(offered).is_none_or(|version| version > BRIDGE);
    let below_bridge = parse_version(current).is_some_and(|version| version < BRIDGE);
    let on_bridge = parse_version(current).is_none_or(|version| version == BRIDGE);
    if below_bridge && newer {
        return Err(format!("Update to {offered} must go through 0.9.7 first."));
    }
    if on_bridge && newer && local == LocalData::Unverified {
        return Err(format!(
            "Update to {offered} is held until local data is exported and verified."
        ));
    }
    Ok(())
}

/// Maps what is on disk to a [`LocalData`] verdict. Every database present must be verified
/// for the verdict to be `Verified`.
#[must_use]
pub fn classify_local(
    native: bool,
    native_verified: bool,
    old: bool,
    old_verified: bool,
) -> LocalData {
    if (native && !native_verified) || (old && !old_verified) {
        LocalData::Unverified
    } else if native || old {
        LocalData::Verified
    } else {
        LocalData::None
    }
}

fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.').map(|part| part.parse::<u64>().ok());
    let version = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(version)
}

/// The shell's update state, managed by Tauri.
///
/// Lock order: `status` before `pending`. `claim_install` holds both while it decides.
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

/// Whether this machine holds a local database. Without an export that is verified, it is
/// treated as unverified, so an update that would strand it is held.
fn local_data(app: &AppHandle) -> LocalData {
    local_data_in(app.path().app_data_dir().ok().as_deref())
}

/// Local-data state for a data folder. None (the folder could not be resolved) is unverified,
/// so the update is held rather than allowed to strand data.
#[must_use]
pub fn local_data_in(data: Option<&std::path::Path>) -> LocalData {
    let Some(data) = data else {
        return LocalData::Unverified;
    };
    let pg = data.join("local-pg");
    // Read-only: the gate never creates an id. No id means no verified run for this device.
    let device = crate::device_id::get_existing(data);
    let native = native_database_present(&pg);
    // A missing workspace folder alone is not old data (a fresh install whose folder moved);
    // with other old data, or when that cannot be read, it still holds the update.
    let old = match crate::migrate::old_db_state(data) {
        crate::migrate::OldDb::None => false,
        crate::migrate::OldDb::Found(_) => true,
        crate::migrate::OldDb::WorkspaceMissing(_) => {
            !matches!(crate::migrate::legacy_db_in(data), Ok(false))
        }
    };
    classify_local(
        native,
        crate::migrate::native_data_verified(&pg, device.as_deref()),
        old,
        old && crate::migrate::local_data_verified(data, device.as_deref()),
    )
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
    /// `allow` refused the offer; the status now shows `Held` with the reason in `message`.
    Held {
        status: AppUpdateStatus,
        message: String,
    },
    /// The offered release, the status before, and the `Downloading` status now stored.
    Start {
        update: T,
        before: AppUpdateStatus,
        downloading: AppUpdateStatus,
    },
}

/// Checks the phase, runs the install gate on the offered release, takes it and marks the
/// status `Downloading`. All of it happens under one hold of the status lock, so two clicks
/// cannot both start an install. A refused offer stays in `pending` and becomes `Held`.
///
/// Lock order: `status` first, then `pending`. Nothing may take them the other way round.
fn claim_install<T>(
    status: &Mutex<AppUpdateStatus>,
    pending: &Mutex<Option<T>>,
    version: impl Fn(&T) -> String,
    allow: impl Fn(&str) -> Result<(), String>,
) -> Claim<T> {
    let mut current = guard(status);
    if !can_install(current.phase) {
        return Claim::Refused(current.clone());
    }
    let mut offer = guard(pending);
    let offered = match offer.as_ref() {
        Some(update) => version(update),
        None => return Claim::CheckFirst,
    };
    if let Err(message) = allow(&offered) {
        let held = AppUpdateStatus {
            phase: Phase::Held,
            version: Some(offered),
            percent: None,
            error: Some(UPDATE_HELD.to_string()),
            ..current.clone()
        };
        *current = held.clone();
        return Claim::Held {
            status: held,
            message,
        };
    }
    let Some(update) = offer.take() else {
        return Claim::CheckFirst;
    };
    let before = current.clone();
    let downloading = AppUpdateStatus {
        phase: Phase::Downloading,
        version: Some(offered),
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
    let current = app.package_info().version.to_string();
    // The local data is read inside the claim, under the status lock, so the gate sees it as
    // it is when the install starts.
    let (update, before, downloading) = match claim_install(
        &state.status,
        &state.pending,
        platform::version,
        |offered| install_allowed(&current, offered, local_data(app)),
    ) {
        Claim::Refused(status) => return status,
        Claim::CheckFirst => return check(app).await,
        Claim::Held { status, message } => {
            log_failure(app, UPDATE_HELD, &message);
            let _ = state.set(app, status.clone());
            return status;
        }
        Claim::Start {
            update,
            before,
            downloading,
        } => (update, before, downloading),
    };
    let version = downloading.version.clone().unwrap_or_default();
    let _ = state.set(app, downloading);
    let on_chunk = progress_reporter(app.clone());
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

/// Running download progress. The updater reports each chunk's length, not a running total,
/// so the chunks are added up here.
#[derive(Debug)]
pub struct DownloadProgress {
    received: u64,
    last: Option<u8>,
}

impl Default for DownloadProgress {
    fn default() -> Self {
        // The `Downloading` status starts at 0%.
        Self {
            received: 0,
            last: Some(0),
        }
    }
}

impl DownloadProgress {
    /// Adds one chunk; returns the new percent when it changed, else `None`.
    pub fn chunk(&mut self, len: usize, total: Option<u64>) -> Option<Option<u8>> {
        self.received = self
            .received
            .saturating_add(u64::try_from(len).unwrap_or(u64::MAX));
        let now = percent(self.received, total);
        (now != self.last).then(|| {
            self.last = now;
            now
        })
    }
}

/// Download progress callback: publishes the percent each time it changes.
fn progress_reporter(app: AppHandle) -> impl FnMut(usize, Option<u64>) + Send {
    let mut progress = DownloadProgress::default();
    move |len: usize, total: Option<u64>| {
        if let Some(now) = progress.chunk(len, total) {
            let state = app.state::<AppUpdateState>();
            let current = state.snapshot();
            let _ = state.set(
                &app,
                AppUpdateStatus {
                    percent: now,
                    ..current
                },
            );
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
            let a = s.spawn(|| claim_install(&status, &pending, String::clone, |_| Ok(())));
            let b = s.spawn(|| claim_install(&status, &pending, String::clone, |_| Ok(())));
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
                Claim::Held { .. } => panic!("an allowed offer must not be held"),
            }
        }
        assert_eq!(guard(&status).phase, Phase::Downloading);
    }

    #[test]
    fn a_refused_1_0_0_offer_is_held_and_never_taken_from_pending() {
        let status = status(Phase::Available);
        let pending = Mutex::new(Some("1.0.0".to_owned()));
        let claim = claim_install(&status, &pending, String::clone, |offered| {
            install_allowed("0.9.7", offered, LocalData::Unverified)
        });
        let Claim::Held { status: held, .. } = claim else {
            panic!("1.0.0 over unverified 0.9.7 data must be held");
        };
        assert_eq!(held.phase, Phase::Held);
        assert_eq!(held.version.as_deref(), Some("1.0.0"));
        assert_eq!(guard(&status).phase, Phase::Held);
        assert_eq!(guard(&pending).as_deref(), Some("1.0.0"));
    }

    #[test]
    fn refused_offer_is_held_not_failed_and_stays_offered() {
        let status = status(Phase::Available);
        let pending = Mutex::new(Some("0.9.8".to_owned()));
        let claim = claim_install(&status, &pending, String::clone, |_| Err("held".to_owned()));
        let Claim::Held {
            status: held,
            message,
        } = claim
        else {
            panic!("a refused offer must be held");
        };
        assert_eq!(message, "held");
        assert_eq!(held.phase, Phase::Held);
        assert_eq!(held.error.as_deref(), Some(UPDATE_HELD));
        assert_eq!(held.version.as_deref(), Some("0.9.8"));
        assert_eq!(guard(&status).phase, Phase::Held);
        assert_eq!(guard(&pending).as_deref(), Some("0.9.8"));
    }
}

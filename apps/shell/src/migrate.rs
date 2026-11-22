//! Reads the old Electron app's PGlite database, so the first-open question can offer it. Nothing
//! is copied, renamed or deleted here: the old data stays where Electron left it.

use std::fs;
use std::path::{Path, PathBuf};

use wf_core::sync::folder_layout::WORKSPACE_META_DIR;

use crate::commands::ShellError;
use crate::device_id;

/// What is copied from Electron's data dir, by name. `secrets.json` is not: Electron sealed it.
pub const ITEMS: [&str; 7] = [
    "local-db",
    "local-db-backups",
    "preferences.json",
    "models",
    "artifacts",
    "weaveforge.log",
    "overleaf-git",
];

/// Where the old PGlite database is, or why there is none to import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OldDb {
    /// A PGlite data dir (has `PG_VERSION`) to import.
    Found(PathBuf),
    /// The configured workspace folder is missing (unplugged or moved). Nothing is imported until
    /// the user reconnects it or picks it again; the app's `local-db` is never used in its place.
    WorkspaceMissing(PathBuf),
    /// No old database at all.
    None,
}

/// The old PGlite database to import: the workspace's when it holds one (Electron moves it there
/// once a folder is chosen), else the app's own `local-db`. A configured workspace folder that is
/// missing gives `WorkspaceMissing` rather than falling back to the stale app copy.
#[must_use]
pub fn old_db_state(data_dir: &Path) -> OldDb {
    let is_db = |dir: &Path| dir.join("PG_VERSION").is_file();
    let app_db = data_dir.join("local-db");
    if let Some(root) = configured_root(data_dir) {
        let ws_db = root.join(WORKSPACE_META_DIR).join("db");
        if is_db(&ws_db) {
            return OldDb::Found(ws_db);
        }
        if !root.is_dir() {
            return OldDb::WorkspaceMissing(root);
        }
    }
    if is_db(&app_db) {
        OldDb::Found(app_db)
    } else {
        OldDb::None
    }
}

/// The importable old database dir, or `None` while none is found or the workspace is missing.
#[must_use]
pub fn old_pglite_dir(data_dir: &Path) -> Option<PathBuf> {
    match old_db_state(data_dir) {
        OldDb::Found(dir) => Some(dir),
        OldDb::WorkspaceMissing(_) | OldDb::None => None,
    }
}

/// The old native Postgres folder, `<app data>/local-pg`: its `data`, `data.failed-*`, moved-aside
/// dirs and dumps all live here. Read-only use only.
#[must_use]
pub fn legacy_pg_dir(app_data: &Path) -> PathBuf {
    app_data.join("local-pg")
}

/// True when the old native Postgres folder holds any entry. A missing folder is absent. Any other
/// read error is an error, so the gate fails closed. Never starts Postgres and never writes.
pub fn legacy_pg_data_present(app_data: &Path) -> Result<bool, ShellError> {
    dir_has_entries(&legacy_pg_dir(app_data))
        .map_err(|e| legacy_unreadable("legacy_pg_unreadable", "the old local Postgres folder", &e))
}

fn legacy_unreadable(code: &str, what: &str, e: &std::io::Error) -> ShellError {
    ShellError::coded(code, &format!("cannot read {what}: {e}"))
}

/// Whether `dir` may hold old data. A missing or empty folder is absent. A link of any kind (a
/// symlink, or a junction on Windows, even a broken one) counts as present and is never followed.
/// Any entry at all counts as present, so a moved-aside or failed folder still blocks. Any other
/// read error is returned to the caller, which fails closed.
fn dir_has_entries(dir: &Path) -> std::io::Result<bool> {
    let meta = match fs::symlink_metadata(dir) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    if is_link(&meta) {
        return Ok(true);
    }
    let mut entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    match entries.next() {
        None => Ok(false),
        Some(Ok(_)) => Ok(true),
        Some(Err(e)) => Err(e),
    }
}

fn is_link(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

/// True when any old local database (native Postgres or PGlite) may be on disk under `app_data`.
/// Dumps in `local-db-backups` are left out: 0.9.7 cannot migrate from them. A missing or unplugged
/// workspace counts: its database may be there, so the gate fails closed.
pub fn legacy_db_in(app_data: &Path) -> Result<bool, ShellError> {
    let db_err = |e: std::io::Error| {
        legacy_unreadable("legacy_db_unreadable", "an old local database folder", &e)
    };
    if legacy_pg_data_present(app_data)? {
        return Ok(true);
    }
    if dir_has_entries(&app_data.join("local-db")).map_err(db_err)? {
        return Ok(true);
    }
    if let Some(root) = configured_root(app_data) {
        if dir_has_entries(&root.join(WORKSPACE_META_DIR).join("db")).map_err(db_err)? {
            return Ok(true);
        }
        if !root.is_dir() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether old local-database data is on this device. Fails closed: an Electron data dir counts as
/// legacy data, because 0.9.7 has no code that shows Electron's data was exported. `app_data` is
/// `None` when the platform cannot name the app data dir: that is an error, never "no data".
pub fn legacy_db_from(app_data: Option<&Path>, electron: Option<&Path>) -> Result<bool, ShellError> {
    if electron.is_some() {
        return Ok(true);
    }
    let dir = app_data.ok_or_else(|| {
        ShellError::coded("app_data_unavailable", "cannot locate the app data folder")
    })?;
    legacy_db_in(dir)
}

/// Bridge: whether old local-database data is on this device (`legacyDbPresent`).
#[tauri::command]
#[specta::specta]
pub fn legacy_db_present(app: tauri::AppHandle) -> Result<bool, ShellError> {
    use tauri::Manager as _;
    let paths = app.path();
    let dir = paths.app_data_dir().ok();
    let electron = paths
        .config_dir()
        .ok()
        .zip(paths.resource_dir().ok())
        .and_then(|(config, resources)| {
            let source = crate::launch::app_source(resources);
            crate::launch::electron_data_dir(&source, &app.package_info().name, &config)
        });
    legacy_db_from(dir.as_deref(), electron.as_deref())
}

/// The 0.9.7 migration report, relative to the workspace folder.
pub const REPORT_REL: &str = ".weaveforge/migration-0.9.7/report.json";

/// True only when this device's own run in the 0.9.7 report under `folder` is verified: the newest
/// run whose `deviceId` is `device_id` has `state == "verified"`, an empty `missing`, and a non-empty
/// `kinds` whose db and files counts match. Other devices' runs never count. Every per-device
/// `report-*.json` beside `report.json` is checked first, and any verified own run counts; then
/// `report.json` is the fallback. No `device_id` (the device has no id file yet) is `Ok(false)`. A
/// missing or corrupt report is `Ok(false)`. An IO error other than not-found is a typed error, so
/// the page can show "unavailable" instead of "not migrated". Read-only; never writes.
pub fn report_state_verified(folder: &Path, device_id: Option<&str>) -> Result<bool, ShellError> {
    let Some(device_id) = device_id else {
        return Ok(false);
    };
    let mut runs = Vec::new();
    for path in report_paths(folder)? {
        runs.extend(report_runs(&path)?);
    }
    Ok(own_latest_run(&runs, device_id).is_some_and(run_verified))
}

/// Every `report.json` and `report*.json` in the migration folder, conflict copies included, sorted by
/// path. A missing folder holds none.
fn report_paths(folder: &Path) -> Result<Vec<PathBuf>, ShellError> {
    let dir = folder.join(REPORT_REL).parent().map(Path::to_path_buf).unwrap_or_default();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(report_listing_unreadable(&e)),
    };
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| report_listing_unreadable(&e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("report") && name.ends_with(".json") {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

/// The runs of one report file. A file that cannot be read, or is not a 0.9.7 report (an object with a
/// known `state` and a `runs` array of objects), is a typed error that names it, never skipped. A file
/// that vanished since it was listed holds none.
fn report_runs(path: &Path) -> Result<Vec<serde_json::Value>, ShellError> {
    let name = path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(report_unreadable(&name, &e.to_string())),
    };
    let report: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| report_unreadable(&name, &format!("not valid JSON ({e})")))?;
    // The top-level states the 0.9.7 writer sets (status.rs and remove.rs); `none` is never written here.
    let known_state = matches!(
        report["state"].as_str(),
        Some("verified" | "incomplete" | "removing" | "removed")
    );
    match report["runs"].as_array() {
        Some(runs) if known_state && runs.iter().all(serde_json::Value::is_object) => Ok(runs.clone()),
        _ => Err(report_unreadable(&name, "not a 0.9.7 migration report")),
    }
}

fn report_unreadable(name: &str, why: &str) -> ShellError {
    ShellError::coded(
        "migration_report_unreadable",
        &format!("cannot read the 0.9.7 migration report {name}: {why}"),
    )
}

fn report_listing_unreadable(e: &std::io::Error) -> ShellError {
    ShellError::coded(
        "migration_report_unreadable",
        &format!("cannot list the 0.9.7 migration reports: {e}"),
    )
}

/// This device's latest run across all report files: the one with the later `startedAt`. A tie goes to
/// the run that is not verified, whatever the file order. A run without a matching `deviceId` is never
/// this device's.
fn own_latest_run<'a>(runs: &'a [serde_json::Value], device_id: &str) -> Option<&'a serde_json::Value> {
    runs.iter()
        .filter(|run| run["deviceId"].as_str() == Some(device_id))
        .reduce(|seen, run| {
            let seen_at = seen["startedAt"].as_str().unwrap_or("");
            let run_at = run["startedAt"].as_str().unwrap_or("");
            let tie_to_incomplete = run_at == seen_at && run_verified(seen) && !run_verified(run);
            if run_at > seen_at || tie_to_incomplete {
                run
            } else {
                seen
            }
        })
}

/// A run is verified when its state is `verified` and it is complete.
fn run_verified(run: &serde_json::Value) -> bool {
    run["state"].as_str() == Some("verified") && run_is_complete(run)
}

/// One run is complete when nothing is missing and every kind's db count equals its files count.
fn run_is_complete(run: &serde_json::Value) -> bool {
    run["missing"].as_array().is_some_and(Vec::is_empty)
        && run["kinds"].as_object().is_some_and(|kinds| {
            !kinds.is_empty()
                && kinds.values().all(|counts| {
                    counts["db"].as_u64().is_some() && counts["db"] == counts["files"]
                })
        })
}

/// Bridge: whether this device's own run in the 0.9.7 report of the workspace at `folder` is
/// verified (`migrationReportVerified`). Reads this device's id from app data, never creates it.
/// An unreadable report or id file is a typed error.
#[tauri::command]
#[specta::specta]
pub fn migration_report_verified(app: tauri::AppHandle, folder: String) -> Result<bool, ShellError> {
    use tauri::Manager as _;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| ShellError::coded("app_data_unavailable", "cannot locate the app data folder"))?;
    let device = device_id::read_existing(&data).map_err(|e| {
        ShellError::coded("device_id_unreadable", &format!("cannot read this device's id: {e}"))
    })?;
    report_state_verified(Path::new(&folder), device.as_deref())
}

/// The non-empty `vault-root` from Electron's preferences, as a path.
fn configured_root(old_dir: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(old_dir.join("preferences.json")).ok()?;
    let prefs: serde_json::Value = serde_json::from_str(&text).ok()?;
    let root = prefs
        .get("vault-root")?
        .as_str()
        .filter(|r| !r.is_empty())?;
    Some(PathBuf::from(root))
}

/// This device's KEYS marker, written once its secrets are moved: `<workspace>/.weaveforge/migration-0.9.7/secrets-moved-<deviceId>.json`.
/// Copied from `marker_path` in the KEYS branch (`apps/shell/src/secrets_moved.rs`); keep the two in step.
// TODO(after merge of feat/097-keys): delete this copy and call `secrets_moved.rs` `marker_path`, the
// shared function, so the marker path has one definition.
#[must_use]
pub fn secrets_marker_path(workspace: &Path, device_id: &str) -> PathBuf {
    workspace
        .join(WORKSPACE_META_DIR)
        .join("migration-0.9.7")
        .join(format!("secrets-moved-{device_id}.json"))
}

/// Whether the "install 0.9.7 first" gate shows. Only when old local-database data is on this device
/// AND this device has neither a verified 0.9.7 export nor its secrets-moved marker, both in the
/// configured workspace. A fresh install has no old data, so it never sees the gate. An error or
/// missing piece on the old-data or export check counts as "not done", so the gate shows.
#[must_use]
pub fn gate_required_from(
    app_data: Option<&Path>,
    electron: Option<&Path>,
    device_id: Option<&str>,
) -> bool {
    match legacy_db_from(app_data, electron) {
        Ok(false) => false,
        Ok(true) => !(migrated_here(app_data, device_id) || migrated_here(electron, device_id)),
        Err(_) => true,
    }
}

/// Bridge: whether the "install 0.9.7 first" gate shows (`installGateRequired`). Errors when this
/// device's id cannot be read, so the page shows the gate rather than guessing.
#[tauri::command]
#[specta::specta]
pub fn install_gate_required(app: tauri::AppHandle) -> Result<bool, ShellError> {
    use tauri::Manager as _;
    let paths = app.path();
    let dir = paths.app_data_dir().ok();
    let electron = paths
        .config_dir()
        .ok()
        .zip(paths.resource_dir().ok())
        .and_then(|(config, resources)| {
            let source = crate::launch::app_source(resources);
            crate::launch::electron_data_dir(&source, &app.package_info().name, &config)
        });
    install_gate_with(dir.as_deref(), electron.as_deref(), |data| {
        device_id::read_existing(data).map_err(|e| {
            ShellError::coded("device_id_unreadable", &format!("cannot read this device's id: {e}"))
        })
    })
}

/// The gate decision behind `install_gate_required`. A clean "no old data" answer returns before the
/// device id is read, so a fresh install never fails on a corrupt id file. Old data reads the id, and
/// an unreadable id is an error so the page shows the gate.
fn install_gate_with(
    dir: Option<&Path>,
    electron: Option<&Path>,
    read_device: impl FnOnce(&Path) -> Result<Option<String>, ShellError>,
) -> Result<bool, ShellError> {
    if let Ok(false) = legacy_db_from(dir, electron) {
        return Ok(false);
    }
    let device = match dir {
        Some(data) => read_device(data)?,
        None => None,
    };
    Ok(gate_required_from(dir, electron, device.as_deref()))
}

/// True when the workspace named by the prefs in `prefs_dir` holds this device's marker or its
/// verified 0.9.7 run. No workspace or no device id is not migrated.
fn migrated_here(prefs_dir: Option<&Path>, device_id: Option<&str>) -> bool {
    let (Some(dir), Some(id)) = (prefs_dir, device_id) else {
        return false;
    };
    let Some(root) = configured_root(dir) else {
        return false;
    };
    // Pre-existing: the secrets marker alone passes here. It is written only after this device's secrets move.
    secrets_marker_path(&root, id).is_file()
        || matches!(report_state_verified(&root, Some(id)), Ok(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("wf-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (old, new) = (root.join("old"), root.join("new"));
        let _ = fs::create_dir_all(&old);
        (old, new)
    }

    /// An app data dir whose prefs name `workspace`, with a database in each place asked for.
    fn data_with(name: &str, app_db: bool, ws_db: bool) -> (PathBuf, PathBuf) {
        let (data, _) = temp(name);
        let workspace = data.parent().map(|p| p.join("ws")).unwrap_or_default();
        let prefs = serde_json::json!({ "vault-root": workspace.to_string_lossy() });
        let _ = fs::write(data.join("preferences.json"), prefs.to_string());
        let _ = fs::create_dir_all(&workspace);
        for (on, dir) in [
            (app_db, data.join("local-db")),
            (ws_db, workspace.join(WORKSPACE_META_DIR).join("db")),
        ] {
            if on {
                let _ = fs::create_dir_all(&dir);
                let _ = fs::write(dir.join("PG_VERSION"), "16");
            }
        }
        (data, workspace)
    }

    #[test]
    fn old_db_is_the_workspace_one_when_both_exist() {
        let (data, ws) = data_with("old-both", true, true);
        assert_eq!(
            old_pglite_dir(&data),
            Some(ws.join(WORKSPACE_META_DIR).join("db"))
        );
    }

    #[test]
    fn old_db_falls_back_to_the_app_one_without_a_workspace_db() {
        let (data, _) = data_with("old-app", true, false);
        assert_eq!(old_pglite_dir(&data), Some(data.join("local-db")));
    }

    #[test]
    fn old_db_is_found_in_the_workspace_alone() {
        let (data, ws) = data_with("old-ws", false, true);
        assert_eq!(
            old_pglite_dir(&data),
            Some(ws.join(WORKSPACE_META_DIR).join("db"))
        );
    }

    #[test]
    fn old_db_is_none_for_a_new_user() {
        let (data, _) = data_with("old-none", false, false);
        assert_eq!(old_pglite_dir(&data), None);
    }

    #[test]
    fn old_db_ignores_an_empty_workspace_db_folder() {
        let (data, ws) = data_with("old-empty-ws", true, false);
        let _ = fs::create_dir_all(ws.join(WORKSPACE_META_DIR).join("db"));
        assert_eq!(old_pglite_dir(&data), Some(data.join("local-db")));
    }

    #[test]
    fn old_db_without_prefs_uses_the_app_one() {
        let (data, _) = temp("old-noprefs");
        let _ = fs::create_dir_all(data.join("local-db"));
        let _ = fs::write(data.join("local-db").join("PG_VERSION"), "16");
        assert_eq!(old_pglite_dir(&data), Some(data.join("local-db")));
    }

    fn pg_dir(dir: &Path) {
        let _ = fs::create_dir_all(dir);
        let _ = fs::write(dir.join("PG_VERSION"), "18");
    }

    /// Case a: a workspace DB plus a tiny stale app `local-db` must read the workspace.
    #[test]
    fn old_state_workspace_beats_stale_app_db() {
        let (data, ws) = data_with("old-stale", true, true);
        assert_eq!(
            old_db_state(&data),
            OldDb::Found(ws.join(WORKSPACE_META_DIR).join("db"))
        );
    }

    /// Case d: custom folder with spaces, non-ASCII and backslashes in the stored path.
    #[test]
    fn old_state_custom_root_with_spaces_and_non_ascii() {
        let (data, _) = temp("old-unicode");
        let root = data.parent().unwrap().join("Ünïcode folder ő spaces");
        pg_dir(&root.join(WORKSPACE_META_DIR).join("db"));
        let prefs = serde_json::json!({ "vault-root": root.to_string_lossy() });
        let _ = fs::write(data.join("preferences.json"), prefs.to_string());
        assert_eq!(
            old_db_state(&data),
            OldDb::Found(root.join(WORKSPACE_META_DIR).join("db"))
        );
    }

    /// Case c: an unplugged or missing vault-root is pending, never a silent local-db import.
    #[test]
    fn old_state_missing_root_is_pending_not_local_db() {
        let (data, _) = temp("old-missing");
        let root = data.parent().unwrap().join("unplugged");
        pg_dir(&data.join("local-db"));
        let prefs = serde_json::json!({ "vault-root": root.to_string_lossy() });
        let _ = fs::write(data.join("preferences.json"), prefs.to_string());
        assert_eq!(old_db_state(&data), OldDb::WorkspaceMissing(root.clone()));
        assert_eq!(old_pglite_dir(&data), None);
    }

    /// Case c, no app DB either: still pending, the notice names the folder.
    #[test]
    fn old_state_missing_root_without_app_db_is_pending() {
        let (data, _) = temp("old-missing-bare");
        let root = data.parent().unwrap().join("gone");
        let prefs = serde_json::json!({ "vault-root": root.to_string_lossy() });
        let _ = fs::write(data.join("preferences.json"), prefs.to_string());
        assert_eq!(old_db_state(&data), OldDb::WorkspaceMissing(root));
    }

    /// No prefs and no DB: nothing to import.
    #[test]
    fn old_state_new_user_has_no_source() {
        let (data, _) = temp("old-state-new");
        assert_eq!(old_db_state(&data), OldDb::None);
    }

    /// Case b, app DB only: root exists with no workspace DB, the app one is used.
    #[test]
    fn old_state_app_db_when_root_exists_without_workspace_db() {
        let (data, _) = data_with("old-state-app", true, false);
        assert_eq!(old_db_state(&data), OldDb::Found(data.join("local-db")));
    }

    #[test]
    fn legacy_pg_is_absent_when_the_dir_is_missing() {
        let (data, _) = temp("legacy-missing");
        assert_eq!(legacy_pg_data_present(&data), Ok(false));
    }

    #[test]
    fn legacy_pg_is_absent_when_the_dir_is_empty() {
        let (data, _) = temp("legacy-empty");
        fs::create_dir_all(legacy_pg_dir(&data)).unwrap();
        assert_eq!(legacy_pg_data_present(&data), Ok(false));
    }

    #[test]
    fn legacy_pg_is_present_for_a_data_dir_with_pg_version() {
        let (data, _) = temp("legacy-populated");
        fs::create_dir_all(legacy_pg_dir(&data).join("data")).unwrap();
        fs::write(legacy_pg_dir(&data).join("data").join("PG_VERSION"), "18").unwrap();
        assert_eq!(legacy_pg_data_present(&data), Ok(true));
    }

    #[test]
    fn legacy_pg_is_present_when_only_a_dump_is_there() {
        let (data, _) = temp("legacy-dump-only");
        fs::create_dir_all(legacy_pg_dir(&data)).unwrap();
        fs::write(legacy_pg_dir(&data).join("backup.sql"), "-- dump").unwrap();
        assert_eq!(legacy_pg_data_present(&data), Ok(true));
    }

    #[test]
    fn legacy_pg_is_present_when_only_a_failed_data_dir_is_there() {
        let (data, _) = temp("legacy-failed-only");
        fs::create_dir_all(legacy_pg_dir(&data).join("data.failed-x")).unwrap();
        assert_eq!(legacy_pg_data_present(&data), Ok(true));
    }

    #[test]
    fn legacy_pg_io_error_fails_closed() {
        // `local-pg` as a plain file: reading it as a folder fails with an error other than not-found.
        let (data, _) = temp("legacy-io-error");
        fs::write(legacy_pg_dir(&data), "not a folder").unwrap();
        let err = legacy_pg_data_present(&data).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("legacy_pg_unreadable"));
        assert!(legacy_db_in(&data).is_err());
    }

    #[test]
    fn legacy_db_is_present_for_the_native_pg_dir() {
        let (data, _) = temp("legacy-db-pg");
        fs::create_dir_all(legacy_pg_dir(&data).join("data")).unwrap();
        fs::write(legacy_pg_dir(&data).join("data").join("PG_VERSION"), "18").unwrap();
        assert_eq!(legacy_db_in(&data), Ok(true));
    }

    #[test]
    fn legacy_db_is_present_for_the_old_pglite_dir() {
        let (data, _) = data_with("legacy-db-pglite", true, false);
        assert_eq!(legacy_db_in(&data), Ok(true));
    }

    #[test]
    fn legacy_db_is_absent_when_nothing_is_there() {
        let (data, _) = temp("legacy-db-none");
        assert_eq!(legacy_db_in(&data), Ok(false));
    }

    #[test]
    fn legacy_db_is_present_for_a_failed_app_db_folder() {
        let (data, _) = data_with("legacy-db-failed", false, false);
        fs::create_dir_all(data.join("local-db").join("data.failed-x")).unwrap();
        assert_eq!(legacy_db_in(&data), Ok(true));
    }

    #[test]
    fn legacy_db_is_present_for_a_moved_aside_workspace_db_folder() {
        let (data, ws) = data_with("legacy-db-moved", false, false);
        fs::create_dir_all(ws.join(WORKSPACE_META_DIR).join("db").join("moved-aside")).unwrap();
        assert_eq!(legacy_db_in(&data), Ok(true));
    }

    #[test]
    fn an_empty_workspace_db_folder_is_absent() {
        let (data, ws) = data_with("legacy-db-empty-ws", false, false);
        fs::create_dir_all(ws.join(WORKSPACE_META_DIR).join("db")).unwrap();
        assert_eq!(legacy_db_in(&data), Ok(false));
    }

    #[test]
    fn a_dump_in_local_db_backups_does_not_block_the_gate() {
        let (data, _) = temp("legacy-db-backups-dump");
        fs::create_dir_all(data.join("local-db-backups")).unwrap();
        fs::write(data.join("local-db-backups").join("old.sql"), "-- dump").unwrap();
        assert_eq!(legacy_db_in(&data), Ok(false));
    }

    #[test]
    fn a_local_db_that_is_a_plain_file_fails_closed() {
        let (data, _) = temp("legacy-db-file");
        fs::write(data.join("local-db"), "not a folder").unwrap();
        let err = legacy_db_in(&data).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("legacy_db_unreadable"));
    }

    #[cfg(unix)]
    #[test]
    fn a_broken_symlink_at_local_pg_is_present_and_not_followed() {
        let (data, _) = temp("legacy-pg-symlink");
        std::os::unix::fs::symlink(data.join("missing-target"), legacy_pg_dir(&data)).unwrap();
        assert_eq!(legacy_pg_data_present(&data), Ok(true));
        assert!(fs::symlink_metadata(legacy_pg_dir(&data)).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_broken_symlink_at_local_db_is_present() {
        let (data, _) = temp("legacy-db-symlink");
        std::os::unix::fs::symlink(data.join("missing-target"), data.join("local-db")).unwrap();
        assert_eq!(legacy_db_in(&data), Ok(true));
    }

    #[cfg(windows)]
    #[test]
    fn a_broken_junction_at_local_pg_is_present_and_not_followed() {
        use std::process::Command;
        let (data, _) = temp("legacy-pg-junction");
        let target = data.join("junction-target");
        fs::create_dir_all(&target).unwrap();
        let link = legacy_pg_dir(&data);
        let made = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .unwrap();
        assert!(made.status.success(), "mklink /J failed");
        fs::remove_dir(&target).unwrap();
        assert_eq!(legacy_pg_data_present(&data), Ok(true));
        let _ = Command::new("cmd").args(["/C", "rmdir"]).arg(&link).output();
    }

    /// A workspace folder whose 0.9.7 report holds `body`.
    fn report(name: &str, body: &str) -> PathBuf {
        let (folder, _) = temp(name);
        let path = folder.join(REPORT_REL);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, body).unwrap();
        folder
    }

    #[test]
    fn report_absent_is_not_verified() {
        let (folder, _) = temp("report-absent");
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn report_incomplete_is_not_verified() {
        let folder = report("report-incomplete", r#"{"state":"incomplete","runs":[]}"#);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    /// This device's id, as the report's runs record it.
    const DEVICE: &str = "device-a";

    const COMPLETE: &str = r#"{"state":"verified","runs":[{"deviceId":"device-a","state":"verified","missing":[],"kinds":{"vault_page":{"db":2,"files":2}}}]}"#;

    #[test]
    fn another_devices_verified_run_is_refused() {
        let body = COMPLETE.replace(r#""deviceId":"device-a""#, r#""deviceId":"device-b""#);
        let folder = report("report-other-device", &body);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn this_devices_verified_run_passes_next_to_another_devices_run() {
        let body = COMPLETE.replace(
            r#"}]}"#,
            r#"},{"deviceId":"device-b","state":"incomplete","missing":["vault_page"],"kinds":{}}]}"#,
        );
        let folder = report("report-own-device", &body);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(true));
    }

    #[test]
    fn a_missing_device_id_is_refused() {
        let folder = report("report-no-device", COMPLETE);
        assert_eq!(report_state_verified(&folder, None), Ok(false));
    }

    #[test]
    fn report_verified_is_verified() {
        let folder = report("report-verified", COMPLETE);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(true));
    }

    #[test]
    fn verified_report_without_runs_is_not_verified() {
        let folder = report("report-no-runs", r#"{"state":"verified","runs":[]}"#);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn verified_report_with_missing_items_is_not_verified() {
        let body = COMPLETE.replace(r#""missing":[]"#, r#""missing":["vault_page"]"#);
        let folder = report("report-missing", &body);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn verified_report_with_db_files_mismatch_is_not_verified() {
        let body = COMPLETE.replace(r#""files":2"#, r#""files":1"#);
        let folder = report("report-mismatch", &body);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn a_missing_workspace_blocks_the_legacy_gate() {
        let (data, _) = temp("legacy-ws-missing");
        let root = data.parent().unwrap().join("unplugged-legacy");
        let prefs = serde_json::json!({ "vault-root": root.to_string_lossy() });
        let _ = fs::write(data.join("preferences.json"), prefs.to_string());
        assert_eq!(legacy_db_in(&data), Ok(true));
    }

    #[test]
    fn an_unnamed_app_data_dir_is_an_error_not_absent() {
        let err = legacy_db_from(None, None).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("app_data_unavailable"));
    }

    #[test]
    fn an_electron_data_dir_blocks_even_without_an_app_data_dir() {
        let (electron, _) = temp("legacy-electron");
        assert_eq!(legacy_db_from(None, Some(&electron)), Ok(true));
    }

    #[test]
    fn an_empty_app_data_dir_is_absent() {
        let (data, _) = temp("legacy-empty-app");
        assert_eq!(legacy_db_from(Some(&data), None), Ok(false));
    }

    fn device_id_unreadable() -> ShellError {
        ShellError::coded("device_id_unreadable", "cannot read this device's id")
    }

    #[test]
    fn a_fresh_install_with_a_corrupt_device_id_is_not_gated() {
        let (data, _) = temp("gate-fresh-corrupt-id");
        let gated = install_gate_with(Some(&data), None, |_| Err(device_id_unreadable()));
        assert_eq!(gated, Ok(false));
    }

    #[test]
    fn old_data_with_an_unreadable_device_id_is_still_an_error() {
        let (data, _) = data_with("gate-old-corrupt-id", true, false);
        let gated = install_gate_with(Some(&data), None, |_| Err(device_id_unreadable()));
        assert_eq!(gated.unwrap_err().code.as_deref(), Some("device_id_unreadable"));
    }

    #[test]
    fn old_data_with_a_readable_device_id_and_no_migration_is_gated() {
        let (data, _) = data_with("gate-old-no-migration", true, false);
        let gated = install_gate_with(Some(&data), None, |_| Ok(Some(DEVICE.to_string())));
        assert_eq!(gated, Ok(true));
    }

    #[test]
    fn corrupt_report_refuses_and_names_the_file() {
        let folder = report("report-corrupt", "{not json");
        let err = report_state_verified(&folder, Some(DEVICE)).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("migration_report_unreadable"));
        assert!(err.message.contains("report.json"), "{}", err.message);
    }

    #[test]
    fn unreadable_report_is_a_typed_error() {
        // A directory where the report file should be: the read fails with a non-NotFound error.
        let (folder, _) = temp("report-unreadable");
        fs::create_dir_all(folder.join(REPORT_REL)).unwrap();
        let err = report_state_verified(&folder, Some(DEVICE)).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("migration_report_unreadable"));
    }

    /// A per-device report file, `report-<name>.json`, beside `report.json` in the 0.9.7 folder.
    fn device_report(name: &str, file: &str, body: &str) -> PathBuf {
        let (folder, _) = temp(name);
        let path = folder.join(REPORT_REL).parent().unwrap().join(file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, body).unwrap();
        folder
    }

    #[test]
    fn this_devices_verified_per_device_report_passes_without_report_json() {
        let folder = device_report("report-per-device", "report-device-a.json", COMPLETE);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(true));
    }

    #[test]
    fn a_corrupt_per_device_report_refuses_beside_a_verified_report_json() {
        let folder = reports_in(
            "report-fallback",
            &[("report.json", COMPLETE), ("report-device-a.json", "{not json")],
        );
        let err = report_state_verified(&folder, Some(DEVICE)).unwrap_err();
        assert!(err.message.contains("report-device-a.json"), "{}", err.message);
    }

    /// One run as the export writes it, with matching counts.
    fn run(device: &str, state: &str, started: &str) -> String {
        format!(
            r#"{{"deviceId":"{device}","state":"{state}","startedAt":"{started}","missing":[],"kinds":{{"vault_page":{{"db":2,"files":2}}}}}}"#
        )
    }

    /// A report file holding `runs`.
    fn report_body(runs: &[String]) -> String {
        format!(r#"{{"state":"verified","runs":[{}]}}"#, runs.join(","))
    }

    /// A 0.9.7 folder holding each `(file name, body)` in the migration folder.
    fn reports_in(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let (folder, _) = temp(name);
        let dir = folder.join(REPORT_REL).parent().unwrap().to_path_buf();
        fs::create_dir_all(&dir).unwrap();
        for (file, body) in files {
            fs::write(dir.join(file), body).unwrap();
        }
        folder
    }

    #[test]
    fn an_empty_report_file_refuses() {
        let folder = report("report-empty-file", "");
        assert!(report_state_verified(&folder, Some(DEVICE)).is_err());
    }

    #[test]
    fn a_report_without_a_runs_list_refuses() {
        let folder = report("report-no-runs-key", r#"{"state":"incomplete"}"#);
        assert!(report_state_verified(&folder, Some(DEVICE)).is_err());
    }

    #[test]
    fn a_report_with_an_unknown_state_refuses() {
        let folder = report("report-unknown-state", r#"{"state":"done","runs":[]}"#);
        assert!(report_state_verified(&folder, Some(DEVICE)).is_err());
    }

    #[test]
    fn another_devices_removed_report_is_not_an_error() {
        let folder = report(
            "report-other-removed",
            r#"{"state":"removed","runs":[{"deviceId":"device-b","state":"verified","startedAt":"2026-11-20T10:00:00Z","missing":[],"kinds":{"vault_page":{"db":2,"files":2}}}]}"#,
        );
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn another_devices_removing_report_is_not_an_error() {
        let folder = report(
            "report-other-removing",
            r#"{"state":"removing","removingDeviceId":"device-b","runs":[{"deviceId":"device-b","state":"verified","startedAt":"2026-11-20T10:00:00Z","missing":[],"kinds":{"vault_page":{"db":2,"files":2}}}]}"#,
        );
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn a_report_that_is_not_an_object_refuses() {
        let folder = report("report-array", "[]");
        assert!(report_state_verified(&folder, Some(DEVICE)).is_err());
    }

    #[test]
    fn a_corrupt_conflict_copy_refuses_beside_a_verified_own_run() {
        let folder = reports_in(
            "report-conflict-corrupt",
            &[("report-device-a.json", COMPLETE), ("report-device-a (1).json", "{not json")],
        );
        let err = report_state_verified(&folder, Some(DEVICE)).unwrap_err();
        assert!(err.message.contains("report-device-a (1).json"), "{}", err.message);
    }

    #[test]
    fn a_corrupt_other_devices_file_refuses() {
        let folder = reports_in(
            "report-other-corrupt",
            &[("report-device-a.json", COMPLETE), ("report-device-b.json", "{not json")],
        );
        assert!(report_state_verified(&folder, Some(DEVICE)).is_err());
    }

    #[test]
    fn a_later_incomplete_conflict_copy_run_refuses_the_earlier_verified_run() {
        let early = report_body(&[run(DEVICE, "verified", "2026-11-22T10:00:00Z")]);
        let late = report_body(&[run(DEVICE, "incomplete", "2026-11-22T11:00:00Z")]);
        let folder = reports_in(
            "report-conflict-later-incomplete",
            &[("report.json", early.as_str()), ("report-device-a (1).json", late.as_str())],
        );
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn a_later_verified_conflict_copy_run_passes_over_an_earlier_incomplete_run() {
        let early = report_body(&[run(DEVICE, "incomplete", "2026-11-22T10:00:00Z")]);
        let late = report_body(&[run(DEVICE, "verified", "2026-11-22T11:00:00Z")]);
        let folder = reports_in(
            "report-conflict-later-verified",
            &[("report.json", early.as_str()), ("report-device-a (1).json", late.as_str())],
        );
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(true));
    }

    #[test]
    fn a_tie_goes_to_the_incomplete_run_whatever_the_file_order() {
        let same = "2026-11-22T10:00:00Z";
        let verified = report_body(&[run(DEVICE, "verified", same)]);
        let incomplete = report_body(&[run(DEVICE, "incomplete", same)]);
        let names = ["report.json", "report-device-a (1).json"];
        for (first, second) in [(names[0], names[1]), (names[1], names[0])] {
            let folder = reports_in(
                "report-tie",
                &[(first, verified.as_str()), (second, incomplete.as_str())],
            );
            assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false), "{first} then {second}");
        }
    }

    #[test]
    fn empty_runs_in_every_report_file_are_not_verified() {
        let empty = r#"{"state":"none","runs":[]}"#;
        let folder = reports_in("report-empty-union", &[("report.json", empty), ("report-device-a.json", empty)]);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn another_devices_per_device_report_is_refused() {
        let body = COMPLETE.replace(r#""deviceId":"device-a""#, r#""deviceId":"device-b""#);
        let folder = device_report("report-other-per-device", "report-device-b.json", &body);
        assert_eq!(report_state_verified(&folder, Some(DEVICE)), Ok(false));
    }

    #[test]
    fn legacy_pg_with_only_a_pid_file_is_present() {
        let (data, _) = temp("legacy-pid-only");
        fs::create_dir_all(legacy_pg_dir(&data).join("data")).unwrap();
        fs::write(legacy_pg_dir(&data).join("data").join("postmaster.pid"), "1").unwrap();
        assert_eq!(legacy_pg_data_present(&data), Ok(true));
    }

    fn write_report(ws: &Path, body: &str) {
        let path = ws.join(REPORT_REL);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    /// The KEYS marker, written where the 0.9.7 run puts it: inside the workspace folder.
    fn write_marker(ws: &Path) {
        let path = secrets_marker_path(ws, DEVICE);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "{}").unwrap();
    }

    /// The gate as the desktop asks it: this device id, app data only (no Electron dir).
    fn gate(app: &Path) -> bool {
        gate_required_from(Some(app), None, Some(DEVICE))
    }

    #[test]
    fn marker_path_is_in_the_workspace_migration_folder() {
        let ws = Path::new("ws-root");
        assert_eq!(
            secrets_marker_path(ws, DEVICE),
            ws.join(".weaveforge").join("migration-0.9.7").join("secrets-moved-device-a.json")
        );
    }

    #[test]
    fn a_marker_in_app_data_does_not_count() {
        let (data, _) = data_with("gate-app-marker", true, false);
        fs::write(data.join("secrets-moved-device-a.json"), "{}").unwrap();
        assert!(gate(&data));
    }

    #[test]
    fn fresh_install_shows_no_gate() {
        let (data, _) = temp("gate-fresh");
        assert!(!gate(&data));
    }

    #[test]
    fn old_data_without_export_or_marker_shows_the_gate() {
        let (data, _) = data_with("gate-bare", true, false);
        assert!(gate(&data));
    }

    #[test]
    fn old_data_with_verified_export_and_marker_shows_no_gate() {
        let (data, ws) = data_with("gate-both", true, false);
        write_report(&ws, COMPLETE);
        write_marker(&ws);
        assert!(!gate(&data));
    }

    #[test]
    fn old_data_with_verified_export_alone_shows_no_gate() {
        let (data, ws) = data_with("gate-export", true, false);
        write_report(&ws, COMPLETE);
        assert!(!gate(&data));
    }

    #[test]
    fn old_data_with_marker_alone_shows_no_gate() {
        let (data, ws) = data_with("gate-marker", true, false);
        write_marker(&ws);
        assert!(!gate(&data));
    }

    #[test]
    fn old_data_with_another_devices_export_shows_the_gate() {
        let (data, ws) = data_with("gate-other-device", true, false);
        write_report(&ws, &COMPLETE.replace(r#""deviceId":"device-a""#, r#""deviceId":"device-b""#));
        assert!(gate(&data));
    }

    #[test]
    fn old_data_with_an_unreadable_report_shows_the_gate() {
        let (data, ws) = data_with("gate-bad-report", true, false);
        fs::create_dir_all(ws.join(REPORT_REL)).unwrap();
        assert!(gate(&data));
    }

    #[test]
    fn unreadable_old_state_shows_the_gate() {
        let (data, _) = temp("gate-unreadable");
        fs::write(legacy_pg_dir(&data), "not a folder").unwrap();
        assert!(gate(&data));
    }

    #[test]
    fn missing_app_data_path_shows_the_gate() {
        assert!(gate_required_from(None, None, Some(DEVICE)));
    }

    #[test]
    fn app_data_prefs_marker_counts_when_electron_prefs_point_elsewhere() {
        let (data, ws) = data_with("gate-app-prefs-marker", true, false);
        write_marker(&ws);
        let (electron, _) = temp("gate-electron-no-prefs");
        assert!(!gate_required_from(Some(&data), Some(&electron), Some(DEVICE)));
    }

    #[test]
    fn electron_prefs_marker_counts_when_app_data_has_no_prefs() {
        let (electron, ws) = data_with("gate-electron-prefs-marker", true, false);
        write_marker(&ws);
        let (data, _) = temp("gate-app-no-prefs");
        assert!(!gate_required_from(Some(&data), Some(&electron), Some(DEVICE)));
    }
}

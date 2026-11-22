//! Reads the old Electron app's PGlite database, so the first-open question can offer it. Nothing
//! is copied, renamed or deleted here: the old data stays where Electron left it.

use std::fs;
use std::path::{Path, PathBuf};

use wf_core::sync::folder_layout::WORKSPACE_META_DIR;

use crate::commands::ShellError;

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

/// The 0.9.7 native Postgres data dir, under the app data dir. Read-only use only.
#[must_use]
pub fn legacy_pg_data_dir(app_data: &Path) -> PathBuf {
    app_data.join("local-pg").join("data")
}

/// True when the old native Postgres data dir exists and holds `PG_VERSION`. Never starts
/// Postgres and never writes.
#[must_use]
pub fn legacy_pg_data_present(app_data: &Path) -> bool {
    legacy_pg_data_dir(app_data).join("PG_VERSION").is_file()
}

/// True when any old local database (native Postgres or PGlite) may be on disk under `app_data`.
/// A missing or unplugged workspace counts: its database may be there, so the gate fails closed.
#[must_use]
pub fn legacy_db_in(app_data: &Path) -> bool {
    legacy_pg_data_present(app_data) || !matches!(old_db_state(app_data), OldDb::None)
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
    Ok(legacy_db_in(dir))
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

/// True only when the 0.9.7 report under `folder` is verified: `state == "verified"`, at least one
/// run, and every run has an empty `missing` and a non-empty `kinds` whose db and files counts
/// match. A missing report or bad JSON is `Ok(false)`. An IO error other than not-found is a typed
/// error, so the page can show "unavailable" instead of "not migrated". Read-only; never writes.
pub fn report_state_verified(folder: &Path) -> Result<bool, ShellError> {
    let text = match fs::read_to_string(folder.join(REPORT_REL)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => {
            return Err(ShellError::coded(
                "migration_report_unreadable",
                &format!("cannot read the 0.9.7 migration report: {e}"),
            ));
        }
    };
    let Ok(report) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Ok(false);
    };
    Ok(is_verified_report(&report))
}

fn is_verified_report(report: &serde_json::Value) -> bool {
    report["state"].as_str() == Some("verified")
        && report["runs"]
            .as_array()
            .is_some_and(|runs| !runs.is_empty() && runs.iter().all(run_is_complete))
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

/// Bridge: whether the workspace at `folder` has a verified 0.9.7 migration report
/// (`migrationReportVerified`). Read-only; an unreadable file is a typed error.
#[tauri::command]
#[specta::specta]
pub fn migration_report_verified(folder: String) -> Result<bool, ShellError> {
    report_state_verified(Path::new(&folder))
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
    fn legacy_pg_data_is_absent_when_the_dir_is_missing() {
        let (data, _) = temp("legacy-missing");
        assert!(!legacy_pg_data_present(&data));
    }

    #[test]
    fn legacy_pg_data_is_absent_when_the_dir_is_empty() {
        let (data, _) = temp("legacy-empty");
        fs::create_dir_all(legacy_pg_data_dir(&data)).unwrap();
        assert!(!legacy_pg_data_present(&data));
    }

    #[test]
    fn legacy_pg_data_is_present_when_the_dir_has_files() {
        let (data, _) = temp("legacy-populated");
        fs::create_dir_all(legacy_pg_data_dir(&data)).unwrap();
        fs::write(legacy_pg_data_dir(&data).join("PG_VERSION"), "18").unwrap();
        assert!(legacy_pg_data_present(&data));
    }

    #[test]
    fn legacy_db_is_present_for_the_native_pg_dir() {
        let (data, _) = temp("legacy-db-pg");
        fs::create_dir_all(legacy_pg_data_dir(&data)).unwrap();
        fs::write(legacy_pg_data_dir(&data).join("PG_VERSION"), "18").unwrap();
        assert!(legacy_db_in(&data));
    }

    #[test]
    fn legacy_db_is_present_for_the_old_pglite_dir() {
        let (data, _) = data_with("legacy-db-pglite", true, false);
        assert!(legacy_db_in(&data));
    }

    #[test]
    fn legacy_db_is_absent_when_nothing_is_there() {
        let (data, _) = temp("legacy-db-none");
        assert!(!legacy_db_in(&data));
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
        assert_eq!(report_state_verified(&folder), Ok(false));
    }

    #[test]
    fn report_incomplete_is_not_verified() {
        let folder = report("report-incomplete", r#"{"state":"incomplete"}"#);
        assert_eq!(report_state_verified(&folder), Ok(false));
    }

    const COMPLETE: &str = r#"{"state":"verified","runs":[{"missing":[],"kinds":{"vault_page":{"db":2,"files":2}}}]}"#;

    #[test]
    fn report_verified_is_verified() {
        let folder = report("report-verified", COMPLETE);
        assert_eq!(report_state_verified(&folder), Ok(true));
    }

    #[test]
    fn verified_report_without_runs_is_not_verified() {
        let folder = report("report-no-runs", r#"{"state":"verified","runs":[]}"#);
        assert_eq!(report_state_verified(&folder), Ok(false));
    }

    #[test]
    fn verified_report_with_missing_items_is_not_verified() {
        let body = COMPLETE.replace(r#""missing":[]"#, r#""missing":["vault_page"]"#);
        let folder = report("report-missing", &body);
        assert_eq!(report_state_verified(&folder), Ok(false));
    }

    #[test]
    fn verified_report_with_db_files_mismatch_is_not_verified() {
        let body = COMPLETE.replace(r#""files":2"#, r#""files":1"#);
        let folder = report("report-mismatch", &body);
        assert_eq!(report_state_verified(&folder), Ok(false));
    }

    #[test]
    fn a_missing_workspace_blocks_the_legacy_gate() {
        let (data, _) = temp("legacy-ws-missing");
        let root = data.parent().unwrap().join("unplugged-legacy");
        let prefs = serde_json::json!({ "vault-root": root.to_string_lossy() });
        let _ = fs::write(data.join("preferences.json"), prefs.to_string());
        assert!(legacy_db_in(&data));
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

    #[test]
    fn corrupt_report_is_not_verified() {
        let folder = report("report-corrupt", "{not json");
        assert_eq!(report_state_verified(&folder), Ok(false));
    }

    #[test]
    fn unreadable_report_is_a_typed_error() {
        // A directory where the report file should be: the read fails with a non-NotFound error.
        let (folder, _) = temp("report-unreadable");
        fs::create_dir_all(folder.join(REPORT_REL)).unwrap();
        let err = report_state_verified(&folder).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("migration_report_unreadable"));
    }

    #[test]
    fn legacy_db_without_pg_version_is_absent() {
        let (data, _) = temp("legacy-no-pg-version");
        fs::create_dir_all(legacy_pg_data_dir(&data)).unwrap();
        fs::write(legacy_pg_data_dir(&data).join("postmaster.pid"), "1").unwrap();
        assert!(!legacy_pg_data_present(&data));
    }
}

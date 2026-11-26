//! Reads the old Electron app's PGlite database, so the first-open question can offer it. Nothing
//! is copied, renamed or deleted here: the old data stays where Electron left it.

use std::fs;
use std::path::{Path, PathBuf};

use wf_core::sync::folder_layout::WORKSPACE_META_DIR;

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

/// Whether the old local database was exported and checked: the 0.9.7 report in the configured
/// workspace says so. A missing or unreadable report counts as not verified.
#[must_use]
pub fn local_data_verified(old_dir: &Path, device: Option<&str>) -> bool {
    let Some(device) = device else {
        return false;
    };
    configured_root(old_dir).is_some_and(|folder| report_verified_in(&folder, device))
}

/// Whether the native local database was exported to a folder whose 0.9.7 report is verified.
/// The folder comes from `exported-to.json` in the database root.
#[must_use]
pub fn native_data_verified(pg_root: &Path, device: Option<&str>) -> bool {
    let Some(device) = device else {
        return false;
    };
    let Ok(text) = fs::read_to_string(pg_root.join("exported-to.json")) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    value["folder"]
        .as_str()
        .is_some_and(|folder| report_verified_in(Path::new(folder), device))
}

/// Whether this device's 0.9.7 report under `folder` is verified, removing or removed. The report
/// is this device's own `report-<device>.json` (what the 0.9.7 exporter writes), else the legacy
/// `report.json`; another device's file never stands in. Any unreadable report counts as not verified.
fn report_verified_in(folder: &Path, device: &str) -> bool {
    use crate::migrate_097::remove::{base_report, read_reports};
    read_reports(folder, device).is_ok_and(|reports| {
        base_report(&reports, device).is_some_and(|report| report_value_is_verified(report, device))
    })
}

/// The report's state is `verified`, `removing` or `removed`, and the newest run whose
/// `deviceId` is this device's id has an empty `missing`. A run without a matching `deviceId`
/// does not count, so a workspace synced from another device never proves this one's data.
fn report_value_is_verified(report: &serde_json::Value, device: &str) -> bool {
    let state = report.get("state").and_then(serde_json::Value::as_str);
    if !matches!(state, Some("verified" | "removing" | "removed")) {
        return false;
    }
    crate::migrate_097::remove::own_run(report, device)
        .ok()
        .and_then(|run| run.get("missing"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(Vec::is_empty)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The legacy 0.9.7 migration report, relative to the export folder.
    const REPORT_097: &str = ".weaveforge/migration-0.9.7/report.json";

    fn report_is_verified(text: &str, device: &str) -> bool {
        serde_json::from_str::<serde_json::Value>(text)
            .is_ok_and(|report| report_value_is_verified(&report, device))
    }

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

    const DEVICE: &str = "11111111-2222-4333-8444-555555555555";
    const OTHER: &str = "66666666-7777-4888-8999-aaaaaaaaaaaa";

    fn report(state: &str, runs: &str) -> String {
        format!(r#"{{"state":"{state}","runs":{runs}}}"#)
    }

    fn run(device: &str, missing: &str) -> String {
        format!(r#"{{"deviceId":"{device}",{missing}}}"#)
    }

    #[test]
    fn matching_newest_run_with_verified_state_and_empty_missing_is_verified() {
        for state in ["verified", "removing", "removed"] {
            let runs = format!("[{}]", run(DEVICE, r#""missing":[]"#));
            assert!(report_is_verified(&report(state, &runs), DEVICE), "{state}");
        }
    }

    #[test]
    fn a_run_for_another_device_refuses() {
        let runs = format!("[{}]", run(OTHER, r#""missing":[]"#));
        assert!(!report_is_verified(&report("verified", &runs), DEVICE));
    }

    #[test]
    fn a_run_without_a_device_id_refuses() {
        let runs = r#"[{"missing":[]}]"#;
        assert!(!report_is_verified(&report("verified", runs), DEVICE));
    }

    #[test]
    fn the_newest_matching_run_decides_and_other_devices_runs_are_ignored() {
        let older_ok = run(DEVICE, r#""missing":[]"#);
        let newer_bad = run(DEVICE, r#""missing":["a"]"#);
        let newest_other = run(OTHER, r#""missing":[]"#);
        assert!(!report_is_verified(
            &report("verified", &format!("[{older_ok},{newer_bad}]")),
            DEVICE
        ));
        assert!(report_is_verified(
            &report("verified", &format!("[{older_ok},{newest_other}]")),
            DEVICE
        ));
    }

    #[test]
    fn a_matching_run_that_lists_missing_entries_refuses() {
        let runs = format!("[{}]", run(DEVICE, r#""missing":["a"]"#));
        assert!(!report_is_verified(&report("verified", &runs), DEVICE));
    }

    #[test]
    fn a_matching_run_without_a_missing_array_refuses() {
        let runs = format!("[{}]", run(DEVICE, ""));
        assert!(!report_is_verified(&report("verified", &runs), DEVICE));
        let runs = format!("[{}]", run(DEVICE, r#""missing":"a""#));
        assert!(!report_is_verified(&report("verified", &runs), DEVICE));
        let runs = format!("[{}]", run(DEVICE, r#""missing":null"#));
        assert!(!report_is_verified(&report("verified", &runs), DEVICE));
    }

    #[test]
    fn a_report_with_no_runs_or_another_state_or_unreadable_refuses() {
        assert!(!report_is_verified(&report("verified", "[]"), DEVICE));
        assert!(!report_is_verified(r#"{"state":"verified"}"#, DEVICE));
        let runs = format!("[{}]", run(DEVICE, r#""missing":[]"#));
        assert!(!report_is_verified(&report("incomplete", &runs), DEVICE));
        assert!(!report_is_verified("not json", DEVICE));
    }

    #[test]
    fn a_helper_error_refuses_local_and_native_data() {
        let (data, _) = temp("helper-error");
        let workspace = data.parent().unwrap_or(&data).join("ws-helper");
        let report_file = workspace.join(REPORT_097);
        fs::create_dir_all(report_file.parent().unwrap()).unwrap();
        let runs = format!("[{}]", run(DEVICE, r#""missing":[]"#));
        fs::write(&report_file, report("verified", &runs)).unwrap();
        let prefs = serde_json::json!({ "vault-root": workspace.to_string_lossy() });
        fs::write(data.join("preferences.json"), prefs.to_string()).unwrap();
        assert!(!local_data_verified(&data, None));
        assert!(local_data_verified(&data, Some(DEVICE)));

        let (pg, _) = temp("helper-error-pg");
        let link = serde_json::json!({ "folder": workspace.to_string_lossy() });
        fs::write(pg.join("exported-to.json"), link.to_string()).unwrap();
        assert!(!native_data_verified(&pg, None));
        assert!(native_data_verified(&pg, Some(DEVICE)));
    }

    #[test]
    fn local_data_is_verified_only_through_the_configured_workspace_report() {
        let (data, _) = temp("verified-report");
        let workspace = data.parent().unwrap_or(&data).join("ws");
        let report_file = workspace.join(REPORT_097);
        fs::create_dir_all(report_file.parent().unwrap()).unwrap();
        let runs = format!("[{}]", run(DEVICE, r#""missing":[]"#));
        fs::write(&report_file, report("verified", &runs)).unwrap();
        assert!(
            !local_data_verified(&data, Some(DEVICE)),
            "no prefs yet, so no workspace"
        );
        let prefs = serde_json::json!({ "vault-root": workspace.to_string_lossy() });
        fs::write(data.join("preferences.json"), prefs.to_string()).unwrap();
        assert!(local_data_verified(&data, Some(DEVICE)));
        assert!(!local_data_verified(&data, Some(OTHER)));
    }

    /// Writes `body` as `name` in the 0.9.7 migration folder under `folder`.
    fn put_report(folder: &Path, name: &str, body: &str) {
        let dir = folder.join(".weaveforge/migration-0.9.7");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(name), body).unwrap();
    }

    fn linked_pg(name: &str, folder: &Path) -> PathBuf {
        let (pg, _) = temp(name);
        let link = serde_json::json!({ "folder": folder.to_string_lossy() });
        fs::write(pg.join("exported-to.json"), link.to_string()).unwrap();
        pg
    }

    /// The 0.9.7 exporter writes only `report-<deviceId>.json`; that file alone proves the export.
    #[test]
    fn this_devices_own_report_file_alone_is_verified() {
        let (data, _) = temp("own-report");
        let workspace = data.parent().unwrap_or(&data).join("ws-own-report");
        let _ = fs::remove_dir_all(&workspace);
        let runs = format!("[{}]", run(DEVICE, r#""missing":[]"#));
        put_report(
            &workspace,
            &format!("report-{DEVICE}.json"),
            &report("verified", &runs),
        );
        let prefs = serde_json::json!({ "vault-root": workspace.to_string_lossy() });
        fs::write(data.join("preferences.json"), prefs.to_string()).unwrap();
        assert!(local_data_verified(&data, Some(DEVICE)));
        let pg = linked_pg("own-report-pg", &workspace);
        assert!(native_data_verified(&pg, Some(DEVICE)));
    }

    /// Another device's file never stands in for this one, even when it holds this device's run.
    #[test]
    fn another_devices_report_file_alone_is_not_verified() {
        let (pg, _) = temp("other-report-pg");
        let folder = pg.parent().unwrap_or(&pg).join("export-other-report");
        let _ = fs::remove_dir_all(&folder);
        let runs = format!(
            "[{},{}]",
            run(DEVICE, r#""missing":[]"#),
            run(OTHER, r#""missing":[]"#)
        );
        put_report(
            &folder,
            &format!("report-{OTHER}.json"),
            &report("verified", &runs),
        );
        let pg = linked_pg("other-report-link", &folder);
        assert!(!native_data_verified(&pg, Some(DEVICE)));
        assert!(native_data_verified(&pg, Some(OTHER)));
    }

    /// The own file decides when there is one; the legacy report.json counts only without it.
    #[test]
    fn the_own_report_file_beats_the_legacy_report() {
        let (pg, _) = temp("own-beats-legacy");
        let folder = pg.parent().unwrap_or(&pg).join("export-own-beats-legacy");
        let _ = fs::remove_dir_all(&folder);
        let ok = format!("[{}]", run(DEVICE, r#""missing":[]"#));
        let bad = format!("[{}]", run(DEVICE, r#""missing":["a"]"#));
        put_report(&folder, "report.json", &report("verified", &ok));
        let pg = linked_pg("own-beats-legacy-link", &folder);
        assert!(
            native_data_verified(&pg, Some(DEVICE)),
            "legacy alone counts"
        );
        put_report(
            &folder,
            &format!("report-{DEVICE}.json"),
            &report("verified", &bad),
        );
        assert!(!native_data_verified(&pg, Some(DEVICE)), "own file decides");
    }

    /// An unreadable own file is not verified, even beside a verified legacy report.
    #[test]
    fn an_unreadable_own_report_is_not_verified() {
        let (pg, _) = temp("own-unreadable");
        let folder = pg.parent().unwrap_or(&pg).join("export-own-unreadable");
        let _ = fs::remove_dir_all(&folder);
        let ok = format!("[{}]", run(DEVICE, r#""missing":[]"#));
        put_report(&folder, "report.json", &report("verified", &ok));
        put_report(&folder, &format!("report-{DEVICE}.json"), "not json");
        let pg = linked_pg("own-unreadable-link", &folder);
        assert!(!native_data_verified(&pg, Some(DEVICE)));
    }

    #[test]
    fn native_data_is_verified_through_the_export_folder_it_names() {
        let (pg, _) = temp("native-report");
        let folder = pg.parent().unwrap_or(&pg).join("export");
        let report_file = folder.join(REPORT_097);
        fs::create_dir_all(report_file.parent().unwrap()).unwrap();
        let runs = format!("[{}]", run(DEVICE, r#""missing":[]"#));
        fs::write(&report_file, report("verified", &runs)).unwrap();
        assert!(
            !native_data_verified(&pg, Some(DEVICE)),
            "no exported-to.json yet"
        );
        let link = serde_json::json!({ "folder": folder.to_string_lossy() });
        fs::write(pg.join("exported-to.json"), link.to_string()).unwrap();
        assert!(native_data_verified(&pg, Some(DEVICE)));
        fs::write(&report_file, report("incomplete", &runs)).unwrap();
        assert!(!native_data_verified(&pg, Some(DEVICE)));
    }
}

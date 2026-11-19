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
}

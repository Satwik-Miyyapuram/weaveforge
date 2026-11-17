//! First start after the Electron app: copy its data into the new data dir, once.
//!
//! Ported from the removed Node sidecar's `migrate.ts`; runs before the database opens, so it never opens a
//! half-copied one. Same markers and lock names as the older apps, so their runs count here too.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use wf_core::sync::folder_layout::WORKSPACE_META_DIR;

use crate::db_lock::{self, LockError};
use crate::vault::iso_utc;

/// Written into the new data dir when the copy is complete; its presence means "never again".
pub const DONE_MARKER: &str = "migrated-from-electron";

/// Written into the new data dir once the copy is published. The old Electron dir is never written to.
pub const MIGRATED_MARKER: &str = "migrated";

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

const STAGING_DIR: &str = ".migrating";
const LOCK_APP: &str = "weaveforge-migration";

/// What a run did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// An earlier run finished.
    Already,
    /// Electron left nothing to copy.
    Nothing,
    /// Electron is running; nothing was copied.
    Busy(String),
    /// These items were copied.
    Done(Vec<String>),
}

/// Copies Electron's data into `new_dir` once.
///
/// # Errors
/// Any I/O failure; the caller must not open a database then.
pub fn migrate_from_electron(
    old_dir: &Path,
    new_dir: &Path,
    now: SystemTime,
) -> io::Result<Outcome> {
    assert_separate(old_dir, new_dir)?;
    let present: Vec<&str> = ITEMS
        .into_iter()
        .filter(|i| old_dir.join(i).exists())
        .collect();
    if new_dir.join(DONE_MARKER).exists() && !marker_allows_retry(new_dir, !present.is_empty()) {
        return Ok(Outcome::Already);
    }
    if present.is_empty() {
        write_done_marker(old_dir, new_dir, now, &[])?;
        return Ok(Outcome::Nothing);
    }
    let _locks = match take_locks(&db_dirs_to_lock(old_dir), now)? {
        Ok(locks) => locks,
        Err(reason) => return Ok(Outcome::Busy(reason)),
    };
    // Markers are written while Electron is still locked out, so it cannot change its data unwarned in between.
    let copied = stage_and_publish(old_dir, new_dir, &present, now)?;
    write_done_marker(old_dir, new_dir, now, &copied)?;
    Ok(Outcome::Done(copied))
}

/// Locks held on Electron's database dirs; released on drop, so an error or panic never leaves one behind.
struct Locks(Vec<PathBuf>);

impl Drop for Locks {
    fn drop(&mut self) {
        for dir in &self.0 {
            db_lock::release(dir);
        }
    }
}

/// Lexical absolute form: `.` and `..` resolved without touching the disk, as Node's `path.resolve` does.
fn resolve(path: &Path) -> io::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut out = PathBuf::new();
    for part in absolute.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = out.pop();
            }
            other => out.push(other),
        }
    }
    Ok(out)
}

/// Refuses a new dir that is the old dir or inside it: the rename-aside step would move Electron's own data.
fn assert_separate(old_dir: &Path, new_dir: &Path) -> io::Result<()> {
    let (old, new) = (resolve(old_dir)?, resolve(new_dir)?);
    let inside = if cfg!(windows) {
        let lower = |p: &Path| p.to_string_lossy().to_lowercase().replace('/', "\\");
        let (old, new) = (lower(&old), lower(&new));
        new == old || new.starts_with(&format!("{}\\", old.trim_end_matches('\\')))
    } else {
        new.starts_with(&old)
    };
    if inside {
        return Err(io::Error::other(
            "the new data dir must not be the old app's data dir or inside it",
        ));
    }
    Ok(())
}

/// Electron's live database dirs: its own, plus the workspace database when preferences name one.
fn db_dirs_to_lock(old_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![old_dir.join("local-db")];
    dirs.extend(workspace_db_dir(old_dir));
    dirs
}

fn workspace_db_dir(old_dir: &Path) -> Option<PathBuf> {
    let db = configured_root(old_dir)?
        .join(WORKSPACE_META_DIR)
        .join("db");
    db.exists().then_some(db)
}

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

/// Locks each dir. `Ok(Err(reason))` when one is busy, after releasing the ones taken.
fn take_locks(dirs: &[PathBuf], now: SystemTime) -> io::Result<Result<Locks, String>> {
    let mut taken = Locks(Vec::new());
    for dir in dirs {
        match db_lock::acquire(dir, LOCK_APP, now) {
            Ok(()) => taken.0.push(dir.clone()),
            Err(error @ LockError::InUse { .. }) => return Ok(Err(error.to_string())),
            Err(LockError::Io(e)) => return Err(e),
        }
    }
    Ok(Ok(taken))
}

/// A copy that wrote fewer bytes than the source holds is a failed copy: the migration must stop
/// rather than publish a truncated file as if it had moved.
fn check_copied(to: &Path, copied: u64, want: u64) -> io::Result<()> {
    if copied == want {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::UnexpectedEof,
        format!(
            "copy to {} wrote {copied} of {want} bytes",
            to.display()
        ),
    ))
}

/// `fs.cpSync` with `errorOnExist`, `force: false`, `preserveTimestamps`: never overwrites; files keep their times;
/// symlinks are recreated as links, not followed (so a loop or a dangling link cannot break the copy).
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(from)?;
    if meta.is_symlink() {
        return copy_link(from, to);
    }
    if meta.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if to.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("{} exists", to.display()),
        ));
    }
    let copied = fs::copy(from, to)?;
    check_copied(to, copied, meta.len())?;
    let mut times = fs::FileTimes::new().set_modified(meta.modified()?);
    if let Ok(accessed) = meta.accessed() {
        times = times.set_accessed(accessed);
    }
    open_for_times(to)?.set_times(times)
}

/// Opens a file only to set its times, so a read-only copy (`fs::copy` keeps the read-only bit) still works.
fn open_for_times(path: &Path) -> io::Result<fs::File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_WRITE_ATTRIBUTES: u32 = 0x100;
        fs::OpenOptions::new()
            .access_mode(FILE_WRITE_ATTRIBUTES)
            .open(path)
    }
    #[cfg(not(windows))]
    {
        fs::File::open(path)
    }
}

fn copy_link(from: &Path, to: &Path) -> io::Result<()> {
    let target = fs::read_link(from)?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, to)
    }
    #[cfg(windows)]
    {
        if fs::metadata(from).is_ok_and(|m| m.is_dir()) {
            std::os::windows::fs::symlink_dir(&target, to)
        } else {
            std::os::windows::fs::symlink_file(&target, to)
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, to);
        Err(io::Error::other("symlinks are not supported here"))
    }
}

/// Removes `dir` and everything in it; a missing dir is fine.
fn remove_tree(dir: &Path) -> io::Result<()> {
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Copies the items into a staging dir, then renames them into place only once every copy succeeded.
/// An item already in `new_dir` comes from a run that crashed before the done marker, or was written by the new
/// app before migrating; Electron may have changed it since, so its current copy wins and the old one is kept
/// aside, never deleted.
fn stage_and_publish(
    old_dir: &Path,
    new_dir: &Path,
    present: &[&str],
    now: SystemTime,
) -> io::Result<Vec<String>> {
    let staging = new_dir.join(STAGING_DIR);
    remove_tree(&staging)?;
    fs::create_dir_all(&staging)?;
    for item in present {
        copy_tree(&old_dir.join(item), &staging.join(item))?;
    }
    // The old dir is only read, never marked: the Electron app must stay byte-identical so a rollback works.
    let at = iso_utc(now);
    let marker = serde_json::json!({ "to": new_dir.to_string_lossy(), "at": at });
    fs::create_dir_all(new_dir)?;
    fs::write(new_dir.join(MIGRATED_MARKER), marker.to_string())?;
    let aside = new_dir
        .join(".pre-migration")
        .join(at.replace([':', '.'], "-"));
    for item in present {
        let existing = new_dir.join(item);
        if existing.exists() {
            fs::create_dir_all(&aside)?;
            fs::rename(&existing, aside.join(item))?;
        }
        fs::rename(staging.join(item), &existing)?;
    }
    remove_tree(&staging)?;
    Ok(present.iter().map(|i| (*i).to_owned()).collect())
}

/// Whether an existing done marker still lets a run copy. A marker that copied something is final. A marker
/// that copied nothing (an earlier start found no data) is retried once Electron's data is there. An unreadable
/// marker stays final, as before.
fn marker_allows_retry(new_dir: &Path, source_has_data: bool) -> bool {
    let Some(marker) = fs::read_to_string(new_dir.join(DONE_MARKER))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    else {
        return false;
    };
    let copied_nothing = marker["copied"].as_array().is_some_and(Vec::is_empty);
    copied_nothing && source_has_data
}

/// Written last, atomically, so a crash before it means the next start copies again.
fn write_done_marker(
    old_dir: &Path,
    new_dir: &Path,
    now: SystemTime,
    copied: &[String],
) -> io::Result<()> {
    fs::create_dir_all(new_dir)?;
    let file = new_dir.join(DONE_MARKER);
    let body = serde_json::json!({
        "from": old_dir.to_string_lossy(),
        "at": iso_utc(now),
        "copied": copied,
        "secretsLeftBehind": old_dir.join("secrets.json").exists(),
    });
    let tmp = new_dir.join(format!("{DONE_MARKER}.tmp"));
    fs::write(&tmp, body.to_string())?;
    fs::rename(tmp, file)
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

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap_or_default()
    }

    /// Every file under `dir` with its bytes, sorted, so a before/after compare catches any write.
    fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(d) = stack.pop() {
            for entry in fs::read_dir(&d).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    out.push((path.clone(), fs::read(&path).unwrap_or_default()));
                }
            }
        }
        out.sort();
        out
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
    fn a_short_copy_is_an_error_and_a_full_one_passes() {
        let (dir, _) = temp("copy-check");
        let to = dir.join("file.bin");
        assert!(check_copied(&to, 10, 10).is_ok());
        let err = check_copied(&to, 4, 10).expect_err("a truncated copy must fail");
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
        assert!(err.to_string().contains("4 of 10"));
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

    /// Writes a done marker as an earlier run would have, with `copied` items.
    fn write_marker(new: &Path, from: &Path, copied: &[&str]) {
        let _ = fs::create_dir_all(new);
        let body = serde_json::json!({
            "from": from.to_string_lossy(),
            "at": "2026-11-01T00:00:00.000Z",
            "copied": copied,
            "secretsLeftBehind": false,
        });
        let _ = fs::write(new.join(DONE_MARKER), body.to_string());
    }

    #[test]
    fn empty_marker_from_a_missing_source_is_retried_when_data_exists() {
        // The reported bug: the first start found no data at the wrong dir and wrote an empty marker,
        // which then blocked every later run.
        let (old, new) = temp("retry");
        let _ = fs::create_dir_all(old.join("local-db"));
        write_marker(&new, &old.join("missing"), &[]);
        assert!(matches!(
            migrate_from_electron(&old, &new, SystemTime::now()),
            Ok(Outcome::Done(ref items)) if items == &["local-db".to_owned()]
        ));
        assert!(new.join("local-db").exists());
    }

    #[test]
    fn retry_never_touches_the_native_database() {
        // The native database (`local-pg`) may already hold the user's data, even an empty one from a bad
        // first start. The file copy only writes PGlite and prefs items, so `local-pg` stays byte-identical.
        let (old, new) = temp("retry-native");
        let _ = fs::create_dir_all(old.join("local-db"));
        let _ = fs::create_dir_all(new.join("local-pg"));
        let _ = fs::write(new.join("local-pg").join("PG_VERSION"), "18");
        write_marker(&new, &old.join("missing"), &[]);
        assert!(matches!(
            migrate_from_electron(&old, &new, SystemTime::now()),
            Ok(Outcome::Done(_))
        ));
        assert_eq!(read(&new.join("local-pg").join("PG_VERSION")), "18");
        assert!(!new.join("local-pg").join("local-db").exists());
    }

    #[test]
    fn non_empty_marker_still_blocks_a_rerun() {
        let (old, new) = temp("retry-done");
        let _ = fs::create_dir_all(old.join("local-db"));
        write_marker(&new, &old, &["local-db"]);
        assert_eq!(
            migrate_from_electron(&old, &new, SystemTime::now()).ok(),
            Some(Outcome::Already)
        );
    }

    #[test]
    fn broken_pglite_backup_dirs_are_not_copied() {
        let (old, new) = temp("broken");
        let _ = fs::create_dir_all(old.join("local-db.broken-1700000000"));
        let _ = fs::write(
            old.join("local-db.broken-1700000000").join("PG_VERSION"),
            "16",
        );
        let _ = fs::write(old.join("preferences.json"), "{}");
        assert_eq!(
            migrate_from_electron(&old, &new, SystemTime::now()).ok(),
            Some(Outcome::Done(vec!["preferences.json".into()]))
        );
        assert!(!new.join("local-db.broken-1700000000").exists());
    }

    #[test]
    fn preferences_carry_the_vault_root_over() {
        let (old, new) = temp("prefs");
        let prefs = serde_json::json!({ "vault-root": "C:\\Users\\Ada\\Vault", "vault-git": true });
        let _ = fs::write(old.join("preferences.json"), prefs.to_string());
        assert!(migrate_from_electron(&old, &new, SystemTime::now()).is_ok());
        let copied: serde_json::Value =
            serde_json::from_str(&read(&new.join("preferences.json"))).unwrap_or_default();
        assert_eq!(copied, prefs);
    }

    #[test]
    fn nothing_to_copy_writes_marker_then_already() {
        let (old, new) = temp("nothing");
        assert_eq!(
            migrate_from_electron(&old, &new, SystemTime::now()).ok(),
            Some(Outcome::Nothing)
        );
        assert!(new.join(DONE_MARKER).exists());
        assert_eq!(
            migrate_from_electron(&old, &new, SystemTime::now()).ok(),
            Some(Outcome::Already)
        );
    }

    #[test]
    fn copies_items_keeps_secrets_behind_and_marks_both_dirs() {
        let (old, new) = temp("done");
        let _ = fs::create_dir_all(old.join("local-db").join("base"));
        let _ = fs::write(old.join("local-db").join("base").join("1"), "pg");
        let _ = fs::write(old.join("preferences.json"), "{}");
        let _ = fs::write(old.join("secrets.json"), "sealed");
        let before = snapshot(&old);
        let outcome = migrate_from_electron(&old, &new, SystemTime::now()).ok();
        assert_eq!(
            snapshot(&old),
            before,
            "old Electron dir must be byte-identical"
        );
        assert_eq!(
            outcome,
            Some(Outcome::Done(vec![
                "local-db".into(),
                "preferences.json".into()
            ]))
        );
        assert_eq!(read(&new.join("local-db").join("base").join("1")), "pg");
        assert!(!new.join("secrets.json").exists());
        assert!(!new.join(STAGING_DIR).exists());
        assert!(
            !old.join(MIGRATED_MARKER).exists(),
            "old dir gets no marker"
        );
        assert!(
            new.join(MIGRATED_MARKER).exists(),
            "marker lives in new dir"
        );
        assert!(
            old.join("local-db").exists(),
            "old data is copied, never moved"
        );
        let marker: serde_json::Value =
            serde_json::from_str(&read(&new.join(DONE_MARKER))).unwrap_or_default();
        assert_eq!(marker["secretsLeftBehind"], serde_json::Value::Bool(true));
        assert_eq!(
            marker["copied"],
            serde_json::json!(["local-db", "preferences.json"])
        );
    }

    #[test]
    fn existing_new_item_is_moved_aside_not_deleted() {
        let (old, new) = temp("aside");
        let _ = fs::write(old.join("preferences.json"), "old-app");
        let _ = fs::create_dir_all(&new);
        let _ = fs::write(new.join("preferences.json"), "new-app");
        assert!(matches!(
            migrate_from_electron(&old, &new, SystemTime::now()),
            Ok(Outcome::Done(_))
        ));
        assert_eq!(read(&new.join("preferences.json")), "old-app");
        let aside: Vec<PathBuf> = fs::read_dir(new.join(".pre-migration"))
            .map(|d| d.filter_map(Result::ok).map(|e| e.path()).collect())
            .unwrap_or_default();
        assert_eq!(aside.len(), 1);
        assert!(aside.iter().all(|a| {
            !a.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .contains(':')
        }));
        assert_eq!(
            aside.first().map(|a| read(&a.join("preferences.json"))),
            Some("new-app".into())
        );
    }

    #[test]
    fn copy_keeps_file_modified_time() {
        let (old, new) = temp("mtime");
        let file = old.join("weaveforge.log");
        let _ = fs::write(&file, "log");
        let then = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        let _ = fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .and_then(|f| f.set_times(fs::FileTimes::new().set_modified(then)));
        assert!(migrate_from_electron(&old, &new, SystemTime::now()).is_ok());
        let copied = fs::metadata(new.join("weaveforge.log"))
            .and_then(|m| m.modified())
            .ok();
        assert_eq!(copied, Some(then));
    }

    #[test]
    fn read_only_file_is_copied_with_its_time() {
        let (old, new) = temp("readonly");
        let file = old.join("weaveforge.log");
        let _ = fs::write(&file, "log");
        let then = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        let _ = fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .and_then(|f| f.set_times(fs::FileTimes::new().set_modified(then)));
        let set_read_only = |p: &Path, on: bool| {
            if let Ok(meta) = fs::metadata(p) {
                let mut perms = meta.permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                perms.set_readonly(on);
                let _ = fs::set_permissions(p, perms);
            }
        };
        set_read_only(&file, true);
        let outcome = migrate_from_electron(&old, &new, SystemTime::now());
        let copied = new.join("weaveforge.log");
        let time = fs::metadata(&copied).and_then(|m| m.modified()).ok();
        set_read_only(&file, false);
        set_read_only(&copied, false);
        assert!(outcome.is_ok(), "{outcome:?}");
        assert_eq!(time, Some(then));
    }

    #[test]
    fn busy_lock_copies_nothing_and_releases_taken_locks() {
        let (old, new) = temp("busy");
        let _ = fs::create_dir_all(old.join("local-db"));
        let workspace = old.parent().map(|p| p.join("vault")).unwrap_or_default();
        let ws_db = workspace.join(WORKSPACE_META_DIR).join("db");
        let _ = fs::create_dir_all(&ws_db);
        let prefs = serde_json::json!({ "vault-root": workspace.to_string_lossy() });
        let _ = fs::write(old.join("preferences.json"), prefs.to_string());
        // An unwritten lock is held by "Another WeaveForge" for the write grace.
        let _ = fs::write(db_lock::lock_path(&ws_db), "");
        match migrate_from_electron(&old, &new, SystemTime::now()) {
            Ok(Outcome::Busy(reason)) => assert!(reason.contains("Another WeaveForge"), "{reason}"),
            other => panic!("expected Busy, got {other:?}"),
        }
        assert!(
            !db_lock::lock_path(&old.join("local-db")).exists(),
            "first lock released"
        );
        assert!(!new.join(DONE_MARKER).exists());
    }

    #[test]
    fn new_dir_inside_old_dir_is_refused() {
        let (old, _) = temp("inside");
        assert!(migrate_from_electron(&old, &old, SystemTime::now()).is_err());
        assert!(migrate_from_electron(&old, &old.join("sub"), SystemTime::now()).is_err());
        assert!(
            migrate_from_electron(&old, &old.join("sub").join(".."), SystemTime::now()).is_err()
        );
        let sibling = PathBuf::from(format!("{}-new", old.display()));
        assert!(migrate_from_electron(&old, &sibling, SystemTime::now()).is_ok());
    }
}

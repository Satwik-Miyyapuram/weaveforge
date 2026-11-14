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

/// Written into the old dir once the copy is published, so Electron warns that its data has moved.
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
    if new_dir.join(DONE_MARKER).exists() {
        return Ok(Outcome::Already);
    }
    let present: Vec<&str> = ITEMS
        .into_iter()
        .filter(|i| old_dir.join(i).exists())
        .collect();
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
    let text = fs::read_to_string(old_dir.join("preferences.json")).ok()?;
    let prefs: serde_json::Value = serde_json::from_str(&text).ok()?;
    let root = prefs
        .get("vault-root")?
        .as_str()
        .filter(|r| !r.is_empty())?;
    let db = Path::new(root).join(WORKSPACE_META_DIR).join("db");
    db.exists().then_some(db)
}

/// The old PGlite database to copy into the native one: the workspace's when it holds one
/// (Electron moves it there once a folder is chosen), else the app's own `local-db`.
#[must_use]
pub fn old_pglite_dir(data_dir: &Path) -> Option<PathBuf> {
    let is_db = |dir: &PathBuf| dir.join("PG_VERSION").is_file();
    workspace_db_dir(data_dir)
        .filter(is_db)
        .or_else(|| Some(data_dir.join("local-db")).filter(is_db))
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
    let _bytes = fs::copy(from, to)?;
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
    // From the first rename on, Electron warns that its data has moved.
    let at = iso_utc(now);
    let marker = serde_json::json!({ "to": new_dir.to_string_lossy(), "at": at });
    fs::write(old_dir.join(MIGRATED_MARKER), marker.to_string())?;
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

    /// An app data dir whose prefs name `workspace`, with a database in each place asked for.
    fn data_with(name: &str, app_db: bool, ws_db: bool) -> (PathBuf, PathBuf) {
        let (data, _) = temp(name);
        let workspace = data.parent().map(|p| p.join("ws")).unwrap_or_default();
        let prefs = serde_json::json!({ "vault-root": workspace.to_string_lossy() });
        let _ = fs::write(data.join("preferences.json"), prefs.to_string());
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
        let outcome = migrate_from_electron(&old, &new, SystemTime::now()).ok();
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
        assert!(old.join(MIGRATED_MARKER).exists());
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

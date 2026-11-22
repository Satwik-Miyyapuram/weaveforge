//! "Remove old data" (0.9.7): deletes the app's local Postgres data dir, only after a verified
//! migration with a non-empty backup, for the folder the export wrote. Refuses if any reparse
//! point (junction, symlink) sits in or is the data dir.
//!
//! State machine in report.json: `verified` -> `removing` (cluster stopped, `removingDeviceId`
//! names the device that started it, deletion started) -> `removed` (with `removedAt`). A
//! `removing` report resumes deletion only on the device that started it, or when the data dir is
//! already gone; any other device runs the full checks before it takes over.

use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use crate::local_http::control::parse_iso_ms;

const REPORT_REL: &str = ".weaveforge/migration-0.9.7/report.json";
pub(super) const MIGRATION_DIR: &str = ".weaveforge/migration-0.9.7";
/// Backup name for reports written before the `backup` field existed.
const DEFAULT_BACKUP: &str = "pre-migration.dump";
const EXPORTED_TO: &str = "exported-to.json";
const DUMP_MAGIC: &[u8] = b"PGDMP";
/// Magic (5 bytes), archive major, minor, revision, int size, offset size, format.
const HEADER_LEN: usize = 11;
/// A custom-format dump always holds at least its table of contents; shorter files are not dumps.
const MIN_DUMP_BYTES: u64 = 256;
const VERIFY_WINDOW_MS: u64 = 600_000;
const NOTHING_TO_REMOVE: &str =
    "refused: nothing to remove (no verified migration backup or run in the report)";

/// Per-device secrets count file (written by the KEYS lane once every local secret is in the
/// keychain): `{count, deviceId}`.
fn secrets_rel(device_id: &str) -> String {
    format!("{MIGRATION_DIR}/secrets-moved-{device_id}.json")
}

/// Records in `pg_root/exported-to.json` that the export wrote `folder` (called by the KEYS lane
/// after a successful export).
pub fn record_exported_to(pg_root: &Path, folder: &Path) -> Result<(), String> {
    let folder = canonical(folder)?;
    fs::create_dir_all(pg_root).map_err(|e| format!("cannot create {}: {e}", pg_root.display()))?;
    write_json_atomic(
        &pg_root.join(EXPORTED_TO),
        &serde_json::json!({ "folder": folder }),
    )
}

/// The dump file this device's run names (`runs[].backup`, else the report's `backup`), as a plain
/// name inside the migration folder. A report without either field predates it and uses
/// `pre-migration.dump`. A null field has nothing to remove. A name with a path separator or `..`
/// is refused.
pub fn backup_name(report: &serde_json::Value, device_id: &str) -> Result<String, String> {
    let own = own_run(report, device_id).ok().and_then(|run| run.get("backup"));
    let value = match own.or_else(|| report.get("backup")) {
        None => return Ok(DEFAULT_BACKUP.to_owned()),
        Some(value) if value.is_null() => return Err(NOTHING_TO_REMOVE.to_owned()),
        Some(value) => value,
    };
    let name = value.as_str().unwrap_or("");
    let mut parts = Path::new(name).components();
    let plain = !name.is_empty()
        && !name.contains(['/', '\\'])
        && matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None));
    if plain {
        Ok(name.to_owned())
    } else {
        Err(format!("refused: backup name {name:?} is not a plain file name"))
    }
}

/// Stops the local cluster through `stop_pg`, then deletes `pg_root`. Refuses (touching nothing)
/// unless report.json says `verified` (or resumes a `removing` report this device started),
/// the report has at least one run, the backup it names is a non-empty dump, this device's newest
/// run is verified with no missing items and db == files for every kind, and (unless resuming)
/// that run finished at most 10 minutes before `now`, `pg_root/exported-to.json` names this
/// folder, the per-device `secrets-moved-<deviceId>.json` covers every `local_secrets` row, and
/// neither `pg_root` nor anything inside it is a reparse point. Ends with state `removed` and
/// `removedAt = now`.
///
/// `local_secrets_rows` runs while Postgres is still up, only when not resuming. A resume skips it
/// because Postgres is already down; it still needs the per-device secrets file.
pub fn remove_old_data(
    folder: &Path,
    pg_root: &Path,
    now: &str,
    device_id: &str,
    local_secrets_rows: &mut dyn FnMut() -> Result<u64, String>,
    stop_pg: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let report_path = folder.join(REPORT_REL);
    let mut report = read_report(&report_path)?;
    let state = report["state"].as_str().unwrap_or("").to_owned();
    match state.as_str() {
        "verified" | "removing" => {}
        "removed" => return Err("refused: old data already removed".to_owned()),
        other => {
            return Err(format!(
                "refused: migration state is not verified (report state: {other})"
            ))
        }
    }
    match report["runs"].as_array() {
        Some(runs) if !runs.is_empty() => {}
        _ => return Err(NOTHING_TO_REMOVE.to_owned()),
    }
    let backup = backup_name(&report, device_id)?;
    check_backup(folder, &backup)?;
    if !own_run_missing(&report, device_id)?.is_empty() {
        return Err("refused: report lists missing items".to_owned());
    }
    check_own_run_verdict(&report, device_id)?;
    // Only the device that started the removal resumes it; any other device runs the full checks.
    let resume = state == "removing" && report["removingDeviceId"].as_str() == Some(device_id);
    if !resume {
        check_fresh_run(&report, device_id, now)?;
        check_exported_to(pg_root, folder)?;
    }
    let moved = read_secrets_moved(folder, device_id)?;
    if pg_root.exists() {
        if is_reparse(&fs::symlink_metadata(pg_root).map_err(|e| e.to_string())?) {
            return Err(format!(
                "refused: local cluster root is a link or junction: {}",
                pg_root.display()
            ));
        }
        if let Some(link) = find_reparse_point(pg_root)? {
            return Err(format!(
                "refused: reparse point (link or junction) inside local cluster: {}",
                link.display()
            ));
        }
    }
    let backups = backups_dir(pg_root);
    if backups.exists() {
        if is_reparse(&fs::symlink_metadata(&backups).map_err(|e| e.to_string())?) {
            return Err(format!(
                "refused: local-db-backups is a link or junction: {}",
                backups.display()
            ));
        }
        if let Some(link) = find_reparse_point(&backups)? {
            return Err(format!(
                "refused: reparse point (link or junction) inside local-db-backups: {}",
                link.display()
            ));
        }
    }
    if !resume {
        let local_rows = local_secrets_rows()?;
        check_secrets_count(moved, local_rows)?;
        stop_pg()?;
        report["state"] = "removing".into();
        report["removingDeviceId"] = device_id.into();
        write_json_atomic(&report_path, &report)?;
    }
    if pg_root.join("data").join("postmaster.pid").exists() {
        return Err(
            "refused: postgres still running (data/postmaster.pid present); stop it, then remove again"
                .to_owned(),
        );
    }
    mark_removed(pg_root)?;
    if pg_root.exists() {
        fs::remove_dir_all(pg_root)
            .map_err(|e| format!("cannot delete {}: {e}", pg_root.display()))?;
    }
    let backups = backups_dir(pg_root);
    if backups.exists() {
        fs::remove_dir_all(&backups)
            .map_err(|e| format!("cannot delete {}: {e}", backups.display()))?;
    }
    report["state"] = "removed".into();
    report["removedAt"] = now.into();
    write_json_atomic(&report_path, &report)
}

/// Name of the marker, in app data beside `local-pg`, that says the old cluster was removed.
const MARKER: &str = "old-db-removed";

/// Whether the old local cluster was removed on this device. Start skips the local database then,
/// so a relaunch never restores the cluster from `local-db-backups`.
#[must_use]
pub fn old_db_removed(pg_root: &Path) -> bool {
    marker_path(pg_root).exists()
}

fn marker_path(pg_root: &Path) -> std::path::PathBuf {
    pg_root.parent().unwrap_or(pg_root).join(MARKER)
}

/// Old local-db backups sit beside the cluster and go with it on removal.
fn backups_dir(pg_root: &Path) -> std::path::PathBuf {
    pg_root.parent().unwrap_or(pg_root).join("local-db-backups")
}

/// Writes the marker before anything is deleted; an existing marker is kept.
fn mark_removed(pg_root: &Path) -> Result<(), String> {
    let path = marker_path(pg_root);
    match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(format!("cannot write {}: {e}", path.display())),
    }
}

/// This device's newest run: the last entry of `runs` whose `deviceId` is `device_id`. A run from
/// another device never counts; no run from this device refuses.
pub(super) fn own_run<'a>(report: &'a serde_json::Value, device_id: &str) -> Result<&'a serde_json::Value, String> {
    let runs = report["runs"]
        .as_array()
        .ok_or("refused: report has no runs; verify again")?;
    runs.iter()
        .rev()
        .find(|run| run["deviceId"].as_str() == Some(device_id))
        .ok_or_else(|| "refused: no verify run from this device; verify again".to_owned())
}

/// The `missing` kinds of this device's newest run (see `own_run`).
pub fn own_run_missing(
    report: &serde_json::Value,
    device_id: &str,
) -> Result<Vec<String>, String> {
    let own = own_run(report, device_id)?;
    let items = own["missing"]
        .as_array()
        .ok_or("refused: verify run has no missing list; verify again")?;
    Ok(items
        .iter()
        .map(|item| item["kind"].as_str().unwrap_or("?").to_owned())
        .collect())
}

/// This device's newest run must have finished `verified`, list at least one kind, and have the
/// same db and files count for every kind. An aborted run or an empty kinds map is not a verify.
fn check_own_run_verdict(report: &serde_json::Value, device_id: &str) -> Result<(), String> {
    let run = own_run(report, device_id)?;
    if run["state"].as_str() != Some("verified") {
        return Err(
            "refused: this device's verify run did not finish (not verified); verify again"
                .to_owned(),
        );
    }
    let kinds = match run["kinds"].as_object() {
        Some(kinds) if !kinds.is_empty() => kinds,
        _ => return Err("refused: verify run has no kinds to compare; verify again".to_owned()),
    };
    let show = |n: Option<u64>| n.map_or("?".to_owned(), |n| n.to_string());
    for (kind, counts) in kinds {
        let db = counts["db"].as_u64();
        let files = counts["files"].as_u64();
        if db.is_none() || db != files {
            return Err(format!(
                "refused: {kind} count differs between database and files (db {}, files {}); verify again",
                show(db),
                show(files)
            ));
        }
    }
    Ok(())
}

/// This device's own verify run must have finished at most `VERIFY_WINDOW_MS` before removal. The
/// top-level `verifiedAt` is not used: another device sharing the folder overwrites it.
fn check_fresh_run(report: &serde_json::Value, device_id: &str, now: &str) -> Result<(), String> {
    let verified = own_run(report, device_id)?["finishedAt"]
        .as_str()
        .and_then(parse_iso_ms)
        .ok_or("refused: this device's verify run has no readable finishedAt; verify again")?;
    let now = parse_iso_ms(now).ok_or("refused: current time is unreadable")?;
    let age = i128::from(now) - i128::from(verified);
    if age < 0 {
        return Err(
            "refused: verify run finished in the future; check the device clock, then verify again"
                .to_owned(),
        );
    }
    if age > i128::from(VERIFY_WINDOW_MS) {
        return Err(format!(
            "refused: verification is stale ({} s old, limit {} s); verify again",
            age / 1000,
            VERIFY_WINDOW_MS / 1000
        ));
    }
    Ok(())
}

fn canonical(path: &Path) -> Result<String, String> {
    fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("cannot resolve {}: {e}", path.display()))
}

fn read_report(path: &Path) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(path).map_err(|_| {
        "refused: no migration report (state none); migration must be verified first".to_owned()
    })?;
    serde_json::from_str(&text).map_err(|_| "refused: migration report is unparsable".to_owned())
}

/// Header-only check of the named backup: reads the first bytes and the length, never the whole dump.
fn check_backup(folder: &Path, name: &str) -> Result<(), String> {
    let mut file = fs::File::open(folder.join(MIGRATION_DIR).join(name))
        .map_err(|_| "refused: migration backup is missing".to_owned())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len == 0 {
        return Err("refused: migration backup is empty".to_owned());
    }
    let not_dump = "refused: migration backup is not a PostgreSQL dump";
    let mut header = [0u8; HEADER_LEN];
    file.read_exact(&mut header)
        .map_err(|_| not_dump.to_owned())?;
    if !valid_custom_header(&header) {
        return Err(not_dump.to_owned());
    }
    if len < MIN_DUMP_BYTES {
        return Err("refused: migration backup is too short to be a PostgreSQL dump".to_owned());
    }
    Ok(())
}

/// PGDMP magic, archive major version 1, int and offset sizes 1..=8, format 1 (custom).
fn valid_custom_header(header: &[u8; HEADER_LEN]) -> bool {
    header.starts_with(DUMP_MAGIC)
        && header[5] == 1
        && (1..=8).contains(&header[8])
        && (1..=8).contains(&header[9])
        && header[10] == 1
}

fn check_exported_to(pg_root: &Path, folder: &Path) -> Result<(), String> {
    let text = fs::read_to_string(pg_root.join(EXPORTED_TO))
        .map_err(|_| "refused: exported-to.json is missing".to_owned())?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| "refused: exported-to.json is unparsable".to_owned())?;
    if value["folder"].as_str() != Some(canonical(folder)?.as_str()) {
        return Err("refused: exported-to.json names another folder".to_owned());
    }
    Ok(())
}

/// Reads `count` from this device's `secrets-moved-<deviceId>.json`. Missing, unparsable or
/// count-less files refuse, and so does a file that names no `deviceId` or another device's.
fn read_secrets_moved(folder: &Path, device_id: &str) -> Result<u64, String> {
    let text = fs::read_to_string(folder.join(secrets_rel(device_id)))
        .map_err(|_| "refused: secrets-moved file for this device is missing".to_owned())?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| "refused: secrets-moved file is unparsable".to_owned())?;
    let count = value["count"]
        .as_u64()
        .ok_or_else(|| "refused: secrets-moved file has no count".to_owned())?;
    match value["deviceId"].as_str() {
        Some(id) if id == device_id => Ok(count),
        Some(_) => Err("refused: secrets-moved file was written by another device".to_owned()),
        None => Err("refused: secrets-moved file has no deviceId".to_owned()),
    }
}

fn check_secrets_count(moved: u64, local_rows: u64) -> Result<(), String> {
    if moved < local_rows {
        return Err(format!(
            "refused: secrets moved ({moved}) is less than local_secrets rows ({local_rows})"
        ));
    }
    Ok(())
}

/// Writes JSON to `path` via `path.part`, fsyncs, then renames over the target.
fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let part = PathBuf::from(format!("{}.part", path.display()));
    let mut file =
        fs::File::create(&part).map_err(|e| format!("cannot write {}: {e}", part.display()))?;
    file.write_all(value.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&part, path).map_err(|e| format!("cannot replace {}: {e}", path.display()))
}

/// Walks `root` without following links. Returns the first entry that is a symlink, junction or
/// has the Windows reparse-point attribute.
fn find_reparse_point(root: &Path) -> Result<Option<PathBuf>, String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries =
            fs::read_dir(&dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
        for entry in entries {
            let path = entry.map_err(|e| e.to_string())?.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if is_reparse(&meta) {
                return Ok(Some(path));
            }
            if meta.is_dir() {
                stack.push(path);
            }
        }
    }
    Ok(None)
}

#[cfg(windows)]
fn is_reparse(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse(meta: &fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

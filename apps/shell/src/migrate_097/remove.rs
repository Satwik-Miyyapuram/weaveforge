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
/// Refusal when `exported-to.json` names another folder: the workspace was moved or renamed.
const FOLDER_MOVED: &str = "refused: folder moved, export again";

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

/// Records the export of `folder` only when this device's newest run in its report is verified.
/// An unreadable, unparsable, or unverified report records nothing.
pub fn record_verified_export(pg_root: &Path, folder: &Path, device_id: &str) -> Result<(), String> {
    let text = fs::read_to_string(folder.join(REPORT_REL))
        .map_err(|e| format!("refused: report.json unreadable: {e}"))?;
    let report: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "refused: report.json is unparsable".to_owned())?;
    check_own_run_verdict(&report, device_id)?;
    record_exported_to(pg_root, folder)
}

/// The dump file this device's run names (`runs[].backup`), as a plain name inside the migration
/// folder. Without a backup on its own run, the report's `backup` is used only when no other
/// device has run; another device's dump is refused. A report without either field predates it and
/// uses `pre-migration.dump`. A null field has nothing to remove. A name with a path separator or
/// `..` is refused.
pub fn backup_name(report: &serde_json::Value, device_id: &str) -> Result<String, String> {
    if let Some(value) = own_run(report, device_id).ok().and_then(|run| run.get("backup")) {
        return match value.is_null() {
            true => Err(NOTHING_TO_REMOVE.to_owned()),
            false => plain_backup_name(value),
        };
    }
    if other_device_ran(report, device_id) {
        return Err("refused: backup belongs to another device".to_owned());
    }
    match report.get("backup") {
        None => Ok(DEFAULT_BACKUP.to_owned()),
        Some(value) if value.is_null() => Err(NOTHING_TO_REMOVE.to_owned()),
        Some(value) => plain_backup_name(value),
    }
}

/// Whether any run in the report may belong to a device other than `device_id`. A run with no
/// `deviceId` cannot be shown to be this device's own, so it counts as another device's.
fn other_device_ran(report: &serde_json::Value, device_id: &str) -> bool {
    report["runs"].as_array().is_some_and(|runs| {
        runs.iter()
            .any(|run| run["deviceId"].as_str() != Some(device_id))
    })
}

fn plain_backup_name(value: &serde_json::Value) -> Result<String, String> {
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
    let report = read_report(&report_path)?;
    let state = report["state"].as_str().unwrap_or("").to_owned();
    // Per device: this device's removals entry and local marker decide "already removed". The
    // top-level state belongs to whichever device wrote last, so it only counts in a legacy report.
    let own_entry = report["removals"][device_id]["state"].as_str().unwrap_or("").to_owned();
    let resume = own_entry == "removing"
        || (state == "removing" && report["removingDeviceId"].as_str() == Some(device_id));
    let legacy_removed = report.get("removals").is_none() && state == "removed";
    if own_entry == "removed" || legacy_removed || (old_db_removed(pg_root) && !resume) {
        return Err("refused: old data already removed".to_owned());
    }
    // A resume is decided by this device's own removing entry; another device's top-level state
    // (say "incomplete" written mid-removal) must not strand a half-deleted cluster.
    if !resume {
        match state.as_str() {
            "verified" | "removing" | "removed" => {}
            other => {
                return Err(format!(
                    "refused: migration state is not verified (report state: {other})"
                ))
            }
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
    }
    // A resume stops postgres too: a crash may have left it running.
    stop_pg()?;
    if !resume {
        update_report(&report_path, |r| {
            r["removingDeviceId"] = device_id.into();
            r["removals"][device_id] = serde_json::json!({ "state": "removing" });
            if is_removal_state(r) {
                r["state"] = "removing".into();
            }
        })?;
    }
    if let Some(running) = live_postmaster(&pg_root.join("data").join("postmaster.pid")) {
        return Err(format!(
            "refused: postgres still running ({running}); stop it, then remove again"
        ));
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
    update_report(&report_path, |r| {
        r["removals"][device_id] = serde_json::json!({ "state": "removed", "removedAt": now });
        if is_removal_state(r) {
            r["state"] = "removed".into();
            r["removedAt"] = now.into();
        }
    })
}

/// Whether the top-level state is one a removal may move on from. Another device's "incomplete"
/// or "exporting" is left alone; this device's own removals entry is what it reads back.
fn is_removal_state(report: &serde_json::Value) -> bool {
    matches!(report["state"].as_str(), Some("verified" | "removing" | "removed"))
}

/// Writes report.json as `change` applied to a fresh read, so other devices' runs and removal
/// entries survive. Re-reads just before the write, then reads back after the rename and retries
/// when the change did not land. A narrow window remains between the re-read and the rename.
fn update_report(report_path: &Path, change: impl Fn(&mut serde_json::Value)) -> Result<(), String> {
    for _ in 0..REPORT_WRITE_TRIES {
        let before = fs::read_to_string(report_path)
            .map_err(|e| format!("cannot read {}: {e}", report_path.display()))?;
        let mut fresh: serde_json::Value = serde_json::from_str(&before)
            .map_err(|_| "refused: migration report is unparsable".to_owned())?;
        change(&mut fresh);
        if fs::read_to_string(report_path).is_ok_and(|now| now == before) {
            write_json_atomic(report_path, &fresh)?;
            let landed = fs::read_to_string(report_path)
                .ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
            if landed.as_ref() == Some(&fresh) {
                return Ok(());
            }
        }
    }
    Err("refused: report.json kept changing during the removal; try again".to_owned())
}

/// The running postgres named by a `postmaster.pid` left in the cluster, described for the refusal.
/// A stale file (its PID is gone) does not block; a file that cannot be parsed does.
pub fn live_postmaster(pid_file: &Path) -> Option<String> {
    match fs::read_to_string(pid_file) {
        Ok(text) => match text.lines().next().and_then(|line| line.trim().parse::<u32>().ok()) {
            Some(pid) if process_alive(pid) => Some(format!("pid {pid} from data/postmaster.pid")),
            Some(_) => None,
            None => Some("data/postmaster.pid is unreadable".to_owned()),
        },
        Err(_) if pid_file.exists() => Some("data/postmaster.pid is unreadable".to_owned()),
        Err(_) => None,
    }
}

/// Whether `pid` is a running postgres. The image name must match, so a reused PID of another
/// program does not count; a failed query counts as alive (refuse, never delete on doubt).
#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .output()
        .map_or(true, |out| {
            !out.status.success() || {
                let listed = String::from_utf8_lossy(&out.stdout);
                listed.contains(&format!("\"{pid}\"")) && listed.contains("\"postgres.exe\"")
            }
        })
}

/// Whether `pid` is alive. `kill -0` fails for EPERM too, so only "No such process" means dead.
#[cfg(not(windows))]
fn process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .output()
        .map_or(true, |out| {
            out.status.success()
                || !String::from_utf8_lossy(&out.stderr).contains("No such process")
        })
}

/// Name of the marker, in app data beside `local-pg`, that says the old cluster was removed.
const MARKER: &str = "old-db-removed";
/// Tries a report.json write gets when another device changes the file between its read and write.
const REPORT_WRITE_TRIES: usize = 3;

/// Whether the old local cluster was removed on this device. Start skips the local database then,
/// so a relaunch never restores the cluster from `local-db-backups`.
#[must_use]
pub fn old_db_removed(pg_root: &Path) -> bool {
    marker_path(pg_root).exists()
}

/// Why start must not open the local cluster, or `None` to start it. A removed cluster stays gone:
/// starting it would restore it from `local-db-backups`.
#[must_use]
pub fn start_refusal(removed: bool) -> Option<&'static str> {
    removed.then_some("the local database was removed in 0.9.7; the files are the source of truth")
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

/// Whether a `conflicts` value may name conflict copies. Fails closed: only an absent or null
/// value, an empty list or a zero count counts as clean; any other shape counts as conflicts.
fn has_conflicts(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Array(items) => !items.is_empty(),
        serde_json::Value::Number(n) => n.as_f64().is_none_or(|f| f != 0.0),
        _ => true,
    }
}

/// This device's newest run must have finished `verified`, list at least one kind, and have no
/// conflict copies. An aborted run or an empty kinds map is not a verify.
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
    let conflicted = has_conflicts(&run["conflicts"])
        || kinds.values().any(|counts| has_conflicts(&counts["conflicts"]));
    if conflicted {
        return Err("refused: this device's export left conflict copies; resolve them first".to_owned());
    }
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

/// Canonical path without the Windows `\\?\` prefix, so `exported-to.json` holds a plain path.
fn canonical(path: &Path) -> Result<String, String> {
    dunce::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("cannot resolve {}: {e}", path.display()))
}

fn read_report(path: &Path) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(path).map_err(|_| {
        "refused: no migration report (state none); migration must be verified first".to_owned()
    })?;
    serde_json::from_str(&text).map_err(|_| {
        keep_unreadable_report(path);
        "refused: migration report is unparsable".to_owned()
    })
}

/// Moves an unreadable report.json aside as report.json.bad, so nothing merges over it. An existing
/// .bad file is kept as it is, and then the unreadable report stays where it is.
fn keep_unreadable_report(path: &Path) {
    let bad = PathBuf::from(format!("{}.bad", path.display()));
    if !bad.exists() {
        let _ = fs::rename(path, &bad);
    }
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
    let named = value["folder"].as_str().unwrap_or_default();
    // Both sides are canonicalized, so a `\\?\`-prefixed stored path still matches the plain one.
    let same = match (dunce::canonicalize(named), dunce::canonicalize(folder)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if !same {
        return Err(FOLDER_MOVED.to_owned());
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
    // A .part left by an interrupted write is stale; it is replaced, never appended to.
    let _ = fs::remove_file(&part);
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

#[cfg(test)]
mod update_report_tests {
    use super::*;
    use std::cell::Cell;

    fn scratch_report(name: &str, text: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("wf-m097-report-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("report.json");
        fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn a_write_raced_by_another_device_is_retried_and_keeps_both_changes() {
        let path = scratch_report("race", r#"{"version":1,"state":"verified","runs":[]}"#);
        let raced = Cell::new(false);
        let result = update_report(&path, |r| {
            if !raced.replace(true) {
                // Another device writes between this read and the write.
                fs::write(&path, r#"{"version":1,"state":"verified","runs":[],"other":"dev-b"}"#).unwrap();
            }
            r["removals"]["dev-a"] = serde_json::json!({ "state": "removing" });
        });
        let text = fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let _ = fs::remove_dir_all(path.parent().unwrap());
        result.expect("the retry lands the change");
        assert_eq!(value["other"], "dev-b", "the other device's change must survive");
        assert_eq!(value["removals"]["dev-a"]["state"], "removing");
    }

    #[test]
    fn a_report_that_keeps_moving_is_refused_after_the_tries() {
        let path = scratch_report("churn", r#"{"version":1,"state":"verified","runs":[]}"#);
        let calls = Cell::new(0_usize);
        let result = update_report(&path, |_| {
            let n = calls.get();
            calls.set(n + 1);
            fs::write(&path, format!(r#"{{"version":1,"state":"verified","runs":[],"n":{n}}}"#)).unwrap();
        });
        let _ = fs::remove_dir_all(path.parent().unwrap());
        let err = result.expect_err("a report that keeps moving must refuse");
        assert!(err.starts_with("refused: report.json kept changing"), "{err}");
        assert_eq!(calls.get(), REPORT_WRITE_TRIES);
    }
}
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

#[cfg(test)]
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
/// `None` when the id is not safe in a file name, so no path is ever built from it.
fn secrets_rel(device_id: &str) -> Option<String> {
    crate::device_id::is_file_name_id(device_id)
        .then(|| format!("{MIGRATION_DIR}/secrets-moved-{device_id}.json"))
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
pub fn record_verified_export(
    pg_root: &Path,
    folder: &Path,
    device_id: &str,
) -> Result<(), String> {
    let reports = read_reports(folder, device_id).map_err(|problem| problem.refusal())?;
    let report = device_report(&reports, device_id).ok_or_else(no_device_report)?;
    check_own_run_verdict(report, device_id)?;
    record_exported_to(pg_root, folder)
}

/// The dump file this device's run names (`runs[].backup`), as a plain name inside the migration
/// folder. Without a backup on its own run, the report's `backup` is used only when no other
/// device has run; another device's dump is refused. A report without either field predates it and
/// uses `pre-migration.dump`. A null field has nothing to remove. A name with a path separator or
/// `..` is refused.
pub fn backup_name(report: &serde_json::Value, device_id: &str) -> Result<String, String> {
    if let Some(value) = own_run(report, device_id)
        .ok()
        .and_then(|run| run.get("backup"))
    {
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
        && matches!(
            (parts.next(), parts.next()),
            (Some(Component::Normal(_)), None)
        );
    if plain {
        Ok(name.to_owned())
    } else {
        Err(format!(
            "refused: backup name {name:?} is not a plain file name"
        ))
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
    remove_with(
        folder,
        pg_root,
        now,
        device_id,
        local_secrets_rows,
        stop_pg,
        &mut |path: &Path, change: &dyn Fn(&mut serde_json::Value)| update_report(path, change),
    )
}

/// The injected final report write: the report path and the change to apply to it.
type ReportWrite<'a> = dyn FnMut(&Path, &dyn Fn(&mut serde_json::Value)) -> Result<(), String> + 'a;

/// `remove_old_data` with the final report write injected. The write runs after the cluster is
/// deleted; if it fails, the next launch resumes from the `removing` entry and finishes it.
#[allow(
    clippy::too_many_lines,
    reason = "one ordered removal sequence; removed in 0.9.8"
)]
pub(crate) fn remove_with(
    folder: &Path,
    pg_root: &Path,
    now: &str,
    device_id: &str,
    local_secrets_rows: &mut dyn FnMut() -> Result<u64, String>,
    stop_pg: &mut dyn FnMut() -> Result<(), String>,
    final_write: &mut ReportWrite<'_>,
) -> Result<(), String> {
    let report_path = own_report_path(folder, device_id);
    let reports = read_reports(folder, device_id).map_err(|problem| problem.refusal())?;
    let report = device_report(&reports, device_id)
        .ok_or_else(no_device_report)?
        .clone();
    let state = report["state"].as_str().unwrap_or("").to_owned();
    // Per device: this device's removals entry and local marker decide "already removed". The
    // top-level state belongs to whichever device wrote last, so it only counts in a legacy report.
    let own_entry = report["removals"][device_id]["state"]
        .as_str()
        .unwrap_or("")
        .to_owned();
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
                ));
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
    // This device writes only its own file: the base report is copied there before the first change.
    if !report_path.exists() {
        write_json_atomic(&report_path, &report)?;
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
    final_write(&report_path, &|r: &mut serde_json::Value| {
        r["removals"][device_id] = serde_json::json!({ "state": "removed", "removedAt": now });
        if is_removal_state(r) {
            r["state"] = "removed".into();
            r["removedAt"] = now.into();
        }
    })
    .map_err(|e| {
        format!(
            "removed, but {} not updated: {e}",
            own_report_name(device_id)
        )
    })
}

/// Launch hook: finishes a removal this device started and did not finish (a crash or power cut
/// between `removing` and `removed`). Returns `Ok(false)` when the folder has no report, or this
/// device has no removal in progress; other devices' removals are never resumed here. A resume runs
/// the same gates as `remove_old_data`, minus the checks a resume skips, and stops Postgres first.
pub fn resume_on_launch(
    folder: &Path,
    pg_root: &Path,
    device_id: &str,
    now: &str,
    stop_pg: &mut dyn FnMut() -> Result<(), String>,
) -> Result<bool, String> {
    let reports = read_reports(folder, device_id).map_err(|problem| problem.refusal())?;
    if !reports
        .iter()
        .any(|(_, report)| own_removing(report, device_id))
    {
        return Ok(false);
    }
    // A resume never reads the secrets count (Postgres is already down); the closure refuses if asked.
    let mut no_count = || Err("refused: local_secrets count is not read on resume".to_owned());
    remove_old_data(folder, pg_root, now, device_id, &mut no_count, stop_pg)?;
    Ok(true)
}

/// Whether the top-level state is one a removal may move on from. Another device's "incomplete"
/// or "exporting" is left alone; this device's own removals entry is what it reads back.
fn is_removal_state(report: &serde_json::Value) -> bool {
    matches!(
        report["state"].as_str(),
        Some("verified" | "removing" | "removed")
    )
}

/// Writes this device's report file as `change` applied to a fresh read, so other devices' runs and removal
/// entries survive. Re-reads just before the write, then reads back after the rename and retries
/// when the change did not land. A narrow window remains between the re-read and the rename.
fn update_report(
    report_path: &Path,
    change: impl Fn(&mut serde_json::Value),
) -> Result<(), String> {
    for _ in 0..REPORT_WRITE_TRIES {
        let before = fs::read_to_string(report_path)
            .map_err(|e| format!("cannot read {}: {e}", report_path.display()))?;
        let mut fresh: serde_json::Value = serde_json::from_str(&before)
            .map_err(|_| "refused: migration report is unreadable".to_owned())?;
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
    let name = report_path.file_name().map_or_else(
        || "the report".to_owned(),
        |n| n.to_string_lossy().into_owned(),
    );
    Err(format!(
        "refused: {name} kept changing during the removal; try again"
    ))
}

/// The running postgres named by a `postmaster.pid` left in the cluster, described for the refusal.
/// A stale file (its PID is gone) does not block; a file that cannot be parsed does.
#[must_use]
pub fn live_postmaster(pid_file: &Path) -> Option<String> {
    match fs::read_to_string(pid_file) {
        Ok(text) => match text
            .lines()
            .next()
            .and_then(|line| line.trim().parse::<u32>().ok())
        {
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

/// Why start must not open the cluster while a removal is unfinished: a `removing` report with no
/// marker means the cluster may still be there and a start would restore it from its backups.
#[must_use]
pub fn removal_refusal(folder: &Path, device_id: &str, pg_root: &Path) -> Option<String> {
    let reports = match read_reports(folder, device_id) {
        Ok(reports) => reports,
        Err(problem) => return Some(problem.refusal()),
    };
    let unfinished = reports.iter().any(|(_, report)| {
        report["state"].as_str() == Some("removing")
            || report["removals"].as_object().is_some_and(|map| {
                map.values()
                    .any(|entry| entry["state"].as_str() == Some("removing"))
            })
    });
    (unfinished && !old_db_removed(pg_root)).then(|| {
        "refused: a 0.9.7 removal is unfinished; it finishes on the next launch".to_owned()
    })
}

/// This device's own report file name, the only report file this device writes.
pub(super) fn own_report_name(device_id: &str) -> String {
    format!("report-{device_id}.json")
}

pub(super) fn own_report_path(folder: &Path, device_id: &str) -> PathBuf {
    folder.join(MIGRATION_DIR).join(own_report_name(device_id))
}

/// Why the migration reports cannot be read as a whole. Either one refuses.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReportsError {
    /// The migration folder cannot be listed.
    Listing(String),
    /// A report this device restores from its backup or by running the export again: the legacy
    /// report.json or this device's own file.
    Restore(String),
    /// A conflict copy, or another device's file. The user deletes it.
    Conflict(String),
    /// The device id is not safe in a file name, so this device's report file cannot be named.
    DeviceId(String),
}

impl ReportsError {
    /// Why the reports cannot be read, in plain words.
    pub(super) fn reason(&self) -> String {
        match self {
            Self::Listing(error) => format!("cannot list the migration reports: {error}"),
            Self::Restore(name) => {
                format!("{name} is unreadable; restore it from your backup or run the export again")
            }
            Self::Conflict(name) => format!("migration report {name} is unreadable"),
            Self::DeviceId(id) => format!("the device id {id:?} is not usable in a file name"),
        }
    }

    /// The step the user takes, when one is known: only a conflict copy is named for deletion.
    pub(super) fn step(&self) -> Option<String> {
        match self {
            Self::Listing(_) | Self::Restore(_) | Self::DeviceId(_) => None,
            Self::Conflict(name) => Some(format!("delete the conflict copy {name}")),
        }
    }

    pub(super) fn refusal(&self) -> String {
        match self.step() {
            Some(step) => format!("refused: {}; {step}", self.reason()),
            None => format!("refused: {}", self.reason()),
        }
    }
}

/// Every report file in the migration folder (report.json and each report*.json, conflict copies
/// included), parsed. An absent folder has none. A listing failure or one unreadable file is an error.
pub(crate) fn read_reports(
    folder: &Path,
    device_id: &str,
) -> Result<Vec<(String, serde_json::Value)>, ReportsError> {
    // The id becomes a file name (`report-<id>.json`), so it must not carry path characters.
    if !crate::device_id::is_file_name_id(device_id) {
        return Err(ReportsError::DeviceId(device_id.to_owned()));
    }
    let own = own_report_name(device_id);
    let dir = folder.join(MIGRATION_DIR);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(ReportsError::Listing(e.to_string())),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| ReportsError::Listing(e.to_string()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("report") && name.ends_with(".json") {
            names.push(name);
        }
    }
    names.sort();
    let mut reports = Vec::with_capacity(names.len());
    for name in names {
        let parsed = fs::read_to_string(dir.join(&name))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
        match parsed {
            Some(value) => reports.push((name, value)),
            None => {
                let restorable = name == "report.json" || name == own;
                return Err(if restorable {
                    ReportsError::Restore(name)
                } else {
                    ReportsError::Conflict(name)
                });
            }
        }
    }
    Ok(reports)
}

/// The report the status reads for this device: its own file, else the legacy report.json. Another
/// device's file never stands in for it.
pub(crate) fn base_report<'a>(
    reports: &'a [(String, serde_json::Value)],
    device_id: &str,
) -> Option<&'a serde_json::Value> {
    device_report(reports, device_id)
}

/// The report this device verifies and removes from: its own file, else the legacy report.json.
/// Another device's file never stands in for it.
pub(crate) fn device_report<'a>(
    reports: &'a [(String, serde_json::Value)],
    device_id: &str,
) -> Option<&'a serde_json::Value> {
    let own = own_report_name(device_id);
    reports
        .iter()
        .find(|(name, _)| *name == own)
        .or_else(|| reports.iter().find(|(name, _)| name == "report.json"))
        .map(|(_, value)| value)
}

/// The refusal when this device has no report of its own (or legacy) to verify or remove from.
pub(super) fn no_device_report() -> String {
    "refused: no export report from this device; run the export again".to_owned()
}

/// Whether this device has a removal in progress in one report: its own removals entry, or the
/// top-level state for the device that started it.
fn own_removing(report: &serde_json::Value, device_id: &str) -> bool {
    let state = report["state"].as_str().unwrap_or("");
    report["removals"][device_id]["state"].as_str() == Some("removing")
        || (state == "removing" && report["removingDeviceId"].as_str() == Some(device_id))
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
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(format!("cannot write {}: {e}", path.display())),
    }
}

/// This device's newest run: the last entry of `runs` whose `deviceId` is `device_id`. A run from
/// another device never counts; no run from this device refuses.
pub(crate) fn own_run<'a>(
    report: &'a serde_json::Value,
    device_id: &str,
) -> Result<&'a serde_json::Value, String> {
    let runs = report["runs"]
        .as_array()
        .ok_or("refused: report has no runs; verify again")?;
    runs.iter()
        .rev()
        .find(|run| run["deviceId"].as_str() == Some(device_id))
        .ok_or_else(|| "refused: no verify run from this device; verify again".to_owned())
}

/// The `missing` kinds of this device's newest run (see `own_run`).
pub fn own_run_missing(report: &serde_json::Value, device_id: &str) -> Result<Vec<String>, String> {
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
        || kinds
            .values()
            .any(|counts| has_conflicts(&counts["conflicts"]));
    if conflicted {
        return Err(
            "refused: this device's export left conflict copies; resolve them first".to_owned(),
        );
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
    let rel = secrets_rel(device_id)
        .ok_or_else(|| "refused: secrets-moved file for this device is missing".to_owned())?;
    let text = fs::read_to_string(folder.join(rel))
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
        let dir =
            std::env::temp_dir().join(format!("wf-m097-report-{name}-{}", std::process::id()));
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
                fs::write(
                    &path,
                    r#"{"version":1,"state":"verified","runs":[],"other":"dev-b"}"#,
                )
                .unwrap();
            }
            r["removals"]["dev-a"] = serde_json::json!({ "state": "removing" });
        });
        let text = fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let _ = fs::remove_dir_all(path.parent().unwrap());
        result.expect("the retry lands the change");
        assert_eq!(
            value["other"], "dev-b",
            "the other device's change must survive"
        );
        assert_eq!(value["removals"]["dev-a"]["state"], "removing");
    }

    #[test]
    fn a_report_that_keeps_moving_is_refused_after_the_tries() {
        let path = scratch_report("churn", r#"{"version":1,"state":"verified","runs":[]}"#);
        let calls = Cell::new(0_usize);
        let result = update_report(&path, |_| {
            let n = calls.get();
            calls.set(n + 1);
            fs::write(
                &path,
                format!(r#"{{"version":1,"state":"verified","runs":[],"n":{n}}}"#),
            )
            .unwrap();
        });
        let _ = fs::remove_dir_all(path.parent().unwrap());
        let err = result.expect_err("a report that keeps moving must refuse");
        assert!(
            err.starts_with("refused: report.json kept changing"),
            "{err}"
        );
        assert_eq!(calls.get(), REPORT_WRITE_TRIES);
    }
}

#[cfg(test)]
mod final_write_tests {
    use super::*;
    use std::cell::Cell;

    const NOW_T: &str = "2026-11-23T08:00:00Z";
    const DEV: &str = "dev-a";
    const RUN: &str = r#"{"startedAt":"2026-11-23T07:59:00Z","finishedAt":"2026-11-23T08:00:00Z","state":"verified","sources":[],"kinds":{"notes":{"db":1,"files":1}},"blobs":{"db":0,"verified":0},"deviceId":"dev-a","missing":[]}"#;

    struct Setup {
        base: PathBuf,
        folder: PathBuf,
        pg_root: PathBuf,
    }

    impl Drop for Setup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    /// A verified folder with a good backup, this device's secrets file and exported-to.json, plus
    /// a cluster dir and a backups dir beside it. Mirrors what `remove_old_data` gates on.
    fn setup(name: &str) -> Setup {
        let base =
            std::env::temp_dir().join(format!("wf-m097-final-write-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let folder = base.join("vault");
        let pg_root = base.join("local-pg");
        let dir = folder.join(MIGRATION_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(pg_root.join("data")).unwrap();
        fs::write(pg_root.join("data/PG_VERSION"), "16").unwrap();
        fs::create_dir_all(base.join("local-db-backups")).unwrap();
        fs::write(
            folder.join(REPORT_REL),
            format!(
                r#"{{"version":1,"state":"verified","backup":"pre-migration.dump","verifiedAt":"{NOW_T}","runs":[{RUN}]}}"#
            ),
        )
        .unwrap();
        let mut dump = b"PGDMP".to_vec();
        dump.extend_from_slice(&[1, 16, 0, 4, 8, 1]);
        dump.resize(4096, 0);
        fs::write(dir.join("pre-migration.dump"), dump).unwrap();
        fs::write(
            folder.join(secrets_rel(DEV).expect("a test device id is file-name safe")),
            format!(r#"{{"movedAt":"{NOW_T}","count":0,"deviceId":"{DEV}"}}"#),
        )
        .unwrap();
        let exported = serde_json::json!({ "folder": canonical(&folder).unwrap() });
        fs::write(pg_root.join(EXPORTED_TO), exported.to_string()).unwrap();
        Setup {
            base,
            folder,
            pg_root,
        }
    }

    /// This device's own report file: every write in these tests lands there, never in report.json.
    fn read_report(folder: &Path) -> serde_json::Value {
        let text = fs::read_to_string(own_report_path(folder, DEV)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn a_failed_final_write_leaves_a_removed_cluster_that_the_next_launch_finishes() {
        let s = setup("final-write");
        let injected = Cell::new(0_usize);
        let mut fail_final = |_path: &Path, _change: &dyn Fn(&mut serde_json::Value)| {
            injected.set(injected.get() + 1);
            Err("disk full".to_owned())
        };
        let first = remove_with(
            &s.folder,
            &s.pg_root,
            NOW_T,
            DEV,
            &mut || Ok(0),
            &mut || Ok(()),
            &mut fail_final,
        );
        let err = first.expect_err("the injected final write fails");
        assert!(
            err.starts_with("removed, but report-dev-a.json not updated"),
            "the failure must say the cluster is gone: {err}"
        );
        assert_eq!(injected.get(), 1, "the final write runs once");
        assert!(
            !s.pg_root.exists(),
            "the cluster is deleted before the final write"
        );
        assert!(
            old_db_removed(&s.pg_root),
            "the marker is written before the delete"
        );
        let stuck = read_report(&s.folder);
        assert_eq!(stuck["state"], "removing");
        assert_eq!(stuck["removals"][DEV]["state"], "removing");

        // Next launch: this device's own `removing` entry resumes the removal, stops Postgres once,
        // and writes `removed` without deleting anything a second time.
        let mut stops = 0_usize;
        let mut count_stop = || {
            stops += 1;
            Ok(())
        };
        let resumed = resume_on_launch(&s.folder, &s.pg_root, DEV, NOW_T, &mut count_stop);
        assert_eq!(resumed, Ok(true));
        assert_eq!(stops, 1, "postgres is stopped once on the resume");
        let done = read_report(&s.folder);
        assert_eq!(done["state"], "removed");
        assert_eq!(done["removals"][DEV]["state"], "removed");
        assert!(old_db_removed(&s.pg_root), "the marker survives the resume");
        assert!(!s.pg_root.exists(), "the cluster stays deleted");
        assert!(
            !s.pg_root
                .parent()
                .unwrap()
                .join("local-db-backups")
                .exists()
        );
    }

    #[test]
    fn a_resume_reads_only_the_own_device_file() {
        let s = setup("own-file-resume");
        let legacy = s.folder.join(REPORT_REL);
        fs::remove_file(&legacy).unwrap();
        let own = s.folder.join(MIGRATION_DIR).join("report-dev-a.json");
        fs::write(
            &own,
            format!(
                r#"{{"version":1,"state":"removing","removingDeviceId":"{DEV}","removals":{{"{DEV}":{{"state":"removing"}}}},"backup":"pre-migration.dump","verifiedAt":"{NOW_T}","runs":[{RUN}]}}"#
            ),
        )
        .unwrap();
        let mut stops = 0_usize;
        let mut count_stop = || {
            stops += 1;
            Ok(())
        };
        assert_eq!(
            resume_on_launch(&s.folder, &s.pg_root, DEV, NOW_T, &mut count_stop),
            Ok(true)
        );
        assert_eq!(stops, 1, "postgres is stopped once on the resume");
        let done: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&own).unwrap()).unwrap();
        assert_eq!(
            done["state"], "removed",
            "the resume writes this device's own file"
        );
        assert!(!legacy.exists(), "the legacy report.json is never created");
    }
}

#[cfg(test)]
mod union_tests {
    use super::*;

    const ME: &str = "dev-a";
    const NOW: &str = "2026-11-22T10:05:00.000Z";
    const REMOVING: &str = r#"{"version":1,"state":"removing","removingDeviceId":"dev-a","removals":{"dev-a":{"state":"removing"}},"runs":[]}"#;
    const VERIFIED_A: &str = r#"{"version":1,"state":"verified","runs":[{"deviceId":"dev-a","state":"verified","finishedAt":"2026-11-22T10:00:00.000Z","kinds":{"notes":{"db":1,"files":1}},"missing":[],"conflicts":[]}]}"#;
    const VERIFIED_B: &str = r#"{"version":1,"state":"verified","runs":[{"deviceId":"dev-b","state":"verified","finishedAt":"2026-11-22T10:00:00.000Z","kinds":{"notes":{"db":1,"files":1}},"missing":[],"conflicts":[]}]}"#;

    /// A migration folder holding the given report files, and a cluster root with no removed marker.
    fn fixture(name: &str, files: &[(&str, &str)]) -> (PathBuf, PathBuf, PathBuf) {
        let base =
            std::env::temp_dir().join(format!("wf-m097-union-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let folder = base.join("vault");
        let dir = folder.join(MIGRATION_DIR);
        fs::create_dir_all(&dir).unwrap();
        for (file, text) in files {
            fs::write(dir.join(file), text).unwrap();
        }
        let pg_root = base.join("local-pg");
        (base, folder, pg_root)
    }

    #[test]
    fn a_removal_in_one_devices_own_file_refuses_the_start() {
        let (base, folder, pg_root) = fixture("own-removing", &[("report-dev-a.json", REMOVING)]);
        let refusal = removal_refusal(&folder, ME, &pg_root);
        let _ = fs::remove_dir_all(&base);
        assert!(
            refusal.is_some_and(|r| r.contains("unfinished")),
            "a removing own file refuses the start"
        );
    }

    #[test]
    fn an_unreadable_legacy_report_refuses_with_a_restore_message() {
        let (base, folder, pg_root) = fixture("legacy-bad", &[("report.json", "{ not json")]);
        let refusal = removal_refusal(&folder, ME, &pg_root);
        let _ = fs::remove_dir_all(&base);
        assert_eq!(
            refusal.as_deref(),
            Some(
                "refused: report.json is unreadable; restore it from your backup or run the export again"
            )
        );
    }

    #[test]
    fn an_unreadable_own_report_refuses_with_a_restore_message() {
        let (base, folder, pg_root) = fixture("own-bad", &[("report-dev-a.json", "{ not json")]);
        let refusal = removal_refusal(&folder, ME, &pg_root);
        let _ = fs::remove_dir_all(&base);
        assert_eq!(
            refusal.as_deref(),
            Some(
                "refused: report-dev-a.json is unreadable; restore it from your backup or run the export again"
            )
        );
    }

    #[test]
    fn a_verified_mark_in_another_devices_file_never_records_the_export() {
        let (base, folder, pg_root) =
            fixture("other-verified", &[("report-dev-b.json", VERIFIED_B)]);
        let result = record_verified_export(&pg_root, &folder, ME);
        let recorded = pg_root.join(EXPORTED_TO).exists();
        let _ = fs::remove_dir_all(&base);
        assert!(
            result.is_err() && !recorded,
            "another device's verified run unlocks nothing"
        );
    }

    #[test]
    fn a_verified_mark_in_another_devices_file_never_removes_the_data() {
        let (base, folder, pg_root) = fixture("other-remove", &[("report-dev-b.json", VERIFIED_B)]);
        let mut secrets = || Ok(0);
        let mut stop = || Ok(());
        let result = remove_old_data(&folder, &pg_root, NOW, ME, &mut secrets, &mut stop);
        let _ = fs::remove_dir_all(&base);
        assert!(
            result.is_err(),
            "another device's verified run never unlocks removal"
        );
    }

    #[test]
    fn a_verified_own_file_records_the_export() {
        let (base, folder, pg_root) = fixture("own-verified", &[("report-dev-a.json", VERIFIED_A)]);
        let result = record_verified_export(&pg_root, &folder, ME);
        let recorded = pg_root.join(EXPORTED_TO).exists();
        let _ = fs::remove_dir_all(&base);
        assert!(
            result.is_ok() && recorded,
            "this device's own verified run records the export"
        );
    }

    #[test]
    fn an_unreadable_conflict_copy_refuses_recording_the_export() {
        let (base, folder, pg_root) = fixture(
            "conflict-record",
            &[
                ("report-dev-a.json", VERIFIED_A),
                ("report-dev-a (1).json", "{ not json"),
            ],
        );
        let result = record_verified_export(&pg_root, &folder, ME);
        let _ = fs::remove_dir_all(&base);
        assert_eq!(
            result.err().as_deref(),
            Some(
                "refused: migration report report-dev-a (1).json is unreadable; delete the conflict copy report-dev-a (1).json"
            )
        );
    }

    #[test]
    fn an_unreadable_conflict_copy_refuses_the_removal() {
        let (base, folder, pg_root) = fixture(
            "conflict-remove",
            &[
                ("report-dev-a.json", VERIFIED_A),
                ("report-dev-a (1).json", "{ not json"),
            ],
        );
        let mut secrets = || Ok(0);
        let mut stop = || Ok(());
        let result = remove_old_data(&folder, &pg_root, NOW, ME, &mut secrets, &mut stop);
        let _ = fs::remove_dir_all(&base);
        assert_eq!(
            result.err().as_deref(),
            Some(
                "refused: migration report report-dev-a (1).json is unreadable; delete the conflict copy report-dev-a (1).json"
            )
        );
    }

    #[test]
    fn an_unreadable_conflict_copy_refuses_the_start_even_with_no_removal_running() {
        let (base, folder, pg_root) = fixture(
            "conflict",
            &[
                (
                    "report-dev-a.json",
                    r#"{"version":1,"state":"verified","runs":[]}"#,
                ),
                ("report-dev-a (1).json", "{ not json"),
            ],
        );
        let refusal = removal_refusal(&folder, ME, &pg_root);
        let _ = fs::remove_dir_all(&base);
        assert_eq!(
            refusal.as_deref(),
            Some(
                "refused: migration report report-dev-a (1).json is unreadable; delete the conflict copy report-dev-a (1).json"
            )
        );
    }

    #[test]
    fn a_device_id_outside_the_file_name_shape_is_refused_and_writes_nothing() {
        let long = "a".repeat(129);
        for id in ["", long.as_str(), "../x", "a/b", "a_b"] {
            let (base, folder, pg_root) = fixture("id-shape", &[("report-dev-a.json", VERIFIED_A)]);
            let read = read_reports(&folder, id);
            let refusal = removal_refusal(&folder, id, &pg_root);
            let recorded = record_verified_export(&pg_root, &folder, id);
            let mut secrets = || Ok(0);
            let mut stop = || Ok(());
            let removed = remove_old_data(&folder, &pg_root, NOW, id, &mut secrets, &mut stop);
            let exported = pg_root.join(EXPORTED_TO).exists();
            let _ = fs::remove_dir_all(&base);
            assert!(read.is_err(), "{id:?}: the reader refuses the id");
            assert!(
                refusal.as_deref().is_some_and(|r| r.contains("device id")),
                "{id:?}: {refusal:?}"
            );
            assert!(
                recorded.is_err() && !exported,
                "{id:?}: nothing is recorded"
            );
            assert!(removed.is_err(), "{id:?}: the removal refuses the id");
        }
    }

    #[test]
    fn base_report_never_falls_back_to_another_devices_file() {
        let (base, folder, _pg_root) = fixture("no-fallback", &[("report-dev-b.json", VERIFIED_B)]);
        let reports = read_reports(&folder, ME);
        let _ = fs::remove_dir_all(&base);
        assert!(
            reports.as_ref().is_ok_and(|r| base_report(r, ME).is_none()),
            "dev-b's file never stands in for dev-a"
        );
    }
}

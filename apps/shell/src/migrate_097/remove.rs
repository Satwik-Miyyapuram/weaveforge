//! "Remove old data" (0.9.7): deletes the app's local Postgres data dir, only after a verified
//! migration with a non-empty backup, for the folder the export wrote. Refuses if any reparse
//! point (junction, symlink) sits in or is the data dir.
//!
//! State machine in report.json: `verified` -> `removing` (cluster stopped, deletion started)
//! -> `removed` (with `removedAt`). A `removing` report resumes deletion after a crash.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::local_http::control::parse_iso_ms;

const REPORT_REL: &str = ".weaveforge/migration-0.9.7/report.json";
const BACKUP_REL: &str = ".weaveforge/migration-0.9.7/pre-migration.dump";
const EXPORTED_TO: &str = "exported-to.json";
const SECRETS_REL: &str = ".weaveforge/migration-0.9.7/secrets-moved.json";
const DUMP_MAGIC: &[u8] = b"PGDMP";
const VERIFY_WINDOW_MS: u64 = 600_000;
/// Written in `pg_root` before the cluster stops; names the device that started the removal.
const MARKER_REL: &str = "removing.json";

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

/// Writes a `verified` report with no runs and no backup, for a folder that had no old data.
/// `verified_at` is the time of that check (the removal gate needs it fresh). Refuses if a report
/// already exists, so a real migration report is never overwritten.
pub fn write_verified_empty_report(folder: &Path, verified_at: &str) -> Result<(), String> {
    let path = folder.join(REPORT_REL);
    if path.exists() {
        return Err("refused: report.json already exists".to_owned());
    }
    write_json_atomic(
        &path,
        &serde_json::json!({
            "version": 1,
            "state": "verified",
            "backup": null,
            "verifiedAt": verified_at,
            "runs": [],
        }),
    )
}

/// Stops the local cluster through `stop_pg`, then deletes `pg_root`. Refuses (touching nothing)
/// unless report.json says `verified` (or resumes a `removing` report) with a `verifiedAt` at most
/// 10 minutes before `now`, its backup is a non-empty dump with no missing items,
/// `pg_root/exported-to.json` names this folder, `secrets-moved.json` exists and covers every
/// `local_secrets` row, and neither `pg_root` nor anything inside it is a reparse point. Ends with
/// state `removed` and `removedAt = now`.
///
/// `local_secrets_rows` runs while Postgres is still up, only for a `verified` report. A
/// `removing` resume skips it because Postgres is already down; it still needs `secrets-moved.json`.
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
    check_backup(folder)?;
    if !newest_missing(&report)?.is_empty() {
        return Err("refused: report lists missing items".to_owned());
    }
    if state == "verified" {
        check_verified_at(&report, now)?;
        check_exported_to(pg_root, folder)?;
    }
    let moved = read_secrets_moved(folder)?;
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
    if state == "verified" {
        let local_rows = local_secrets_rows()?;
        check_secrets_count(moved, local_rows)?;
        fs::create_dir_all(pg_root)
            .map_err(|e| format!("cannot create {}: {e}", pg_root.display()))?;
        write_json_atomic(
            &pg_root.join(MARKER_REL),
            &serde_json::json!({ "deviceId": device_id }),
        )?;
        stop_pg()?;
        report["state"] = "removing".into();
        write_json_atomic(&report_path, &report)?;
    } else {
        check_marker(pg_root, device_id)?;
    }
    if pg_root.exists() {
        fs::remove_dir_all(pg_root)
            .map_err(|e| format!("cannot delete {}: {e}", pg_root.display()))?;
    }
    report["state"] = "removed".into();
    report["removedAt"] = now.into();
    write_json_atomic(&report_path, &report)
}

/// The `missing` list of the newest run, as the TS writer puts it (`runs[last].missing`).
/// A report with no run has not been verified by a run, so it refuses.
pub fn newest_missing(report: &serde_json::Value) -> Result<Vec<String>, String> {
    let runs = report["runs"]
        .as_array()
        .ok_or("refused: report has no runs; verify again")?;
    let last = runs
        .last()
        .ok_or("refused: report has no run; verify again")?;
    Ok(last["missing"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| item["kind"].as_str().unwrap_or("?").to_owned())
                .collect()
        })
        .unwrap_or_default())
}

/// The verify must be at most `VERIFY_WINDOW_MS` old: the UI runs the TS verify right before
/// removal, so an older report means the data may have changed since it was checked.
fn check_verified_at(report: &serde_json::Value, now: &str) -> Result<(), String> {
    let verified = report["verifiedAt"]
        .as_str()
        .and_then(parse_iso_ms)
        .ok_or("refused: report has no readable verifiedAt; verify again")?;
    let now = parse_iso_ms(now).ok_or("refused: current time is unreadable")?;
    let age = i128::from(now) - i128::from(verified);
    if !(0..=i128::from(VERIFY_WINDOW_MS)).contains(&age) {
        return Err(format!(
            "refused: verification is stale ({} s old, limit {} s); verify again",
            age / 1000,
            VERIFY_WINDOW_MS / 1000
        ));
    }
    Ok(())
}

/// A `removing` resume only runs on the device whose marker started it.
fn check_marker(pg_root: &Path, device_id: &str) -> Result<(), String> {
    let text = fs::read_to_string(pg_root.join(MARKER_REL)).map_err(|_| {
        "refused: removal was not started on this device (removing.json missing)".to_owned()
    })?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| "refused: removing.json is unparsable".to_owned())?;
    if value["deviceId"].as_str() != Some(device_id) {
        return Err("refused: removal was started by another device".to_owned());
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

fn check_backup(folder: &Path) -> Result<(), String> {
    let bytes = fs::read(folder.join(BACKUP_REL))
        .map_err(|_| "refused: migration backup is missing".to_owned())?;
    if bytes.is_empty() {
        return Err("refused: migration backup is empty".to_owned());
    }
    if !bytes.starts_with(DUMP_MAGIC) {
        return Err("refused: migration backup is not a PostgreSQL dump".to_owned());
    }
    Ok(())
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

/// Reads `count` from `secrets-moved.json` (written by the KEYS lane once every local secret is in
/// the keychain). Missing, unparsable or count-less files refuse.
fn read_secrets_moved(folder: &Path) -> Result<u64, String> {
    let text = fs::read_to_string(folder.join(SECRETS_REL))
        .map_err(|_| "refused: secrets-moved.json is missing".to_owned())?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| "refused: secrets-moved.json is unparsable".to_owned())?;
    value["count"]
        .as_u64()
        .ok_or_else(|| "refused: secrets-moved.json has no count".to_owned())
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

//! Experiment metrics on disk: each SDK batch is one new chunk file,
//! `<experiment>/metrics/<run>/<batch-id>.csv`, written once and never
//! appended to. Readers merge every chunk by `(run, step, metric)`.
//!
//! Laws (proved in `tests/metrics_chunks.rs`):
//! - A chunk that already exists is never written again, so a batch fetched
//!   twice adds nothing.
//! - Reading back gives every written point, merged and sorted.
//! - An inbox row is acked only once its data is on disk; a row that cannot
//!   be stored stays in the inbox.
//! - A batch is stored whole or not at all: every chunk is written to a temp
//!   file before any is moved into place.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use sha2::{Digest as _, Sha256};
use wf_core::metric_csv::{CsvMetric, decode, encode, merge_chunks};
use wf_core::sync::entity_file::parse_entity_file;
use wf_core::sync::folder_layout::metrics_chunk_path;

use crate::checked_write::{WriteOutcome, write_temp};
use crate::vault::{EntryKind, Vault, VaultError, io_err, temp_beside};

/// The run name used when a point names none.
pub const DEFAULT_RUN: &str = "main";

/// What [`write_chunk`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkWrite {
    /// The chunk is now on disk.
    Written,
    /// A chunk with this batch id was already there; nothing was written.
    AlreadyPresent,
}

/// Why a chunk could not be written.
#[derive(Debug, thiserror::Error)]
pub enum MetricsError {
    /// A run or batch id that is not a plain file name.
    #[error("Bad run or batch name: {0:?}")]
    BadName(String),
    /// The vault refused or failed the write.
    #[error(transparent)]
    Vault(#[from] VaultError),
}

/// True for a plain path segment: letters, digits, `-`, `_` and `.`, not
/// starting with `.`, at most 128 characters.
#[must_use]
pub fn is_safe_segment(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Writes `rows` as the chunk `batch_id` of `run`, unless that chunk exists.
///
/// # Errors
/// An unsafe run or batch name, or a vault failure.
pub fn write_chunk(
    vault: &Vault,
    experiment_dir: &str,
    run: &str,
    batch_id: &str,
    rows: &[CsvMetric],
) -> Result<ChunkWrite, MetricsError> {
    for name in [run, batch_id] {
        if !is_safe_segment(name) {
            return Err(MetricsError::BadName(name.to_owned()));
        }
    }
    let path = metrics_chunk_path(experiment_dir, run, batch_id);
    // `Some("")` means "only if the file is missing".
    Ok(
        match vault.write_bytes_checked(&path, encode(rows).as_bytes(), Some(""))? {
            WriteOutcome::Written { .. } => ChunkWrite::Written,
            WriteOutcome::Changed { .. } => ChunkWrite::AlreadyPresent,
        },
    )
}

/// The merged metrics of one experiment.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MetricsRead {
    /// One row per `(run, step, metric)`, sorted by that key.
    pub rows: Vec<CsvMetric>,
    /// Chunks that could not be read or decoded; shown, never guessed at.
    pub bad_chunks: Vec<String>,
}

/// Reads and merges every chunk under `<experiment_dir>/metrics`.
///
/// # Errors
/// Only when the metrics folder itself cannot be listed.
pub fn read_metrics(vault: &Vault, experiment_dir: &str) -> Result<MetricsRead, VaultError> {
    let mut chunks = Vec::new();
    let mut bad_chunks = Vec::new();
    for entry in vault.walk(&format!("{experiment_dir}/metrics"))? {
        if entry.kind != EntryKind::File || !entry.path.ends_with(".csv") {
            continue;
        }
        match vault
            .read_text(&entry.path)
            .ok()
            .and_then(|t| decode(&t).ok())
        {
            Some(rows) => chunks.push(rows),
            None => bad_chunks.push(entry.path),
        }
    }
    Ok(MetricsRead {
        rows: merge_chunks(&chunks),
        bad_chunks,
    })
}

/// Experiment id to experiment folder (the `.md` file's path without `.md`),
/// for every experiment file in the workspace.
///
/// # Errors
/// Only when the workspace root cannot be listed.
pub fn experiment_dirs(vault: &Vault) -> Result<HashMap<String, String>, VaultError> {
    let mut dirs = HashMap::new();
    for entry in vault.walk("")? {
        let Some(dir) = entry.path.strip_suffix(".md") else {
            continue;
        };
        if entry.kind != EntryKind::File || !dir.contains("experiments/") {
            continue;
        }
        let Some(file) = vault
            .read_text(&entry.path)
            .ok()
            .and_then(|t| parse_entity_file(&t))
        else {
            continue;
        };
        if file.entity_type == "experiment" {
            let _ = dirs.insert(file.id, dir.to_owned());
        }
    }
    Ok(dirs)
}

/// What one drain pass stored.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DrainReport {
    /// Inbox row ids whose data is on disk; safe to ack.
    pub ack: Vec<i64>,
    /// Files written in this pass.
    pub written: usize,
    /// Files that were already on disk (a re-fetched row).
    pub duplicates: usize,
    /// Rows left in the inbox, with the reason.
    pub skipped: Vec<(Option<i64>, String)>,
}

/// Stores claimed `sdk_inbox` rows as files: metrics as chunks named
/// `b<row id>`, artifacts as `<experiment>/artifacts/<run>/a<row id>.json`.
/// `dirs` maps experiment ids to folders (see [`experiment_dirs`]).
#[must_use]
pub fn apply_inbox_rows(
    vault: &Vault,
    rows: &[Value],
    dirs: &HashMap<String, String>,
) -> DrainReport {
    let mut report = DrainReport::default();
    for row in rows {
        let id = row.get("id").and_then(Value::as_i64);
        match id
            .ok_or_else(|| "row has no id".to_owned())
            .and_then(|id| store_row(vault, id, row, dirs))
        {
            Ok(writes) => {
                for write in writes {
                    match write {
                        ChunkWrite::Written => report.written += 1,
                        ChunkWrite::AlreadyPresent => report.duplicates += 1,
                    }
                }
                report.ack.extend(id);
            }
            Err(reason) => report.skipped.push((id, reason)),
        }
    }
    report
}

fn store_row(
    vault: &Vault,
    id: i64,
    row: &Value,
    dirs: &HashMap<String, String>,
) -> Result<Vec<ChunkWrite>, String> {
    let payload = row.get("payload").and_then(Value::as_object);
    let payload = payload.ok_or("row has no payload")?;
    match row.get("kind").and_then(Value::as_str) {
        Some("metrics") => store_metrics(vault, id, payload, dirs),
        Some("artifacts") => store_artifact(vault, id, row, payload, dirs).map(|w| vec![w]),
        other => Err(format!("unknown kind {other:?}")),
    }
}

fn experiment_dir<'a>(
    dirs: &'a HashMap<String, String>,
    id: Option<&str>,
) -> Result<&'a str, String> {
    let id = id.ok_or("no experiment id")?;
    dirs.get(id)
        .map(String::as_str)
        .ok_or_else(|| format!("no experiment file for {id}"))
}

fn store_metrics(
    vault: &Vault,
    id: i64,
    payload: &Map<String, Value>,
    dirs: &HashMap<String, String>,
) -> Result<Vec<ChunkWrite>, String> {
    let points = payload.get("points").and_then(Value::as_array);
    let points = points.ok_or("payload has no points")?;
    store_metric_points(vault, &format!("b{id}"), points, dirs)
}

/// The batch id for points posted to the local API: a digest of the points,
/// so the same request sent twice names the same chunk.
#[must_use]
pub fn local_batch_id(points: &[Value]) -> String {
    let digest = Sha256::digest(Value::from(points.to_vec()).to_string().as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("l{hex}")
}

/// Writes SDK metric points (`{experiment_id, metric, step, value, run?,
/// wall_time?}`) as chunk `batch_id`, one chunk per experiment and run.
/// Every point is checked before anything is written.
///
/// # Errors
/// A point with no known experiment, a bad number or name, or a failed write.
pub fn store_metric_points(
    vault: &Vault,
    batch_id: &str,
    points: &[Value],
    dirs: &HashMap<String, String>,
) -> Result<Vec<ChunkWrite>, String> {
    // (experiment folder, run) -> rows, so each chunk holds one run.
    let mut groups: Vec<((&str, String), Vec<CsvMetric>)> = Vec::new();
    for point in points {
        let experiment = point.get("experiment_id").and_then(Value::as_str);
        let dir = experiment_dir(dirs, experiment)?;
        let row = to_metric(point).ok_or_else(|| format!("bad point {point}"))?;
        let key = (dir, row.run.clone());
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, rows)) => rows.push(row),
            None => groups.push((key, vec![row])),
        }
    }
    // Check every name first, so a row is stored whole or not at all.
    if let Some(((_, run), _)) = groups.iter().find(|((_, run), _)| !is_safe_segment(run)) {
        return Err(format!("bad run name {run:?}"));
    }
    if !is_safe_segment(batch_id) {
        return Err(format!("bad batch id {batch_id:?}"));
    }
    // Write every chunk to a temp file first, then publish them all, so a
    // failed write leaves no part of the batch behind.
    let mut staged = Vec::with_capacity(groups.len());
    for ((dir, run), rows) in &groups {
        let path = metrics_chunk_path(dir, run, batch_id);
        match stage(vault, &path, encode(rows).as_bytes()) {
            Ok(pair) => staged.push(pair),
            Err(e) => {
                discard(&staged);
                return Err(e.to_string());
            }
        }
    }
    publish(&staged)
}

/// A chunk written to a temp file beside its final path: `(temp, target)`.
type Staged = (PathBuf, PathBuf);

fn stage(vault: &Vault, rel: &str, bytes: &[u8]) -> Result<Staged, VaultError> {
    let target = vault.resolve(rel)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|source| io_err("create folder", rel, source))?;
    }
    let temp = temp_beside(&target);
    if let Err(source) = write_temp(&temp, bytes) {
        let _ = fs::remove_file(&temp);
        return Err(io_err("write", rel, source));
    }
    Ok((temp, target))
}

fn discard(staged: &[Staged]) {
    for (temp, _) in staged {
        let _ = fs::remove_file(temp);
    }
}

/// Moves every staged chunk into place without replacing one that exists.
/// On a failure the chunks placed by this call are removed again.
fn publish(staged: &[Staged]) -> Result<Vec<ChunkWrite>, String> {
    let mut out = Vec::with_capacity(staged.len());
    for (i, (temp, target)) in staged.iter().enumerate() {
        match place(temp, target) {
            Ok(write) => out.push(write),
            Err(e) => {
                discard(&staged[i..]);
                for ((_, placed), write) in staged.iter().zip(&out) {
                    if *write == ChunkWrite::Written {
                        let _ = fs::remove_file(placed);
                    }
                }
                return Err(format!("could not store chunk {}: {e}", target.display()));
            }
        }
    }
    Ok(out)
}

/// A hard link never replaces an existing chunk; where links are not
/// supported, a checked rename does the same job (a chunk is never edited,
/// so a racing writer of the same batch wrote the same bytes).
fn place(temp: &Path, target: &Path) -> io::Result<ChunkWrite> {
    let write = match fs::hard_link(temp, target) {
        Ok(()) => ChunkWrite::Written,
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => ChunkWrite::AlreadyPresent,
        Err(_) if fs::symlink_metadata(target).is_ok() => ChunkWrite::AlreadyPresent,
        Err(_) => {
            fs::rename(temp, target)?;
            return Ok(ChunkWrite::Written);
        }
    };
    let _ = fs::remove_file(temp);
    Ok(write)
}

fn to_metric(point: &Value) -> Option<CsvMetric> {
    let number = |key: &str| match point.get(key) {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    };
    let step = if point.get("step").is_none_or(Value::is_null) {
        0.0
    } else {
        number("step")?
    };
    let value = number("value")?;
    let metric = point.get("metric").and_then(Value::as_str)?.trim();
    if metric.is_empty() || !step.is_finite() || !value.is_finite() {
        return None;
    }
    let text = |key: &str| point.get(key).and_then(Value::as_str).map(str::to_owned);
    Some(CsvMetric {
        run: text("run").unwrap_or_else(|| DEFAULT_RUN.to_owned()),
        step,
        metric: metric.to_owned(),
        value,
        time: text("wall_time"),
    })
}

fn store_artifact(
    vault: &Vault,
    id: i64,
    row: &Value,
    payload: &Map<String, Value>,
    dirs: &HashMap<String, String>,
) -> Result<ChunkWrite, String> {
    let experiment = payload
        .get("experiment_id")
        .or_else(|| row.get("experiment_id"))
        .and_then(Value::as_str);
    let dir = experiment_dir(dirs, experiment)?;
    let run = payload
        .get("run")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_RUN);
    if !is_safe_segment(run) {
        return Err(format!("bad run name {run:?}"));
    }
    let text = serde_json::to_string_pretty(payload).map_err(|e| e.to_string())?;
    let path = format!("{dir}/artifacts/{run}/a{id}.json");
    match vault.write_text_checked(&path, &format!("{text}\n"), Some("")) {
        Ok(WriteOutcome::Written { .. }) => Ok(ChunkWrite::Written),
        Ok(WriteOutcome::Changed { .. }) => Ok(ChunkWrite::AlreadyPresent),
        Err(e) => Err(e.to_string()),
    }
}

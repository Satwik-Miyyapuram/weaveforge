//! Integration tests for `wf_store::files::metrics_csv`: chunk files, merge on
//! read, and draining SDK inbox rows into chunks.

#[cfg(test)]
mod common;

use common::TempDir;
use serde_json::{Value, json};
use support::{dir_bytes, experiment_file, vault_in};
use wf_core::metric_csv::CsvMetric;
use wf_store::files::metrics_csv::{
    ChunkWrite, apply_inbox_rows, experiment_dirs, local_batch_id, read_metrics,
    store_metric_points, write_chunk,
};

/// Helpers live here so `cfg(test)` covers their unwraps.
#[cfg(test)]
mod support {
    use std::fs;
    use std::path::Path;

    use wf_store::vault::Vault;

    pub fn vault_in(dir: &Path) -> Vault {
        Vault::new(dir.to_path_buf())
    }

    pub fn experiment_file(root: &Path, rel: &str, id: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path,
            format!("---\nweaveforge-id: {id}\nweaveforge-type: experiment\nwf: 3\n---\n"),
        )
        .unwrap();
    }

    /// Total bytes of every file under `dir`.
    pub fn dir_bytes(dir: &Path) -> u64 {
        let mut total = 0;
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let meta = entry.metadata().unwrap();
            total += if meta.is_dir() {
                dir_bytes(&entry.path())
            } else {
                meta.len()
            };
        }
        total
    }
}

const EXP: &str = "thesis/experiments/lr-sweep--abc123";

fn point(run: &str, step: u32, metric: &str) -> CsvMetric {
    CsvMetric {
        run: run.to_owned(),
        step: f64::from(step),
        metric: metric.to_owned(),
        value: f64::from(step) / 1000.0,
        time: Some(format!("2026-11-19T10:00:{:02}Z", step % 60)),
    }
}

#[test]
fn metrics_chunks_read_back() {
    let tmp = TempDir::new();
    let vault = vault_in(tmp.path());
    let mut all = Vec::new();
    for run in ["r1", "r2", "r3"] {
        let rows: Vec<CsvMetric> = (0..1000).map(|s| point(run, s, "loss")).collect();
        for (batch, chunk) in rows.chunks(250).enumerate() {
            let wrote = write_chunk(&vault, EXP, run, &format!("b{batch}"), chunk).unwrap();
            assert_eq!(wrote, ChunkWrite::Written);
        }
        all.extend(rows);
    }
    let read = read_metrics(&vault, EXP).unwrap();
    assert!(read.bad_chunks.is_empty());
    all.sort_by(|a, b| a.run.cmp(&b.run).then(a.step.total_cmp(&b.step)));
    assert_eq!(read.rows, all);
}

#[test]
fn duplicate_batch_dropped() {
    let tmp = TempDir::new();
    let vault = vault_in(tmp.path());
    let first = vec![point("r", 1, "loss")];
    let second = vec![point("r", 2, "loss")];
    assert_eq!(
        write_chunk(&vault, EXP, "r", "b1", &first).unwrap(),
        ChunkWrite::Written
    );
    let before = vault.read_file(&format!("{EXP}/metrics/r/b1.csv")).unwrap();
    assert_eq!(
        write_chunk(&vault, EXP, "r", "b1", &second).unwrap(),
        ChunkWrite::AlreadyPresent
    );
    let after = vault.read_file(&format!("{EXP}/metrics/r/b1.csv")).unwrap();
    assert_eq!(before, after, "a chunk is written once and never rewritten");
    assert_eq!(read_metrics(&vault, EXP).unwrap().rows, first);
}

#[test]
fn unsafe_run_or_batch_names_are_refused() {
    let tmp = TempDir::new();
    let vault = vault_in(tmp.path());
    for (run, batch) in [
        ("..", "b"),
        ("r", "../x"),
        ("a/b", "b"),
        ("", "b"),
        ("r", ".hidden"),
    ] {
        assert!(
            write_chunk(&vault, EXP, run, batch, &[]).is_err(),
            "{run} {batch}"
        );
    }
}

#[test]
fn a_broken_chunk_is_reported_not_guessed() {
    let tmp = TempDir::new();
    let vault = vault_in(tmp.path());
    let _ = write_chunk(&vault, EXP, "r", "ok", &[point("r", 1, "acc")]).unwrap();
    vault
        .write_file(&format!("{EXP}/metrics/r/bad.csv"), b"not,a,chunk\n")
        .unwrap();
    let read = read_metrics(&vault, EXP).unwrap();
    assert_eq!(read.rows, vec![point("r", 1, "acc")]);
    assert_eq!(read.bad_chunks, vec![format!("{EXP}/metrics/r/bad.csv")]);
}

#[test]
fn no_metrics_folder_reads_empty() {
    let tmp = TempDir::new();
    let read = read_metrics(&vault_in(tmp.path()), EXP).unwrap();
    assert!(read.rows.is_empty() && read.bad_chunks.is_empty());
}

fn inbox_row(id: i64, experiment: &str, steps: std::ops::Range<u32>) -> Value {
    let points: Vec<Value> = steps
        .map(|s| json!({"experiment_id": experiment, "metric": "loss", "step": s, "value": 0.5}))
        .collect();
    json!({"id": id, "kind": "metrics", "experiment_id": experiment, "payload": {"points": points}})
}

#[test]
fn drain_then_ack_lists_every_stored_row() {
    let tmp = TempDir::new();
    experiment_file(tmp.path(), &format!("{EXP}.md"), "exp-1");
    let vault = vault_in(tmp.path());
    let dirs = experiment_dirs(&vault).unwrap();
    assert_eq!(dirs.get("exp-1").map(String::as_str), Some(EXP));
    let rows = vec![inbox_row(7, "exp-1", 0..3), inbox_row(8, "exp-1", 3..5)];
    let report = apply_inbox_rows(&vault, &rows, &dirs);
    assert_eq!(report.ack, vec![7, 8]);
    assert_eq!(report.written, 2);
    assert_eq!(read_metrics(&vault, EXP).unwrap().rows.len(), 5);
}

#[test]
fn ack_lost_refetch() {
    let tmp = TempDir::new();
    experiment_file(tmp.path(), &format!("{EXP}.md"), "exp-1");
    let vault = vault_in(tmp.path());
    let dirs = experiment_dirs(&vault).unwrap();
    let rows = vec![inbox_row(7, "exp-1", 0..3)];
    let first = apply_inbox_rows(&vault, &rows, &dirs);
    // The ack never reached the relay, so the same row comes back.
    let again = apply_inbox_rows(&vault, &rows, &dirs);
    assert_eq!(first.ack, vec![7]);
    assert_eq!(again.ack, vec![7], "the stored row is acked again");
    assert_eq!((first.written, again.written, again.duplicates), (1, 0, 1));
    assert_eq!(read_metrics(&vault, EXP).unwrap().rows.len(), 3);
}

#[test]
fn rows_that_cannot_be_stored_are_not_acked() {
    let tmp = TempDir::new();
    let vault = vault_in(tmp.path());
    let dirs = experiment_dirs(&vault).unwrap();
    let rows = vec![
        inbox_row(1, "no-such-experiment", 0..2),
        json!({"id": 2, "kind": "metrics", "payload": {"points": [{"experiment_id": "x", "value": "NaN"}]}}),
        json!({"kind": "metrics", "payload": {}}),
    ];
    let report = apply_inbox_rows(&vault, &rows, &dirs);
    assert!(report.ack.is_empty());
    assert_eq!(report.skipped.len(), 3);
}

#[test]
fn local_post_sent_twice_is_one_chunk() {
    let tmp = TempDir::new();
    experiment_file(tmp.path(), &format!("{EXP}.md"), "exp-1");
    let vault = vault_in(tmp.path());
    let dirs = experiment_dirs(&vault).unwrap();
    let points = inbox_row(0, "exp-1", 0..4)["payload"]["points"].clone();
    let points = points.as_array().unwrap();
    let batch = local_batch_id(points);
    let first = store_metric_points(&vault, &batch, points, &dirs).unwrap();
    let again = store_metric_points(&vault, &local_batch_id(points), points, &dirs).unwrap();
    assert_eq!(first, vec![ChunkWrite::Written]);
    assert_eq!(again, vec![ChunkWrite::AlreadyPresent]);
    assert_eq!(read_metrics(&vault, EXP).unwrap().rows.len(), 4);
    let other = inbox_row(0, "exp-1", 4..6)["payload"]["points"].clone();
    assert_ne!(local_batch_id(other.as_array().unwrap()), batch);
}

#[test]
fn local_post_with_a_bad_point_writes_nothing() {
    let tmp = TempDir::new();
    experiment_file(tmp.path(), &format!("{EXP}.md"), "exp-1");
    let vault = vault_in(tmp.path());
    let dirs = experiment_dirs(&vault).unwrap();
    let points = vec![
        json!({"experiment_id": "exp-1", "metric": "loss", "step": 1, "value": 0.5}),
        json!({"experiment_id": "exp-1", "metric": "loss", "step": 2, "value": "NaN"}),
    ];
    assert!(store_metric_points(&vault, &local_batch_id(&points), &points, &dirs).is_err());
    assert!(read_metrics(&vault, EXP).unwrap().rows.is_empty());
}

/// Every file under `dir`, temps included; a missing folder has none.
fn files_under(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(files_under(&path));
        } else {
            out.push(path);
        }
    }
    out
}

#[test]
fn a_later_group_failing_leaves_no_partial_batch() {
    let tmp = TempDir::new();
    experiment_file(tmp.path(), &format!("{EXP}.md"), "exp-1");
    let vault = vault_in(tmp.path());
    let dirs = experiment_dirs(&vault).unwrap();
    let points = vec![
        json!({"experiment_id": "exp-1", "run": "a", "metric": "loss", "step": 1, "value": 0.5}),
        json!({"experiment_id": "exp-1", "run": "b", "metric": "loss", "step": 1, "value": 0.4}),
    ];
    // A file where run `b`'s folder should be makes the second group's write fail.
    let metrics = tmp.path().join(EXP).join("metrics");
    std::fs::create_dir_all(&metrics).unwrap();
    std::fs::write(metrics.join("b"), "blocker").unwrap();
    let batch = local_batch_id(&points);
    assert!(store_metric_points(&vault, &batch, &points, &dirs).is_err());
    assert_eq!(files_under(&metrics), vec![metrics.join("b")]);
    assert!(read_metrics(&vault, EXP).unwrap().rows.is_empty());
    // Once the blocker is gone, the retry stores the whole batch.
    std::fs::remove_file(metrics.join("b")).unwrap();
    let writes = store_metric_points(&vault, &batch, &points, &dirs).unwrap();
    assert_eq!(writes, vec![ChunkWrite::Written, ChunkWrite::Written]);
    assert_eq!(read_metrics(&vault, EXP).unwrap().rows.len(), 2);
    assert_eq!(files_under(&metrics).len(), 2);
}

#[test]
fn artifact_rows_become_files() {
    let tmp = TempDir::new();
    experiment_file(tmp.path(), &format!("{EXP}.md"), "exp-1");
    let vault = vault_in(tmp.path());
    let dirs = experiment_dirs(&vault).unwrap();
    let row = json!({"id": 9, "kind": "artifacts", "experiment_id": "exp-1",
        "payload": {"experiment_id": "exp-1", "name": "model card", "url": "https://x"}});
    let report = apply_inbox_rows(&vault, std::slice::from_ref(&row), &dirs);
    assert_eq!(report.ack, vec![9]);
    let stored = vault
        .read_text(&format!("{EXP}/artifacts/main/a9.json"))
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&stored).unwrap(),
        row["payload"]
    );
    assert_eq!(apply_inbox_rows(&vault, &[row], &dirs).ack, vec![9]);
}

/// Repo growth for one 100 000-step run logging three metrics, sent as SDK
/// batches of 1 000 points. Prints the bytes on disk and in a git commit.
#[test]
fn repo_growth_100k_steps() {
    let tmp = TempDir::new();
    let vault = vault_in(tmp.path());
    let metrics = ["loss", "accuracy", "learning_rate"];
    let points: Vec<CsvMetric> = (0..100_000)
        .flat_map(|s| metrics.iter().map(move |m| point("main", s, m)))
        .collect();
    for (batch, chunk) in points.chunks(1000).enumerate() {
        let _ = write_chunk(&vault, EXP, "main", &format!("b{batch:04}"), chunk).unwrap();
    }
    let raw = dir_bytes(&tmp.path().join(EXP).join("metrics"));

    let repo = git2::Repository::init(tmp.path()).unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("t", "t@example.com").unwrap();
    let _ = repo
        .commit(Some("HEAD"), &sig, &sig, "metrics", &tree, &[])
        .unwrap();
    let git = dir_bytes(&tmp.path().join(".git").join("objects"));
    println!(
        "repo_growth_100k_steps: {} points, {} chunks, {raw} bytes of CSV, {git} bytes of git objects",
        points.len(),
        points.len().div_ceil(1000)
    );
    assert_eq!(read_metrics(&vault, EXP).unwrap().rows.len(), points.len());
    assert!(git < 16 * 1024 * 1024, "git objects grew {git} bytes");
}

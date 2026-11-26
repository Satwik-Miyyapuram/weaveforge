//! Experiment metrics as CSV chunk files: `run,step,metric,value,time`, with
//! RFC 4180 quoting. Each SDK batch is one chunk; readers merge all chunks.
//!
//! Laws (proved in `tests/metrics_csv.rs`):
//! - `decode(encode(rows)) == rows`, whatever the names hold.
//! - `merge_chunks` keeps one row per `(run, step, metric)`, is idempotent and
//!   gives the same result in any chunk order.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

/// The first line of every chunk.
pub const HEADER: &str = "run,step,metric,value,time";

/// One logged metric point in a chunk.
#[derive(Debug, Clone, PartialEq)]
pub struct CsvMetric {
    /// The run inside the experiment.
    pub run: String,
    /// The training step.
    pub step: f64,
    /// The metric's name.
    pub metric: String,
    /// The logged value.
    pub value: f64,
    /// When it was logged (ISO 8601), when known.
    pub time: Option<String>,
}

/// The chunk text for `rows`, header first, LF line ends.
#[must_use]
pub fn encode(rows: &[CsvMetric]) -> String {
    let mut out = format!("{HEADER}\n");
    for row in rows {
        let cells = [
            quote(&row.run),
            row.step.to_string(),
            quote(&row.metric),
            row.value.to_string(),
            quote(row.time.as_deref().unwrap_or_default()),
        ];
        out.push_str(&cells.join(","));
        out.push('\n');
    }
    out
}

fn quote(cell: &str) -> String {
    if cell.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", cell.replace('"', "\"\""))
    } else {
        cell.to_owned()
    }
}

/// Reads a chunk.
///
/// # Errors
/// A missing header, an unclosed quote, a row without five cells, or a step
/// or value that is not a number. The message names the row.
pub fn decode(text: &str) -> Result<Vec<CsvMetric>, String> {
    let mut records = records(text)?.into_iter();
    match records.next() {
        Some(header) if header.join(",") == HEADER => {}
        _ => return Err("missing header run,step,metric,value,time".to_owned()),
    }
    records
        .enumerate()
        .map(|(i, cells)| to_row(cells).ok_or_else(|| format!("bad row {}", i + 2)))
        .collect()
}

fn to_row(cells: Vec<String>) -> Option<CsvMetric> {
    let [run, step, metric, value, time]: [String; 5] = cells.try_into().ok()?;
    Some(CsvMetric {
        run,
        step: step.parse().ok()?,
        metric,
        value: value.parse().ok()?,
        time: (!time.is_empty()).then_some(time),
    })
}

/// Splits CSV text into records of cells; CRLF and LF both end a record
/// outside quotes. Blank lines are skipped.
fn records(text: &str) -> Result<Vec<Vec<String>>, String> {
    let mut out = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match (quoted, c) {
            (true, '"') if chars.peek() == Some(&'"') => {
                cell.push('"');
                let _ = chars.next();
            }
            (true, '"') => quoted = false,
            (true, other) => cell.push(other),
            (false, '"') if cell.is_empty() => quoted = true,
            (false, ',') => row.push(std::mem::take(&mut cell)),
            (false, '\r') if chars.peek() == Some(&'\n') => {}
            (false, '\n' | '\r') => end_record(&mut out, &mut row, &mut cell),
            (false, other) => cell.push(other),
        }
    }
    if quoted {
        return Err("unclosed quote".to_owned());
    }
    end_record(&mut out, &mut row, &mut cell);
    Ok(out)
}

fn end_record(out: &mut Vec<Vec<String>>, row: &mut Vec<String>, cell: &mut String) {
    if row.is_empty() && cell.is_empty() {
        return;
    }
    row.push(std::mem::take(cell));
    out.push(std::mem::take(row));
}

fn key_order(a: &CsvMetric, b: &CsvMetric) -> Ordering {
    a.run
        .cmp(&b.run)
        .then(a.step.total_cmp(&b.step))
        .then(a.metric.cmp(&b.metric))
}

/// Every row of every chunk, one per `(run, step, metric)`, sorted by that
/// key. When chunks disagree, the row with the smallest `(time, value)` wins,
/// so the result does not depend on which chunk was read first.
#[must_use]
pub fn merge_chunks(chunks: &[Vec<CsvMetric>]) -> Vec<CsvMetric> {
    let mut rows: Vec<CsvMetric> = chunks.iter().flatten().cloned().collect();
    rows.sort_by(|a, b| {
        key_order(a, b)
            .then(a.time.cmp(&b.time))
            .then(a.value.total_cmp(&b.value))
    });
    rows.dedup_by(|later, first| key_order(later, first) == Ordering::Equal);
    rows
}

/// At most about `max_points` rows per `(run, metric)` series: every
/// `len / max_points`-th row by step, plus the series' last row, so a curve
/// never looks like it started later or stopped earlier. Sorted by step, then
/// metric, then run. A budget of 0 keeps everything.
#[must_use]
pub fn thin_series(rows: &[CsvMetric], max_points: usize) -> Vec<CsvMetric> {
    let mut series: BTreeMap<(&str, &str), Vec<&CsvMetric>> = BTreeMap::new();
    for row in rows {
        series
            .entry((row.run.as_str(), row.metric.as_str()))
            .or_default()
            .push(row);
    }
    let mut kept: Vec<CsvMetric> = Vec::new();
    for points in series.values_mut() {
        points.sort_by(|a, b| a.step.total_cmp(&b.step));
        let stride = if max_points == 0 || points.len() <= max_points {
            1
        } else {
            points.len() / max_points
        };
        let last = points.len() - 1;
        kept.extend(
            points
                .iter()
                .enumerate()
                .filter(|(i, _)| i % stride == 0 || *i == last)
                .map(|(_, row)| (*row).clone()),
        );
    }
    kept.sort_by(|a, b| {
        a.step
            .total_cmp(&b.step)
            .then(a.metric.cmp(&b.metric))
            .then(a.run.cmp(&b.run))
    });
    kept
}

/// The distinct metric names, sorted.
#[must_use]
pub fn metric_names(rows: &[CsvMetric]) -> Vec<String> {
    rows.iter()
        .map(|row| row.metric.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

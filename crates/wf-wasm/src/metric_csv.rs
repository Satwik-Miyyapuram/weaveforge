//! Metric CSV chunks for JavaScript (wf-core `metric_csv`): the files-first metrics store.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::metric_csv::{CsvMetric, decode, encode, merge_chunks, thin_series};

use super::to_js;

/// One chunk row as JavaScript sees it.
#[derive(Serialize, Deserialize)]
struct Row {
    run: String,
    step: f64,
    metric: String,
    value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    time: Option<String>,
}

/// What [`metric_csv_history_js`] returns.
#[derive(Serialize)]
struct History {
    rows: Vec<Row>,
    /// Indexes of the chunks that could not be read; they were skipped.
    bad: Vec<usize>,
}

fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

/// [`encode`]: the chunk text for `rows`, header first.
///
/// # Errors
///
/// Fails if `rows` has the wrong shape.
#[wasm_bindgen(js_name = metricCsvEncode)]
pub fn metric_csv_encode_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ run: string; step: number; metric: string; value: number; time?: string }[]"
    )]
    rows: JsValue,
) -> Result<String, JsError> {
    let rows: Vec<Row> = serde_wasm_bindgen::from_value(rows).map_err(js_error)?;
    let rows: Vec<CsvMetric> = rows
        .into_iter()
        .map(|r| CsvMetric {
            run: r.run,
            step: r.step,
            metric: r.metric,
            value: r.value,
            time: r.time,
        })
        .collect();
    Ok(encode(&rows))
}

/// Every chunk decoded, merged ([`merge_chunks`]), narrowed to `metric` when given, and thinned
/// to about `maxPoints` per series ([`thin_series`]; 0 keeps all). A chunk that does not decode
/// is skipped and its index listed in `bad`.
///
/// # Errors
///
/// Fails if `chunks` is not an array of strings.
#[wasm_bindgen(
    js_name = metricCsvHistory,
    unchecked_return_type = "{ rows: { run: string; step: number; metric: string; value: number; time?: string }[]; bad: number[] }"
)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn metric_csv_history_js(
    #[wasm_bindgen(unchecked_param_type = "string[]")] chunks: JsValue,
    metric: Option<String>,
    max_points: u32,
) -> Result<JsValue, JsError> {
    let texts: Vec<String> = serde_wasm_bindgen::from_value(chunks).map_err(js_error)?;
    let mut decoded = Vec::with_capacity(texts.len());
    let mut bad = Vec::new();
    for (i, text) in texts.iter().enumerate() {
        match decode(text) {
            Ok(rows) => decoded.push(rows),
            Err(_) => bad.push(i),
        }
    }
    let mut merged = merge_chunks(&decoded);
    if let Some(name) = metric.as_deref() {
        merged.retain(|r| r.metric == name);
    }
    let rows = thin_series(&merged, max_points as usize)
        .into_iter()
        .map(|r| Row {
            run: r.run,
            step: r.step,
            metric: r.metric,
            value: r.value,
            time: r.time,
        })
        .collect();
    to_js(&History { rows, bad }).map_err(js_error)
}

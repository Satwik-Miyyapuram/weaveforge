//! Reader-mark digest and reading log (wf-core `papers::reading_digest`).
//!
//! The TS wrapper in `packages/wf-wasm/src/wrappers-5.ts` gives the results their types.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::reading_digest::{self, DigestMark, ReadingMark, ReadingPaper};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`highlights_digest`](reading_digest::highlights_digest) (TS `highlightsDigest`).
///
/// # Errors
///
/// Fails if `marks` is not a list of digest marks.
#[wasm_bindgen(js_name = highlightsDigest)]
pub fn highlights_digest_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.DigestMark[]")] marks: JsValue,
    existing: &str,
) -> JsResult<String> {
    let marks: Vec<DigestMark> = serde_wasm_bindgen::from_value(marks)?;
    Ok(reading_digest::highlights_digest(&marks, existing))
}

/// [`draft_reading_log`](reading_digest::draft_reading_log) (TS `draftReadingLog`).
///
/// # Errors
///
/// Fails if `papers` or `marks` are not lists of the right shape.
#[wasm_bindgen(js_name = draftReadingLog)]
pub fn draft_reading_log_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReadingPaper[]")] papers: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReadingMark[]")] marks: JsValue,
    day: &str,
) -> JsResult<String> {
    let papers: Vec<ReadingPaper> = serde_wasm_bindgen::from_value(papers)?;
    let marks: Vec<ReadingMark> = serde_wasm_bindgen::from_value(marks)?;
    Ok(reading_digest::draft_reading_log(&papers, &marks, day))
}

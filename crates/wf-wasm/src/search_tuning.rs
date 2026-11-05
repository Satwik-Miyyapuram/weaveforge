//! Search ranking rules for JavaScript (wf-core `search_tuning`). The JS names match
//! `packages/core/src/search/search-tuning.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::search_tuning::{self, DocumentBoostOptions, RankedDoc};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`fuzziness_for_term`](search_tuning::fuzziness_for_term).
#[wasm_bindgen(js_name = fuzzinessForTerm)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn fuzziness_for_term_js(term: String) -> f64 {
    search_tuning::fuzziness_for_term(&term)
}

/// [`document_boost`](search_tuning::document_boost). `now` is epoch milliseconds.
///
/// # Errors
///
/// Fails if `doc` or `options` has the wrong shape.
#[wasm_bindgen(js_name = documentBoost)]
pub fn document_boost_js(doc: JsValue, options: JsValue, now: f64) -> JsResult<f64> {
    let doc: RankedDoc = serde_wasm_bindgen::from_value(doc)?;
    let options: DocumentBoostOptions = serde_wasm_bindgen::from_value(options)?;
    Ok(search_tuning::document_boost(&doc, &options, now))
}

//! Hybrid search fusion helpers for JavaScript (wf-core `hybrid_fusion`). The JS names match `packages/core/src/search/hybrid-fusion.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::hybrid_fusion;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`strip_stopwords`](hybrid_fusion::strip_stopwords).
#[wasm_bindgen(js_name = stripStopwords)]
pub fn strip_stopwords_js(query: &str) -> String {
    hybrid_fusion::strip_stopwords(query)
}

/// [`query_term_count`](hybrid_fusion::query_term_count).
///
/// # Errors
///
/// Fails if `terms` is not an array of strings.
#[wasm_bindgen(js_name = queryTermCount)]
pub fn query_term_count_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] terms: JsValue,
) -> JsResult<f64> {
    let terms: Vec<String> = serde_wasm_bindgen::from_value(terms)?;
    Ok(hybrid_fusion::query_term_count(&terms))
}

/// [`covered_hit_mask`](hybrid_fusion::covered_hit_mask) as a boolean array.
///
/// # Errors
///
/// Fails if `query_term_counts` is not an array of numbers or `null`.
#[wasm_bindgen(js_name = coveredHitMask)]
pub fn covered_hit_mask_js(
    query_term_counts: JsValue,
    term_count: f64,
    min_coverage: f64,
) -> JsResult<JsValue> {
    let counts: Vec<Option<f64>> = serde_wasm_bindgen::from_value(query_term_counts)?;
    to_js(&hybrid_fusion::covered_hit_mask(
        &counts,
        term_count,
        min_coverage,
    ))
}

/// [`gate_vector_mask`](hybrid_fusion::gate_vector_mask) as a boolean array.
///
/// # Errors
///
/// Fails if `scores` is not an array of numbers.
#[wasm_bindgen(js_name = gateVectorMask)]
pub fn gate_vector_mask_js(scores: JsValue, floor: f64, keep_top: f64) -> JsResult<JsValue> {
    let scores: Vec<f64> = serde_wasm_bindgen::from_value(scores)?;
    to_js(&hybrid_fusion::gate_vector_mask(&scores, floor, keep_top))
}

//! Hybrid search fusion helpers for JavaScript (wf-core `hybrid_fusion`). The JS names match `packages/core/src/search/hybrid-fusion.ts`.

use js_sys::{Array, Reflect};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::hybrid_fusion::{self, HYBRID_MIN_TERM_COVERAGE, HYBRID_VECTOR_KEEP_TOP};

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
#[wasm_bindgen(js_name = coveredHitMask, unchecked_return_type = "boolean[]")]
pub fn covered_hit_mask_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (number | null)[]")] query_term_counts: JsValue,
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
#[wasm_bindgen(js_name = gateVectorMask, unchecked_return_type = "boolean[]")]
pub fn gate_vector_mask_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] scores: JsValue,
    floor: f64,
    keep_top: f64,
) -> JsResult<JsValue> {
    let scores: Vec<f64> = serde_wasm_bindgen::from_value(scores)?;
    to_js(&hybrid_fusion::gate_vector_mask(&scores, floor, keep_top))
}

/// `hit[key]`, read as a plain property.
fn field(hit: &JsValue, key: &str) -> JsValue {
    Reflect::get(hit, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
}

/// The hits whose `mask` entry is `true`, in order.
fn kept(hits: &Array, mask: &[bool]) -> Array {
    hits.iter()
        .zip(mask)
        .filter(|(_, keep)| **keep)
        .map(|(hit, _)| hit)
        .collect()
}

#[wasm_bindgen(typescript_custom_section)]
const COVERED_HITS_TS: &str = r"
/** Keyword hits that matched enough of the query to be worth fusing. */
export function coveredHits<T extends { queryTerms?: readonly string[] }>(
  hits: readonly T[],
  termCount: number,
  minCoverage?: number,
): T[];
/** Vector hits, best first, gated by the encoder's floor. */
export function gateVectorHits<T extends { score: number }>(
  hits: readonly T[],
  floor: number,
  keepTop?: number,
): T[];
";

/// Keyword hits that matched enough of the query to be worth fusing:
/// [`covered_hit_mask`](hybrid_fusion::covered_hit_mask) over `queryTerms?.length ?? null`.
/// `min_coverage` defaults to [`HYBRID_MIN_TERM_COVERAGE`].
///
/// # Errors
///
/// Fails if a hit's `queryTerms.length` is not a number.
#[wasm_bindgen(js_name = coveredHits, skip_typescript)]
pub fn covered_hits_js(
    hits: &Array,
    term_count: f64,
    min_coverage: Option<f64>,
) -> JsResult<Array> {
    let counts = hits
        .iter()
        .map(|hit| {
            let terms = field(&hit, "queryTerms");
            if terms.is_undefined() || terms.is_null() {
                return Ok(None);
            }
            let length = field(&terms, "length");
            if length.is_undefined() || length.is_null() {
                return Ok(None);
            }
            serde_wasm_bindgen::from_value(length).map(Some)
        })
        .collect::<JsResult<Vec<Option<f64>>>>()?;
    let mask = hybrid_fusion::covered_hit_mask(
        &counts,
        term_count,
        min_coverage.unwrap_or(HYBRID_MIN_TERM_COVERAGE),
    );
    Ok(kept(hits, &mask))
}

/// Vector hits, best first, gated by the encoder's floor:
/// [`gate_vector_mask`](hybrid_fusion::gate_vector_mask) over each hit's `score`. `keep_top`
/// defaults to [`HYBRID_VECTOR_KEEP_TOP`].
///
/// # Errors
///
/// Fails if a hit's `score` is not a number.
#[wasm_bindgen(js_name = gateVectorHits, skip_typescript)]
pub fn gate_vector_hits_js(hits: &Array, floor: f64, keep_top: Option<f64>) -> JsResult<Array> {
    let scores = hits
        .iter()
        .map(|hit| serde_wasm_bindgen::from_value(field(&hit, "score")))
        .collect::<JsResult<Vec<f64>>>()?;
    let mask =
        hybrid_fusion::gate_vector_mask(&scores, floor, keep_top.unwrap_or(HYBRID_VECTOR_KEEP_TOP));
    Ok(kept(hits, &mask))
}

//! Hit collapsing and related-list de-duplication for JavaScript (wf-core
//! `result_dedupe`). The JS names match
//! `packages/wf-wasm/src/search-result-dedupe.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::result_dedupe::{self, CollapseHit, DistinctInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`collapse_hits`](result_dedupe::collapse_hits) as `{id, score}` objects.
///
/// # Errors
///
/// Fails if `hits` is not an array of hit records.
#[wasm_bindgen(js_name = collapseToEntities)]
pub fn collapse_hits_js(hits: JsValue, seed_entity_id: &str) -> JsResult<JsValue> {
    let hits: Vec<CollapseHit> = serde_wasm_bindgen::from_value(hits)?;
    to_js(&result_dedupe::collapse_hits(&hits, seed_entity_id))
}

/// [`distinct_related`](result_dedupe::distinct_related) as kept indices and
/// merge pairs.
///
/// # Errors
///
/// Fails if `input` is not a distinct-input record.
#[wasm_bindgen(js_name = distinctRelated)]
pub fn distinct_related_indices_js(input: JsValue) -> JsResult<JsValue> {
    let input: DistinctInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&result_dedupe::distinct_related(&input))
}

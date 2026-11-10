//! Screen-list filtering by search rank for JavaScript (wf-core `rank_filter`).
//! The JS name matches `packages/wf-wasm/src/search-rank-filter.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::rank_filter::{self, RankItem};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`rank_filter_order`](rank_filter::rank_filter_order) as an array of indices
/// into `items`.
///
/// # Errors
///
/// Fails if `hit_entity_ids` is not an array of strings or `items` is not an
/// array of `{id, fallbackText}` records.
#[wasm_bindgen(js_name = rankFilterOrder)]
pub fn rank_filter_order_js(
    query: &str,
    hit_entity_ids: JsValue,
    items: JsValue,
) -> JsResult<JsValue> {
    let hit_entity_ids: Vec<String> = serde_wasm_bindgen::from_value(hit_entity_ids)?;
    let items: Vec<RankItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&rank_filter::rank_filter_order(
        query,
        &hit_entity_ids,
        &items,
    ))
}

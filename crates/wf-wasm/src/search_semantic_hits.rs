//! Passage ids and the blank-query check for the semantic index (wf-core `search::semantic_hits`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::semantic_hits;

/// [`passage_id`](semantic_hits::passage_id): the id of a document's `index`th passage.
#[wasm_bindgen(js_name = passageId)]
#[must_use]
pub fn passage_id_js(doc_id: &str, index: u32) -> String {
    semantic_hits::passage_id(doc_id, usize::try_from(index).unwrap_or(usize::MAX))
}

/// [`is_blank_query`](semantic_hits::is_blank_query): whether a query has nothing to search for.
#[wasm_bindgen(js_name = isBlankQuery)]
#[must_use]
pub fn is_blank_query_js(query: &str) -> bool {
    semantic_hits::is_blank_query(query)
}

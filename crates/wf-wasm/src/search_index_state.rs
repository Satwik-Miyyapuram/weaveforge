//! Resource-type to search-kind policy and the search index's bookkeeping for JavaScript
//! (wf-core `search_index_state`). The JS names match `packages/wf-wasm/src/search-index-state.ts`.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen takes arguments by value"
)]

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::query::SearchKind;
use wf_core::search::search_index_state::{self, SearchIndexStateCore};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The search index's bookkeeping (wf-core `SearchIndexStateCore`): whether an index is held,
/// its document count, PDF pages per paper, and the stale kinds. The caller keeps the JS handles
/// (index, graph, density, PDF texts) and clears them when `forget` runs.
#[wasm_bindgen(js_name = SearchIndexState)]
#[derive(Debug, Default)]
pub struct SearchIndexState {
    inner: SearchIndexStateCore,
}

#[wasm_bindgen]
impl SearchIndexState {
    /// Nothing indexed yet.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether an index has been adopted and not forgotten.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn ready(&self) -> bool {
        self.inner.ready()
    }

    /// Documents the index holds, for the size warning.
    #[wasm_bindgen(getter = documentCount)]
    #[must_use]
    pub fn document_count(&self) -> u32 {
        self.inner.document_count()
    }

    /// Replaces the document count.
    #[wasm_bindgen(setter = documentCount)]
    pub fn set_document_count(&mut self, count: u32) {
        self.inner.set_document_count(count);
    }

    /// Takes the index as built, holding `documentCount` documents.
    pub fn adopt(&mut self, document_count: u32) {
        self.inner.adopt(document_count);
    }

    /// Pages held for `paperId`; 0 when none.
    #[wasm_bindgen(js_name = pdfPageCount)]
    #[must_use]
    pub fn pdf_page_count(&self, paper_id: &str) -> u32 {
        self.inner.pdf_page_count(paper_id)
    }

    /// Records the page count held for `paperId`.
    #[wasm_bindgen(js_name = setPdfPageCount)]
    pub fn set_pdf_page_count(&mut self, paper_id: &str, count: u32) {
        self.inner.set_pdf_page_count(paper_id, count);
    }

    /// Replaces every paper's page count from a `Map` or a `[paperId, pages][]` iterable.
    ///
    /// # Errors
    ///
    /// Fails if `counts` is not iterable or an entry is not a `[string, number]` pair.
    #[wasm_bindgen(js_name = replacePdfPageCounts)]
    pub fn replace_pdf_page_counts(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Iterable<readonly [string, number]>")]
        counts: JsValue,
    ) -> Result<(), JsValue> {
        let iter = js_sys::try_iter(&counts)?
            .ok_or_else(|| JsValue::from_str("pdfPageCounts must be iterable"))?;
        let entries = iter
            .map(|entry| {
                serde_wasm_bindgen::from_value::<(String, u32)>(entry?).map_err(JsValue::from)
            })
            .collect::<Result<BTreeMap<String, u32>, JsValue>>()?;
        self.inner.replace_pdf_page_counts(entries);
        Ok(())
    }

    /// Notes the kinds a write to `resourceType` can change. Returns `true` when the whole index
    /// was distrusted (an unmapped type), so the caller has nothing left to refresh selectively.
    #[wasm_bindgen(js_name = markStale)]
    pub fn mark_stale(&mut self, resource_type: Option<String>) -> bool {
        self.inner
            .mark_stale(resource_type.as_deref().unwrap_or(""))
    }

    /// The kinds waiting to be refreshed. Taking does not clear them.
    ///
    /// # Errors
    ///
    /// Fails only if the result cannot be serialized.
    #[wasm_bindgen(js_name = pendingStale, unchecked_return_type = "B.SearchKind[]")]
    pub fn pending_stale(&self) -> JsResult<JsValue> {
        to_js(&self.inner.pending_stale())
    }

    /// Forgets the kinds a completed refresh replaced.
    ///
    /// # Errors
    ///
    /// Fails if `kinds` is not an array of search kinds.
    #[wasm_bindgen(js_name = settleStale)]
    pub fn settle_stale(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "readonly B.SearchKind[]")] kinds: JsValue,
    ) -> JsResult<()> {
        let kinds: Vec<SearchKind> = serde_wasm_bindgen::from_value(kinds)?;
        self.inner.settle_stale(&kinds);
        Ok(())
    }

    /// Nothing is indexed any more; the next build starts from scratch.
    pub fn forget(&mut self) {
        self.inner.forget();
    }
}

/// [`kinds_for_resource`](search_index_state::kinds_for_resource): the kinds a write can change, or `null` when unmapped.
///
/// # Errors
///
/// Fails only if the result cannot be serialized.
#[wasm_bindgen(js_name = kindsForResource, unchecked_return_type = "B.SearchKind[] | null")]
pub fn kinds_for_resource_js(resource_type: &str) -> JsResult<wasm_bindgen::JsValue> {
    to_js(&search_index_state::kinds_for_resource(resource_type))
}

/// Every mapped resource type, in table order.
///
/// # Errors
///
/// Fails only if the result cannot be serialized.
#[wasm_bindgen(js_name = resourceTypes, unchecked_return_type = "string[]")]
pub fn resource_types_js() -> JsResult<wasm_bindgen::JsValue> {
    to_js(&search_index_state::resource_types())
}

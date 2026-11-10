//! Vault-page query text for PostgREST reads (wf-core `vault::page_query`). The TS wrappers in
//! `packages/wf-wasm/src/vault-page.ts` name these for the repository.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::page_query;

/// [`title_or_body_filter`](page_query::title_or_body_filter): the PostgREST `or` filter for a
/// title or body search. `undefined` for an empty query.
#[wasm_bindgen(js_name = vaultTitleOrBodyFilter)]
#[must_use]
pub fn vault_title_or_body_filter_js(query: &str) -> Option<String> {
    page_query::title_or_body_filter(query)
}

/// [`title_like_pattern`](page_query::title_like_pattern): the ILIKE pattern for a normalised title key.
#[wasm_bindgen(js_name = vaultTitleLikePattern)]
#[must_use]
pub fn vault_title_like_pattern_js(key: &str) -> String {
    page_query::title_like_pattern(key)
}

/// [`is_missing_body_preview_column`](page_query::is_missing_body_preview_column). Takes the
/// error's `message` and `code`, either of which may be absent.
#[wasm_bindgen(js_name = isMissingBodyPreviewColumn)]
#[must_use]
pub fn is_missing_body_preview_column_js(message: Option<String>, code: Option<String>) -> bool {
    page_query::is_missing_body_preview_column(message.as_deref(), code.as_deref())
}

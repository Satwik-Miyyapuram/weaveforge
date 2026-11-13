//! Note-link helpers (wf-core `vault::link_resolve`): the existing note a `[[title]]` resolves to,
//! and the message for link targets that failed to load.
//!
//! The TS wrappers in `packages/wf-wasm/src/vault-link-resolve.ts` apply the `undefined` handling.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::link_resolve;

/// [`find_title_match`](link_resolve::find_title_match). Returns the index of the match, or
/// `undefined` in JS when none matches.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = findTitleMatch)]
#[must_use]
pub fn find_title_match_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] existing_titles: Vec<String>,
    title: &str,
) -> Option<usize> {
    link_resolve::find_title_match(&existing_titles, title)
}

/// [`link_targets_error`](link_resolve::link_targets_error). Returns the message, or `undefined`
/// when no target failed.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = linkTargetsError)]
#[must_use]
pub fn link_targets_error_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] failed: Vec<String>,
) -> Option<String> {
    link_resolve::link_targets_error(&failed)
}

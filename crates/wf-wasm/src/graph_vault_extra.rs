//! Graph persisted-state merge and vault page create/tree for JavaScript. The JS names match
//! `packages/core/src/features/relations/domain/graph-persisted-state.ts` and
//! `packages/core/src/shared/core-contract.ts` (vault page types).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_settings::{self, GraphPersistedState};
use wf_core::vault::page::{self, NewVaultPageInput, VaultPageSummary};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`merge_graph_persisted_state`](graph_settings::merge_graph_persisted_state): `stored` is the
/// parsed state, or `null` for the defaults.
///
/// # Errors
///
/// Fails if `stored` has the wrong shape.
#[wasm_bindgen(js_name = mergeGraphPersistedState)]
pub fn merge_graph_persisted_state_js(stored: JsValue) -> JsResult<JsValue> {
    let stored: Option<GraphPersistedState> = serde_wasm_bindgen::from_value(stored)?;
    to_js(&graph_settings::merge_graph_persisted_state(stored))
}

/// [`create_vault_page`](page::create_vault_page) with the id and time supplied.
///
/// # Errors
///
/// Fails if `input` has the wrong shape, or with the validation message when the title is blank.
#[wasm_bindgen(js_name = createVaultPageWith)]
pub fn create_vault_page_with_js(input: JsValue, id: &str, now: &str) -> JsResult<JsValue> {
    let input: NewVaultPageInput = serde_wasm_bindgen::from_value(input)?;
    let made = page::create_vault_page(&input, id, now).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&made)
}

/// [`build_page_tree`](page::build_page_tree) over the summary fields of each page.
///
/// # Errors
///
/// Fails if `pages` has the wrong shape.
#[wasm_bindgen(js_name = buildPageTree)]
pub fn build_page_tree_js(pages: JsValue) -> JsResult<JsValue> {
    let pages: Vec<VaultPageSummary> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&page::build_page_tree(&pages))
}

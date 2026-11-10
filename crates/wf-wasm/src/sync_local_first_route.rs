//! wasm exports for `sync::local_first_route` (TS: `sync-local-first-route.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::local_first_route;

use super::to_js;

/// [`local_first_route::synced_tables`] as an array of table names.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = syncedTables)]
pub fn synced_tables_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&local_first_route::synced_tables())
}

/// [`local_first_route::is_synced_table`].
#[wasm_bindgen(js_name = isSyncedTable)]
pub fn is_synced_table_js(table: &str) -> bool {
    local_first_route::is_synced_table(table)
}

/// [`local_first_route::is_both_ends_rpc`].
#[wasm_bindgen(js_name = isBothEndsRpc)]
pub fn is_both_ends_rpc_js(name: &str) -> bool {
    local_first_route::is_both_ends_rpc(name)
}

/// [`local_first_route::both_ends_merge`]: `"serverError"`, `"preferLocalRows"` or `"concatRows"`.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = bothEndsMerge)]
pub fn both_ends_merge_js(
    name: &str,
    here_failed: bool,
    there_failed: bool,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&local_first_route::both_ends_merge(
        name,
        here_failed,
        there_failed,
    ))
}

//! Quick open ranking and palette groups (wf-core `editor_workspace::quick_open`),
//! served straight from `@weaveforge/wasm`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::editor_workspace::quick_open::{self as quick, QuickOpenResult};
use wf_core::editor_workspace::workspace_tree::WorkspaceTreeNode;

use super::to_js;

/// [`quick_open_results`](quick::quick_open_results) as an array of `{ node, score, matched }`.
///
/// # Errors
///
/// Fails if `documents` is not an array of tree rows.
#[wasm_bindgen(js_name = quickOpenResults, unchecked_return_type = "B.QuickOpenResult[]")]
pub fn quick_open_results_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.WorkspaceTreeNode[]")] documents: JsValue,
    query: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let documents: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(documents)?;
    to_js(&quick::quick_open_results(&documents, query))
}

/// [`group_results`](quick::group_results) as an array of `{ kind, label, results }`.
///
/// # Errors
///
/// Fails if `results` is not an array of quick-open results.
#[wasm_bindgen(js_name = groupResults, unchecked_return_type = "B.QuickOpenGroup[]")]
pub fn group_results_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.QuickOpenResult[]")] results: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let results: Vec<QuickOpenResult> = serde_wasm_bindgen::from_value(results)?;
    to_js(&quick::group_results(&results))
}

/// [`painted_order`](quick::painted_order): the results group by group.
///
/// # Errors
///
/// Fails if `results` is not an array of quick-open results.
#[wasm_bindgen(js_name = paintedOrder, unchecked_return_type = "B.QuickOpenResult[]")]
pub fn painted_order_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.QuickOpenResult[]")] results: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let results: Vec<QuickOpenResult> = serde_wasm_bindgen::from_value(results)?;
    to_js(&quick::painted_order(&results))
}

/// [`step_cursor`](quick::step_cursor): the row an arrow key lands on.
#[wasm_bindgen(js_name = stepCursor)]
#[must_use]
pub fn step_cursor_js(cursor: i32, delta: i32, length: i32) -> i32 {
    quick::step_cursor(cursor, delta, length)
}

/// [`title_of`](quick::title_of): the title a row is shown under.
///
/// # Errors
///
/// Fails if `node` is not a tree row.
#[wasm_bindgen(js_name = titleOf)]
pub fn title_of_js(
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceTreeNode")] node: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let node: WorkspaceTreeNode = serde_wasm_bindgen::from_value(node)?;
    Ok(quick::title_of(&node).to_owned())
}

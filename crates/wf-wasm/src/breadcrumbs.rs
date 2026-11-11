//! The path to the document on screen (wf-core `editor_workspace::breadcrumbs`),
//! re-exported from `packages/wf-wasm/src/wrappers-1.ts`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::editor_workspace::breadcrumbs::{self as crumbs, BreadcrumbTab};
use wf_core::editor_workspace::workspace_tree::WorkspaceTreeNode;

use super::to_js;

/// [`breadcrumbs`](crumbs::breadcrumbs) as an array of crumbs.
///
/// # Errors
///
/// Fails if `tab`, `files` or `lists` does not have the shape of its type.
#[wasm_bindgen(js_name = breadcrumbs)]
pub fn breadcrumbs_js(
    tab: JsValue,
    files: JsValue,
    lists: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let tab: BreadcrumbTab = serde_wasm_bindgen::from_value(tab)?;
    let files: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(files)?;
    let lists: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(lists)?;
    to_js(&crumbs::breadcrumbs(&tab, &files, &lists))
}

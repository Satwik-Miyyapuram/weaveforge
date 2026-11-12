//! The path to the document on screen (wf-core `editor_workspace::breadcrumbs`),
//! served straight from wasm as `breadcrumbs`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::editor_workspace::breadcrumbs::{self as crumbs, BreadcrumbTab};
use wf_core::editor_workspace::workspace_tree::WorkspaceTreeNode;

use super::to_js;

/// [`breadcrumbs`](crumbs::breadcrumbs) as an array of crumbs. A missing `lists` reads as `[]`.
///
/// # Errors
///
/// Fails if `tab`, `files` or `lists` does not have the shape of its type.
#[wasm_bindgen(js_name = breadcrumbs, unchecked_return_type = "B.Crumb[]")]
pub fn breadcrumbs_js(
    #[wasm_bindgen(unchecked_param_type = "B.BreadcrumbTab")] tab: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.WorkspaceTreeNode[]")] files: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "readonly B.WorkspaceTreeNode[]")] lists: Option<
        JsValue,
    >,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let tab: BreadcrumbTab = serde_wasm_bindgen::from_value(tab)?;
    let files: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(files)?;
    let lists: Vec<WorkspaceTreeNode> = match lists {
        Some(lists) => serde_wasm_bindgen::from_value(lists)?,
        None => Vec::new(),
    };
    to_js(&crumbs::breadcrumbs(&tab, &files, &lists))
}

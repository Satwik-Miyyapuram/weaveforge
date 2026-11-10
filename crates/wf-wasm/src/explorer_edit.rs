//! Explorer create, rename and move rules (wf-core `editor_workspace::explorer_edit`).

use std::collections::HashSet;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::explorer_edit as edit;
use wf_core::editor_workspace::workspace_tree::WorkspaceTreeNode;

use super::to_js;

/// [`root_key`](edit::root_key).
///
/// # Errors
///
/// Fails if the argument is not an editable root, or the result cannot be serialised.
#[wasm_bindgen(js_name = rootKey, unchecked_return_type = "string")]
pub fn root_key_js(
    #[wasm_bindgen(unchecked_param_type = "B.EditableRoot")] root: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let root: edit::EditableRoot = serde_wasm_bindgen::from_value(root)?;
    to_js(&edit::root_key(root))
}

/// [`root_of_kind`](edit::root_of_kind). `kind` is a snake_case tree kind name.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = rootOfKind)]
pub fn root_of_kind_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&edit::root_of_kind(kind))
}

/// [`root_of`](edit::root_of).
///
/// # Errors
///
/// Fails if the node does not have the expected shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = rootOf)]
pub fn root_of_js(node: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let node: WorkspaceTreeNode = serde_wasm_bindgen::from_value(node)?;
    to_js(&edit::root_of(&node))
}

/// [`creatable_under`](edit::creatable_under).
///
/// # Errors
///
/// Fails if the node does not have the expected shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = creatableUnder, unchecked_return_type = "readonly B.CreateKind[]")]
pub fn creatable_under_js(
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceTreeNode")] node: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let node: WorkspaceTreeNode = serde_wasm_bindgen::from_value(node)?;
    to_js(&edit::creatable_under(&node))
}

/// [`creation_kind_for`](edit::creation_kind_for). `activeKind` is `null` when no document is open.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = creationKindFor)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn creation_kind_for_js(
    active_kind: Option<String>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&edit::creation_kind_for(active_kind.as_deref()))
}

/// [`can_rename`](edit::can_rename).
///
/// # Errors
///
/// Fails if the node does not have the expected shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = canRename, unchecked_return_type = "boolean")]
pub fn can_rename_js(
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceTreeNode")] node: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let node: WorkspaceTreeNode = serde_wasm_bindgen::from_value(node)?;
    to_js(&edit::can_rename(&node))
}

/// [`creation_target`](edit::creation_target). `active` is `null` when no document is open,
/// `folders` the ids of the notes made as folders.
///
/// # Errors
///
/// Fails if an argument does not have the expected shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = creationTarget)]
pub fn creation_target_js(
    kind: JsValue,
    active: JsValue,
    folders: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let kind: edit::CreateKind = serde_wasm_bindgen::from_value(kind)?;
    let active: Option<edit::ActiveDocument> = serde_wasm_bindgen::from_value(active)?;
    let folders: Vec<String> = serde_wasm_bindgen::from_value(folders)?;
    let folders: HashSet<String> = folders.into_iter().collect();
    to_js(&edit::creation_target(kind, active.as_ref(), &folders))
}

/// [`can_drop`](edit::can_drop).
///
/// # Errors
///
/// Fails if an argument does not have the expected shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = canDrop, unchecked_return_type = "boolean")]
pub fn can_drop_js(
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceTreeNode")] source: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceTreeNode")] target: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let source: WorkspaceTreeNode = serde_wasm_bindgen::from_value(source)?;
    let target: WorkspaceTreeNode = serde_wasm_bindgen::from_value(target)?;
    to_js(&edit::can_drop(&source, &target))
}

/// [`drop_parent_id`](edit::drop_parent_id).
///
/// # Errors
///
/// Fails if the node does not have the expected shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = dropParentId)]
pub fn drop_parent_id_js(target: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let target: WorkspaceTreeNode = serde_wasm_bindgen::from_value(target)?;
    to_js(&edit::drop_parent_id(&target))
}

/// [`draft_placeholder`](edit::draft_placeholder).
///
/// # Errors
///
/// Fails if the argument is not a create kind, or the result cannot be serialised.
#[wasm_bindgen(js_name = draftPlaceholder, unchecked_return_type = "string")]
pub fn draft_placeholder_js(
    #[wasm_bindgen(unchecked_param_type = "B.CreateKind")] kind: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let kind: edit::CreateKind = serde_wasm_bindgen::from_value(kind)?;
    to_js(&edit::draft_placeholder(kind))
}

/// [`draft_icon`](edit::draft_icon).
///
/// # Errors
///
/// Fails if the argument is not a create kind, or the result cannot be serialised.
#[wasm_bindgen(js_name = draftIcon, unchecked_return_type = "string")]
pub fn draft_icon_js(
    #[wasm_bindgen(unchecked_param_type = "B.CreateKind")] kind: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let kind: edit::CreateKind = serde_wasm_bindgen::from_value(kind)?;
    to_js(&edit::draft_icon(kind))
}

/// [`draft_makes`](edit::draft_makes).
///
/// # Errors
///
/// Fails if the argument is not a create kind, or the result cannot be serialised.
#[wasm_bindgen(js_name = draftMakes, unchecked_return_type = "B.DraftMakes")]
pub fn draft_makes_js(
    #[wasm_bindgen(unchecked_param_type = "B.CreateKind")] kind: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let kind: edit::CreateKind = serde_wasm_bindgen::from_value(kind)?;
    to_js(&edit::draft_makes(kind))
}

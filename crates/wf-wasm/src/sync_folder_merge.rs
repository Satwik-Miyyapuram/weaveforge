//! Folder merge and mirror manifest for JavaScript (wf-core `sync::folder_merge`,
//! `sync::folder_mirror::next_manifest`).

use std::collections::HashMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::deserialize::ImportDiffEntry;
use wf_core::sync::folder_layout;
use wf_core::sync::folder_merge;
use wf_core::sync::folder_mirror;
use wf_core::sync::import_action::ImportAction;
use wf_core::sync::merge_vault_page::VaultPageBase;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`merge_both_changed`](folder_merge::merge_both_changed). `base` and `workspace_content`
/// may be absent, which keeps the entry as it was.
///
/// # Errors
///
/// Fails when `entry` or `base` is not the shape the folder import produces.
#[wasm_bindgen(js_name = mergeBothChanged)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn merge_both_changed_js(
    entry: JsValue,
    base: JsValue,
    workspace_content: Option<String>,
) -> JsResult<JsValue> {
    let entry: ImportDiffEntry = serde_wasm_bindgen::from_value(entry)?;
    let base: Option<VaultPageBase> = serde_wasm_bindgen::from_value(base)?;
    to_js(&folder_merge::merge_both_changed(
        entry,
        base.as_ref(),
        workspace_content.as_deref(),
    ))
}

/// [`count_actions`](folder_merge::count_actions).
///
/// # Errors
///
/// Fails when `entries` is not a list of import entries.
#[wasm_bindgen(js_name = countActions)]
pub fn count_actions_js(entries: JsValue) -> JsResult<JsValue> {
    let entries: Vec<ImportDiffEntry> = serde_wasm_bindgen::from_value(entries)?;
    to_js(&folder_merge::count_actions(&entries))
}

/// [`count_action_list`](folder_merge::count_action_list): the tally over bare actions.
///
/// # Errors
///
/// Fails when `actions` is not a list of import actions.
#[wasm_bindgen(js_name = countActionList)]
pub fn count_action_list_js(actions: JsValue) -> JsResult<JsValue> {
    let actions: Vec<ImportAction> = serde_wasm_bindgen::from_value(actions)?;
    to_js(&folder_merge::count_action_list(&actions))
}

/// [`next_manifest`](folder_mirror::next_manifest).
#[wasm_bindgen(js_name = nextManifest)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned Vec<String> arguments.
#[must_use]
pub fn next_manifest_js(
    previous: Vec<String>,
    written: Vec<String>,
    removed: Vec<String>,
) -> Vec<String> {
    folder_mirror::next_manifest(&previous, &written, &removed)
}

/// [`json_edit_since`](folder_mirror::json_edit_since). `base` is the recorded digest map.
///
/// # Errors
///
/// Fails when `base` is not an object of string digests.
#[wasm_bindgen(js_name = jsonEditSince)]
pub fn json_edit_since_js(base: JsValue, path: &str, text: &str) -> JsResult<bool> {
    let base: HashMap<String, String> = serde_wasm_bindgen::from_value(base)?;
    Ok(folder_mirror::json_edit_since(&base, path, text))
}

/// [`folder_title_from_path`](folder_layout::folder_title_from_path).
#[wasm_bindgen(js_name = folderTitleFromPath)]
#[must_use]
pub fn folder_title_from_path_js(path: &str) -> String {
    folder_layout::folder_title_from_path(path)
}

/// [`pick_project_folder`](folder_layout::pick_project_folder). `undefined` when no folder fits.
#[wasm_bindgen(js_name = pickProjectFolder)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned Vec<String> arguments.
#[must_use]
pub fn pick_project_folder_js(dirs: Vec<String>, exact: &str, tail: &str) -> Option<String> {
    folder_layout::pick_project_folder(&dirs, exact, tail)
}

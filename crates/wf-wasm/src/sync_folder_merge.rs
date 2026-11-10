//! Folder merge and mirror manifest for JavaScript (wf-core `sync::folder_merge`,
//! `sync::folder_mirror::next_manifest`).

use std::collections::{BTreeMap, HashMap};

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
pub fn json_edit_since_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] base: JsValue,
    path: &str,
    text: &str,
) -> JsResult<bool> {
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

/// [`settle_conflict`](folder_merge::settle_conflict). `resolutions` maps each conflicted path to
/// its resolution. `undefined` when the entry settles to nothing (markers, or kept as it is).
///
/// # Errors
///
/// Fails when `entry` or `resolutions` is not the shape the folder import produces.
#[wasm_bindgen(js_name = settleConflict, unchecked_return_type = "B.ImportDiffEntry | undefined")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn settle_conflict_js(
    #[wasm_bindgen(unchecked_param_type = "B.ImportDiffEntry")] entry: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, B.ConflictResolution>>")]
    resolutions: JsValue,
) -> JsResult<JsValue> {
    let entry: ImportDiffEntry = serde_wasm_bindgen::from_value(entry)?;
    let resolutions: BTreeMap<String, folder_merge::ConflictResolution> =
        serde_wasm_bindgen::from_value(resolutions)?;
    to_js(&folder_merge::settle_conflict(entry, &resolutions))
}

/// [`keep_both_title`](folder_merge::keep_both_title): the title of the copy kept beside a conflict.
#[wasm_bindgen(js_name = keepBothTitle)]
#[must_use]
pub fn keep_both_title_js(title: &str) -> String {
    folder_merge::keep_both_title(title)
}

/// [`read_mirror_base`](folder_mirror::read_mirror_base): the manifest's path-to-digest map.
/// `text` is the manifest text, or `undefined` when there is none.
///
/// # Errors
///
/// Fails only when the result cannot be turned into a JS object.
#[wasm_bindgen(js_name = readMirrorBase, unchecked_return_type = "Record<string, string>")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn read_mirror_base_js(text: Option<String>) -> JsResult<JsValue> {
    to_js(&folder_mirror::read_mirror_base(text.as_deref()))
}

/// [`read_mirror_bases`](folder_mirror::read_mirror_bases): the manifest's note bases, by path.
///
/// # Errors
///
/// Fails only when the result cannot be turned into a JS object.
#[wasm_bindgen(js_name = readMirrorBases, unchecked_return_type = "Record<string, B.VaultPageBase>")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn read_mirror_bases_js(text: Option<String>) -> JsResult<JsValue> {
    to_js(&folder_mirror::read_mirror_bases(text.as_deref()))
}

/// [`claim_digest`](folder_mirror::claim_digest): `base` with `path` recorded for `stamped`.
///
/// # Errors
///
/// Fails when `base` is not an object of string digests.
#[wasm_bindgen(js_name = claimDigest, unchecked_return_type = "Record<string, string>")]
pub fn claim_digest_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] base: JsValue,
    path: &str,
    stamped: &str,
) -> JsResult<JsValue> {
    let base: indexmap::IndexMap<String, String> = serde_wasm_bindgen::from_value(base)?;
    to_js(&folder_mirror::claim_digest(&base, path, stamped))
}

/// [`moved_path`](folder_mirror::moved_path): `path` after the project folder `old` moved to `root`.
#[wasm_bindgen(js_name = movedPath)]
#[must_use]
pub fn moved_path_js(old: &str, root: &str, path: &str) -> String {
    folder_mirror::moved_path(old, root, path)
}

/// [`rekey_manifest_text`](folder_mirror::rekey_manifest_text). `undefined` when `text` is not a
/// JSON object.
#[wasm_bindgen(js_name = rekeyManifestText)]
#[must_use]
pub fn rekey_manifest_text_js(text: &str, old: &str, root: &str) -> Option<String> {
    folder_mirror::rekey_manifest_text(text, old, root)
}

/// [`unstamp_for_compare`](folder_mirror::unstamp_for_compare): `text` with a README or manifest's
/// export time blanked, for comparing two copies of a mirrored file.
#[wasm_bindgen(js_name = unstampForCompare)]
#[must_use]
pub fn unstamp_for_compare_js(path: &str, text: &str) -> String {
    folder_mirror::unstamp_for_compare(path, text)
}

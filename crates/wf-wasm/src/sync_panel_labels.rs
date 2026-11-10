//! Sync issues panel labels and hunk grouping for JavaScript (wf-core `sync::panel_labels`).

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::panel_labels::{self, Choice};
use wf_core::sync::text_diff::DiffLine;

use super::to_js;

/// [`group_hunks`](panel_labels::group_hunks): unchanged and changed runs of a body diff.
///
/// # Errors
///
/// Fails if `lines` has the wrong shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = groupHunks, unchecked_return_type = "B.HunkGroup[]")]
pub fn group_hunks_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.DiffLine[]")] lines: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let lines: Vec<DiffLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&panel_labels::group_hunks(&lines))
}

/// [`is_settled`](panel_labels::is_settled): whether a field's choice is complete.
///
/// # Errors
///
/// Fails if `choice` has the wrong shape.
#[wasm_bindgen(js_name = isSettled)]
pub fn is_settled_js(
    choice: JsValue,
    ours: &str,
    theirs: &str,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let choice: Option<Choice> = serde_wasm_bindgen::from_value(choice)?;
    Ok(panel_labels::is_settled(choice.as_ref(), ours, theirs))
}

/// [`device_markers`](panel_labels::device_markers): conflict markers named for this device and the cloud.
#[wasm_bindgen(js_name = deviceMarkers)]
pub fn device_markers_js(ours: &str, theirs: &str) -> String {
    panel_labels::device_markers(ours, theirs)
}

/// [`kind_of`](panel_labels::kind_of): the label for a synced table.
#[wasm_bindgen(js_name = kindOf)]
pub fn kind_of_js(table: &str) -> String {
    panel_labels::kind_of(table)
}

/// [`name_of`](panel_labels::name_of): a conflict's title, or "Untitled".
///
/// # Errors
///
/// Fails if `local` or `remote` is not an object (or null for `remote`).
#[wasm_bindgen(js_name = nameOf)]
pub fn name_of_js(
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] local: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown> | null")] remote: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let local: Map<String, Value> = serde_wasm_bindgen::from_value(local)?;
    let remote: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(remote)?;
    Ok(panel_labels::name_of(&local, remote.as_ref()))
}

/// [`humanize`](panel_labels::humanize): a field name as a label.
#[wasm_bindgen(js_name = humanize)]
pub fn humanize_js(field: &str) -> String {
    panel_labels::humanize(field)
}

/// [`plural`](panel_labels::plural): "n word" with the right plural.
#[wasm_bindgen(js_name = plural)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn plural_js(n: u32, word: &str, many: Option<String>) -> String {
    panel_labels::plural(n, word, many.as_deref())
}

/// [`device_label`](panel_labels::device_label): the adoption suffix name for a platform string.
#[wasm_bindgen(js_name = deviceLabel)]
pub fn device_label_js(platform: &str) -> String {
    panel_labels::device_label(platform)
}

/// [`unique_device_name`](panel_labels::unique_device_name): an adoption label no taken name matches.
///
/// # Errors
///
/// Fails if `taken` is not an array of strings.
#[wasm_bindgen(js_name = uniqueDeviceName)]
pub fn unique_device_name_js(
    name: &str,
    device_label: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] taken: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let taken: Vec<String> = serde_wasm_bindgen::from_value(taken)?;
    Ok(panel_labels::unique_device_name(name, device_label, &taken))
}

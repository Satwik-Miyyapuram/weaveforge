//! Folder-diff helpers for JavaScript (wf-core `workspace::folder_diff`).
//! The JS names match `packages/wf-wasm/src/workspace-folder-diff.ts`.

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::folder_diff::{self, ParsedEntity};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`rename_sources`](folder_diff::rename_sources) over the parsed entities and the
/// folder and current texts by path. Returns new path to old path.
///
/// # Errors
///
/// Fails if the inputs do not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = renameSources)]
pub fn rename_sources_js(parsed: JsValue, folder: JsValue, current: JsValue) -> JsResult<JsValue> {
    let parsed: Vec<ParsedEntity> = serde_wasm_bindgen::from_value(parsed)?;
    let folder: BTreeMap<String, String> = serde_wasm_bindgen::from_value(folder)?;
    let current: BTreeMap<String, String> = serde_wasm_bindgen::from_value(current)?;
    to_js(&folder_diff::rename_sources(&parsed, &folder, &current))
}

/// [`seen_files`](folder_diff::seen_files) over the folder and current texts, the
/// base digests by path, and the renames from [`renameSources`].
///
/// # Errors
///
/// Fails if the inputs do not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = seenFiles)]
pub fn seen_files_js(
    folder: JsValue,
    current: JsValue,
    base: JsValue,
    renamed: JsValue,
) -> JsResult<JsValue> {
    let folder: BTreeMap<String, String> = serde_wasm_bindgen::from_value(folder)?;
    let current: BTreeMap<String, String> = serde_wasm_bindgen::from_value(current)?;
    let base: BTreeMap<String, String> = serde_wasm_bindgen::from_value(base)?;
    let renamed: BTreeMap<String, String> = serde_wasm_bindgen::from_value(renamed)?;
    to_js(&folder_diff::seen_files(&folder, &current, &base, &renamed))
}

//! Folder-diff helpers for JavaScript (wf-core `workspace::folder_diff`).
//! The JS names match `packages/wf-wasm/src/wrappers-11.ts`.

use std::collections::{BTreeMap, HashSet};

use js_sys::{Array, Set};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::deserialize::ParsedEntity as FileEntity;
use wf_core::workspace::folder_diff::{self, ParsedEntity};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`importable_entities`](folder_diff::importable_entities): the vault pages, and the files
/// whose note id is in `note_ids`, in input order.
///
/// # Errors
///
/// Fails if `entities` is not a list of parsed folder files, `note_ids` holds a non-string, or
/// the result cannot be serialized.
#[wasm_bindgen(js_name = importableEntities, unchecked_return_type = "B.ParsedEntity[]")]
pub fn importable_entities_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ParsedEntity[]")] entities: JsValue,
    #[wasm_bindgen(js_name = noteIds, unchecked_param_type = "ReadonlySet<string>")] note_ids: &Set,
) -> JsResult<JsValue> {
    let entities: Vec<FileEntity> = serde_wasm_bindgen::from_value(entities)?;
    let note_ids: HashSet<String> = serde_wasm_bindgen::from_value(Array::from(note_ids).into())?;
    to_js(&folder_diff::importable_entities(&entities, &note_ids))
}

/// [`rename_sources`](folder_diff::rename_sources) over the parsed entities and the
/// folder and current texts by path. Returns new path to old path.
///
/// # Errors
///
/// Fails if the inputs do not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = renameSources, unchecked_return_type = "Record<string, string>")]
pub fn rename_sources_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.FolderParsedEntity[]")] parsed: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] folder: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] current: JsValue,
) -> JsResult<JsValue> {
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
#[wasm_bindgen(js_name = seenFiles, unchecked_return_type = "Record<string, B.FolderSeenFile>")]
pub fn seen_files_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] folder: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] current: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] base: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] renamed: JsValue,
) -> JsResult<JsValue> {
    let folder: BTreeMap<String, String> = serde_wasm_bindgen::from_value(folder)?;
    let current: BTreeMap<String, String> = serde_wasm_bindgen::from_value(current)?;
    let base: BTreeMap<String, String> = serde_wasm_bindgen::from_value(base)?;
    let renamed: BTreeMap<String, String> = serde_wasm_bindgen::from_value(renamed)?;
    to_js(&folder_diff::seen_files(&folder, &current, &base, &renamed))
}

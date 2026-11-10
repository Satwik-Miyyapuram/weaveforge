//! Folder export, import parsing and import diffs for JavaScript (steps 0b-5b, 0b-5c). Each export
//! wraps a `wf-core` function; the JS shapes match `packages/core`.
//!
//! The snapshot and the stored JSON rows cross as JSON text: `JSON.stringify` drops
//! `undefined` fields, as the TypeScript serializer and diff saw them.

use std::collections::HashMap;

use serde::de::DeserializeOwned;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::change_origin::ChangeSide;
use wf_core::sync::deserialize::{
    ExistingEntity, ParsedEntity, diff_workspace, parse_workspace_folder,
};
use wf_core::sync::folder_layout::WorkspaceProject;
use wf_core::sync::folder_mirror::plan_mirror;
use wf_core::sync::import_action::ActionCounts;
use wf_core::sync::json_entities::{
    JsonDiffEntry, JsonRow, ParsedJsonData, WorkspaceJsonKind, add_counts, count_json_actions,
    diff_json_data, json_data_path, parse_json_data,
};
use wf_core::sync::serialize::serialize_workspace;
use wf_core::sync::workspace_snapshot::{WorkspaceSnapshot, workspace_snapshot_counts};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Parses JSON text the TS side produced with `JSON.stringify`.
fn from_json<T: DeserializeOwned>(json: &str) -> JsResult<T> {
    serde_json::from_str(json).map_err(serde_wasm_bindgen::Error::new)
}

/// [`wf_core::sync::serialize::serialize_workspace`] for JS, as `{ files, assets }`.
///
/// # Errors
///
/// Fails when the snapshot JSON is invalid, or the project id or name is over
/// `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = serializeWorkspace)]
pub fn serialize_workspace_js(
    snapshot_json: &str,
    project_id: &str,
    project_name: &str,
) -> JsResult<JsValue> {
    check_text(project_id)?;
    check_text(project_name)?;
    let snapshot: WorkspaceSnapshot = from_json(snapshot_json)?;
    let project = WorkspaceProject {
        id: project_id.to_owned(),
        name: project_name.to_owned(),
    };
    to_js(&serialize_workspace(&snapshot, &project))
}

/// [`wf_core::sync::workspace_snapshot::workspace_snapshot_counts`] for JS.
///
/// # Errors
///
/// Fails when the snapshot JSON is invalid.
#[wasm_bindgen(js_name = workspaceSnapshotCounts)]
pub fn workspace_snapshot_counts_js(snapshot_json: &str) -> JsResult<JsValue> {
    let snapshot: WorkspaceSnapshot = from_json(snapshot_json)?;
    to_js(&workspace_snapshot_counts(&snapshot))
}

/// [`wf_core::sync::deserialize::parse_workspace_folder`] for JS, over `[path, content][]`.
///
/// # Errors
///
/// Fails when a path or content is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = parseWorkspaceFolder)]
pub fn parse_workspace_folder_js(files: JsValue) -> JsResult<JsValue> {
    let files: Vec<(String, String)> = serde_wasm_bindgen::from_value(files)?;
    for (path, content) in &files {
        check_text(path)?;
        check_text(content)?;
    }
    to_js(&parse_workspace_folder(&files))
}

/// [`wf_core::sync::deserialize::diff_workspace`] for JS. `sides` maps a parsed path to who
/// changed it; the TS wrapper fills it from `origin`. A path it lacks is `Unknown`. Without
/// `sides`, there is no origin.
///
/// # Errors
///
/// Fails when an argument does not match its shape.
#[wasm_bindgen(js_name = diffWorkspace)]
pub fn diff_workspace_js(parsed: JsValue, existing: JsValue, sides: JsValue) -> JsResult<JsValue> {
    let parsed: Vec<ParsedEntity> = serde_wasm_bindgen::from_value(parsed)?;
    let existing: Vec<ExistingEntity> = serde_wasm_bindgen::from_value(existing)?;
    let sides: Option<HashMap<String, ChangeSide>> = serde_wasm_bindgen::from_value(sides)?;
    let lookup = sides
        .map(|sides| move |path: &str| sides.get(path).copied().unwrap_or(ChangeSide::Unknown));
    let origin = lookup.as_ref().map(|f| f as &dyn Fn(&str) -> ChangeSide);
    to_js(&diff_workspace(&parsed, &existing, origin))
}

/// [`wf_core::sync::json_entities::json_data_path`] for JS.
///
/// # Errors
///
/// Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units or `kind` is not a
/// known kind.
#[wasm_bindgen(js_name = jsonDataPath)]
pub fn json_data_path_js(project_root: js_sys::JsString, kind: JsValue) -> JsResult<String> {
    let project_root = &crate::guarded_text(&project_root)?;
    let kind: WorkspaceJsonKind = serde_wasm_bindgen::from_value(kind)?;
    Ok(json_data_path(project_root, kind))
}

/// [`wf_core::sync::json_entities::parse_json_data`] for JS, as `null` when it is not a JSON array.
///
/// # Errors
///
/// Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `kind` is
/// not a known kind.
#[wasm_bindgen(js_name = parseJsonData)]
pub fn parse_json_data_js(
    path: js_sys::JsString,
    content: js_sys::JsString,
    kind: JsValue,
) -> JsResult<JsValue> {
    let path = &crate::guarded_text(&path)?;
    let content = &crate::guarded_text(&content)?;
    let kind: WorkspaceJsonKind = serde_wasm_bindgen::from_value(kind)?;
    to_js(&parse_json_data(path, content, kind))
}

/// [`wf_core::sync::json_entities::diff_json_data`] for JS. `side` is who changed `parsed.path`;
/// the TS wrapper asks `origin` for it.
///
/// # Errors
///
/// Fails when an argument does not match its shape.
#[wasm_bindgen(js_name = diffJsonData)]
pub fn diff_json_data_js(parsed: JsValue, existing_json: &str, side: JsValue) -> JsResult<JsValue> {
    let parsed: ParsedJsonData = serde_wasm_bindgen::from_value(parsed)?;
    let existing: Vec<JsonRow> = from_json(existing_json)?;
    let side: Option<ChangeSide> = serde_wasm_bindgen::from_value(side)?;
    let origin = side.map(|side| move |_: &str| side);
    to_js(&diff_json_data(
        &parsed,
        &existing,
        origin.as_ref().map(|f| f as &dyn Fn(&str) -> ChangeSide),
    ))
}

/// [`wf_core::sync::json_entities::count_json_actions`] for JS.
///
/// # Errors
///
/// Fails when `entries` does not match the diff entry shape.
#[wasm_bindgen(js_name = countJsonActions)]
pub fn count_json_actions_js(entries: JsValue) -> JsResult<JsValue> {
    let entries: Vec<JsonDiffEntry> = serde_wasm_bindgen::from_value(entries)?;
    to_js(&count_json_actions(&entries))
}

/// [`wf_core::sync::json_entities::add_counts`] for JS.
///
/// # Errors
///
/// Fails when either argument is not action counts.
#[wasm_bindgen(js_name = addCounts, unchecked_return_type = "B.ActionCounts")]
pub fn add_counts_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<B.ActionCounts>")] a: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<B.ActionCounts>")] b: JsValue,
) -> JsResult<JsValue> {
    let a: ActionCounts = serde_wasm_bindgen::from_value(a)?;
    let b: ActionCounts = serde_wasm_bindgen::from_value(b)?;
    to_js(&add_counts(a, b))
}

/// [`wf_core::sync::folder_mirror::plan_mirror`] for JS: `files` is `[path, content][]`,
/// `asset_paths` and `previous_paths` are `string[]`, `base` is an optional
/// `{ [path]: digest }` and `disk` is `{ [path]: text }` for the paths the plan reads.
/// Returns the `MirrorResult` (`mirrored` and `bases` as `[path, value][]`).
///
/// # Errors
///
/// Fails when an argument has the wrong shape.
#[wasm_bindgen(js_name = planMirror)]
pub fn plan_mirror_js(
    files: JsValue,
    asset_paths: JsValue,
    previous_paths: JsValue,
    base: JsValue,
    disk: JsValue,
) -> JsResult<JsValue> {
    let files: Vec<(String, String)> = serde_wasm_bindgen::from_value(files)?;
    let asset_paths: Vec<String> = serde_wasm_bindgen::from_value(asset_paths)?;
    let previous_paths: Vec<String> = serde_wasm_bindgen::from_value(previous_paths)?;
    let base: Option<HashMap<String, String>> = serde_wasm_bindgen::from_value(base)?;
    let disk: HashMap<String, String> = serde_wasm_bindgen::from_value(disk)?;
    let plan = plan_mirror(&files, &asset_paths, &previous_paths, base.as_ref(), &disk)
        .map_err(|err| serde_wasm_bindgen::Error::new(err.to_string()))?;
    to_js(&plan)
}

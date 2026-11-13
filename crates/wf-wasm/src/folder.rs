//! Folder export, import parsing and import diffs for JavaScript (steps 0b-5b, 0b-5c). Each export
//! wraps a `wf-core` function; the JS shapes match `packages/core`.
//!
//! The snapshot and the stored JSON rows are read through `JSON.stringify`, which drops
//! `undefined` fields, as the TypeScript serializer and diff saw them.

use std::collections::HashMap;

use js_sys::{Array, Function, JSON, JsString, Object, Reflect};
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
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

/// `JSON.stringify(value)`; a value with no JSON text (`undefined`) reads as empty text.
fn stringify(value: &JsValue) -> Result<String, JsValue> {
    Ok(JSON::stringify(value)?.as_string().unwrap_or_default())
}

/// `value[key]`.
fn get(value: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    Reflect::get(value, &JsValue::from_str(key))
}

/// [`wf_core::sync::serialize::serialize_workspace`] for JS: the project's folder-mirror files
/// for a snapshot, as `{ files: { [path]: content }, assets }`.
///
/// # Errors
///
/// Fails when the snapshot cannot be stringified or read, or the project id or name is over
/// `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(
    js_name = serializeWorkspace,
    unchecked_return_type = "{ files: Record<string, string>; assets: B.SerializedAsset[] }"
)]
pub fn serialize_workspace_js(
    #[wasm_bindgen(unchecked_param_type = "object")] snapshot: &JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ id: string; name: string }")] project: &JsValue,
) -> Result<JsValue, JsValue> {
    let snapshot_json = stringify(snapshot)?;
    let project = WorkspaceProject {
        id: crate::guarded_text(&get(project, "id")?.unchecked_into::<JsString>())?,
        name: crate::guarded_text(&get(project, "name")?.unchecked_into::<JsString>())?,
    };
    let snapshot: WorkspaceSnapshot = from_json(&snapshot_json)?;
    let out = serialize_workspace(&snapshot, &project);
    let files = Object::from_entries(&to_js(&out.files)?)?;
    let result = Object::new();
    let _ = Reflect::set(&result, &JsValue::from_str("files"), &files)?;
    let _ = Reflect::set(&result, &JsValue::from_str("assets"), &to_js(&out.assets)?)?;
    Ok(result.into())
}

/// [`wf_core::sync::workspace_snapshot::workspace_snapshot_counts`] for JS.
///
/// # Errors
///
/// Fails when the snapshot cannot be stringified or read.
#[wasm_bindgen(
    js_name = workspaceSnapshotCounts,
    unchecked_return_type = "B.WorkspaceSnapshotCounts"
)]
pub fn workspace_snapshot_counts_js(
    #[wasm_bindgen(unchecked_param_type = "object")] snapshot: &JsValue,
) -> Result<JsValue, JsValue> {
    let snapshot: WorkspaceSnapshot = from_json(&stringify(snapshot)?)?;
    Ok(to_js(&workspace_snapshot_counts(&snapshot))?)
}

/// [`wf_core::sync::deserialize::parse_workspace_folder`] for JS: every importable entity in a
/// folder's `{ [path]: content }` files.
///
/// # Errors
///
/// Fails when a path or content is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = parseWorkspaceFolder, unchecked_return_type = "B.ParsedEntity[]")]
pub fn parse_workspace_folder_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] files: &JsValue,
) -> JsResult<JsValue> {
    let files: Vec<(String, String)> =
        serde_wasm_bindgen::from_value(Object::entries(files.unchecked_ref()).into())?;
    for (path, content) in &files {
        check_text(path)?;
        check_text(content)?;
    }
    to_js(&parse_workspace_folder(&files))
}

/// [`wf_core::sync::deserialize::diff_workspace`] for JS: what importing `parsed` would do to
/// `existing`. `options.origin` is asked once for every parsed path up front (so it must be
/// pure); a path it lacks is `Unknown`, and without it there is no origin.
///
/// # Errors
///
/// Fails when an argument does not match its shape, or `origin` throws.
#[wasm_bindgen(js_name = diffWorkspace, unchecked_return_type = "B.ImportDiff")]
pub fn diff_workspace_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ParsedEntity[]")] parsed: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExistingEntity[]")] existing: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "{ origin?(path: string): B.ChangeSide }")]
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let origin = match options {
        Some(options) => get(&options, "origin")?,
        None => JsValue::UNDEFINED,
    };
    // As `Object.fromEntries(parsed.map((e) => [e.path, origin(e.path)]))`, before any parsing.
    let sides = if origin.is_truthy() {
        let origin: &Function = origin.unchecked_ref();
        let entries = Array::new();
        for entity in Array::from(&parsed).iter() {
            let path = get(&entity, "path")?;
            let side = origin.call1(&JsValue::UNDEFINED, &path)?;
            let _ = entries.push(&Array::of2(&path, &side));
        }
        Some(Object::from_entries(&entries)?)
    } else {
        None
    };
    let parsed: Vec<ParsedEntity> = serde_wasm_bindgen::from_value(parsed)?;
    let existing: Vec<ExistingEntity> = serde_wasm_bindgen::from_value(existing)?;
    let sides: Option<HashMap<String, ChangeSide>> = sides
        .map(|sides| serde_wasm_bindgen::from_value(sides.into()))
        .transpose()?;
    let lookup = sides
        .map(|sides| move |path: &str| sides.get(path).copied().unwrap_or(ChangeSide::Unknown));
    let origin = lookup.as_ref().map(|f| f as &dyn Fn(&str) -> ChangeSide);
    Ok(to_js(&diff_workspace(&parsed, &existing, origin))?)
}

/// [`wf_core::sync::json_entities::json_data_path`] for JS.
///
/// # Errors
///
/// Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units or `kind` is not a
/// known kind.
#[wasm_bindgen(js_name = jsonDataPath)]
pub fn json_data_path_js(
    project_root: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceJsonKind")] kind: JsValue,
) -> JsResult<String> {
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
#[wasm_bindgen(js_name = parseJsonData, unchecked_return_type = "B.ParsedJsonData | null")]
pub fn parse_json_data_js(
    path: js_sys::JsString,
    content: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceJsonKind")] kind: JsValue,
) -> JsResult<JsValue> {
    let path = &crate::guarded_text(&path)?;
    let content = &crate::guarded_text(&content)?;
    let kind: WorkspaceJsonKind = serde_wasm_bindgen::from_value(kind)?;
    parse_json_data(path, content, kind).map_or(Ok(JsValue::NULL), |parsed| to_js(&parsed))
}

/// [`wf_core::sync::json_entities::diff_json_data`] for JS: what importing a JSON data file would
/// do to the stored rows. `options.origin?.(parsed.path)` says who changed the file.
///
/// # Errors
///
/// Fails when an argument does not match its shape, or `origin` throws.
#[wasm_bindgen(js_name = diffJsonData, unchecked_return_type = "B.JsonDiff")]
pub fn diff_json_data_js(
    #[wasm_bindgen(unchecked_param_type = "B.ParsedJsonData")] parsed: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly Readonly<Record<string, unknown>>[]")]
    existing: &JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "{ origin?(path: string): B.ChangeSide }")]
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let existing_json = stringify(existing)?;
    // `options.origin?.(parsed.path)`: a method call, so `this` is `options`.
    let side = match options {
        Some(options) => {
            let origin = get(&options, "origin")?;
            if origin.is_undefined() || origin.is_null() {
                JsValue::UNDEFINED
            } else {
                let path = get(&parsed, "path")?;
                origin.unchecked_ref::<Function>().call1(&options, &path)?
            }
        }
        None => JsValue::UNDEFINED,
    };
    let parsed: ParsedJsonData = serde_wasm_bindgen::from_value(parsed)?;
    let existing: Vec<JsonRow> = from_json(&existing_json)?;
    let side: Option<ChangeSide> = serde_wasm_bindgen::from_value(side)?;
    let origin = side.map(|side| move |_: &str| side);
    Ok(to_js(&diff_json_data(
        &parsed,
        &existing,
        origin.as_ref().map(|f| f as &dyn Fn(&str) -> ChangeSide),
    ))?)
}

/// [`wf_core::sync::json_entities::count_json_actions`] for JS.
///
/// # Errors
///
/// Fails when `entries` does not match the diff entry shape.
#[wasm_bindgen(js_name = countJsonActions, unchecked_return_type = "B.ActionCounts")]
pub fn count_json_actions_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.JsonDiffEntry[]")] entries: JsValue,
) -> JsResult<JsValue> {
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

/// [`wf_core::sync::folder_mirror::plan_mirror`] for JS: what mirroring `serialized` into the
/// folder would do, without touching it. `disk` holds the folder's text for every file path and
/// for every previous path that is not present but has a `base` entry; a missing key is a
/// missing file. Assets are not fetched: their folder paths only count as present, so they are
/// never removed. Returns the `MirrorResult` (`mirrored` and `bases` as `[path, value][]`).
///
/// # Errors
///
/// Fails when an argument has the wrong shape.
#[wasm_bindgen(js_name = planMirror, unchecked_return_type = "B.MirrorResult")]
pub fn plan_mirror_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ files: Readonly<Record<string, string>>; assets: readonly B.SerializedAsset[] }"
    )]
    serialized: &JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] previous_paths: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>> | undefined")]
    base: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] disk: JsValue,
) -> Result<JsValue, JsValue> {
    let files = Object::entries(get(serialized, "files")?.unchecked_ref());
    let asset_paths: Array = Array::from(&get(serialized, "assets")?)
        .iter()
        .map(|asset| get(&asset, "folderPath"))
        .collect::<Result<_, _>>()?;
    let files: Vec<(String, String)> = serde_wasm_bindgen::from_value(files.into())?;
    let asset_paths: Vec<String> = serde_wasm_bindgen::from_value(asset_paths.into())?;
    let previous_paths: Vec<String> = serde_wasm_bindgen::from_value(previous_paths)?;
    let base: Option<HashMap<String, String>> = serde_wasm_bindgen::from_value(base)?;
    let disk: HashMap<String, String> = serde_wasm_bindgen::from_value(disk)?;
    let plan = plan_mirror(&files, &asset_paths, &previous_paths, base.as_ref(), &disk)
        .map_err(|err| serde_wasm_bindgen::Error::new(err.to_string()))?;
    Ok(to_js(&plan)?)
}

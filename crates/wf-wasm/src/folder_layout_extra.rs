//! Folder layout and ink metadata helpers for JavaScript (wf-core `sync::folder_layout` and
//! `sync::ink_note`). The JS names match `packages/core/src/workspace/folder-layout.ts` and
//! `packages/core/src/ink/ink-note.ts`. Enums cross as their serde string form.

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::folder_layout::{self, AssetScope, WorkspaceEntityType};
use wf_core::sync::ink_note::{self, InkNoteMeta};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`parse_kind_suffix`](folder_layout::parse_kind_suffix): the entity type, or `null`.
#[wasm_bindgen(js_name = parseKindSuffix)]
pub fn parse_kind_suffix_js(path: &str) -> JsResult<JsValue> {
    match folder_layout::parse_kind_suffix(path) {
        Some(entity) => to_js(&entity),
        None => Ok(JsValue::NULL),
    }
}

/// [`flat_path`](folder_layout::flat_path). `entity` is a `WorkspaceEntityType` string.
///
/// # Errors
///
/// Fails if `entity` is not a known entity type.
#[wasm_bindgen(js_name = flatPath)]
pub fn flat_path_js(
    entity: JsValue,
    id: &str,
    title: &str,
    project_root: &str,
) -> JsResult<String> {
    let entity: WorkspaceEntityType = serde_wasm_bindgen::from_value(entity)?;
    Ok(folder_layout::flat_path(entity, id, title, project_root))
}

/// [`log_path`](folder_layout::log_path).
#[wasm_bindgen(js_name = logPath)]
pub fn log_path_js(id: &str, entry_date: &str, project_root: &str) -> String {
    folder_layout::log_path(id, entry_date, project_root)
}

/// [`paper_pdf_path`](folder_layout::paper_pdf_path).
#[wasm_bindgen(js_name = paperPdfPath)]
pub fn paper_pdf_path_js(paper_id: &str, project_root: &str) -> String {
    folder_layout::paper_pdf_path(paper_id, project_root)
}

/// [`paper_html_path`](folder_layout::paper_html_path).
#[wasm_bindgen(js_name = paperHtmlPath)]
pub fn paper_html_path_js(paper_id: &str, project_root: &str) -> String {
    folder_layout::paper_html_path(paper_id, project_root)
}

/// [`asset_path`](folder_layout::asset_path). `scope` is `"notes"`, `"papers"` or `"report"`.
///
/// # Errors
///
/// Fails on any other scope.
#[wasm_bindgen(js_name = assetPath)]
pub fn asset_path_js(scope: &str, storage_path: &str) -> JsResult<String> {
    let scope = match scope {
        "notes" => AssetScope::Notes,
        "papers" => AssetScope::Papers,
        "report" => AssetScope::Report,
        other => {
            return Err(serde_wasm_bindgen::Error::new(format!(
                "unknown asset scope {other}"
            )));
        }
    };
    Ok(folder_layout::asset_path(scope, storage_path))
}

/// [`folder_key`](folder_layout::folder_key) (TS `folderSegments` joined with `/`): the folder
/// of one picked file's relative path.
#[wasm_bindgen(js_name = folderKey)]
#[must_use]
pub fn folder_key_js(relative_path: &str) -> String {
    folder_layout::folder_key(relative_path)
}

/// [`folder_keys`](folder_layout::folder_keys) (TS `folderKeys`): every folder the picked files
/// lead to, shallowest first.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = folderKeys)]
#[must_use]
pub fn folder_keys_js(relative_paths: Vec<String>) -> Vec<String> {
    folder_layout::folder_keys(&relative_paths)
}

/// [`is_ink_note_frontmatter`](ink_note::is_ink_note_frontmatter).
///
/// # Errors
///
/// Fails if `frontmatter` is not an object.
#[wasm_bindgen(js_name = isInkNoteFrontmatter)]
pub fn is_ink_note_frontmatter_js(
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] frontmatter: JsValue,
) -> JsResult<bool> {
    let fm: Map<String, Value> = serde_wasm_bindgen::from_value(frontmatter)?;
    Ok(ink_note::is_ink_note_frontmatter(&fm))
}

/// [`write_ink_note_meta`](ink_note::write_ink_note_meta) as a plain object, keys in TS order.
///
/// # Errors
///
/// Fails if `meta` has the wrong shape.
#[wasm_bindgen(js_name = writeInkNoteMeta, unchecked_return_type = "Record<string, unknown>")]
pub fn write_ink_note_meta_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] meta: JsValue,
) -> JsResult<JsValue> {
    let meta: InkNoteMeta = serde_wasm_bindgen::from_value(meta)?;
    let fields: Map<String, Value> = ink_note::write_ink_note_meta(&meta).into_iter().collect();
    to_js(&fields)
}

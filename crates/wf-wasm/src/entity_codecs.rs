//! Entity file codecs for JavaScript (wf-core `entity_codecs`). `kind` is an
//! `EntityKind` string: `log_entry`, `experiment`, `report_section` or `reading_list`.
//! Rows cross as plain camelCase objects.

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::entity_codecs::{self, CodecError, EntityKind};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

fn js_error(e: &CodecError) -> serde_wasm_bindgen::Error {
    serde_wasm_bindgen::Error::new(e.to_string())
}

/// [`parse_entity_row`](entity_codecs::parse_entity_row): the row, or `null` when the
/// text is not a file of `kind`.
///
/// # Errors
///
/// Throws for a file written by a newer app, or an unknown `kind`.
#[wasm_bindgen(js_name = entityRowFromFile, unchecked_return_type = "Record<string, unknown> | null")]
pub fn entity_row_from_file_js(
    #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
    text: &str,
) -> JsResult<JsValue> {
    let kind: EntityKind = serde_wasm_bindgen::from_value(kind)?;
    match entity_codecs::parse_entity_row(kind, text) {
        Ok(row) => to_js(&row),
        Err(CodecError::NotThisKind) => Ok(JsValue::NULL),
        Err(e) => Err(js_error(&e)),
    }
}

/// [`render_entity_row`](entity_codecs::render_entity_row): the file text for `row`,
/// keeping the keys of `existing` that the kind does not own.
///
/// # Errors
///
/// Throws when the row has no id, `existing` is another item or kind, or `existing`
/// was written by a newer app.
#[wasm_bindgen(js_name = entityFileFromRow)]
pub fn entity_file_from_row_js(
    #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
    existing: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] row: JsValue,
) -> JsResult<String> {
    let kind: EntityKind = serde_wasm_bindgen::from_value(kind)?;
    let row: Map<String, Value> = serde_wasm_bindgen::from_value(row)?;
    entity_codecs::render_entity_row(kind, existing.as_deref(), &row).map_err(|e| js_error(&e))
}

/// [`entity_path`](entity_codecs::entity_path): where a new item of `kind` is written.
///
/// # Errors
///
/// Throws when the row has no id (or a log entry has no date).
#[wasm_bindgen(js_name = entityPath)]
pub fn entity_path_js(
    #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] row: JsValue,
    project_root: Option<String>,
) -> JsResult<String> {
    let kind: EntityKind = serde_wasm_bindgen::from_value(kind)?;
    let row: Map<String, Value> = serde_wasm_bindgen::from_value(row)?;
    entity_codecs::entity_path(kind, &row, project_root.as_deref().unwrap_or(""))
        .map_err(|e| js_error(&e))
}

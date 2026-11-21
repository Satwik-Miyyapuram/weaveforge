//! Paper and annotation files for JavaScript (files-first L1/L2). Each export wraps
//! `wf_core::papers::paper_file` or `wf_core::reader::annotations_file`; the laws they
//! keep are in `docs/building/core/papers.md` and `docs/building/core/reader.md`.

use std::fmt::Display;

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::papers::paper_file::{paper_row, parse_paper_file, write_paper_row};
use wf_core::reader::annotations_file::{
    AnnotationRow, annotations_file_path, parse_annotations, render_annotations,
};
use wf_core::sync::folder_layout::comments_path;

use super::to_js;

fn js_error(error: impl Display) -> JsError {
    JsError::new(&error.to_string())
}

fn rows_from_js(value: JsValue) -> Result<Vec<AnnotationRow>, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(js_error)
}

/// The `Paper` row a `.paper.md` file holds ([`paper_row`] of [`parse_paper_file`]).
///
/// # Errors
///
/// Fails when the text is not a paper file.
#[wasm_bindgen(js_name = paperRowFromFile, unchecked_return_type = "Record<string, unknown>")]
pub fn paper_row_from_file_js(text: &str) -> Result<JsValue, JsError> {
    let file = parse_paper_file(text).map_err(js_error)?;
    to_js(&paper_row(&file)).map_err(js_error)
}

/// [`write_paper_row`]: the file text after writing `row` into `existing` (a new
/// file when `existing` is `null`). Keeps the body, relations and unknown keys.
///
/// # Errors
///
/// Fails when `existing` is not a paper file or is from a newer app.
#[wasm_bindgen(js_name = writePaperRow)]
pub fn write_paper_row_js(
    existing: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] row: JsValue,
) -> Result<String, JsError> {
    let row: Map<String, Value> = serde_wasm_bindgen::from_value(row).map_err(js_error)?;
    write_paper_row(existing.as_deref(), &row).map_err(js_error)
}

/// [`parse_annotations`]: the rows of an annotations file.
///
/// # Errors
///
/// Fails when the text is not a JSON array of objects with a string `id`.
#[wasm_bindgen(
    js_name = parseAnnotationsFile,
    unchecked_return_type = "Record<string, unknown>[]"
)]
pub fn parse_annotations_file_js(text: &str) -> Result<JsValue, JsError> {
    to_js(&parse_annotations(text).map_err(js_error)?).map_err(js_error)
}

/// [`render_annotations`]: the file text for `rows`, sorted by id.
///
/// # Errors
///
/// Fails when `rows` is not an array of objects.
#[wasm_bindgen(js_name = renderAnnotationsFile)]
pub fn render_annotations_file_js(
    #[wasm_bindgen(unchecked_param_type = "readonly Record<string, unknown>[]")] rows: JsValue,
) -> Result<String, JsError> {
    Ok(render_annotations(&rows_from_js(rows)?))
}

/// [`annotations_file_path`]: the sidecar next to the paper file, under its name
/// (`x.paper.md` -> `x.annotations.json`).
#[must_use]
#[wasm_bindgen(js_name = annotationsFilePath)]
pub fn annotations_file_path_js(paper_path: &str) -> String {
    annotations_file_path(paper_path)
}

/// [`comments_path`]: the comments sidecar next to an item, under its name
/// (`x.paper.md` -> `x.comments.json`, `x.md` -> `x.comments.json`).
#[must_use]
#[wasm_bindgen(js_name = commentsFilePath)]
pub fn comments_file_path_js(item_path: &str) -> String {
    comments_path(item_path)
}

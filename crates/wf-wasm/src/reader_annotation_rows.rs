//! Stored reader annotation row to domain annotation, for JavaScript (wf-core
//! `reader::annotation_rows`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation_rows::{ReaderAnnotationRow, to_domain};

use super::to_js;

/// [`to_domain`] (TS `toDomain`): the row as a `ReaderAnnotation` object.
///
/// # Errors
///
/// Throws an `Error` (`Invalid annotation type in store: <type>`) when the row's type is not a
/// reader annotation type, and fails if `row` is not a `ReaderAnnotationRow` object.
#[wasm_bindgen(js_name = annotationRowToDomain)]
pub fn annotation_row_to_domain(row: JsValue) -> Result<JsValue, wasm_bindgen::JsError> {
    let row: ReaderAnnotationRow = serde_wasm_bindgen::from_value(row)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
    let annotation = to_domain(row).map_err(|message| wasm_bindgen::JsError::new(&message))?;
    to_js(&annotation).map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

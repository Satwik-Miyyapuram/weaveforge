//! Annotation pin row to domain pin (wf-core `papers::annotation_pin`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::annotation_pin::{self, AnnotationPinRow};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`to_domain`](annotation_pin::to_domain) (TS `annotationPinToDomain`).
///
/// # Errors
///
/// Fails if `row` is not an annotation pin row, or the result cannot be converted.
#[wasm_bindgen(js_name = annotationPinToDomain, unchecked_return_type = "B.AnnotationPin")]
pub fn annotation_pin_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.AnnotationPinRow")] row: JsValue,
) -> JsResult<JsValue> {
    let row: AnnotationPinRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&annotation_pin::to_domain(row))
}

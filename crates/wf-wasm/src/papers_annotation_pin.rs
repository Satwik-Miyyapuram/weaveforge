//! Annotation pin row to domain pin (wf-core `papers::annotation_pin`).
//!
//! The TS wrapper in `packages/wf-wasm/src/papers-annotation-pin.ts` gives the results their types.

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
#[wasm_bindgen(js_name = annotationPinToDomain)]
pub fn annotation_pin_to_domain_js(row: JsValue) -> JsResult<JsValue> {
    let row: AnnotationPinRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&annotation_pin::to_domain(row))
}

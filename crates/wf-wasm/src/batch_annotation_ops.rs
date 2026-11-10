//! Image-region annotations for bulk extract (wf-core `reader::batch_annotation_ops`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::batch_annotation_ops as ops;

use super::to_js;

/// [`collect_annotation_image_regions`](ops::collect_annotation_image_regions).
///
/// # Errors
///
/// Fails if the annotations do not have the shape of a TS `ReaderAnnotation`,
/// or the result cannot be serialised.
#[wasm_bindgen(js_name = collectAnnotationImageRegions, unchecked_return_type = "B.BatchImageRegion[]")]
pub fn collect_annotation_image_regions_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnnotationInput[]")] annotations: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let annotations: Vec<ops::AnnotationInput> = serde_wasm_bindgen::from_value(annotations)?;
    to_js(&ops::collect_annotation_image_regions(&annotations))
}

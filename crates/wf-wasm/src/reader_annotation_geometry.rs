//! Annotation geometry per page (the removed TS `project-annotation-geometry`).
//! Wraps `wf_core::reader::annotation_geometry`.

use js_sys::{Array, Map};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::reader::annotation_geometry::{
    ProjectGeometryInput, bucket_annotations_by_page, project_page_annotation_geometry,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`bucket_annotations_by_page`]: a `Map` from 1-based page number to the caller's own
/// annotation objects on that page, in first-insertion order.
///
/// # Errors
///
/// Fails if `annotations` is not a list of annotations.
#[wasm_bindgen(
    js_name = bucketAnnotationsByPage,
    unchecked_return_type = "Map<number, T.ReaderAnnotation[]>"
)]
pub fn bucket_annotations_by_page_js(
    #[wasm_bindgen(unchecked_param_type = "readonly T.ReaderAnnotation[]")] annotations: JsValue,
) -> JsResult<JsValue> {
    let own: Array = annotations.clone().unchecked_into();
    let parsed: Vec<wf_core::reader::annotation_helpers::ReaderAnnotation> =
        serde_wasm_bindgen::from_value(annotations)?;
    let by_page = Map::new();
    for bucket in bucket_annotations_by_page(&parsed) {
        let members: Array = bucket
            .annotation_indices
            .iter()
            .map(|&i| own.get(i))
            .collect();
        let _ = by_page.set(&JsValue::from_f64(bucket.page_number), &members);
    }
    Ok(by_page.into())
}

/// [`project_page_annotation_geometry`]: `{ boxes, strokes }` in CSS pixels for one page.
///
/// # Errors
///
/// Fails if `input` does not match `ProjectGeometryInput`.
#[wasm_bindgen(js_name = projectPageAnnotationGeometry, unchecked_return_type = "B.PageAnnotationGeometry")]
pub fn project_page_annotation_geometry_js(
    #[wasm_bindgen(unchecked_param_type = "B.ProjectGeometryInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: ProjectGeometryInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&project_page_annotation_geometry(&input))
}

//! Annotation geometry per page (`apps/web/src/features/reader/application/project-annotation-geometry.ts`).
//! Wraps `wf_core::reader::annotation_geometry`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation_geometry::{
    ProjectGeometryInput, bucket_annotations_by_page, project_page_annotation_geometry,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`bucket_annotations_by_page`]: `[{ pageNumber, annotationIndices }]`, in first-insertion order.
///
/// # Errors
///
/// Fails if `annotations` is not a list of annotations.
#[wasm_bindgen(js_name = bucketAnnotationsByPage)]
pub fn bucket_annotations_by_page_js(annotations: JsValue) -> JsResult<JsValue> {
    let annotations: Vec<wf_core::reader::annotation_helpers::ReaderAnnotation> =
        serde_wasm_bindgen::from_value(annotations)?;
    to_js(&bucket_annotations_by_page(&annotations))
}

/// [`project_page_annotation_geometry`]: `{ boxes, strokes }` in CSS pixels for one page.
///
/// # Errors
///
/// Fails if `input` does not match `ProjectGeometryInput`.
#[wasm_bindgen(js_name = projectPageAnnotationGeometry)]
pub fn project_page_annotation_geometry_js(input: JsValue) -> JsResult<JsValue> {
    let input: ProjectGeometryInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&project_page_annotation_geometry(&input))
}

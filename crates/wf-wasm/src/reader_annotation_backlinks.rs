//! Annotation backlinks for JavaScript (wf-core `reader::annotation_backlinks`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation_backlinks as backlinks;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`find_annotation_backlinks`](backlinks::find_annotation_backlinks) as an array of hits.
///
/// # Errors
///
/// Fails if `input` lacks the `annotations`, `pins`, `sections` or `vaultPages` arrays.
#[wasm_bindgen(js_name = findAnnotationBacklinks)]
pub fn find_annotation_backlinks_js(input: JsValue) -> JsResult<JsValue> {
    let input: backlinks::BacklinkInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&backlinks::find_annotation_backlinks(&input))
}

/// [`backlinks_for_annotation`](backlinks::backlinks_for_annotation) as an array of targets.
///
/// # Errors
///
/// Fails if `hits` is not an array of hits.
#[wasm_bindgen(js_name = backlinksForAnnotation)]
pub fn backlinks_for_annotation_js(hits: JsValue, annotation_id: &str) -> JsResult<JsValue> {
    let hits: Vec<backlinks::AnnotationBacklinkHit> = serde_wasm_bindgen::from_value(hits)?;
    to_js(&backlinks::backlinks_for_annotation(&hits, annotation_id))
}

//! Local annotation records (`apps/web/src/features/reader/application/reader-annotation-helpers.ts`).
//! Wraps `wf_core::reader::annotation_helpers`. Palette constants and the create-tool
//! predicates stay in `reader_create_tool` and TS.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation_draft::NewReaderAnnotation;
use wf_core::reader::annotation_helpers::{
    AnnotationPatch, ReaderAnnotation, annotation_pin_key, apply_annotation_patch,
    listed_annotations, optimistic_annotation_from_draft,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`annotation_pin_key`]: the Zotero key when present and non-blank, else the local id.
#[wasm_bindgen(js_name = annotationPinKey)]
pub fn annotation_pin_key_js(id: &str, zotero_key: Option<String>) -> String {
    annotation_pin_key(id, zotero_key.as_deref())
}

/// [`apply_annotation_patch`]: the full annotation after an edit.
///
/// # Errors
///
/// Fails if `ann` or `patch` is malformed.
#[wasm_bindgen(js_name = applyAnnotationPatch)]
pub fn apply_annotation_patch_js(ann: JsValue, patch: JsValue) -> JsResult<JsValue> {
    let ann: ReaderAnnotation = serde_wasm_bindgen::from_value(ann)?;
    let patch: AnnotationPatch = serde_wasm_bindgen::from_value(patch)?;
    to_js(&apply_annotation_patch(&ann, &patch))
}

/// [`optimistic_annotation_from_draft`]: the annotation to paint before its write returns.
///
/// # Errors
///
/// Fails if `draft` is not a new-annotation draft.
#[wasm_bindgen(js_name = optimisticAnnotationFromDraft)]
pub fn optimistic_annotation_from_draft_js(
    draft: JsValue,
    id: &str,
    now: &str,
) -> JsResult<JsValue> {
    let draft: NewReaderAnnotation = serde_wasm_bindgen::from_value(draft)?;
    to_js(&optimistic_annotation_from_draft(&draft, id, now))
}

/// [`listed_annotations`]: the marks the Annotations list shows (ink left out).
///
/// # Errors
///
/// Fails if `annotations` is not a list of annotations.
#[wasm_bindgen(js_name = listedAnnotations)]
pub fn listed_annotations_js(annotations: JsValue) -> JsResult<JsValue> {
    let annotations: Vec<ReaderAnnotation> = serde_wasm_bindgen::from_value(annotations)?;
    to_js(&listed_annotations(&annotations))
}

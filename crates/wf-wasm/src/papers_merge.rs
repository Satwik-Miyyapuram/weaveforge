//! Merging a duplicate paper into the copy kept (wf-core `papers::paper_merge`).

use serde_json::{Map, Value};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::paper_merge::{
    MergeCopy, MergePaper, annotation_identity, merge_order, merge_paper_into, zotero_key_of,
};

use super::to_js;

/// [`merge_paper_into`] (TS `mergePaperInto`). The kept paper with the duplicate's gaps filled.
///
/// # Errors
///
/// Fails if either argument is not a paper, or the result cannot be converted.
#[wasm_bindgen(js_name = mergePaperInto, unchecked_return_type = "B.MergePaper")]
pub fn merge_paper_into_js(
    #[wasm_bindgen(unchecked_param_type = "B.MergePaper")] keep: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.MergePaper")] dup: JsValue,
) -> Result<JsValue, JsError> {
    let keep: MergePaper =
        serde_wasm_bindgen::from_value(keep).map_err(|error| JsError::new(&error.to_string()))?;
    let dup: MergePaper =
        serde_wasm_bindgen::from_value(dup).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&merge_paper_into(&keep, &dup)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`zotero_key_of`] (TS `zoteroKeyOf`): the paper's Zotero item key, or `undefined`.
///
/// # Errors
///
/// Fails if `metadata` is not an object of JSON values.
#[wasm_bindgen(js_name = zoteroKeyOf)]
pub fn zotero_key_of_js(
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown> | null | undefined")]
    metadata: JsValue,
) -> Result<Option<String>, JsError> {
    let metadata: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(metadata)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(metadata.and_then(|map| zotero_key_of(&map)))
}

/// [`merge_order`] (TS `MergePapersUseCase.execute`): which copy a merge keeps, the order the
/// others fold into it, and the refusal message when the merge cannot run.
///
/// # Errors
///
/// Fails if `copies` is not a list of `{ id, linked }` objects.
#[wasm_bindgen(js_name = mergeOrder, unchecked_return_type = "B.MergeOrder")]
pub fn merge_order_js(
    keep_id: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.MergeCopy[]")] copies: JsValue,
    can_remove_zotero: bool,
) -> Result<JsValue, JsError> {
    let copies: Vec<MergeCopy> =
        serde_wasm_bindgen::from_value(copies).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&merge_order(keep_id, &copies, can_remove_zotero))
        .map_err(|error| JsError::new(&error.to_string()))
}

/// [`annotation_identity`] (TS `sameAnnotation`): the key two annotations share when they are
/// the same mark.
///
/// # Errors
///
/// Fails if `annotation` is not a JSON-like object.
#[wasm_bindgen(js_name = annotationIdentity)]
pub fn annotation_identity_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ type: string; color?: string | null; text?: string | null; comment?: string | null; anchor?: unknown }"
    )]
    annotation: JsValue,
) -> Result<String, JsError> {
    let annotation: Value = serde_wasm_bindgen::from_value(annotation)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(annotation_identity(&annotation))
}

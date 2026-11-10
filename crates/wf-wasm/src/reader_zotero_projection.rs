//! Zotero annotation projection for JavaScript (wf-core `reader::zotero_projection`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::zotero_projection::{self, ZoteroAnnotationInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`project_zotero_annotations`](zotero_projection::project_zotero_annotations).
///
/// # Errors
///
/// Fails when `annotations` is not a list of cached Zotero annotations.
#[wasm_bindgen(js_name = projectZoteroAnnotations)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn project_zotero_annotations_js(
    annotations: JsValue,
    content_hash: Option<String>,
    now: Option<String>,
) -> JsResult<JsValue> {
    let annotations: Vec<ZoteroAnnotationInput> = serde_wasm_bindgen::from_value(annotations)?;
    to_js(&zotero_projection::project_zotero_annotations(
        &annotations,
        content_hash.as_deref(),
        now.as_deref(),
    ))
}

//! Zotero annotation projection for JavaScript (wf-core `reader::zotero_projection`).

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::zotero_projection::{self, ZoteroAnnotationInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The optional `{ contentHash, now }` of [`project_zotero_annotations_js`].
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionOptions {
    content_hash: Option<String>,
    now: Option<String>,
}

/// [`project_zotero_annotations`](zotero_projection::project_zotero_annotations): cached Zotero
/// annotations as reader annotations; notes are dropped, the rest sorted by position. A blank
/// `contentHash` counts as none.
///
/// # Errors
///
/// Fails when `annotations` is not a list of cached Zotero annotations, or `options` is not
/// `{ contentHash?, now? }`.
#[wasm_bindgen(
    js_name = projectZoteroAnnotations,
    unchecked_return_type = "B.ZoteroReaderAnnotation[]"
)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn project_zotero_annotations_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ZoteroAnnotationInput[]")]
    annotations: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "{ contentHash?: string; now?: string }")]
    options: Option<JsValue>,
) -> JsResult<JsValue> {
    let annotations: Vec<ZoteroAnnotationInput> = serde_wasm_bindgen::from_value(annotations)?;
    let options: ProjectionOptions = match options {
        Some(value) if !value.is_undefined() && !value.is_null() => {
            serde_wasm_bindgen::from_value(value)?
        }
        _ => ProjectionOptions::default(),
    };
    let content_hash = options
        .content_hash
        .as_deref()
        .map(str::trim)
        .filter(|hash| !hash.is_empty());
    to_js(&zotero_projection::project_zotero_annotations(
        &annotations,
        content_hash,
        options.now.as_deref(),
    ))
}

//! Reader annotation constants for JavaScript (`apps/web/src/features/reader/application/parts.ts`).
//! Reads the Rust consts, so TS keeps no copy of them.

use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation_helpers::PENDING_ANNOTATION_PREFIX;
use wf_core::reader::zotero_projection::DEFAULT_ANNOTATION_COLOR;

use super::to_js;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReaderAnnotationConsts {
    pending_prefix: &'static str,
    default_color: &'static str,
}

/// The reader's annotation constants: the `pending:` id prefix and the default highlight colour.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = readerAnnotationConsts,
    unchecked_return_type = "{ pendingPrefix: string; defaultColor: string }"
)]
pub fn reader_annotation_consts_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&ReaderAnnotationConsts {
        pending_prefix: PENDING_ANNOTATION_PREFIX,
        default_color: DEFAULT_ANNOTATION_COLOR,
    })
}

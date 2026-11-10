//! PDF source-ladder order for JavaScript (wf-core `reader::pdf_source_ladder`). The JS name
//! matches `resolvePdfSource` in `packages/core/src/reader/pdf-source-ladder.ts`, which calls
//! `ladderOrder` and keeps the fetching in TS.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::pdf_source_ladder::{default_resolver_order, ladder_order};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`ladder_order`] (TS `ladderOrder`): the indexes of the supporting resolvers, in order.
///
/// # Errors
///
/// Fails if `supports` is not an array of booleans.
#[wasm_bindgen(js_name = ladderOrder)]
pub fn ladder_order_js(supports: JsValue) -> JsResult<JsValue> {
    let supports: Vec<bool> = serde_wasm_bindgen::from_value(supports)?;
    to_js(&ladder_order(&supports))
}

/// [`default_resolver_order`] (TS `defaultPdfSourceResolvers` order): the source kinds, in the
/// order they are tried. `hasCache` and `hasGithub` say which optional rungs exist.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = pdfSourceResolverOrder, unchecked_return_type = "B.PdfSourceKind[]")]
pub fn pdf_source_resolver_order_js(has_cache: bool, has_github: bool) -> JsResult<JsValue> {
    to_js(&default_resolver_order(has_cache, has_github))
}

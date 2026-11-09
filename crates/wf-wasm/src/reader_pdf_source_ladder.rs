//! PDF source-ladder order for JavaScript (wf-core `reader::pdf_source_ladder`). The JS name
//! matches `resolvePdfSource` in `packages/core/src/reader/pdf-source-ladder.ts`, which calls
//! `ladderOrder` and keeps the fetching in TS.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::pdf_source_ladder::ladder_order;

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

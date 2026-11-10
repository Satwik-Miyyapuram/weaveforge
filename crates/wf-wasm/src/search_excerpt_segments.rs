//! Excerpt splitting into plain and highlighted segments for JavaScript
//! (wf-core `excerpt_segments`). The JS name matches
//! `packages/wf-wasm/src/search-excerpt-segments.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::excerpt_segments::{self, ExcerptInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`excerpt_segments`](excerpt_segments::excerpt_segments) as `{text,
/// highlighted}` runs.
///
/// # Errors
///
/// Fails if `excerpt` is not a `{text, highlights}` record.
#[wasm_bindgen(js_name = excerptSegments)]
pub fn excerpt_segments_js(excerpt: JsValue) -> JsResult<JsValue> {
    let excerpt: ExcerptInput = serde_wasm_bindgen::from_value(excerpt)?;
    to_js(&excerpt_segments::excerpt_segments(&excerpt))
}

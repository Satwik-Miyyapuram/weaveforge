//! AI evidence highlighting for JavaScript (wf-core `ai::evidence`). The JS name matches
//! `packages/core/src/features/ai-assistant/domain/ai-evidence.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::evidence;
use wf_core::reader::anchor::AnchorPdfLocus;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`highlight_within_excerpt`](evidence::highlight_within_excerpt). `locus` is a PDF locus object or
/// `undefined`; the result is `{ before, match, after, confidence }`, or `null` when nothing matches.
///
/// # Errors
///
/// Fails if `locus` is not a PDF locus object, or the result cannot be converted.
#[wasm_bindgen(js_name = highlightWithinExcerpt)]
pub fn highlight_within_excerpt_js(excerpt: &str, locus: JsValue) -> JsResult<JsValue> {
    let locus: Option<AnchorPdfLocus> = serde_wasm_bindgen::from_value(locus)?;
    to_js(&evidence::highlight_within_excerpt(excerpt, locus.as_ref()))
}

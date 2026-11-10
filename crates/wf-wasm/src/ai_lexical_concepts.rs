//! Lexical concept extraction for JavaScript (wf-core `ai::lexical_concepts`). The JS name matches
//! `packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::lexical_concepts::{self, LexicalRequest};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`extract_lexical`](lexical_concepts::extract_lexical): the concepts found in the documents.
///
/// # Errors
///
/// Fails if the request is malformed or the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = extractLexical)]
pub fn extract_lexical_js(request: JsValue) -> JsResult<JsValue> {
    let request: LexicalRequest = serde_wasm_bindgen::from_value(request)?;
    to_js(&lexical_concepts::extract_lexical(&request))
}

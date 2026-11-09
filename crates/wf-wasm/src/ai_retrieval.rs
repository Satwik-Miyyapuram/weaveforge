//! AI excerpt retrieval for JavaScript (wf-core `ai::retrieval`). The JS name matches
//! `packages/core/src/features/ai-assistant/domain/ai-retrieval.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::retrieval::{self, AiRetrievalDocument, RetrievalOptions};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`retrieve_ai_excerpts`](retrieval::retrieve_ai_excerpts). `options` is an object; `{}` takes the defaults.
///
/// # Errors
///
/// Fails if `documents` or `options` has the wrong shape.
#[wasm_bindgen(js_name = retrieveAiExcerpts)]
pub fn retrieve_ai_excerpts_js(
    documents: JsValue,
    query: &str,
    options: JsValue,
) -> JsResult<JsValue> {
    let documents: Vec<AiRetrievalDocument> = serde_wasm_bindgen::from_value(documents)?;
    let options: RetrievalOptions = serde_wasm_bindgen::from_value(options)?;
    to_js(&retrieval::retrieve_ai_excerpts(&documents, query, options))
}

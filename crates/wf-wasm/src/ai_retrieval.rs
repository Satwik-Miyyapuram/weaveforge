//! AI excerpt retrieval for JavaScript (wf-core `ai::retrieval`). The JS name matches
//! `packages/core/src/features/ai-assistant/domain/ai-retrieval.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::retrieval::{self, AiRetrievalDocument, RetrievalOptions};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`retrieve_ai_excerpts`](retrieval::retrieve_ai_excerpts). `options` is an object; a missing
/// `options` or `{}` takes the defaults.
///
/// # Errors
///
/// Fails if `documents` or `options` has the wrong shape.
#[wasm_bindgen(js_name = retrieveAiExcerpts, unchecked_return_type = "B.AiRetrievedExcerpt[]")]
pub fn retrieve_ai_excerpts_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AiRetrievalDocument[]")] documents: JsValue,
    query: &str,
    #[wasm_bindgen(unchecked_optional_param_type = "{ limit?: number; maxChars?: number }")]
    options: Option<JsValue>,
) -> JsResult<JsValue> {
    let documents: Vec<AiRetrievalDocument> = serde_wasm_bindgen::from_value(documents)?;
    let options: RetrievalOptions = match options {
        Some(options) => serde_wasm_bindgen::from_value(options)?,
        None => RetrievalOptions::default(),
    };
    to_js(&retrieval::retrieve_ai_excerpts(&documents, query, options))
}

/// [`cited_sources`](retrieval::cited_sources): the 1-based source numbers an answer cites, in
/// first-citation order, out of `count` sources.
///
/// # Errors
///
/// Fails if the numbers cannot be converted to a JS value.
#[wasm_bindgen(js_name = citedSourceNumbers, unchecked_return_type = "number[]")]
pub fn cited_source_numbers_js(answer: &str, count: usize) -> JsResult<JsValue> {
    to_js(&retrieval::cited_sources(answer, count))
}

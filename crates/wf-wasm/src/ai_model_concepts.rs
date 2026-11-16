//! Model concept-extraction reply parsing for JavaScript (wf-core `ai::model_concepts`). The JS
//! names match `packages/core/src/features/ai-assistant/domain/parts.ts`.

use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::model_concepts;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`parse_extraction_json`](model_concepts::parse_extraction_json): the reply's `concepts` list, or `[]`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = parseExtractionJson,
    unchecked_return_type = "{ name?: unknown; aliases?: unknown; kind?: unknown; documentIds?: unknown; evidence?: unknown; [key: string]: unknown }[]"
)]
pub fn parse_extraction_json_js(text: &str) -> JsResult<JsValue> {
    to_js(&model_concepts::parse_extraction_json(text))
}

/// [`to_extraction_result`](model_concepts::to_extraction_result), checking ids against `batchIds`.
///
/// # Errors
///
/// Fails if `raw` is not an array.
#[wasm_bindgen(js_name = toExtractionResult, unchecked_return_type = "B.ExtractionResult")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Vec<String>.
pub fn to_extraction_result_js(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] raw: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] batch_ids: Vec<String>,
) -> JsResult<JsValue> {
    let raw: Vec<Value> = serde_wasm_bindgen::from_value(raw)?;
    to_js(&model_concepts::to_extraction_result(&raw, &batch_ids))
}

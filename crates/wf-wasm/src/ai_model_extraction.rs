//! Model concept-extraction request building and result merging for JavaScript (wf-core
//! `ai::model_extraction`). The JS names match
//! `packages/core/src/features/ai-assistant/domain/parts.ts`. The host keeps the
//! batch loop and the model call.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::extraction::ExtractionResult;
use wf_core::ai::model_extraction::{self, ModelDocument};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`limits`](model_extraction::limits): the default batch size, document cap and known-concept cap.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = modelExtractionLimits, unchecked_return_type = "B.ModelExtractionLimits")]
pub fn model_extraction_limits_js() -> JsResult<JsValue> {
    to_js(&model_extraction::limits())
}

/// [`build_batch_request`](model_extraction::build_batch_request): the chat request for one batch.
///
/// `maxChars` is cast with `as usize`, which saturates: negative and NaN become 0.
///
/// # Errors
///
/// Fails if `batch` is not a list of documents.
#[wasm_bindgen(js_name = modelBuildBatchRequest, unchecked_return_type = "B.ModelRequest")]
// `max_chars` is a whole non-negative character budget, so the cast is exact.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Vec<String>.
pub fn model_build_batch_request_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ModelDocument[]")] batch: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] existing: Vec<String>,
    model: Option<String>,
    max_chars: f64,
    nonce: &str,
) -> JsResult<JsValue> {
    let batch: Vec<ModelDocument> = serde_wasm_bindgen::from_value(batch)?;
    let request = model_extraction::build_batch_request(
        &batch,
        &existing,
        model.as_deref(),
        max_chars as usize,
        nonce,
    );
    to_js(&request)
}

/// [`finalize_extraction`](model_extraction::finalize_extraction): the merged, de-duplicated concepts.
///
/// `maxConcepts` follows JS `slice(0, n)` semantics (see `js_slice_keep`); a falsy cap means no cap.
///
/// # Errors
///
/// Fails if `results` is not a list of extraction results.
#[wasm_bindgen(js_name = modelFinalizeExtraction, unchecked_return_type = "B.ExtractionResult")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Vec<String>.
pub fn model_finalize_extraction_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionResult[]")] results: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] existing: Vec<String>,
    #[wasm_bindgen(unchecked_optional_param_type = "number | null | undefined")]
    max_concepts: Option<f64>,
) -> JsResult<JsValue> {
    let results: Vec<ExtractionResult> = serde_wasm_bindgen::from_value(results)?;
    to_js(&model_extraction::finalize_extraction(
        &results,
        &existing,
        max_concepts,
    ))
}

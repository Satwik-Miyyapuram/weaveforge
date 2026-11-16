//! Embedding-encoder start plan for JavaScript (wf-core `embedding_models`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::embedding_models::{self, EmbeddingStart};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`plan_embedding_start`](embedding_models::plan_embedding_start) as `"reuse" | "swap" | "rebuild"`.
///
/// # Errors
///
/// Fails only if the result cannot be serialized.
#[wasm_bindgen(
    js_name = planEmbeddingStart,
    unchecked_return_type = "\"reuse\" | \"swap\" | \"rebuild\""
)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn plan_embedding_start_js(
    #[wasm_bindgen(unchecked_param_type = "string | null")] stored_model: Option<String>,
    target: &str,
) -> JsResult<JsValue> {
    let plan: EmbeddingStart =
        embedding_models::plan_embedding_start(stored_model.as_deref(), target);
    to_js(&plan)
}

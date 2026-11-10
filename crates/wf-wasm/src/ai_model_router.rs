//! AI provider selection for JavaScript (wf-core `ai::model_router`). The JS name matches
//! `AiModelRouter` in `packages/core/src/features/ai-assistant/domain/ai-model-router.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::model_router::{self, ModelProviderAvailability};

/// [`select_model_provider`](model_router::select_model_provider); a refusal throws its message as text.
///
/// # Errors
///
/// Fails if `providers` is not a list of `{ provider, available }`, or the selection is refused.
#[wasm_bindgen(js_name = selectModelProvider)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn select_model_provider_js(providers: JsValue, selected: String) -> Result<String, JsValue> {
    let providers: Vec<ModelProviderAvailability> = serde_wasm_bindgen::from_value(providers)?;
    model_router::select_model_provider(&providers, &selected)
        .map_err(|message| JsValue::from_str(&message))
}

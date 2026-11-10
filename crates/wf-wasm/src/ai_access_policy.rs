//! AI access policy and settings helpers for JavaScript (wf-core `ai::access_policy`). The JS names
//! match `packages/core/src/features/ai-assistant/domain/ai-access-policy.ts` and `ai-settings.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::access_policy::{self, AiAccessSettingsInput, AiPolicyInput, AiResourceType};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`ai_read_category_for_resource`](access_policy::ai_read_category_for_resource).
///
/// # Errors
///
/// Fails if `resourceType` is not a known resource type.
#[wasm_bindgen(js_name = aiReadCategoryForResource, unchecked_return_type = "B.AiReadCategory")]
pub fn ai_read_category_for_resource_js(
    #[wasm_bindgen(unchecked_param_type = "B.AiResourceType")] resource_type: JsValue,
) -> JsResult<JsValue> {
    let resource_type: AiResourceType = serde_wasm_bindgen::from_value(resource_type)?;
    to_js(&access_policy::ai_read_category_for_resource(resource_type))
}

/// [`evaluate_ai_access`](access_policy::evaluate_ai_access); `now` is the ISO 8601 clock time.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = evaluateAiAccess)]
pub fn evaluate_ai_access_js(input: JsValue, now: &str) -> JsResult<JsValue> {
    let input: AiPolicyInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&access_policy::evaluate_ai_access(&input, now))
}

/// [`normalize_ai_access_settings`](access_policy::normalize_ai_access_settings); `undefined` reads as none.
///
/// # Errors
///
/// Fails if a field has the wrong JS type (for example a non-boolean `enabled`).
#[wasm_bindgen(js_name = normalizeAiAccessSettings)]
pub fn normalize_ai_access_settings_js(input: JsValue) -> JsResult<JsValue> {
    let input: Option<AiAccessSettingsInput> = serde_wasm_bindgen::from_value(input)?;
    to_js(&access_policy::normalize_ai_access_settings(input.as_ref()))
}

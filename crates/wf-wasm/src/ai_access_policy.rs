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

/// [`AI_READ_CATEGORIES`](access_policy::AI_READ_CATEGORIES): read categories an AI session may be granted.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = aiReadCategories, unchecked_return_type = "readonly B.AiReadCategory[]")]
pub fn ai_read_categories_js() -> JsResult<JsValue> {
    to_js(&access_policy::AI_READ_CATEGORIES)
}

/// [`AI_PROPOSAL_KINDS`](access_policy::AI_PROPOSAL_KINDS): proposal kinds the assistant may suggest.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = aiProposalKinds, unchecked_return_type = "readonly B.AiProposalKind[]")]
pub fn ai_proposal_kinds_js() -> JsResult<JsValue> {
    to_js(&access_policy::AI_PROPOSAL_KINDS)
}

/// [`AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS`](access_policy::AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS):
/// proposal kinds that need encrypted Zotero credentials (empty).
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = aiCredentialProtectedProposalKinds,
    unchecked_return_type = "readonly B.AiProposalKind[]"
)]
pub fn ai_credential_protected_proposal_kinds_js() -> JsResult<JsValue> {
    to_js(&access_policy::AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS)
}

/// [`evaluate_ai_access`](access_policy::evaluate_ai_access); `now` is the ISO 8601 clock time.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = evaluateAiAccess, unchecked_return_type = "T.AiPolicyDecision")]
pub fn evaluate_ai_access_js(
    #[wasm_bindgen(unchecked_param_type = "R<B.AiPolicyInput>")] input: JsValue,
    now: &str,
) -> JsResult<JsValue> {
    let input: AiPolicyInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&access_policy::evaluate_ai_access(&input, now))
}

/// Single policy evaluator shared by in-app tools and the MCP adapter. `evaluate` reads the
/// clock (`new Date().toISOString()`) when the input carries no `now`.
#[wasm_bindgen]
pub struct AiAccessPolicy;

#[wasm_bindgen]
impl AiAccessPolicy {
    /// A policy evaluator; it holds no state.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// [`evaluate_ai_access`](access_policy::evaluate_ai_access) at `input.now`, or at the
    /// current time when `now` is absent. Other extra fields are ignored.
    ///
    /// # Errors
    ///
    /// Fails if `input` has the wrong shape or `now` is not a string.
    #[wasm_bindgen(unchecked_return_type = "T.AiPolicyDecision")]
    pub fn evaluate(
        &self,
        #[wasm_bindgen(unchecked_param_type = "R<B.AiPolicyInput> & { now?: string }")]
        input: JsValue,
    ) -> JsResult<JsValue> {
        let now = js_sys::Reflect::get(&input, &JsValue::from_str("now")).map_err(|_| {
            serde_wasm_bindgen::Error::new("AiAccessPolicy input must be an object")
        })?;
        let now: Option<String> = serde_wasm_bindgen::from_value(now)?;
        let now = now.unwrap_or_else(|| String::from(js_sys::Date::new_0().to_iso_string()));
        let input: AiPolicyInput = serde_wasm_bindgen::from_value(input)?;
        to_js(&access_policy::evaluate_ai_access(&input, &now))
    }
}

impl Default for AiAccessPolicy {
    fn default() -> Self {
        Self::new()
    }
}

/// [`normalize_ai_access_settings`](access_policy::normalize_ai_access_settings); `undefined` reads as none.
///
/// # Errors
///
/// Fails if a field has the wrong JS type (for example a non-boolean `enabled`).
#[wasm_bindgen(js_name = normalizeAiAccessSettings, unchecked_return_type = "B.AiAccessSettings")]
pub fn normalize_ai_access_settings_js(
    #[wasm_bindgen(unchecked_optional_param_type = "Partial<B.AiAccessSettings>")] input: Option<
        JsValue,
    >,
) -> JsResult<JsValue> {
    let input: Option<AiAccessSettingsInput> =
        serde_wasm_bindgen::from_value(input.unwrap_or(JsValue::UNDEFINED))?;
    to_js(&access_policy::normalize_ai_access_settings(input.as_ref()))
}

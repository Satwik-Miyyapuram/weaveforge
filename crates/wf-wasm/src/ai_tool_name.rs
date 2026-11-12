//! AI tool-name and context-nonce helpers for JavaScript (wf-core `ai::ai_tool_name`). The JS
//! names match `packages/core/src/features/ai-assistant/domain/`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::ai_tool_name;

/// [`canonical_ai_tool_name`](ai_tool_name::canonical_ai_tool_name).
#[wasm_bindgen(js_name = canonicalAiToolName)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn canonical_ai_tool_name_js(name: String) -> String {
    ai_tool_name::canonical_ai_tool_name(&name)
}

/// [`context_nonce_from`](ai_tool_name::context_nonce_from): the caller passes the
/// `Math.random()` values.
#[wasm_bindgen(js_name = contextNonceFrom)]
pub fn context_nonce_from_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] randoms: &[f64],
) -> String {
    ai_tool_name::context_nonce_from(randoms)
}

/// A fresh context nonce: [`context_nonce_from`](ai_tool_name::context_nonce_from) over 16
/// draws of `random`, `Math.random` by default.
///
/// # Errors
///
/// Rethrows whatever `random` throws.
#[wasm_bindgen(js_name = contextNonce)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn context_nonce_js(
    #[wasm_bindgen(unchecked_optional_param_type = "() => number")] random: Option<
        js_sys::Function,
    >,
) -> Result<String, JsValue> {
    let mut draws = Vec::with_capacity(16);
    for _ in 0..16 {
        draws.push(match &random {
            Some(random) => random
                .call0(&JsValue::UNDEFINED)?
                .as_f64()
                .unwrap_or(f64::NAN),
            None => js_sys::Math::random(),
        });
    }
    Ok(ai_tool_name::context_nonce_from(&draws))
}

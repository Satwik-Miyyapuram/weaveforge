//! AI tool-name and context-nonce helpers for JavaScript (wf-core `ai::ai_tool_name`). The JS
//! names match `packages/core/src/features/ai-assistant/domain/`.

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

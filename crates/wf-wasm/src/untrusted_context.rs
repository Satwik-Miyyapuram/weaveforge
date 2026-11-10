//! Untrusted-context fencing for JavaScript (wf-core `ai::untrusted_context`). The JS names
//! match `packages/core/src/features/ai-assistant/domain/untrusted-context.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::untrusted_context::{self, UntrustedItem};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`UNTRUSTED_CONTEXT_RULE`](untrusted_context::UNTRUSTED_CONTEXT_RULE).
#[wasm_bindgen(js_name = untrustedContextRule)]
#[must_use]
pub fn untrusted_context_rule_js() -> String {
    untrusted_context::UNTRUSTED_CONTEXT_RULE.to_owned()
}

/// [`neutralise_context`](untrusted_context::neutralise_context).
#[wasm_bindgen(js_name = neutraliseContext)]
#[must_use]
pub fn neutralise_context_js(text: &str, nonce: &str) -> String {
    untrusted_context::neutralise_context(text, nonce)
}

/// [`safe_label`](untrusted_context::safe_label).
#[wasm_bindgen(js_name = safeLabel)]
#[must_use]
pub fn safe_label_js(label: &str, nonce: &str) -> String {
    untrusted_context::safe_label(label, nonce)
}

/// [`fence_untrusted`](untrusted_context::fence_untrusted).
///
/// # Errors
///
/// Fails if `items` is not an array of `{ label, text }` objects.
#[wasm_bindgen(js_name = fenceUntrusted)]
pub fn fence_untrusted_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.UntrustedItem[]")] items: JsValue,
    nonce: &str,
) -> JsResult<String> {
    let items: Vec<UntrustedItem> = serde_wasm_bindgen::from_value(items)?;
    Ok(untrusted_context::fence_untrusted(&items, nonce))
}

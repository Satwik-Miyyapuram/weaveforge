//! Stored AI provider parsing for JavaScript (wf-core `ai::provider_descriptor`). The JS name matches
//! the former `packages/wf-wasm/src/wrappers-1.ts` wrapper, now served straight from wasm.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::provider_descriptor::parse_stored_provider;

use super::to_js;

/// [`parse_stored_provider`](wf_core::ai::provider_descriptor::parse_stored_provider): the provider, or `null` when the blob does not match.
///
/// # Errors
///
/// Fails only when the parsed result cannot be converted to a JS value.
#[wasm_bindgen(js_name = parseStoredAiProvider, unchecked_return_type = "B.StoredProvider | null")]
pub fn parse_stored_ai_provider_js(raw: &str) -> Result<JsValue, JsError> {
    let provider = parse_stored_provider(raw);
    to_js(&provider).map_err(|error| JsError::new(&error.to_string()))
}

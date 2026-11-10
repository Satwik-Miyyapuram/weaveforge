//! wasm export for `integrations::shared_provider_hint` (TS: `integration-hint.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::integrations::shared_provider_hint::{DescriptorRef, shared_provider_hint};

use super::to_js;

/// [`shared_provider_hint`]. `descriptor` and `all` carry `id`, `provider` and `title`;
/// other fields are ignored.
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = sharedProviderHint)]
pub fn shared_provider_hint_js(
    descriptor: JsValue,
    all: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let descriptor: DescriptorRef = serde_wasm_bindgen::from_value(descriptor)?;
    let all: Vec<DescriptorRef> = serde_wasm_bindgen::from_value(all)?;
    to_js(&shared_provider_hint(&descriptor, &all))
}

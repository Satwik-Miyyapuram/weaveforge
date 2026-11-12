//! wasm export for `integrations::shared_provider_hint` (TS: `integration-hint.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::integrations::shared_provider_hint::{DescriptorRef, shared_provider_hint};

/// [`shared_provider_hint`]: the hint for `descriptor` given all descriptors, or `undefined`
/// when no sibling shares its provider. Only `id`, `provider` and `title` are read.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = sharedProviderHint)]
pub fn shared_provider_hint_js(
    #[wasm_bindgen(unchecked_param_type = "B.HintDescriptor")] descriptor: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.HintDescriptor[]")] all: JsValue,
) -> Result<Option<String>, serde_wasm_bindgen::Error> {
    let descriptor: DescriptorRef = serde_wasm_bindgen::from_value(descriptor)?;
    let all: Vec<DescriptorRef> = serde_wasm_bindgen::from_value(all)?;
    Ok(shared_provider_hint(&descriptor, &all))
}

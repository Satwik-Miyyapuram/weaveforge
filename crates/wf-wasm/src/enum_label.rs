//! wasm exports for `enum_label` (TS: `enum-label.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::enum_label;

use super::to_js;

/// [`enum_label::enum_label`]: the label for `value` under `kind`, humanised when unknown.
#[wasm_bindgen(js_name = enumLabel)]
#[must_use]
pub fn enum_label_js(kind: &str, value: &str) -> String {
    enum_label::enum_label(kind, value)
}

/// [`enum_label::humanise`]: `made_up_kind` reads `Made up kind`.
#[wasm_bindgen(js_name = humanise)]
#[must_use]
pub fn humanise_js(value: &str) -> String {
    enum_label::humanise(value)
}

/// [`enum_label::incoming_relation_label`]: `cites` reads `Cited by`.
#[wasm_bindgen(js_name = incomingRelationLabel)]
#[must_use]
pub fn incoming_relation_label_js(relation: &str) -> String {
    enum_label::incoming_relation_label(relation)
}

/// [`enum_label::enum_options`] as `{ value, label }` objects, in the fixed order.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = enumOptions, unchecked_return_type = "B.EnumOption[]")]
pub fn enum_options_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&enum_label::enum_options(kind))
}

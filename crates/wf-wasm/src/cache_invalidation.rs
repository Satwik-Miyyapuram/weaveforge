//! Scoped cache invalidation for JavaScript (wf-core `cache_invalidation`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::cache_invalidation::{self, ResourceType};

use super::{check_text, to_js};

/// [`cache_invalidation::plan`] for the resource type named `resource_type`, or `undefined` for an
/// unknown name.
///
/// # Errors
///
/// Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = invalidationPlan)]
pub fn invalidation_plan_js(resource_type: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    check_text(resource_type)?;
    to_js(
        &ResourceType::from_name(resource_type).map(cache_invalidation::plan),
    )
}

/// [`cache_invalidation::is_known_resource_type`]: whether `value` names a resource type.
#[must_use]
#[wasm_bindgen(js_name = isKnownResourceType)]
pub fn is_known_resource_type_js(value: &str) -> bool {
    cache_invalidation::is_known_resource_type(value)
}

/// [`cache_invalidation::invalidation_map`]: one entry per resource type.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = invalidationMap)]
pub fn invalidation_map_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&cache_invalidation::invalidation_map())
}

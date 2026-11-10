//! Scoped cache invalidation for JavaScript (wf-core `cache_invalidation`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::cache_invalidation::{self, ResourceType};

use super::{check_text, to_js};

/// [`cache_invalidation::write_scope`] for the resource type named `resource_type`: the repo
/// caches and screen caches one write clears. `undefined` for an unknown name.
///
/// # Errors
///
/// Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = writeScope)]
pub fn write_scope_js(resource_type: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    check_text(resource_type)?;
    to_js(&ResourceType::from_name(resource_type).map(cache_invalidation::write_scope))
}

/// [`cache_invalidation::lww_clear_target`]: the resource type a realtime `lww` broadcast
/// clears, or `undefined` (clear everything).
///
/// # Errors
///
/// Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
#[wasm_bindgen(js_name = lwwClearTarget)]
pub fn lww_clear_target_js(
    resource_type: Option<String>,
) -> Result<Option<String>, serde_wasm_bindgen::Error> {
    if let Some(text) = resource_type.as_deref() {
        check_text(text)?;
    }
    Ok(cache_invalidation::lww_clear_target(
        resource_type.as_deref(),
    ))
}

/// [`cache_invalidation::lww_notify_resource`]: the `resourceType` of a write's `lww` payload,
/// or `undefined` for an empty or missing one.
///
/// # Errors
///
/// Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
#[wasm_bindgen(js_name = lwwNotifyResource)]
pub fn lww_notify_resource_js(
    resource_type: Option<String>,
) -> Result<Option<String>, serde_wasm_bindgen::Error> {
    if let Some(text) = resource_type.as_deref() {
        check_text(text)?;
    }
    Ok(cache_invalidation::lww_notify_resource(
        resource_type.as_deref(),
    ))
}

/// [`cache_invalidation::plan`] for the resource type named `resource_type`, or `undefined` for an
/// unknown name.
///
/// # Errors
///
/// Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = invalidationPlan)]
pub fn invalidation_plan_js(resource_type: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    check_text(resource_type)?;
    to_js(&ResourceType::from_name(resource_type).map(cache_invalidation::plan))
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

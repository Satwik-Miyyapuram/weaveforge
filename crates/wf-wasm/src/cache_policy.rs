//! Screen-cache ages for JavaScript (wf-core `cache_policy`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::cache_policy::screen_cache_policy;

use super::to_js;

/// [`screen_cache_policy`] as `{ revalidateAfterMs, showMaxAgeMs }`. The TS constants stay in
/// `cache-policy.ts` (read at module evaluation); this is for callers that run after init.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = screenCachePolicy, unchecked_return_type = "B.ScreenCachePolicy")]
pub fn screen_cache_policy_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&screen_cache_policy())
}

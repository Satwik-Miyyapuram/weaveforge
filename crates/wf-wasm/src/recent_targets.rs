//! Jump-list recents for JavaScript (wf-core `recent_targets`). The JS names match
//! `apps/web/src/lib/recent-targets.ts`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::recent_targets::{TargetKey, is_recent_target, pin_recent_targets};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_recent_target`] (TS `isRecentTarget`): a stored value with string `kind` and `id`.
/// Anything that does not deserialize as JSON is not a target.
#[wasm_bindgen(js_name = isRecentTarget)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn is_recent_target_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] value: JsValue,
) -> bool {
    serde_wasm_bindgen::from_value::<serde_json::Value>(value)
        .is_ok_and(|json| is_recent_target(&json))
}

/// [`pin_recent_targets`] (TS `pinRecentTargets`): `{ index, recent }` slots in display
/// order, indexing into `items`.
///
/// # Errors
///
/// Fails if `items` or `recents` are not arrays of objects with string `kind` and `id`,
/// or if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = pinRecentTargets)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn pin_recent_targets_js(items: JsValue, recents: JsValue) -> JsResult<JsValue> {
    let items: Vec<TargetKey> = serde_wasm_bindgen::from_value(items)?;
    let recents: Vec<TargetKey> = serde_wasm_bindgen::from_value(recents)?;
    to_js(&pin_recent_targets(&items, &recents))
}

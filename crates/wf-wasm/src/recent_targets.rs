//! Jump-list recents for JavaScript (wf-core `recent_targets`). The JS names match
//! `apps/web/src/lib/parts-2.ts`.

use js_sys::{Array, Object, Reflect};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::recent_targets::{TargetKey, is_recent_target, pin_recent_targets};

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

#[wasm_bindgen(typescript_custom_section)]
const PIN_RECENT_TARGETS_TS: &str = r#"
/**
 * `items` with the recently opened ones moved to the front, in visit order and
 * flagged `recent`. A recent target that no longer matches an item is skipped.
 */
export function pinRecentTargets<T extends { kind: string; id: string }>(items: readonly T[], recents: readonly { kind: string; id: string }[]): (T & { recent?: true })[];
"#;

/// [`pin_recent_targets`] (TS `pinRecentTargets`): the caller's items in display order, a recent
/// one copied with `recent: true`. Typed by the custom section above, since its TS signature is
/// generic.
///
/// # Errors
///
/// Fails if `items` or `recents` are not arrays of objects with string `kind` and `id`,
/// or if a recent item cannot be copied.
#[wasm_bindgen(js_name = pinRecentTargets, skip_typescript)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn pin_recent_targets_js(items: JsValue, recents: JsValue) -> JsResult<JsValue> {
    let originals = Array::from(&items);
    let items: Vec<TargetKey> = serde_wasm_bindgen::from_value(items)?;
    let recents: Vec<TargetKey> = serde_wasm_bindgen::from_value(recents)?;
    let out = Array::new();
    for slot in pin_recent_targets(&items, &recents) {
        let Ok(index) = u32::try_from(slot.index) else {
            continue;
        };
        let item = originals.get(index);
        if slot.recent {
            // `{ ...item, recent: true }`: a copy, so the caller's item is not changed.
            let copy = Object::assign(&Object::new(), item.unchecked_ref());
            let _ = Reflect::set(&copy, &JsValue::from_str("recent"), &JsValue::TRUE)
                .map_err(|_| serde_wasm_bindgen::Error::new("cannot flag a recent target"))?;
            let _ = out.push(&copy);
        } else {
            let _ = out.push(&item);
        }
    }
    Ok(out.into())
}

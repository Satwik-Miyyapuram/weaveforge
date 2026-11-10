//! Page-transition tier and click checks for JavaScript (wf-core `view_transition`).
//! The JS names match `apps/web/src/lib/view-transition.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::view_transition::{
    ClickState, is_plain_click, motion_tier, transitions_on as tier_animates,
};

/// [`motion_tier`] (TS `motionTier`): `"off"`, `"calm"`, `"reactive"` or `"crt"`.
#[wasm_bindgen(js_name = motionTier)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn motion_tier_js(
    motion: Option<String>,
    theme: Option<String>,
    reduced_motion: bool,
    supported: bool,
) -> String {
    motion_tier(
        motion.as_deref(),
        theme.as_deref(),
        reduced_motion,
        supported,
    )
    .as_str()
    .to_owned()
}

/// [`transitions_on`](wf_core::view_transition::transitions_on) (TS `transitionsOn`),
/// over the same inputs as [`motion_tier_js`].
#[wasm_bindgen(js_name = transitionsOn)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn transitions_on_js(
    motion: Option<String>,
    theme: Option<String>,
    reduced_motion: bool,
    supported: bool,
) -> bool {
    tier_animates(motion_tier(
        motion.as_deref(),
        theme.as_deref(),
        reduced_motion,
        supported,
    ))
}

/// [`is_plain_click`] (TS `isPlainClick`): the event fields, read in TS, judged in Rust.
#[wasm_bindgen(js_name = isPlainClick)]
#[allow(clippy::fn_params_excessive_bools)]
pub fn is_plain_click_js(
    button: i32,
    default_prevented: bool,
    meta: bool,
    ctrl: bool,
    shift: bool,
    alt: bool,
) -> bool {
    is_plain_click(ClickState {
        button,
        default_prevented,
        meta,
        ctrl,
        shift,
        alt,
    })
}

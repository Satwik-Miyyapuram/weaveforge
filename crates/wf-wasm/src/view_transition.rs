//! Page-transition tier and click checks for JavaScript (wf-core `view_transition`).
//! The JS names match `apps/web/src/lib/view-transition.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::view_transition::{
    ClickState, MotionTier, is_plain_click, motion_tier, transitions_on as tier_animates,
};

#[wasm_bindgen]
extern "C" {
    /// `{ motion, theme, reducedMotion, supported }`, read through its properties.
    pub type MotionTierInput;

    #[wasm_bindgen(method, getter)]
    fn motion(this: &MotionTierInput) -> Option<String>;

    #[wasm_bindgen(method, getter)]
    fn theme(this: &MotionTierInput) -> Option<String>;

    #[wasm_bindgen(method, getter, js_name = reducedMotion)]
    fn reduced_motion(this: &MotionTierInput) -> bool;

    #[wasm_bindgen(method, getter)]
    fn supported(this: &MotionTierInput) -> bool;

    /// The mouse fields a link click is judged by; a `MouseEvent` has them as getters.
    pub type ClickFields;

    #[wasm_bindgen(method, getter)]
    fn button(this: &ClickFields) -> i32;

    #[wasm_bindgen(method, getter, js_name = defaultPrevented)]
    fn default_prevented(this: &ClickFields) -> bool;

    #[wasm_bindgen(method, getter, js_name = metaKey)]
    fn meta_key(this: &ClickFields) -> bool;

    #[wasm_bindgen(method, getter, js_name = ctrlKey)]
    fn ctrl_key(this: &ClickFields) -> bool;

    #[wasm_bindgen(method, getter, js_name = shiftKey)]
    fn shift_key(this: &ClickFields) -> bool;

    #[wasm_bindgen(method, getter, js_name = altKey)]
    fn alt_key(this: &ClickFields) -> bool;
}

/// The tier for `input`.
fn tier(input: &MotionTierInput) -> MotionTier {
    motion_tier(
        input.motion().as_deref(),
        input.theme().as_deref(),
        input.reduced_motion(),
        input.supported(),
    )
}

/// [`motion_tier`] (TS `motionTier`): calm by default, bigger with Reactive motion, stepped on
/// CRT; off when reduced or unsupported.
#[wasm_bindgen(js_name = motionTier, unchecked_return_type = "\"off\" | \"calm\" | \"reactive\" | \"crt\"")]
#[must_use]
pub fn motion_tier_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean }"
    )]
    input: &MotionTierInput,
) -> String {
    tier(input).as_str().to_owned()
}

/// [`transitions_on`](wf_core::view_transition::transitions_on) (TS `transitionsOn`): true when
/// the tier for the same input as [`motion_tier_js`] animates at all.
#[wasm_bindgen(js_name = transitionsOn)]
#[must_use]
pub fn transitions_on_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean }"
    )]
    input: &MotionTierInput,
) -> bool {
    tier_animates(tier(input))
}

/// [`is_plain_click`] (TS `isPlainClick`): a plain left click that a link would follow in this
/// window.
#[wasm_bindgen(js_name = isPlainClick)]
#[must_use]
pub fn is_plain_click_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ button: number; defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }"
    )]
    e: &ClickFields,
) -> bool {
    is_plain_click(ClickState {
        button: e.button(),
        default_prevented: e.default_prevented(),
        meta: e.meta_key(),
        ctrl: e.ctrl_key(),
        shift: e.shift_key(),
        alt: e.alt_key(),
    })
}

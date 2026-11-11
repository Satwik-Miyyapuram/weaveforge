//! Pinned-screen index for JavaScript (wf-core `library_pins`). JS names match
//! `packages/core/src/features/library/application/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::library_pins::{PinnedScreenInput, pinned_screen_index};

use super::to_js;

/// [`pinned_screen_index`]: the pure half of merging pinned shared rows into a screen.
///
/// # Errors
///
/// Fails if `input` does not match the pinned-screen input shape, or the result cannot be
/// converted to JS.
#[wasm_bindgen(js_name = pinnedScreenIndex, unchecked_return_type = "B.PinnedScreenIndex")]
pub fn pinned_screen_index_js(
    #[wasm_bindgen(unchecked_param_type = "B.PinnedScreenIndexInput")] input: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let input: PinnedScreenInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&pinned_screen_index(&input))
}

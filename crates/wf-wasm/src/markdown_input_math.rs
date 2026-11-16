//! Maths detection for JavaScript (wf-core `markdown_input::math_input`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_input::math_input;

/// [`contains_math`](math_input::contains_math) (TS `containsMath`): whether the renderer would
/// treat any of this text as maths.
#[wasm_bindgen(js_name = containsMath)]
#[must_use]
pub fn contains_math_js(md: &str) -> bool {
    math_input::contains_math(md)
}

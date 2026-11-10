//! The stroke render mapping for JavaScript. Wraps `wf_core::ink::render_strokes`:
//! the strokes and palette cross as plain objects shaped like `InkRenderSource[]`
//! and `InkSvgPalette` in `bindings.ts`, and the result is `InkRenderStroke[]`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::ink_svg::InkSvgPalette;
use wf_core::ink::render_strokes::{InkRenderSource, to_render_strokes};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`to_render_strokes`]: `strokes` is an `InkRenderSource[]`, `palette` an
/// `InkSvgPalette`, and `hidden` the positions to leave out.
#[wasm_bindgen(js_name = toRenderStrokes)]
pub fn to_render_strokes_js(strokes: JsValue, palette: JsValue, hidden: &[u32]) -> JsResult<JsValue> {
    let strokes: Vec<InkRenderSource> = serde_wasm_bindgen::from_value(strokes)?;
    let palette: InkSvgPalette = serde_wasm_bindgen::from_value(palette)?;
    let hidden: Vec<usize> = hidden
        .iter()
        .map(|&at| usize::try_from(at).unwrap_or(usize::MAX))
        .collect();
    to_js(&to_render_strokes(&strokes, &palette, &hidden))
}

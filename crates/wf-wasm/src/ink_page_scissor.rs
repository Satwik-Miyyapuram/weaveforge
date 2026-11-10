//! WebGL page scissor box for JavaScript (wf-core `ink::page_scissor`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::page_scissor;

/// [`page_scissor`](page_scissor::page_scissor): the page's `[x, y, width, height]` scissor
/// box on a `width` by `height` device-pixel surface. Arguments are the view's scale and
/// offsets, the device pixel ratio, the page size, then the surface size.
#[allow(clippy::too_many_arguments)]
#[must_use]
#[wasm_bindgen(js_name = inkPageScissor)]
pub fn ink_page_scissor_js(
    scale: f64,
    offset_x: f64,
    offset_y: f64,
    dpr: f64,
    page_width: f64,
    page_height: f64,
    width: f64,
    height: f64,
) -> Vec<f64> {
    page_scissor::page_scissor(
        (scale, offset_x, offset_y),
        dpr,
        (page_width, page_height),
        (width, height),
    )
    .to_vec()
}

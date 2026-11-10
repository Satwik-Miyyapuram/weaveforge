//! The page SVG export for JavaScript. Each export wraps a `wf_core::ink::ink_svg`
//! function; the page and options cross as plain objects shaped like
//! `InkSvgPage` and `InkSvgOptions` in `bindings.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::ink_svg::{InkSvgOptions, InkSvgPage, ink_page_svg, stroke_path};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`stroke_path`] over a flat `[x0, y0, x1, y1, ...]` array; `undefined` for fewer than two numbers.
#[wasm_bindgen(js_name = strokePath)]
pub fn stroke_path_js(points: &[f64]) -> Option<String> {
    stroke_path(points)
}

/// [`ink_page_svg`]: `page` is an `InkSvgPage`, `options` an `InkSvgOptions` (may be `{}`).
#[wasm_bindgen(js_name = inkPageSvg)]
pub fn ink_page_svg_js(page: JsValue, options: JsValue) -> JsResult<String> {
    let page: InkSvgPage = serde_wasm_bindgen::from_value(page)?;
    let options: InkSvgOptions = serde_wasm_bindgen::from_value(options)?;
    Ok(ink_page_svg(&page, &options))
}

//! The page SVG export for JavaScript. Each export wraps a `wf_core::ink::ink_svg`
//! function; the page and options cross as plain objects shaped like
//! `InkSvgPage` and `InkSvgOptions` in `bindings.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::ink_svg::{InkSvgOptions, InkSvgPage, ink_page_svg, stroke_path};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`stroke_path`] over a flat `[x0, y0, x1, y1, ...]` array; `null` for fewer than two numbers.
#[wasm_bindgen(js_name = strokePath, unchecked_return_type = "string | null")]
pub fn stroke_path_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] points: &[f64],
) -> JsValue {
    stroke_path(points).map_or(JsValue::NULL, JsValue::from)
}

/// [`ink_page_svg`]: the page as an SVG document; `options` defaults to `{}`.
///
/// # Errors
///
/// Fails if `page` or `options` does not match its shape.
#[wasm_bindgen(js_name = inkPageSvg)]
pub fn ink_page_svg_js(
    #[wasm_bindgen(unchecked_param_type = "B.InkSvgPage")] page: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "B.InkSvgOptions")] options: Option<JsValue>,
) -> JsResult<String> {
    let page: InkSvgPage = serde_wasm_bindgen::from_value(page)?;
    let options: InkSvgOptions =
        serde_wasm_bindgen::from_value(options.unwrap_or_else(|| js_sys::Object::new().into()))?;
    Ok(ink_page_svg(&page, &options))
}

//! WebGL page scissor box for JavaScript (wf-core `ink::page_scissor`).

use js_sys::Reflect;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::page_scissor;

use super::to_js;

/// `+obj[key]`; throws as the JS property read would on a non-object.
fn num(obj: &JsValue, key: &str) -> Result<f64, JsValue> {
    Ok(Reflect::get(obj, &JsValue::from_str(key))?.unchecked_into_f64())
}

/// [`page_scissor`](page_scissor::page_scissor): the page's `[x, y, width, height]` scissor
/// box on a device-pixel surface. `view` is the view's `scale` and `offsetX`/`offsetY` in
/// CSS px; `page` and `surface` are sizes.
///
/// # Errors
///
/// Throws if `view`, `page` or `surface` cannot be read.
#[wasm_bindgen(js_name = inkPageScissor, unchecked_return_type = "[number, number, number, number]")]
pub fn ink_page_scissor_js(
    #[wasm_bindgen(unchecked_param_type = "{ scale: number; offsetX: number; offsetY: number }")]
    view: &JsValue,
    dpr: f64,
    #[wasm_bindgen(unchecked_param_type = "{ width: number; height: number }")] page: &JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ width: number; height: number }")] surface: &JsValue,
) -> Result<JsValue, JsValue> {
    let scissor = page_scissor::page_scissor(
        (
            num(view, "scale")?,
            num(view, "offsetX")?,
            num(view, "offsetY")?,
        ),
        dpr,
        (num(page, "width")?, num(page, "height")?),
        (num(surface, "width")?, num(surface, "height")?),
    );
    Ok(to_js(&scissor)?)
}

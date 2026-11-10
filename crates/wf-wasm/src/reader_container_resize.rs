//! Container resize decision (`apps/web/src/features/reader/ui/pdf-reader/container-resize.ts`).
//! Wraps `wf_core::reader::container_resize`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::container_resize::{BoxSize, container_resize};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`container_resize`]: `last` and `next` are `{ width, height }`. Returns `"ignore"`, `"now"` or `"settle"`.
///
/// # Errors
///
/// Fails if either argument is not a `{ width, height }` object of numbers.
#[wasm_bindgen(js_name = containerResize)]
pub fn container_resize_js(
    #[wasm_bindgen(unchecked_param_type = "B.BoxSize")] last: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.BoxSize")] next: JsValue,
) -> JsResult<String> {
    let last: BoxSize = serde_wasm_bindgen::from_value(last)?;
    let next: BoxSize = serde_wasm_bindgen::from_value(next)?;
    Ok(container_resize(last, next).to_owned())
}

//! Markdown image alt placement for JavaScript (wf-core `markdown_figure_alt`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_figure_alt::{self, MdPlacement};

/// [`parse_md_image_alt`](markdown_figure_alt::parse_md_image_alt): an alt split into text, crop,
/// side and width.
///
/// # Errors
///
/// Fails if `raw` is longer than the index text limit.
#[wasm_bindgen(js_name = parseMdImageAlt, unchecked_return_type = "B.MdImageAlt")]
pub fn parse_md_image_alt_js(raw: js_sys::JsString) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let raw = &crate::guarded_text(&raw)?;
    super::to_js(&markdown_figure_alt::parse_md_image_alt(raw))
}

/// [`with_md_image_alt`](markdown_figure_alt::with_md_image_alt): the alt text for a figure's own
/// text and placement.
///
/// # Errors
///
/// Fails if `alt` is too long or `placement` has the wrong shape.
#[wasm_bindgen(js_name = withMdImageAlt)]
pub fn with_md_image_alt_js(
    alt: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "B.MdPlacement")] placement: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let alt = &crate::guarded_text(&alt)?;
    let placement: MdPlacement = serde_wasm_bindgen::from_value(placement)?;
    Ok(markdown_figure_alt::with_md_image_alt(alt, &placement))
}

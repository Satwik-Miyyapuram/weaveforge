//! Dark PDF rendering choice for JavaScript (wf-core `reader::pdf_theme`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::pdf_theme::should_use_dark_pdf_rendering as core_should_use;

/// [`should_use_dark_pdf_rendering`] (TS `shouldUseDarkPdfRendering`). `null` and `undefined`
/// both count as absent.
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
#[wasm_bindgen(js_name = shouldUseDarkPdfRendering)]
pub fn should_use_dark_pdf_rendering_js(theme_id: Option<String>, mode: Option<String>) -> bool {
    core_should_use(theme_id.as_deref(), mode.as_deref())
}

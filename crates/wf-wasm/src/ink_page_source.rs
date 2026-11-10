//! Page-background file tests for JavaScript (wf-core `ink::page_background`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::page_background;

/// [`is_pdf`](page_background::is_pdf): whether a file's MIME type or name marks it a PDF.
#[must_use]
#[wasm_bindgen(js_name = inkIsPdf)]
pub fn ink_is_pdf_js(mime: &str, name: &str) -> bool {
    page_background::is_pdf(mime, name)
}

/// [`is_page_source`](page_background::is_page_source): whether a file can be a page background.
#[must_use]
#[wasm_bindgen(js_name = inkIsPageSource)]
pub fn ink_is_page_source_js(mime: &str, name: &str) -> bool {
    page_background::is_page_source(mime, name)
}

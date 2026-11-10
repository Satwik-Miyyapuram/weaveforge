//! The printable page document for JavaScript. Wraps `wf_core::ink::ink_print`;
//! the document crosses as a plain object shaped like `InkPrintDocument` in `bindings.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::ink_print::{InkPrintDocument, ink_print_document};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`ink_print_document`]: the page as an HTML document for a print frame's `srcdoc`.
#[wasm_bindgen(js_name = inkPrintDocument)]
pub fn ink_print_document_js(doc: JsValue) -> JsResult<String> {
    let doc: InkPrintDocument = serde_wasm_bindgen::from_value(doc)?;
    Ok(ink_print_document(&doc))
}

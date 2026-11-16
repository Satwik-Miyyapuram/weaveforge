//! The reader's printable paper for JavaScript. Wraps `wf_core::reader::print`; the inputs cross
//! as plain objects shaped like `ReaderPrintDocument` and `ReaderPrintLayoutInput` in `bindings.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::print::{
    ReaderPrintDocument, ReaderPrintLayoutInput, reader_print_document, reader_print_orientation,
};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`reader_print_document`]: the paper as an HTML document for a print frame's `srcdoc`.
#[wasm_bindgen(js_name = readerPrintDocument)]
pub fn reader_print_document_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReaderPrintDocument")] doc: JsValue,
) -> JsResult<String> {
    let doc: ReaderPrintDocument = serde_wasm_bindgen::from_value(doc)?;
    Ok(reader_print_document(&doc))
}

/// [`reader_print_orientation`]: `"portrait"` or `"landscape"` for the sheet.
#[wasm_bindgen(js_name = readerPrintOrientation)]
pub fn reader_print_orientation_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReaderPrintLayoutInput")] input: JsValue,
) -> JsResult<String> {
    let input: ReaderPrintLayoutInput = serde_wasm_bindgen::from_value(input)?;
    Ok(reader_print_orientation(input.with_comments, &input.pages)
        .as_str()
        .to_owned())
}

//! The page text after recognition for JavaScript. Wraps `wf_core::ink::page_text`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::page_text::page_text_after_recognition;

/// [`page_text_after_recognition`]: the page text once handwriting has been recognised.
#[wasm_bindgen(js_name = pageTextAfterRecognition)]
pub fn page_text_after_recognition_js(was: &str, prior: &str, recognised: &str) -> String {
    page_text_after_recognition(was, prior, recognised)
}

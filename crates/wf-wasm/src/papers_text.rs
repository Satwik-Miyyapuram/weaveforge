//! Paper drop rules, PDF titles, and figure names for JavaScript (wf-core
//! `papers::paper_drop` and `papers::paper_image`).
//!
//! The TS wrapper in `packages/wf-wasm/src/papers-text.ts` gives the results their types.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::{paper_drop, paper_image};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_pdf_file`](paper_drop::is_pdf_file) (TS `isPdfFile`).
#[wasm_bindgen(js_name = isPdfFile)]
pub fn is_pdf_file_js(name: &str, mime_type: &str) -> bool {
    paper_drop::is_pdf_file(name, mime_type)
}

/// [`is_bib_file`](paper_drop::is_bib_file) (TS `isBibFile`).
#[wasm_bindgen(js_name = isBibFile)]
pub fn is_bib_file_js(name: &str) -> bool {
    paper_drop::is_bib_file(name)
}

/// [`guess_title`](paper_drop::guess_title) (TS `guessTitle`).
#[wasm_bindgen(js_name = guessTitle)]
pub fn guess_title_js(text: &str) -> Option<String> {
    paper_drop::guess_title(text)
}

/// [`metadata_title`](paper_drop::metadata_title) (TS `metadataTitle`).
#[wasm_bindgen(js_name = metadataTitle)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn metadata_title_js(raw: Option<String>) -> Option<String> {
    paper_drop::metadata_title(raw.as_deref())
}

/// [`bib_import_message`](paper_drop::bib_import_message) (TS `bibImportMessage`).
#[wasm_bindgen(js_name = bibImportMessage)]
pub fn bib_import_message_js(added: u32, skipped: u32, problems: u32) -> String {
    paper_drop::bib_import_message(added as usize, skipped as usize, problems as usize)
}

/// [`summarize_pdf_drop`](paper_drop::summarize_pdf_drop) (TS `summarizePdfDrop`).
///
/// # Errors
///
/// Fails if `entries` is not an array of drop entries, or the result cannot be converted.
#[wasm_bindgen(js_name = summarizePdfDrop)]
pub fn summarize_pdf_drop_js(entries: JsValue) -> JsResult<JsValue> {
    let entries: Vec<paper_drop::DropEntry> = serde_wasm_bindgen::from_value(entries)?;
    to_js(&paper_drop::summarize_pdf_drop(&entries))
}

/// [`paper_image_thumbnail_path`](paper_image::paper_image_thumbnail_path) (TS `paperImageThumbnailPath`).
#[wasm_bindgen(js_name = paperImageThumbnailPath)]
pub fn paper_image_thumbnail_path_js(path: &str) -> String {
    paper_image::paper_image_thumbnail_path(path)
}

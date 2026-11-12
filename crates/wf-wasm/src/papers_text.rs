//! Paper drop rules, PDF titles, and figure names for JavaScript (wf-core
//! `papers::paper_drop` and `papers::paper_image`).

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

/// [`split_paper_drop`](paper_drop::split_paper_drop) (TS `splitPaperDrop`).
///
/// # Errors
///
/// Fails if `names` is not an array of strings, or the result cannot be converted.
#[wasm_bindgen(js_name = splitPaperDrop, unchecked_return_type = "{ pdfIndices: number[]; bibIndices: number[] }")]
pub fn split_paper_drop_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] names: JsValue,
) -> JsResult<JsValue> {
    let names: Vec<String> = serde_wasm_bindgen::from_value(names)?;
    to_js(&paper_drop::split_paper_drop(&names))
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
#[wasm_bindgen(js_name = summarizePdfDrop, unchecked_return_type = "B.PdfDropSummary")]
pub fn summarize_pdf_drop_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.DropEntry[]")] entries: JsValue,
) -> JsResult<JsValue> {
    let entries: Vec<paper_drop::DropEntry> = serde_wasm_bindgen::from_value(entries)?;
    to_js(&paper_drop::summarize_pdf_drop(&entries))
}

/// [`paper_image_thumbnail_path`](paper_image::paper_image_thumbnail_path) (TS `paperImageThumbnailPath`).
#[wasm_bindgen(js_name = paperImageThumbnailPath)]
pub fn paper_image_thumbnail_path_js(path: &str) -> String {
    paper_image::paper_image_thumbnail_path(path)
}

/// [`full_image_thumbnail_path`](paper_image::full_image_thumbnail_path) (TS `PaperImageStore.remove`). The thumbnail, or `undefined`.
#[wasm_bindgen(js_name = fullImageThumbnailPath)]
pub fn full_image_thumbnail_path_js(path: &str) -> Option<String> {
    paper_image::full_image_thumbnail_path(path)
}

/// [`paper_image_upload_paths`](paper_image::paper_image_upload_paths) (TS `PaperImageStore.upload`). Returns `[full, thumb]`.
#[wasm_bindgen(js_name = paperImageUploadPaths, unchecked_return_type = "[string, string]")]
pub fn paper_image_upload_paths_js(
    user_id: &str,
    paper_id: &str,
    unique: &str,
    ext: &str,
) -> JsResult<JsValue> {
    to_js(&paper_image::paper_image_upload_paths(
        user_id, paper_id, unique, ext,
    ))
}

/// [`is_pdf_too_large`](paper_drop::is_pdf_too_large) (TS `isPdfTooLarge`).
#[wasm_bindgen(js_name = isPdfTooLarge)]
pub fn is_pdf_too_large_js(size_bytes: f64) -> bool {
    paper_drop::is_pdf_too_large(size_bytes)
}

/// [`arxiv_stamp`](paper_drop::arxiv_stamp) (TS `arxivStamp`).
#[wasm_bindgen(js_name = arxivStamp)]
pub fn arxiv_stamp_js(page_text: &str) -> Option<String> {
    paper_drop::arxiv_stamp(page_text)
}

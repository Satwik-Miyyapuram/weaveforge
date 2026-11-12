//! Cleaning and checking a paper's edited fields (wf-core `papers::paper_update`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::paper_update;

/// [`clean_title`](paper_update::clean_title) (TS `setTitle`): the title collapsed, or `undefined` when blank.
#[wasm_bindgen(js_name = cleanPaperTitle)]
pub fn clean_paper_title(title: &str) -> Option<String> {
    paper_update::clean_title(title)
}

/// [`clean_summary`](paper_update::clean_summary) (TS `setSummary`): the summary trimmed, or `undefined` when blank.
#[wasm_bindgen(js_name = cleanPaperSummary)]
pub fn clean_paper_summary(summary: &str) -> Option<String> {
    paper_update::clean_summary(summary)
}

/// [`clean_image_path`](paper_update::clean_image_path) (TS `addImage`): the path trimmed, or `undefined` when blank.
#[wasm_bindgen(js_name = cleanImagePath)]
pub fn clean_image_path(path: &str) -> Option<String> {
    paper_update::clean_image_path(path)
}

/// [`clean_pdf_address`](paper_update::clean_pdf_address) (TS `setPdfSource`): the address trimmed, or `undefined` when blank.
#[wasm_bindgen(js_name = cleanPdfAddress)]
pub fn clean_pdf_address(url: Option<String>) -> Option<String> {
    paper_update::clean_pdf_address(url.as_deref())
}

/// [`is_https_address`](paper_update::is_https_address) (TS `setPdfSource`): whether the address is https.
#[wasm_bindgen(js_name = isHttpsAddress)]
pub fn is_https_address(url: &str) -> bool {
    paper_update::is_https_address(url)
}

/// [`rating_in_range`](paper_update::rating_in_range) (TS `setRating`): whether the rating is 1 to 5.
#[wasm_bindgen(js_name = ratingInRange)]
pub fn rating_in_range(rating: f64) -> bool {
    paper_update::rating_in_range(rating)
}

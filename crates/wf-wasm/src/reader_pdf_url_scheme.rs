//! PDF URL scheme predicates for JavaScript (wf-core `reader::pdf_url_scheme`). The JS names
//! match `apps/web/src/features/reader/application/parts-3.ts`, which keeps the cache reads.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::pdf_url_scheme::{is_cache_pdf_url, is_remote_pdf_url, is_stored_pdf_url};

/// [`is_cache_pdf_url`]: whether `url` is a `cache://` reference.
#[wasm_bindgen(js_name = isCachePdfUrl)]
pub fn is_cache_pdf_url_js(url: &str) -> bool {
    is_cache_pdf_url(url)
}

/// [`is_stored_pdf_url`]: whether the reader answers `url` from the app's own store.
#[wasm_bindgen(js_name = isStoredPdfUrl)]
pub fn is_stored_pdf_url_js(url: &str) -> bool {
    is_stored_pdf_url(url)
}

/// [`is_remote_pdf_url`]: whether `url` is an http(s) address or a same-origin path.
#[wasm_bindgen(js_name = isRemotePdfUrl)]
pub fn is_remote_pdf_url_js(url: &str) -> bool {
    is_remote_pdf_url(url)
}

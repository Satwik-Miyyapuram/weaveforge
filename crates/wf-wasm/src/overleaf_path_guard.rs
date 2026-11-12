//! Overleaf checkout file checks for the reader (wf-core `overleaf::path_guard`).

use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::overleaf::path_guard;

/// Throws unless `path` is a plain relative path inside the checkout: no `..` segment, no leading
/// `/`, no `\`, no drive letter.
///
/// # Errors
///
/// Fails with [`unsafe_checkout_path_error`](path_guard::unsafe_checkout_path_error) when unsafe.
#[wasm_bindgen(js_name = assertSafeCheckoutPath)]
pub fn assert_safe_checkout_path(path: &str) -> Result<(), JsError> {
    match path_guard::unsafe_checkout_path_error(path) {
        Some(message) => Err(JsError::new(message)),
        None => Ok(()),
    }
}

/// [`is_text_source_file`](path_guard::is_text_source_file): whether the reader keeps this file name.
#[wasm_bindgen(js_name = isOverleafTextSource)]
#[must_use]
pub fn is_overleaf_text_source(name: &str) -> bool {
    path_guard::is_text_source_file(name)
}

/// Throws when the walk has already kept the file limit of text files.
///
/// # Errors
///
/// Fails with [`file_count_error`](path_guard::file_count_error) at the limit.
#[wasm_bindgen(js_name = assertOverleafFileCount)]
pub fn assert_overleaf_file_count(collected: usize) -> Result<(), JsError> {
    match path_guard::file_count_error(collected) {
        Some(message) => Err(JsError::new(message)),
        None => Ok(()),
    }
}

/// Throws when a text file of `size` bytes breaks a byte limit, given `total` bytes already kept.
///
/// # Errors
///
/// Fails with [`text_size_error`](path_guard::text_size_error) when over a limit.
#[wasm_bindgen(js_name = assertOverleafTextSize)]
pub fn assert_overleaf_text_size(size: f64, total: f64) -> Result<(), JsError> {
    match path_guard::text_size_error(size, total) {
        Some(message) => Err(JsError::new(message)),
        None => Ok(()),
    }
}

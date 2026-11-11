//! Zotero Web API library helpers for JavaScript (wf-core `papers::zotero_library`).
//! The JS names match `packages/wf-wasm/src/wrappers-12.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::zotero_library::{self, ZoteroChildProbe};

use super::to_js;

/// [`is_child_item`](zotero_library::is_child_item): true for an attachment, note, annotation or
/// an item with a parent.
///
/// # Errors
///
/// Fails if `item` cannot be read as an object.
#[wasm_bindgen(js_name = isZoteroChildItem, unchecked_return_type = "boolean")]
pub fn is_zotero_child_item_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] item: JsValue,
) -> Result<bool, JsValue> {
    let item: ZoteroChildProbe = serde_wasm_bindgen::from_value(item)?;
    Ok(zotero_library::is_child_item(&item))
}

/// [`normalize_zotero_library`](zotero_library::normalize_zotero_library): the library path, or
/// nothing when the input is not a library.
///
/// # Errors
///
/// Fails if `library` is neither a string nor missing.
#[wasm_bindgen(js_name = normalizeZoteroLibrary)]
pub fn normalize_zotero_library_js(library: JsValue) -> Result<JsValue, JsValue> {
    let library: Option<String> = serde_wasm_bindgen::from_value(library)?;
    Ok(to_js(&zotero_library::normalize_zotero_library(
        library.as_deref(),
    ))?)
}

/// [`zotero_library_url`](zotero_library::zotero_library_url): the API URL for a library path.
#[wasm_bindgen(js_name = zoteroLibraryUrl)]
#[must_use]
pub fn zotero_library_url_js(library: &str, api_origin: &str) -> String {
    zotero_library::zotero_library_url(library, api_origin)
}

/// [`zotero_headers`](zotero_library::zotero_headers): the API key and version headers for a
/// request, as a plain object.
///
/// # Errors
///
/// Fails only if the headers cannot be converted to a JS value.
#[wasm_bindgen(js_name = zoteroHeaders, unchecked_return_type = "Record<string, string>")]
pub fn zotero_headers_js(api_key: &str) -> Result<JsValue, JsValue> {
    Ok(to_js(&zotero_library::zotero_headers(api_key))?)
}

/// [`zotero_top_level_path`](zotero_library::zotero_top_level_path): the top-level items path,
/// inside a collection when one is given.
#[wasm_bindgen(js_name = zoteroTopLevelPath)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn zotero_top_level_path_js(collection: Option<String>) -> String {
    zotero_library::zotero_top_level_path(collection.as_deref())
}

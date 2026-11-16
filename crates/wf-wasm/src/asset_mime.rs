//! Asset content type and extension rules for JavaScript (wf-core `asset_mime`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::asset_mime;

/// [`asset_mime_type`](asset_mime::asset_mime_type): content type for an imported asset's extension.
#[wasm_bindgen(js_name = assetMimeType)]
#[must_use]
pub fn asset_mime_type_js(ext: &str) -> String {
    asset_mime::asset_mime_type(ext).to_owned()
}

/// [`asset_extension`](asset_mime::asset_extension): lowercased extension of a path, `png` when none.
#[wasm_bindgen(js_name = assetExtension)]
#[must_use]
pub fn asset_extension_js(path: &str) -> String {
    asset_mime::asset_extension(path)
}

//! Content-type checks for the paste fetches (wf-core `paste_content`). The JS names match
//! `apps/web/src/backend/net/fetch-for-paste.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::paste_content;

/// [`paste_image_type`](paste_content::paste_image_type): the normalised image type, or `undefined`.
#[wasm_bindgen(js_name = pasteImageType)]
#[must_use]
pub fn paste_image_type_js(content_type: &str) -> Option<String> {
    paste_content::paste_image_type(content_type)
}

/// [`is_html_content_type`](paste_content::is_html_content_type): a body a title can be read from.
#[wasm_bindgen(js_name = isHtmlContentType)]
#[must_use]
pub fn is_html_content_type_js(content_type: &str) -> bool {
    paste_content::is_html_content_type(content_type)
}

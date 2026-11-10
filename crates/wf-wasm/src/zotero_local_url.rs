//! Local Zotero API URL check for JavaScript (wf-core `zotero_local_url`). JS name matches
//! `packages/wf-wasm/src/zotero-local-url.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::zotero_local_url::is_local_zotero_url;

/// [`is_local_zotero_url`]: whether `url` is the local Zotero API's own path with no credentials.
#[wasm_bindgen(js_name = isLocalZoteroUrl)]
pub fn is_local_zotero_url_js(url: &str) -> bool {
    is_local_zotero_url(url)
}

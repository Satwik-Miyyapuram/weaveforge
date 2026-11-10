//! wasm export for the signed-url batch cap (wf-core `storage::blob_access`; TS: `storage-blob-access.ts`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::storage::blob_access;

/// [`blob_access::MAX_SIGNED_URL_PATHS`]: most paths one signed-url request may ask for.
#[wasm_bindgen(js_name = maxSignedUrlPaths)]
pub fn max_signed_url_paths_js() -> u32 {
    u32::try_from(blob_access::MAX_SIGNED_URL_PATHS).unwrap_or(u32::MAX)
}

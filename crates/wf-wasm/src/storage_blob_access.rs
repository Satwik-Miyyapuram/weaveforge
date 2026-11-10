//! wasm export for the signed-url batch cap (wf-core `storage::blob_access`; TS: `storage-blob-access.ts`).

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wf_core::storage::blob_access;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`blob_access::MAX_SIGNED_URL_PATHS`]: most paths one signed-url request may ask for.
#[wasm_bindgen(js_name = maxSignedUrlPaths)]
pub fn max_signed_url_paths_js() -> u32 {
    u32::try_from(blob_access::MAX_SIGNED_URL_PATHS).unwrap_or(u32::MAX)
}

/// [`blob_access::BLOB_STORAGE_BUCKETS`]: every bucket a user's blobs live in, as a string array.
#[wasm_bindgen(js_name = blobStorageBuckets)]
pub fn blob_storage_buckets_js() -> JsResult<JsValue> {
    serde_wasm_bindgen::to_value(&blob_access::BLOB_STORAGE_BUCKETS)
}

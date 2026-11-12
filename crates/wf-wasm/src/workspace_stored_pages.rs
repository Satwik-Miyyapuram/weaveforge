//! Stored note digests and owned asset storage paths for JavaScript (wf-core
//! `workspace::stored_pages`).

use indexmap::IndexMap;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::stored_pages::{self, StoredPage};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`stored_digest`](stored_pages::stored_digest): one note's digest from its title and body.
#[wasm_bindgen(js_name = storedDigest)]
pub fn stored_digest_js(title: &str, body: &str) -> String {
    stored_pages::stored_digest(title, body)
}

/// [`stored_digests`](stored_pages::stored_digests): each note's digest by id, as `Record<string, string>`.
///
/// # Errors
///
/// Fails when `pages` is not an array of `{ id, title, body }` strings.
#[wasm_bindgen(js_name = storedDigests, unchecked_return_type = "Record<string, string>")]
pub fn stored_digests_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { id: string; title: string; body: string }[]"
    )]
    pages: JsValue,
) -> JsResult<JsValue> {
    let pages: Vec<StoredPage> = serde_wasm_bindgen::from_value(pages)?;
    let digests: IndexMap<String, String> = stored_pages::stored_digests(&pages);
    to_js(&digests)
}

/// [`owned_storage`](stored_pages::owned_storage): each owned folder path mapped to its storage path.
#[wasm_bindgen(js_name = ownedStorage, unchecked_return_type = "Record<string, string>")]
pub fn owned_storage_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] folder_paths: Vec<String>,
) -> JsResult<JsValue> {
    to_js(&stored_pages::owned_storage(&folder_paths))
}

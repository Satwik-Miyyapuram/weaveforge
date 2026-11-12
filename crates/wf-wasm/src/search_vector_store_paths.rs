//! Vector-store keys, cache paths and local-row framing (wf-core `search::vector_store_paths`).

use js_sys::{Object, Reflect, Uint8Array};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::vector_store_paths as paths;

/// [`store_key`](paths::store_key): the key a corpus's vectors are stored under.
#[wasm_bindgen(js_name = vectorStoreKey)]
#[must_use]
pub fn vector_store_key_js(project_id: Option<String>) -> String {
    paths::store_key(project_id.as_deref())
}

/// [`folder_cache_dir`](paths::folder_cache_dir): the workspace folder's vector cache directory.
#[wasm_bindgen(js_name = vectorFolderCacheDir)]
#[must_use]
pub fn vector_folder_cache_dir_js() -> String {
    paths::folder_cache_dir()
}

/// [`folder_path`](paths::folder_path): the workspace-folder file holding one corpus's vectors.
#[wasm_bindgen(js_name = vectorFolderPath)]
#[must_use]
pub fn vector_folder_path_js(project_id: Option<String>) -> String {
    paths::folder_path(project_id.as_deref())
}

/// [`is_vector_cache_file`](paths::is_vector_cache_file): whether a folder-cache entry is a vector file.
#[wasm_bindgen(js_name = isVectorCacheFile)]
#[must_use]
pub fn is_vector_cache_file_js(path: &str) -> bool {
    paths::is_vector_cache_file(path)
}

/// [`pack_local_row`](paths::pack_local_row): a local-database row for a head JSON and blob.
#[wasm_bindgen(js_name = packLocalVectorRow)]
#[must_use]
pub fn pack_local_vector_row_js(head_json: &str, bytes: &[u8]) -> String {
    paths::pack_local_row(head_json, bytes)
}

/// [`unpack_local_row`](paths::unpack_local_row): `{ head, bytes }` from a local row, or `null`.
///
/// # Errors
///
/// Fails only if the result object cannot be built.
#[wasm_bindgen(
    js_name = unpackLocalVectorRow,
    unchecked_return_type = "{ readonly head: string; readonly bytes: Uint8Array } | null"
)]
pub fn unpack_local_vector_row_js(packed: &str) -> Result<JsValue, JsValue> {
    let Some((head, bytes)) = paths::unpack_local_row(packed) else {
        return Ok(JsValue::NULL);
    };
    let out = Object::new();
    let _ = Reflect::set(&out, &"head".into(), &JsValue::from_str(&head))?;
    let _ = Reflect::set(&out, &"bytes".into(), &Uint8Array::from(bytes.as_slice()))?;
    Ok(out.into())
}

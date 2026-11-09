//! Ink note sidecar paths and chunk ids for JavaScript (wf-core `ink::ink_paths`). The JS names
//! match `packages/core/src/ink/ink-note.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::ink_paths;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_ink_note_id`](ink_paths::is_ink_note_id).
#[wasm_bindgen(js_name = isInkNoteId)]
pub fn is_ink_note_id_js(id: &str) -> bool {
    ink_paths::is_ink_note_id(id)
}

/// [`ink_sidecar_dir`](ink_paths::ink_sidecar_dir).
///
/// # Errors
///
/// Fails when `noteId` is not a safe id.
#[wasm_bindgen(js_name = inkSidecarDir)]
pub fn ink_sidecar_dir_js(note_id: &str) -> JsResult<String> {
    ink_paths::ink_sidecar_dir(note_id).map_err(serde_wasm_bindgen::Error::new)
}

/// [`ink_chunk_path`](ink_paths::ink_chunk_path).
///
/// # Errors
///
/// Fails when `chunkId` or `noteId` is unusable.
#[wasm_bindgen(js_name = inkChunkPath)]
pub fn ink_chunk_path_js(note_id: &str, chunk_id: &str) -> JsResult<String> {
    ink_paths::ink_chunk_path(note_id, chunk_id).map_err(serde_wasm_bindgen::Error::new)
}

/// [`parse_ink_chunk_path`](ink_paths::parse_ink_chunk_path): `{ noteId, chunkId }`, or `null`.
#[wasm_bindgen(js_name = parseInkChunkPath)]
pub fn parse_ink_chunk_path_js(path: &str) -> JsResult<JsValue> {
    match ink_paths::parse_ink_chunk_path(path) {
        Some(found) => to_js(&found),
        None => Ok(JsValue::NULL),
    }
}

/// [`new_ink_chunk_id`](ink_paths::new_ink_chunk_id). JS passes `Date.now()` as `nowMs` and a
/// 10-byte `Uint8Array` filled by `crypto.getRandomValues` as `randomBytes`.
///
/// # Errors
///
/// Fails when `nowMs` is not finite.
#[wasm_bindgen(js_name = newInkChunkId)]
pub fn new_ink_chunk_id_js(now_ms: f64, random_bytes: &[u8]) -> JsResult<String> {
    ink_paths::new_ink_chunk_id(now_ms, random_bytes).map_err(serde_wasm_bindgen::Error::new)
}

//! The stored vector file's framing (wf-core `search::vector_codec`), used by the
//! workspace-folder and local vector caches.

use js_sys::{Object, Reflect, Uint8Array};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::vector_codec::{self as codec, VectorFileHead};

use super::to_js;
use super::vector_index::VectorIndex;

/// [`VectorIndex::to_bytes`] with its model, dimensions and content hashes, as the semantic
/// index's `serialize()` stores it: `{ model, dimensions, bytes, hashes }`. `hashes` is the
/// `Map` of embedded text hashes, copied to a plain object.
///
/// # Errors
///
/// Fails if `embedded` is not an iterable of `[string, string]` pairs.
#[wasm_bindgen(
    js_name = packVectorIndex,
    unchecked_return_type = "{ readonly model: string; readonly dimensions: number; readonly bytes: Uint8Array; readonly hashes: Readonly<Record<string, string>> }"
)]
pub fn pack_vector_index_js(
    model: &str,
    index: &VectorIndex,
    #[wasm_bindgen(unchecked_param_type = "Iterable<readonly [string, string]>")] embedded: JsValue,
) -> Result<JsValue, JsValue> {
    let hashes = Object::from_entries(&embedded)?;
    let out = Object::new();
    let _ = Reflect::set(&out, &"model".into(), &JsValue::from_str(model))?;
    let _ = Reflect::set(
        &out,
        &"dimensions".into(),
        &JsValue::from_f64(f64::from(index.dimensions())),
    )?;
    let _ = Reflect::set(
        &out,
        &"bytes".into(),
        &Uint8Array::from(index.to_bytes().as_slice()),
    )?;
    let _ = Reflect::set(&out, &"hashes".into(), &hashes)?;
    Ok(out.into())
}

/// [`pack_vectors`](codec::pack_vectors).
///
/// # Errors
///
/// Fails if the head argument is not an object with `model`, `dimensions` and `revision`.
#[wasm_bindgen(js_name = packVectors)]
pub fn pack_vectors_js(
    #[wasm_bindgen(unchecked_param_type = "B.VectorFileHead")] head: JsValue,
    bytes: &[u8],
) -> Result<Vec<u8>, serde_wasm_bindgen::Error> {
    let head: VectorFileHead = serde_wasm_bindgen::from_value(head)?;
    Ok(codec::pack_vectors(&head, bytes))
}

/// [`unpack_head`](codec::unpack_head): the head, or `null` for a torn file.
///
/// # Errors
///
/// Fails only if the head cannot be serialised.
#[wasm_bindgen(js_name = unpackVectorHead, unchecked_return_type = "B.VectorFileHead | null")]
pub fn unpack_vector_head_js(file: &[u8]) -> Result<JsValue, serde_wasm_bindgen::Error> {
    match codec::unpack_head(file) {
        Some((head, _)) => to_js(&head),
        None => Ok(JsValue::NULL),
    }
}

/// [`unpack_vectors`](codec::unpack_vectors): a file's head with its blob as `bytes`, or `null`
/// if it is torn or its head is not valid.
///
/// # Errors
///
/// Fails only if the head cannot be serialised.
#[wasm_bindgen(
    js_name = unpackVectors,
    unchecked_return_type = "(B.VectorFileHead & { bytes: Uint8Array }) | null"
)]
pub fn unpack_vectors_js(file: &[u8]) -> Result<JsValue, JsValue> {
    let Some((head, bytes)) = codec::unpack_vectors(file) else {
        return Ok(JsValue::NULL);
    };
    let out = to_js(&head)?;
    let _ = js_sys::Reflect::set(
        &out,
        &JsValue::from_str("bytes"),
        &js_sys::Uint8Array::from(bytes.as_slice()),
    )?;
    Ok(out)
}

/// The blob of [`unpack_vectors`](codec::unpack_vectors), or `undefined` for a torn file.
#[wasm_bindgen(js_name = unpackVectorBlob)]
#[must_use]
pub fn unpack_vector_blob_js(file: &[u8]) -> Option<Vec<u8>> {
    codec::unpack_vectors(file).map(|(_, bytes)| bytes)
}

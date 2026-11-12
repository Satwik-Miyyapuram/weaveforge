//! Ink note sidecar paths and chunk ids for JavaScript (wf-core `ink::ink_paths`). The JS names
//! match `packages/core/src/ink/parts-2.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
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
#[wasm_bindgen(
    js_name = parseInkChunkPath,
    unchecked_return_type = "{ noteId: string; chunkId: string } | null"
)]
pub fn parse_ink_chunk_path_js(path: &str) -> JsResult<JsValue> {
    match ink_paths::parse_ink_chunk_path(path) {
        Some(found) => to_js(&found),
        None => Ok(JsValue::NULL),
    }
}

/// Fills `bytes` from `globalThis.crypto.getRandomValues`, or from `Math.random()` where
/// there is no Web Crypto.
///
/// # Errors
///
/// Rethrows whatever `getRandomValues` throws.
fn fill_random(bytes: &js_sys::Uint8Array) -> Result<(), JsValue> {
    let crypto = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("crypto"))?;
    if !crypto.is_undefined() && !crypto.is_null() {
        let fill = js_sys::Reflect::get(&crypto, &JsValue::from_str("getRandomValues"))?;
        if let Some(fill) = fill.dyn_ref::<js_sys::Function>() {
            let _ = fill.call1(&crypto, bytes)?;
            return Ok(());
        }
    }
    for index in 0..bytes.length() {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let byte = (js_sys::Math::random() * 256.0).floor() as u8;
        bytes.set_index(index, byte);
    }
    Ok(())
}

/// [`new_ink_chunk_id`](ink_paths::new_ink_chunk_id): a new chunk id from `options.now`
/// (`Date.now()` by default) and 10 random bytes, filled by `options.randomBytes` or by
/// `crypto.getRandomValues`.
///
/// # Errors
///
/// Fails when `now` is not finite, and rethrows whatever filling the bytes throws.
#[wasm_bindgen(js_name = newInkChunkId)]
pub fn new_ink_chunk_id_js(
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ now?: number; randomBytes?: (target: Uint8Array) => void }"
    )]
    options: Option<JsValue>,
) -> Result<String, JsValue> {
    let options = options.unwrap_or(JsValue::UNDEFINED);
    let field = |key: &str| -> Result<JsValue, JsValue> {
        if options.is_undefined() || options.is_null() {
            return Ok(JsValue::UNDEFINED);
        }
        js_sys::Reflect::get(&options, &JsValue::from_str(key))
    };
    let now = field("now")?;
    let now_ms = if now.is_undefined() || now.is_null() {
        js_sys::Date::now()
    } else {
        now.as_f64().unwrap_or(f64::NAN)
    };
    let bytes = js_sys::Uint8Array::new_with_length(10);
    match field("randomBytes")?.dyn_into::<js_sys::Function>() {
        Ok(fill) => {
            let _ = fill.call1(&JsValue::UNDEFINED, &bytes)?;
        }
        Err(_) => fill_random(&bytes)?,
    }
    ink_paths::new_ink_chunk_id(now_ms, &bytes.to_vec())
        .map_err(|message| serde_wasm_bindgen::Error::new(message).into())
}

/// [`chunk_id_of_file_name`](ink_paths::chunk_id_of_file_name): the chunk id a filename
/// names, or `null` when it is not `<chunk id>.inkb`.
#[must_use]
#[wasm_bindgen(js_name = inkChunkIdOfFileName, unchecked_return_type = "string | null")]
pub fn ink_chunk_id_of_file_name_js(name: &str) -> JsValue {
    let value = ink_paths::chunk_id_of_file_name(name).map(str::to_owned);
    value.map_or(JsValue::NULL, JsValue::from)
}

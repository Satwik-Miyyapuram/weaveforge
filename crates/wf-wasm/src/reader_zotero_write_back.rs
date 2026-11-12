//! Zotero annotation write-back request headers and reply outcomes
//! (`apps/web/src/features/reader/infrastructure/parts-2.ts`).
//! Wraps `wf_core::reader::zotero_write_back_reply`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::zotero_write_back_reply::{
    create_outcomes, library_version, update_headers, update_outcome, update_url, CreateReply,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`library_version`]: the `Last-Modified-Version` header as a number, or `undefined`.
#[wasm_bindgen(js_name = zoteroWriteBackLibraryVersion)]
pub fn zotero_write_back_library_version(raw: Option<String>) -> Option<f64> {
    library_version(raw.as_deref())
}

/// [`update_headers`]: the PATCH headers, with the version guard when `zoteroVersion` is known.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = zoteroWriteBackUpdateHeaders)]
pub fn zotero_write_back_update_headers(
    api_key: &str,
    zotero_version: Option<f64>,
) -> JsResult<JsValue> {
    to_js(&update_headers(api_key, zotero_version))
}

/// [`update_url`]: `<base>/items/<key>` with the key percent-encoded.
#[wasm_bindgen(js_name = zoteroWriteBackUpdateUrl)]
pub fn zotero_write_back_update_url(base: &str, zotero_key: &str) -> String {
    update_url(base, zotero_key)
}

/// [`update_outcome`]: `{ id, outcome, zoteroKey, zoteroVersion?, reason? }` for one PATCH.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = zoteroWriteBackUpdateOutcome)]
pub fn zotero_write_back_update_outcome(
    id: &str,
    zotero_key: &str,
    status: u16,
    detail: &str,
    library_version: Option<f64>,
) -> JsResult<JsValue> {
    to_js(&update_outcome(id, zotero_key, status, detail, library_version))
}

/// [`create_outcomes`]: one `{ id, outcome, ... }` per annotation of a batch create. `body` is the
/// reply's JSON; a non-object or unreadable body counts as an empty reply.
///
/// # Errors
///
/// Fails if `ids` is not an array of strings or the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = zoteroWriteBackCreateOutcomes)]
pub fn zotero_write_back_create_outcomes(
    ids: JsValue,
    status: u16,
    detail: &str,
    body: JsValue,
    library_version: Option<f64>,
) -> JsResult<JsValue> {
    let ids: Vec<String> = serde_wasm_bindgen::from_value(ids)?;
    let reply: CreateReply = serde_wasm_bindgen::from_value(body).unwrap_or_default();
    to_js(&create_outcomes(&ids, status, detail, &reply, library_version))
}

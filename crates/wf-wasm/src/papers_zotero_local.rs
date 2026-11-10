//! Local Zotero API status rules (wf-core `papers::zotero_local_status`).
//!
//! The TS wrapper in `packages/wf-wasm/src/papers-zotero-local.ts` gives the results their types.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::zotero_local_status;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The message for the 403 the local API answers when its preference is off (TS
/// `ZOTERO_LOCAL_API_OFF`).
#[wasm_bindgen(js_name = zoteroLocalApiOff)]
#[must_use]
pub fn zotero_local_api_off_js() -> String {
    zotero_local_status::ZOTERO_LOCAL_API_OFF.to_owned()
}

/// [`zotero_local_status_message`](zotero_local_status::zotero_local_status_message)
/// (TS `zoteroLocalStatusMessage`).
///
/// # Errors
///
/// Fails if the result cannot be converted.
#[wasm_bindgen(js_name = zoteroLocalStatusMessage)]
pub fn zotero_local_status_message_js(status: f64) -> JsResult<JsValue> {
    to_js(&zotero_local_status::zotero_local_status_message(status))
}

/// [`usable_status`](zotero_local_status::usable_status) (TS `usableStatus`).
#[wasm_bindgen(js_name = usableStatus)]
#[must_use]
pub fn usable_status_js(status: f64) -> u16 {
    zotero_local_status::usable_status(status)
}

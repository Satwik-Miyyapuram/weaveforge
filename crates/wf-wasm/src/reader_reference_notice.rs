//! Reference popover notices for JavaScript (`apps/web/src/features/reader/application/reference-notice.ts`).
//! Wraps `wf_core::reader::reference_notice`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::reference_notice::{ReferenceNotice, added_notice, notice_for};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`notice_for`]: the text under `entry_index`, or `null` when the notice is about another entry.
///
/// # Errors
///
/// Fails if `notice` is neither `null` nor a `{ index, text }` object.
#[wasm_bindgen(js_name = noticeFor)]
pub fn notice_for_js(notice: JsValue, entry_index: u32) -> JsResult<JsValue> {
    let notice: Option<ReferenceNotice> = serde_wasm_bindgen::from_value(notice)?;
    Ok(match notice_for(notice.as_ref(), entry_index) {
        Some(text) => JsValue::from_str(text),
        None => JsValue::NULL,
    })
}

/// [`added_notice`]: what an add says.
#[wasm_bindgen(js_name = addedNotice)]
pub fn added_notice_js(created: bool) -> String {
    added_notice(created).to_owned()
}

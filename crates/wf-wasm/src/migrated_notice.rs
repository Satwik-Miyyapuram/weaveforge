//! The migrated-data warning for JavaScript (wf-core `sync::migrated_notice`). The JS name matches
//! `apps/shell/sidecar/src/migrated-notice.ts`; the marker-file read stays in TypeScript.

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wf_core::sync::migrated_notice;

/// [`migrated_notice`](migrated_notice::migrated_notice): the warning for the marker's text, or
/// `null` when there is no marker.
#[wasm_bindgen(js_name = migratedNotice, unchecked_return_type = "string | null")]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn migrated_notice_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] raw: Option<
        String,
    >,
) -> JsValue {
    migrated_notice::migrated_notice(raw.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

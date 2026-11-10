//! The migrated-data warning for JavaScript (wf-core `sync::migrated_notice`). The JS name matches
//! `apps/shell/sidecar/src/migrated-notice.ts`; the marker-file read stays in TypeScript.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::migrated_notice;

/// [`migrated_notice`](migrated_notice::migrated_notice): the warning for the marker's text, or
/// `undefined` when there is no marker. The TS wrapper maps `undefined` to `null`.
#[wasm_bindgen(js_name = migratedNotice)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn migrated_notice_js(raw: Option<String>) -> Option<String> {
    migrated_notice::migrated_notice(raw.as_deref())
}

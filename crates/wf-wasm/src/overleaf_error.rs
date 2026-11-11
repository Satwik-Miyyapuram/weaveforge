//! Overleaf error text redaction (wf-core `overleaf::error_redact`). The TS wrapper
//! `packages/wf-wasm/src/wrappers-4.ts` formats the thrown value before this runs.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf::error_redact;

/// [`redact_error_text`](error_redact::redact_error_text): the token and URL credentials removed,
/// capped at 500 UTF-16 units. An empty or missing token is ignored.
#[wasm_bindgen(js_name = redactOverleafErrorText)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn redact_overleaf_error_text(raw: &str, token: Option<String>) -> String {
    error_redact::redact_error_text(raw, token.as_deref())
}

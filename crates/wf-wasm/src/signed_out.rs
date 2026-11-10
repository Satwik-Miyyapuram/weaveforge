//! Signed-out refusal check for JavaScript (wf-core `signed_out`). The JS name matches
//! `isSignedOutRefusal` in `apps/web/src/lib/session-lost.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::signed_out::is_signed_out_refusal;

/// [`is_signed_out_refusal`] (TS `isSignedOutRefusal`): true when a refusal means "sign in".
#[wasm_bindgen(js_name = isSignedOutRefusal)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn is_signed_out_refusal_js(message: &str, code: Option<String>) -> bool {
    is_signed_out_refusal(message, code.as_deref())
}

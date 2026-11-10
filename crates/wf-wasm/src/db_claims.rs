//! wasm export for the row-level security claims JSON (wf-core `db_claims`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::db_claims;

/// [`db_claims::session_claims`]: the `request.jwt.claims` JSON; `null`/`undefined` or `""` gives `anon`.
#[wasm_bindgen(js_name = sessionClaims)]
#[must_use]
pub fn session_claims_js(user_id: Option<String>) -> String {
    db_claims::session_claims(user_id.as_deref())
}

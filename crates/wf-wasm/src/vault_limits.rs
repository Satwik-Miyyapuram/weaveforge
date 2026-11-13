//! Vault size-cap wording for JavaScript (wf-core `sync::vault_limits`). The JS name matches
//! `packages/wf-wasm/src/vault-limits.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::vault_limits::too_large_message;

/// [`too_large_message`](wf_core::sync::vault_limits::too_large_message): the "too large to open here" text for a byte cap.
#[wasm_bindgen(js_name = vaultTooLargeMessage)]
#[must_use]
pub fn vault_too_large_message_js(cap_bytes: f64) -> String {
    too_large_message(cap_bytes)
}

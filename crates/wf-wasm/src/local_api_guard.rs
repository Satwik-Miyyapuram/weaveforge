//! Local API request guards (wf-core `local_api_guard`). The JS names match
//! `apps/shell/sidecar/src/local-api-server.ts` and `local-api.ts`. Token hashing and the constant-time
//! compare stay in TypeScript.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::local_api_guard;

/// [`is_loopback_host`](local_api_guard::is_loopback_host): whether a `Host` header is this machine on `port`.
#[wasm_bindgen(js_name = isLoopbackHost)]
pub fn is_loopback_host_js(host: Option<String>, port: u16) -> bool {
    local_api_guard::is_loopback_host(host.as_deref(), port)
}

/// [`bearer_token`](local_api_guard::bearer_token): the credential a `Bearer` header offers, or `undefined`.
#[wasm_bindgen(js_name = bearerToken)]
pub fn bearer_token_js(header: Option<String>) -> Option<String> {
    local_api_guard::bearer_token(header.as_deref()).map(str::to_string)
}

/// [`is_legacy_token_hex`](local_api_guard::is_legacy_token_hex): whether a stored token is a legacy plaintext one.
#[wasm_bindgen(js_name = isLegacyTokenHex)]
pub fn is_legacy_token_hex_js(stored: &str) -> bool {
    local_api_guard::is_legacy_token_hex(stored)
}

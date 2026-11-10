//! Private-host and public-https checks for JavaScript (wf-core `private_host`). The JS names
//! match `apps/desktop/src/proxy-shared.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::private_host;

/// [`is_private_host`](private_host::is_private_host): a host this machine or its network answers for.
#[wasm_bindgen(js_name = isPrivateHost)]
#[must_use]
pub fn is_private_host_js(hostname: &str) -> bool {
    private_host::is_private_host(hostname)
}

/// [`is_public_https_url`](private_host::is_public_https_url): https, no credentials, public host.
/// `false` for text that does not parse, as the TS `catch` did.
#[wasm_bindgen(js_name = isPublicHttpsUrl)]
#[must_use]
pub fn is_public_https_url_js(raw: &str) -> bool {
    private_host::is_public_https_url(raw)
}

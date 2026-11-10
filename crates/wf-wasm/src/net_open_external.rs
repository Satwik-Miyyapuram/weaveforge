//! Whether a URL may be opened by the operating system, for JavaScript (wf-core `open_external`).
//! The JS name matches `apps/desktop/src/handlers.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::open_external;

/// [`may_open_externally`](open_external::may_open_externally): a plain web address, with no
/// credentials, on an allowed port and not a private host. Scheme-less input is read as https.
#[wasm_bindgen(js_name = mayOpenExternally)]
#[must_use]
pub fn may_open_externally_js(url: &str) -> bool {
    open_external::may_open_externally(url)
}

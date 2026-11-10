//! URL metadata rules for JavaScript (wf-core `papers::url_meta`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::url_meta;

/// [`shell_target`](url_meta::shell_target).
#[wasm_bindgen(js_name = urlMetaShellTarget)]
#[must_use]
pub fn url_meta_shell_target_js(value: &str) -> String {
    url_meta::shell_target(value)
}

/// [`read_failure_message`](url_meta::read_failure_message).
#[wasm_bindgen(js_name = urlMetaReadFailureMessage)]
#[must_use]
pub fn url_meta_read_failure_message_js(status: u16, detail: &str) -> String {
    url_meta::read_failure_message(status, detail)
}

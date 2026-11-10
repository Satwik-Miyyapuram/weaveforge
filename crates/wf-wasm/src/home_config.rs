//! The workspace-folder pointer parse for JavaScript (wf-core `home_config`). The JS name matches
//! `apps/shell/sidecar/src/home-config.ts`; the file read and the path join stay in TypeScript.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::home_config;

/// [`vault_root_from_text`](home_config::vault_root_from_text): the `vaultRoot` string, or `undefined`
/// when there is none. The TS wrapper maps `undefined` to `null`.
#[wasm_bindgen(js_name = vaultRootFromText)]
#[must_use]
pub fn vault_root_from_text_js(text: &str) -> Option<String> {
    home_config::vault_root_from_text(text)
}

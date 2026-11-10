//! Secret names (wf-core `secret_names`). The JS name matches `apps/shell/sidecar/src/secret-store.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::secret_names;

/// [`is_secret_name`](secret_names::is_secret_name): whether `name` is a secret the app stores.
#[wasm_bindgen(js_name = isSecretName)]
pub fn is_secret_name_js(name: &str) -> bool {
    secret_names::is_secret_name(name)
}

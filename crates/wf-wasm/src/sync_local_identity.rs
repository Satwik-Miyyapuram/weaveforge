//! Local-mode decision for JavaScript (wf-core `sync::local_identity`). The JS names are
//! called from `apps/web/src/backend/providers/local/local-identity.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::local_identity::{LOCAL_MODE_KEY, is_local_mode};

/// [`LOCAL_MODE_KEY`] for JS: the localStorage key of the local-mode choice.
#[wasm_bindgen(js_name = localModeKey)]
#[must_use]
pub fn local_mode_key_js() -> String {
    LOCAL_MODE_KEY.to_owned()
}

/// [`is_local_mode`] for JS: whether the stored local-mode value turns local mode on.
#[wasm_bindgen(js_name = localIsLocalMode)]
#[must_use]
pub fn local_is_local_mode_js(stored: Option<String>) -> bool {
    is_local_mode(stored.as_deref())
}

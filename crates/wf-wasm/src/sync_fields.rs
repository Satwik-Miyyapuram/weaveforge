//! Sync connection field visibility for JavaScript (wf-core `sync_fields`). The TS wrapper in
//! `packages/wf-wasm/src/sync-fields.ts` applies the types.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync_fields::field_shown;

/// [`field_shown`]: whether the connection field with `key` is asked for in this sign-in mode.
#[wasm_bindgen(js_name = syncFieldShown)]
#[must_use]
pub fn sync_field_shown(key: &str, mattermost_sign_in: bool) -> bool {
    field_shown(key, mattermost_sign_in)
}

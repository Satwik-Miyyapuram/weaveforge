//! Local identity and marker decisions for JavaScript (wf-core `sync::local_identity`).
//! The JS names are called from `apps/web/src/backend/providers/local/local-identity.ts`
//! and `local-first-marker.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::local_identity::{
    DEVICE_USER_SQL, LOCAL_FIRST_KEY, LOCAL_MODE_KEY, device_user_id, is_local_mode,
    local_first_account_from_marker, local_first_wanted,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`LOCAL_MODE_KEY`] for JS: the localStorage key of the local-mode choice.
#[wasm_bindgen(js_name = localModeKey)]
#[must_use]
pub fn local_mode_key_js() -> String {
    LOCAL_MODE_KEY.to_owned()
}

/// [`LOCAL_FIRST_KEY`] for JS: the localStorage key of the local-first marker.
#[wasm_bindgen(js_name = localFirstKey)]
#[must_use]
pub fn local_first_key_js() -> String {
    LOCAL_FIRST_KEY.to_owned()
}

/// [`DEVICE_USER_SQL`] for JS: the query that reads the signed-in user.
#[wasm_bindgen(js_name = localDeviceUserSql)]
#[must_use]
pub fn local_device_user_sql_js() -> String {
    DEVICE_USER_SQL.to_owned()
}

/// [`is_local_mode`] for JS: whether the stored local-mode value turns local mode on.
#[wasm_bindgen(js_name = localIsLocalMode)]
#[must_use]
pub fn local_is_local_mode_js(stored: Option<String>) -> bool {
    is_local_mode(stored.as_deref())
}

/// [`local_first_wanted`] for JS: whether the local-first wiring applies to this window.
#[wasm_bindgen(js_name = localFirstWanted)]
#[must_use]
pub fn local_first_wanted_js(local_mode: bool, desktop: bool) -> bool {
    local_first_wanted(local_mode, desktop)
}

/// [`local_first_account_from_marker`] for JS: `{ id, email }`, or `null` when unreadable.
///
/// # Errors
///
/// Fails when the result cannot be serialised.
#[wasm_bindgen(
    js_name = localFirstMarkerAccount,
    unchecked_return_type = "{ id: string; email: string | null } | null"
)]
pub fn local_first_marker_account_js(raw: Option<String>) -> JsResult<JsValue> {
    to_js(&local_first_account_from_marker(raw.as_deref()))
}

/// [`device_user_id`] for JS: the reported id when non-empty, else `fallback`.
#[wasm_bindgen(js_name = localDeviceUserId)]
#[must_use]
pub fn local_device_user_id_js(reported: Option<String>, fallback: String) -> String {
    device_user_id(reported.as_deref(), &fallback)
}

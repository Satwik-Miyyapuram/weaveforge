//! Sync-loop session decisions for JavaScript (wf-core `sync::device_session`). The JS names
//! match `mayDriveDevice` and `sessionAction` in `packages/wf-wasm/src/sync-device-session.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::device_session::{may_drive_device, session_action};

/// [`may_drive_device`] for JS (TS `mayDriveDevice`).
#[wasm_bindgen(js_name = mayDriveDevice)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn may_drive_device_js(
    signed_in_user_id: Option<String>,
    adopted_account_id: Option<String>,
) -> bool {
    may_drive_device(signed_in_user_id.as_deref(), adopted_account_id.as_deref())
}

/// [`session_action`] for JS (TS `sessionAction`): `"idle"`, `"adopt"`, `"drive"` or `"foreign"`.
#[wasm_bindgen(js_name = sessionAction, unchecked_return_type = "\"idle\" | \"adopt\" | \"drive\" | \"foreign\"")]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn session_action_js(
    signed_in_user_id: Option<String>,
    adopted_account_id: Option<String>,
) -> String {
    session_action(signed_in_user_id.as_deref(), adopted_account_id.as_deref())
        .name()
        .to_owned()
}

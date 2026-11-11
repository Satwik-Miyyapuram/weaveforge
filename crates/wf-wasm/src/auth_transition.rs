//! Auth session transition for JavaScript (wf-core `auth_transition`). The JS name matches
//! `nextAuthStep` in `apps/web/src/features/auth/domain/parts.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::auth_transition::{AuthTransitionInput, next_auth_step};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`next_auth_step`] (TS `nextAuthStep`): the step as `{ kind, ... }`.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = nextAuthStep)]
#[allow(clippy::fn_params_excessive_bools)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn next_auth_step_js(
    user_id: Option<String>,
    previous_id: Option<String>,
    signing_out: bool,
    was_expired: bool,
    desktop: bool,
    local_account_id: Option<String>,
) -> JsResult<wasm_bindgen::JsValue> {
    to_js(&next_auth_step(AuthTransitionInput {
        user_id: user_id.as_deref(),
        previous_id: previous_id.as_deref(),
        signing_out,
        was_expired,
        desktop,
        local_account_id: local_account_id.as_deref(),
    }))
}

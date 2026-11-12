//! Auth session transition for JavaScript (wf-core `auth_transition`). The JS name matches
//! `nextAuthStep` in `apps/web/src/features/auth/domain/parts.ts`.

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::auth_transition::{AuthTransitionInput, next_auth_step};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The JS input object; `null` ids read as `None`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
struct NextAuthStepInput {
    user_id: Option<String>,
    previous_id: Option<String>,
    signing_out: bool,
    was_expired: bool,
    desktop: bool,
    local_account_id: Option<String>,
}

/// [`next_auth_step`] (TS `nextAuthStep`): the step as `{ kind, ... }`.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = nextAuthStep, unchecked_return_type = "B.AuthStep")]
pub fn next_auth_step_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ userId: string | null; previousId: string | null; signingOut: boolean; wasExpired: boolean; desktop: boolean; localAccountId: string | null }"
    )]
    input: JsValue,
) -> JsResult<JsValue> {
    let input: NextAuthStepInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&next_auth_step(AuthTransitionInput {
        user_id: input.user_id.as_deref(),
        previous_id: input.previous_id.as_deref(),
        signing_out: input.signing_out,
        was_expired: input.was_expired,
        desktop: input.desktop,
        local_account_id: input.local_account_id.as_deref(),
    }))
}

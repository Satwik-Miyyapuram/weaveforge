//! Git remote credentials for JavaScript (wf-core `sync::git_auth`). Spawning git and merging
//! `process.env` stay in `apps/shell/sidecar/src/vault-git.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::sync::git_auth::{RemoteAuthInput, remote_auth};

use super::to_js;

/// [`remote_auth`](wf_core::sync::git_auth::remote_auth): `{ flags, env }` for `{ url, token?, username? }`.
///
/// # Errors
///
/// Fails when `input` is not an object with a string `url`, or when the result cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = gitRemoteAuth,
    unchecked_return_type = "{ flags: string[]; env: Record<string, string> }"
)]
pub fn git_remote_auth_js(
    #[wasm_bindgen(unchecked_param_type = "{ url: string; token?: string; username?: string }")]
    input: JsValue,
) -> Result<JsValue, JsError> {
    let input: RemoteAuthInput =
        serde_wasm_bindgen::from_value(input).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&remote_auth(&input)).map_err(|error| JsError::new(&error.to_string()))
}

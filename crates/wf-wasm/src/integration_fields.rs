//! Sync integration fields (wf-core `sync::integration_fields`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::integration_fields::{self as fields, Integration};

use super::to_js;

/// [`git_connection`](fields::git_connection).
///
/// # Errors
///
/// Fails if `integration` has the wrong shape.
#[wasm_bindgen(js_name = gitConnection)]
pub fn git_connection_js(integration: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let integration: Integration = serde_wasm_bindgen::from_value(integration)?;
    to_js(&fields::git_connection(&integration))
}

/// [`mattermost_connection`](fields::mattermost_connection).
///
/// # Errors
///
/// Fails if `integration` has the wrong shape.
#[wasm_bindgen(js_name = mattermostConnection)]
pub fn mattermost_connection_js(
    integration: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let integration: Integration = serde_wasm_bindgen::from_value(integration)?;
    to_js(&fields::mattermost_connection(&integration))
}

/// [`git_connection_ready`](fields::git_connection_ready).
///
/// # Errors
///
/// Fails if `integration` has the wrong shape.
#[wasm_bindgen(js_name = gitConnectionReady)]
pub fn git_connection_ready_js(integration: JsValue) -> Result<bool, serde_wasm_bindgen::Error> {
    let integration: Integration = serde_wasm_bindgen::from_value(integration)?;
    Ok(fields::git_connection_ready(&integration))
}

/// [`mattermost_connection_ready`](fields::mattermost_connection_ready).
///
/// # Errors
///
/// Fails if `integration` has the wrong shape.
#[wasm_bindgen(js_name = mattermostConnectionReady)]
pub fn mattermost_connection_ready_js(
    integration: JsValue,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let integration: Integration = serde_wasm_bindgen::from_value(integration)?;
    Ok(fields::mattermost_connection_ready(&integration))
}

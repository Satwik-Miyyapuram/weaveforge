//! Mattermost event list and routing (wf-core `sync::mattermost_options`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::integration_fields::Integration;
use wf_core::sync::mattermost_options::{self as options, MattermostEvent};

use super::to_js;

/// [`mattermost_events`](options::mattermost_events): the settings rows, in panel order.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = mattermostEvents)]
pub fn mattermost_events_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&options::mattermost_events())
}

/// [`mattermost_options`](options::mattermost_options) with the defaults applied.
///
/// # Errors
///
/// Fails if `integration` has the wrong shape.
#[wasm_bindgen(js_name = mattermostOptions)]
pub fn mattermost_options_js(integration: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let integration: Integration = serde_wasm_bindgen::from_value(integration)?;
    to_js(&options::mattermost_options(&integration))
}

/// [`mattermost_channel_for`](options::mattermost_channel_for); `undefined` when the event is off.
///
/// # Errors
///
/// Fails if `integration` or `event` has the wrong shape.
#[wasm_bindgen(js_name = mattermostChannelFor)]
pub fn mattermost_channel_for_js(
    integration: JsValue,
    event: JsValue,
) -> Result<Option<String>, serde_wasm_bindgen::Error> {
    let integration: Integration = serde_wasm_bindgen::from_value(integration)?;
    let event: MattermostEvent = serde_wasm_bindgen::from_value(event)?;
    Ok(options::mattermost_channel_for(&integration, event))
}

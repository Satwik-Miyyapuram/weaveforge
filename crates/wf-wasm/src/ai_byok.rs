//! Bring-your-own-key wire formats for JavaScript (wf-core `ai::byok_wire`). The browser keeps the
//! fetch, the timeout and the key in memory; these exports only build and read the JSON.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::byok_wire::{build_request, http_error_message, is_available, parse_reply};
use wf_core::ai::provider_descriptor::{ProviderApi, ProviderDescriptor};

use super::to_js;

#[wasm_bindgen(typescript_custom_section)]
const BYOK_WIRE_TS: &str = r"
/** One provider request: where to send it, with which headers, and its JSON body. */
export interface ByokRequest { url: string; headers: Record<string, string>; body: Record<string, unknown> }
";

/// [`build_request`]: the URL, headers and body for `descriptor`, with `messages` as the chat.
///
/// # Errors
///
/// Fails when the descriptor or the messages are malformed, or the result cannot be converted.
#[wasm_bindgen(js_name = buildByokRequest, unchecked_return_type = "ByokRequest")]
pub fn build_byok_request_js(
    #[wasm_bindgen(unchecked_param_type = "B.ProviderDescriptor")] descriptor: JsValue,
    api_key: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly object[]")] messages: JsValue,
) -> Result<JsValue, JsError> {
    let descriptor: ProviderDescriptor = serde_wasm_bindgen::from_value(descriptor).map_err(js_error)?;
    let messages: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(messages).map_err(js_error)?;
    to_js(&build_request(&descriptor, api_key, &messages)).map_err(js_error)
}

/// [`is_available`]: whether `descriptor` can be used with `api_key`.
///
/// # Errors
///
/// Fails when the descriptor is malformed.
#[wasm_bindgen(js_name = byokAvailable)]
pub fn byok_available_js(
    #[wasm_bindgen(unchecked_param_type = "B.ProviderDescriptor")] descriptor: JsValue,
    api_key: &str,
) -> Result<bool, JsError> {
    let descriptor: ProviderDescriptor = serde_wasm_bindgen::from_value(descriptor).map_err(js_error)?;
    Ok(is_available(&descriptor, api_key))
}

/// [`parse_reply`]: the reply text of a provider's JSON `payload`, or `null` when it is blank.
///
/// # Errors
///
/// Fails when `api` is not a known wire API or the payload cannot be read.
#[wasm_bindgen(js_name = parseByokReply, unchecked_return_type = "string | null")]
pub fn parse_byok_reply_js(api: JsValue, payload: JsValue) -> Result<JsValue, JsError> {
    let api: ProviderApi = serde_wasm_bindgen::from_value(api).map_err(js_error)?;
    let payload: serde_json::Value = serde_wasm_bindgen::from_value(payload).map_err(js_error)?;
    to_js(&parse_reply(api, &payload)).map_err(js_error)
}

/// [`http_error_message`]: the message for a failed call, with the provider's own detail.
#[wasm_bindgen(js_name = byokHttpError)]
pub fn byok_http_error_js(label: &str, status: u16, detail: &str) -> String {
    http_error_message(label, status, detail)
}

fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

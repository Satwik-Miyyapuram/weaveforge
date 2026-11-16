//! Error text for the UI and the API routes (`wf_core::error_report::format`).
//!
//! The thrown JS value is read here with `js_sys::Reflect` into the core's `Thrown` shape, and the
//! wording comes from the core, so it lives in one place. The `origin` and `sessionLost` arguments
//! are the page state the TypeScript caller already holds.

use js_sys::{JSON, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::error_report::format::{
    Env, ErrorShape, Thrown, describe_rejection, format_error, format_for_response, http_context,
    is_network_failure_of, json_body_error, parse_json_body, response_error_text,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// How deep a thrown value's nested `message`, `error` and `cause` are read; a cycle stops here.
const MAX_DEPTH: usize = 8;

/// Reads `key` from `value`, or `undefined` when the read throws.
fn read(value: &JsValue, key: &str) -> JsValue {
    Reflect::get(value, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
}

/// Reads `key` as a string, or `None` when it is not one.
fn text_field(value: &JsValue, key: &str) -> Option<String> {
    read(value, key).as_string()
}

/// Reduces a thrown JS value to the core's [`Thrown`] shape.
fn thrown_of(value: &JsValue, depth: usize) -> Thrown {
    if value.is_null() || value.is_undefined() || depth >= MAX_DEPTH {
        return Thrown::Missing;
    }
    if let Some(text) = value.as_string() {
        return Thrown::Text(text);
    }
    if value.is_object() {
        let shape = shape_of(value, depth);
        return if value.is_instance_of::<js_sys::Error>() {
            Thrown::Error(shape)
        } else {
            Thrown::Record {
                shape,
                json: json_of(value),
            }
        };
    }
    Thrown::Primitive {
        text: String::from(js_sys::JsString::from(value.clone())),
        json: json_of(value),
    }
}

/// `JSON.stringify(value)`, or `None` when it throws or yields no string.
fn json_of(value: &JsValue) -> Option<String> {
    JSON::stringify(value)
        .ok()
        .and_then(|text| text.as_string())
}

/// The fields of an object the core reads.
fn shape_of(value: &JsValue, depth: usize) -> ErrorShape {
    let message_value = read(value, "message");
    let message = message_value.as_string();
    let message_object = (message.is_none() && message_value.is_object())
        .then(|| Box::new(thrown_of(&message_value, depth + 1)));
    let error_value = read(value, "error");
    let error =
        (!error_value.is_null() && !error_value.is_undefined() && !Object::is(&error_value, value))
            .then(|| Box::new(thrown_of(&error_value, depth + 1)));
    let cause_value = read(value, "cause");
    let cause = (!cause_value.is_null() && !cause_value.is_undefined())
        .then(|| Box::new(thrown_of(&cause_value, depth + 1)));
    ErrorShape {
        name: text_field(value, "name").unwrap_or_default(),
        message,
        message_object,
        code: text_field(value, "code"),
        details: text_field(value, "details"),
        hint: text_field(value, "hint"),
        error,
        cause,
    }
}

/// The page state the formatters read.
fn env_of(origin: Option<String>, session_lost: bool) -> Env {
    Env {
        origin,
        session_lost,
    }
}

/// The display text for a thrown value (`formatError`).
#[wasm_bindgen(js_name = formatError)]
pub fn format_error_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] err: JsValue,
    #[wasm_bindgen(unchecked_param_type = "string | null")] origin: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "boolean")] session_lost: bool,
) -> String {
    format_error(&thrown_of(&err, 0), &env_of(origin, session_lost))
}

/// The log line for a rejection reason (`describeRejection`).
#[wasm_bindgen(js_name = describeRejection)]
pub fn describe_rejection_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] reason: JsValue,
    #[wasm_bindgen(unchecked_param_type = "string | null")] origin: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "boolean")] session_lost: bool,
) -> String {
    describe_rejection(&thrown_of(&reason, 0), &env_of(origin, session_lost))
}

/// The text for a body that failed to parse, keeping the parser's reason (`jsonBodyError`).
#[wasm_bindgen(js_name = jsonBodyError)]
pub fn json_body_error_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] err: JsValue,
) -> String {
    json_body_error(&thrown_of(&err, 0))
}

/// The body message and the log line for a route's error (`formatErrorForResponse`).
/// Returns `{ message, log? }`; `log` is set only for the database and cause paths.
#[wasm_bindgen(js_name = formatErrorForResponse, unchecked_return_type = "{ message: string; log?: string }")]
pub fn format_error_for_response_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] err: JsValue,
    #[wasm_bindgen(unchecked_param_type = "string")] context: &str,
    #[wasm_bindgen(unchecked_param_type = "string | null")] origin: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "boolean")] session_lost: bool,
) -> Object {
    let formatted =
        format_for_response(&thrown_of(&err, 0), context, &env_of(origin, session_lost));
    let out = Object::new();
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("message"),
        &JsValue::from_str(&formatted.message),
    );
    if let Some(log) = formatted.log {
        let _ = Reflect::set(&out, &JsValue::from_str("log"), &JsValue::from_str(&log));
    }
    out
}

/// Whether a thrown value is a request that never reached a server (`isNetworkFailureValue`).
#[wasm_bindgen(js_name = isNetworkFailureValue)]
pub fn is_network_failure_value_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] err: JsValue,
) -> bool {
    is_network_failure_of(&thrown_of(&err, 0))
}

/// `(HTTP 502 Bad Gateway from /api/x)`: the status line and the URL's path (`httpContext`).
#[wasm_bindgen(js_name = httpContext)]
pub fn http_context_js(
    #[wasm_bindgen(unchecked_param_type = "string")] url: &str,
    #[wasm_bindgen(unchecked_param_type = "number")] status: u16,
    #[wasm_bindgen(unchecked_param_type = "string")] status_text: &str,
) -> String {
    http_context(url, status, status_text)
}

/// The message of a non-ok response: the server's words or `fallback`, then the context (`responseErrorText`).
#[wasm_bindgen(js_name = responseErrorText)]
pub fn response_error_text_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] server_message: JsValue,
    #[wasm_bindgen(unchecked_param_type = "string")] fallback: &str,
    #[wasm_bindgen(unchecked_param_type = "string")] context: &str,
    #[wasm_bindgen(unchecked_param_type = "string | null")] origin: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "boolean")] session_lost: bool,
) -> String {
    response_error_text(
        &thrown_of(&server_message, 0),
        fallback,
        context,
        &env_of(origin, session_lost),
    )
}

/// Parses a response body: empty is `{}`, a non-object is `{ data }`, invalid JSON is `{ error }` (`parseJsonBody`).
#[wasm_bindgen(js_name = parseJsonBody, unchecked_return_type = "Record<string, unknown>")]
pub fn parse_json_body_js(
    #[wasm_bindgen(unchecked_param_type = "string")] text: &str,
    #[wasm_bindgen(unchecked_param_type = "string")] context: &str,
) -> JsResult<JsValue> {
    to_js(&parse_json_body(text, context))
}

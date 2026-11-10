//! Sidecar wire rules for JavaScript (wf-core `wire`). The JS names match
//! `packages/wf-wasm/src/wire.ts`.

use serde_json::{Value, json};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::wire::{self, Answer, Request, Route, WireTag};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The JS-facing shape of a routing decision: `kind` names the variant.
fn route_value(route: Route) -> Value {
    match route {
        Route::Skip => json!({"kind": "skip"}),
        Route::Reply(reply) => json!({"kind": "reply", "reply": reply}),
        Route::Call(request) => call_value(request),
        Route::Settle(answer) => settle_value(answer),
        Route::BadAnswer => json!({"kind": "badAnswer"}),
    }
}

/// A call. `params` is left out when the line had no `params` key.
fn call_value(request: Request) -> Value {
    let mut call = json!({"kind": "call", "id": request.id, "method": request.method});
    if let Some(params) = request.params {
        call["params"] = params;
    }
    call
}

/// An answer to a waiting ask, with its value or its error.
fn settle_value(answer: Answer) -> Value {
    match answer.result {
        Ok(value) => json!({"kind": "settle", "answer": answer.answer, "ok": true, "value": value}),
        Err(error) => {
            json!({"kind": "settle", "answer": answer.answer, "ok": false, "error": error})
        }
    }
}

/// [`route_line`](wire::route_line) as `{kind, ...}`: `skip`, `reply`, `call`,
/// `settle`, or `badAnswer`.
///
/// # Errors
///
/// Fails only if the decision cannot be turned into a JS value.
#[wasm_bindgen(js_name = wireRoute)]
pub fn wire_route_js(line: &str, accept_answers: bool) -> JsResult<JsValue> {
    to_js(&route_value(wire::route_line(line, accept_answers)))
}

/// [`parse_request`](wire::parse_request) as `{ok: true, id, method, params?}`
/// or `{ok: false, error}`.
///
/// # Errors
///
/// Fails only if the result cannot be turned into a JS value.
#[wasm_bindgen(js_name = wireParseRequest)]
pub fn wire_parse_request_js(line: &str) -> JsResult<JsValue> {
    let value = match wire::parse_request(line) {
        Ok(request) => {
            let mut parsed = json!({"ok": true, "id": request.id, "method": request.method});
            if let Some(params) = request.params {
                parsed["params"] = params;
            }
            parsed
        }
        Err(error) => json!({"ok": false, "error": error}),
    };
    to_js(&value)
}

/// [`wire_tag`](wire::wire_tag) as `{kind: "bigint", digits}` or
/// `{kind: "bytes", encoded}`, or `null` when the value is not a tag.
///
/// # Errors
///
/// Fails if `value` cannot be read as JSON (for example, a JS bigint).
#[wasm_bindgen(js_name = wireTag)]
pub fn wire_tag_js(value: JsValue) -> JsResult<JsValue> {
    let parsed: Value = serde_wasm_bindgen::from_value(value)?;
    let tag = match wire::wire_tag(&parsed) {
        Some(WireTag::Bigint(digits)) => json!({"kind": "bigint", "digits": digits}),
        Some(WireTag::Bytes(encoded)) => json!({"kind": "bytes", "encoded": encoded}),
        None => Value::Null,
    };
    to_js(&tag)
}

/// [`error_reply`](wire::error_reply). `id` is a JS number or `null`.
///
/// # Errors
///
/// Fails if `id` is neither a non-negative integer nor `null`.
#[wasm_bindgen(js_name = wireErrorReply, unchecked_return_type = "Record<string, unknown>")]
pub fn wire_error_reply_js(
    #[wasm_bindgen(unchecked_param_type = "number | null")] id: JsValue,
    error: &str,
) -> JsResult<JsValue> {
    let id: Option<u64> = serde_wasm_bindgen::from_value(id)?;
    to_js(&wire::error_reply(id, error))
}

/// [`ok_reply_head`](wire::ok_reply_head): `{id, ok: true}`, to which the shell adds `value`.
///
/// # Errors
///
/// Fails if `id` is not a non-negative integer.
#[wasm_bindgen(js_name = wireOkReplyHead)]
pub fn wire_ok_reply_head_js(id: JsValue) -> JsResult<JsValue> {
    let id: u64 = serde_wasm_bindgen::from_value(id)?;
    to_js(&wire::ok_reply_head(id))
}

//! Port of the pure parts of `apps/shell/sidecar/src/wire.ts`: request lines,
//! answer lines, the one-key tagged values, and the reply shapes. Sockets,
//! readline, ask timers, the handler table and running a handler stay in TS.

use serde_json::{Value, json};

/// Longest request line accepted, in UTF-16 code units (the TS shim counts `line.length`).
pub const MAX_LINE: usize = 32 * 1024 * 1024;

/// `Number.MAX_SAFE_INTEGER`: the largest id a request or answer may carry.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// The text a request that is not a call answers with.
const BAD_REQUEST: &str = "bad request: needs an integer id and a method";

/// The start of an answer line. Only lines beginning with this are offered to the peer.
const ANSWER_PREFIX: &str = "{\"answer\":";

/// One call from the shell. `params` keeps tagged values as they came off the wire.
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    /// The id the reply is matched to.
    pub id: u64,
    /// The handler name. Never empty.
    pub method: String,
    /// The call's arguments, when the line carried a `params` key (even if `null`).
    pub params: Option<Value>,
}

/// The shell's answer to one ask, matched by `answer`.
#[derive(Clone, Debug, PartialEq)]
pub struct Answer {
    /// The ask this answers. Always at least 1.
    pub answer: u64,
    /// The value on success, or the shell's error message.
    pub result: Result<Value, String>,
}

/// What to do with one line read from the shell.
#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    /// Blank line: nothing is written back.
    Skip,
    /// A reply that can be written now (an error about the line itself).
    Reply(Value),
    /// A call to run through the handler table.
    Call(Request),
    /// An answer to a waiting ask.
    Settle(Answer),
    /// An answer-shaped line that is not a well-formed answer.
    BadAnswer,
}

/// A value the JSON wire carries as a tagged object, which Rust cannot hold as-is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WireTag {
    /// `{"$bigint": "<decimal>"}`: the digits, sign included.
    Bigint(String),
    /// `{"$bytes": "<base64>"}`: the base64 text, still encoded.
    Bytes(String),
}

/// Reads one request line. Errors carry the text to send back.
///
/// # Errors
///
/// `"bad request: not JSON"` when the line does not parse, and the
/// "needs an integer id and a method" text when it parses but is not a call.
pub fn parse_request(line: &str) -> Result<Request, String> {
    let raw: Value = serde_json::from_str(line).map_err(|_| "bad request: not JSON".to_owned())?;
    let obj = raw.as_object().ok_or_else(|| BAD_REQUEST.to_owned())?;
    let id = obj
        .get("id")
        .and_then(safe_id)
        .ok_or_else(|| BAD_REQUEST.to_owned())?;
    let method = match obj.get("method") {
        Some(Value::String(name)) if !name.is_empty() => name.clone(),
        _ => return Err(BAD_REQUEST.to_owned()),
    };
    Ok(Request {
        id,
        method,
        params: obj.get("params").cloned(),
    })
}

/// Reads one answer line. `None` when it is over `MAX_LINE`, not JSON, or not a well-formed answer.
#[must_use]
pub fn parse_answer(line: &str) -> Option<Answer> {
    if utf16_len(line) > MAX_LINE {
        return None;
    }
    let raw: Value = serde_json::from_str(line).ok()?;
    let obj = raw.as_object()?;
    let answer = obj.get("answer").and_then(safe_id).filter(|n| *n >= 1)?;
    let ok = obj.get("ok")?.as_bool()?;
    let result = if ok {
        Ok(obj.get("value").cloned().unwrap_or(Value::Null))
    } else {
        Err(obj.get("error")?.as_str()?.to_owned())
    };
    Some(Answer { answer, result })
}

/// Decides what one line from the shell means. `accept_answers` is false when there is no peer to settle asks.
#[must_use]
pub fn route_line(line: &str, accept_answers: bool) -> Route {
    if accept_answers && line.starts_with(ANSWER_PREFIX) {
        return match parse_answer(line) {
            Some(answer) => Route::Settle(answer),
            None => Route::BadAnswer,
        };
    }
    if line.trim().is_empty() {
        return Route::Skip;
    }
    if utf16_len(line) > MAX_LINE {
        return Route::Reply(error_reply(None, "bad request: line too long"));
    }
    match parse_request(line) {
        Ok(request) => Route::Call(request),
        Err(message) => Route::Reply(error_reply(None, &message)),
    }
}

/// Recognises a one-key tagged object. `None` for anything else, including a
/// bigint tag whose digits are not a decimal integer.
#[must_use]
pub fn wire_tag(value: &Value) -> Option<WireTag> {
    let obj = value.as_object()?;
    if obj.len() != 1 {
        return None;
    }
    if let Some(Value::String(digits)) = obj.get("$bigint") {
        return is_decimal(digits).then(|| WireTag::Bigint(digits.clone()));
    }
    if let Some(Value::String(encoded)) = obj.get("$bytes") {
        return Some(WireTag::Bytes(encoded.clone()));
    }
    None
}

/// The reply for a call that failed, or for a line that could not be read (`id` `None`).
#[must_use]
pub fn error_reply(id: Option<u64>, error: &str) -> Value {
    json!({"id": id, "ok": false, "error": error})
}

/// The start of a successful reply. The shell adds `value` after it, so the keys come out in wire order.
#[must_use]
pub fn ok_reply_head(id: u64) -> Value {
    json!({"id": id, "ok": true})
}

/// The error reply for a method the handler table does not have.
#[must_use]
pub fn unknown_method_error(id: u64, method: &str) -> Value {
    error_reply(Some(id), &format!("unknown method: {method}"))
}

/// An id JSON wrote as a non-negative safe integer.
fn safe_id(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= MAX_SAFE_INTEGER)
}

/// `-?\d+` with ASCII digits only, as the TS regex reads it.
fn is_decimal(text: &str) -> bool {
    let digits = text.strip_prefix('-').unwrap_or(text);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// Length in UTF-16 code units, which is what `String.length` counts in JS.
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

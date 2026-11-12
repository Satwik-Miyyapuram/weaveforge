//! The error formatters the UI and the API routes use (`apps/web/src/lib/format-error.ts`).
//!
//! Two formatters share one reader. [`format_error`] is the display formatter: it keeps
//! the specific words a person needs about their own data. [`format_for_response`] is the
//! wire formatter: database text never reaches a response body, only the SQLSTATE's safe
//! wording and the code. Both read a [`Thrown`], the JS value reduced to the fields the
//! formatters look at; the wasm layer builds it with `js_sys::Reflect`.

use super::network_failure::is_network_failure;
use crate::signed_out::is_signed_out_refusal;

/// Shown for an empty or unusable error value.
pub const GENERIC_ERROR: &str = "Something went wrong.";

/// Shown while signed out, for a refusal that means "sign in" (`parts.ts`).
pub const SESSION_LOST_MESSAGE: &str = "You're signed out. Sign in to load this.";

/// Shown when a browser could not load a chunk that a newer deploy replaced.
const CHUNK_RELOAD: &str = "Could not load part of the app. This usually means a new version was deployed while this tab was open — reload the page.";

/// Runtime error names worth keeping: "TypeError: x is undefined" says more than "x is undefined".
const RUNTIME_ERROR_NAMES: [&str; 16] = [
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "EvalError",
    "URIError",
    "AbortError",
    "TimeoutError",
    "NotAllowedError",
    "QuotaExceededError",
    "SecurityError",
    "NotFoundError",
    "InvalidStateError",
    "DataError",
    "NotReadableError",
    "OperationError",
];

/// The PostgreSQL SQLSTATE classes (Appendix A of the manual). A class not listed here
/// is not a database error, which keeps Node's errno codes (`EPERM`, `ENXIO`) out.
const SQLSTATE_CLASSES: [&str; 43] = [
    "00", "01", "02", "03", "08", "09", "0A", "0B", "0F", "0L", "0P", "0Z", "20", "21", "22", "23",
    "24", "25", "26", "27", "28", "2B", "2D", "2F", "34", "38", "39", "3B", "3D", "3F", "40", "42",
    "44", "53", "54", "55", "57", "58", "72", "F0", "HV", "P0", "XX",
];

/// Codes that mean "this deployment has not run its migrations": `42P01` (undefined table)
/// and PostgREST's `PGRST205` (not in the schema cache).
const MIGRATION_INCOMPLETE: [&str; 2] = ["42P01", "PGRST205"];

/// What to tell a reader when a migration is missing. It names no table.
const MIGRATION_HINT: &str = "The server is missing a database migration; apply the schema migrations (npm run migrate:schema) and try again.";

/// The hint `formatError` adds for an API-token or missing-table failure.
const API_TOKENS_HINT: &str = ". Apply the schema migrations (npm run migrate:schema; migration 0061) if API tokens are not set up yet.";

/// The wording for a database failure that is not the server's fault, keyed by SQLSTATE.
/// Class-level on purpose: the replacement never quotes the raw text.
fn caller_fault(code: &str) -> Option<&'static str> {
    match code {
        "23502" => Some("A required field was missing."),
        "23503" => Some("That refers to a record that no longer exists."),
        "23505" => Some("That value is already in use."),
        "23514" => Some("One of the values sent was not accepted."),
        "22P02" => Some("One of the values sent was in the wrong format."),
        "42501" => Some("You do not have permission to do that."),
        _ => None,
    }
}

/// Per-call state the formatters read: the page origin and whether the session is lost.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Env {
    /// `window.location.origin`, or `None` where there is no window (or it is empty).
    pub origin: Option<String>,
    /// Whether the client has seen the sign-in go away (`isSessionLost()`).
    pub session_lost: bool,
}

/// The fields of an `Error` the formatters read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ErrorShape {
    /// `err.name`.
    pub name: String,
    /// `err.message` when it is a string, untrimmed.
    pub message: Option<String>,
    /// `err.message` when it is a non-null object (formatted recursively).
    pub message_object: Option<Box<Thrown>>,
    /// `err.code` when it is a string.
    pub code: Option<String>,
    /// `err.details` when it is a non-empty string.
    pub details: Option<String>,
    /// `err.hint` when it is a non-empty string.
    pub hint: Option<String>,
    /// `err.error` when it is non-null and not the object itself.
    pub error: Option<Box<Thrown>>,
    /// `err.cause` when it is non-null.
    pub cause: Option<Box<Thrown>>,
}

/// A thrown JS value, reduced to what the formatters read.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Thrown {
    /// `null` or `undefined`.
    #[default]
    Missing,
    /// A string.
    Text(String),
    /// An `Error` instance.
    Error(ErrorShape),
    /// Any other object (a PostgREST row, a supabase-js failure). `json` is
    /// `JSON.stringify` of it, or `None` when that throws.
    Record {
        /// The object's fields.
        shape: ErrorShape,
        /// `JSON.stringify(value)`, `None` when it throws.
        json: Option<String>,
    },
    /// Any other primitive (number, boolean, bigint, symbol).
    Primitive {
        /// `String(value)`.
        text: String,
        /// `JSON.stringify(value)`, `None` when it throws.
        json: Option<String>,
    },
}

/// The result of [`format_for_response`]: the body text and the line to log, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Formatted {
    /// What a route may put in `{ error }`.
    pub message: String,
    /// What to pass to `console.error`, for the database and cause paths.
    pub log: Option<String>,
}

/// The display message for `thrown`: the specific words a reader can act on.
#[must_use]
pub fn format_error(thrown: &Thrown, env: &Env) -> String {
    format_with(thrown, true, env)
}

/// A reason for a log line: the error's name and message, or its JSON.
#[must_use]
pub fn describe_rejection(thrown: &Thrown, env: &Env) -> String {
    match thrown {
        Thrown::Missing => String::new(),
        Thrown::Text(text) | Thrown::Primitive { text, .. } => text.clone(),
        Thrown::Error(shape) => {
            format!("{} {}", shape.name, shape.message.as_deref().unwrap_or(""))
        }
        Thrown::Record { shape, .. } => {
            let text = format_with(thrown, false, env);
            match shape.code.as_deref() {
                Some(code) if !code.is_empty() && !text.contains(code) => {
                    format!("{text} ({code})")
                }
                _ => text,
            }
        }
    }
}

/// Whether `thrown` is a request that never reached a server (a bare network `TypeError`,
/// or a plain object carrying one of those messages).
#[must_use]
pub fn is_network_failure_of(thrown: &Thrown) -> bool {
    let message = match thrown {
        Thrown::Error(shape) | Thrown::Record { shape, .. } => {
            shape.message.as_deref().unwrap_or("")
        }
        _ => "",
    };
    is_network_failure(message)
}

/// The text `JSON body` parse failure reports: `Invalid JSON body: <why>`.
#[must_use]
pub fn json_body_error(thrown: &Thrown) -> String {
    format!("Invalid JSON body: {}", string_of(thrown))
}

/// The message and log line for a value a route is about to return as `{ error }`.
#[must_use]
pub fn format_for_response(thrown: &Thrown, context: &str, env: &Env) -> Formatted {
    let Some(code) = database_code(thrown) else {
        let log = match thrown {
            Thrown::Error(shape) if shape.cause.is_some() => Some(format!(
                "[{context}] {}{}",
                describe_for_log(thrown),
                cause_chain(shape)
            )),
            _ => None,
        };
        return Formatted {
            message: format_with(thrown, false, env),
            log,
        };
    };
    let safe = if MIGRATION_INCOMPLETE.contains(&code.as_str()) {
        MIGRATION_HINT
    } else {
        caller_fault(&code).unwrap_or("Something went wrong on the server.")
    };
    Formatted {
        message: format!("{safe} ({code})"),
        log: Some(format!(
            "[{context}] database error {code}: {}",
            describe_for_log(thrown)
        )),
    }
}

/// The text of a `responseError`: the server's words (or `fallback`), then the request context.
#[must_use]
pub fn response_error_text(
    server_message: &Thrown,
    fallback: &str,
    context: &str,
    env: &Env,
) -> String {
    let said = match server_message {
        Thrown::Missing => String::new(),
        other => format_error(other, env),
    };
    let text = if !said.is_empty() && said != GENERIC_ERROR {
        said.as_str()
    } else {
        fallback
    };
    format!("{text} {context}")
}

/// `(HTTP 502 Bad Gateway from /api/x)`: the path only, since a query can carry tokens.
#[must_use]
pub fn http_context(url: &str, status: u16, status_text: &str) -> String {
    let path = url::Url::parse(url)
        .map(|parsed| parsed.path().to_owned())
        .unwrap_or_default();
    let status_line = if status_text.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status} {status_text}")
    };
    if path.is_empty() {
        format!("({status_line})")
    } else {
        format!("({status_line} from {path})")
    }
}

/// Parses a response body: empty becomes `{}`, a non-object becomes `{ data }`, and invalid
/// JSON becomes `{ error }` with the first 300 UTF-16 units of the body and the request context.
#[must_use]
pub fn parse_json_body(text: &str, context: &str) -> serde_json::Value {
    if text.trim().is_empty() {
        return serde_json::json!({});
    }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(map)) => serde_json::Value::Object(map),
        Ok(other) => serde_json::json!({ "data": other }),
        Err(_) => {
            let snippet = utf16_prefix(text, 300).trim().to_owned();
            let said = if snippet.is_empty() {
                "Request failed.".to_owned()
            } else {
                format!("Server sent non-JSON: {snippet}")
            };
            serde_json::json!({ "error": format!("{said} {context}") })
        }
    }
}

/// The first `limit` UTF-16 units of `text`, without splitting a character.
fn utf16_prefix(text: &str, limit: usize) -> &str {
    let mut used = 0;
    for (index, ch) in text.char_indices() {
        used += ch.len_utf16();
        if used > limit {
            return &text[..index];
        }
    }
    text
}

/// `String(thrown)` in JS, for the reason text of a parse failure.
fn string_of(thrown: &Thrown) -> String {
    match thrown {
        Thrown::Missing => "undefined".to_owned(),
        Thrown::Text(text) | Thrown::Primitive { text, .. } => text.clone(),
        Thrown::Error(shape) => {
            let message = shape.message.as_deref().unwrap_or("");
            if message.is_empty() {
                shape.name.clone()
            } else {
                message.to_owned()
            }
        }
        Thrown::Record { .. } => "[object Object]".to_owned(),
    }
}

/// The hidden detail, in a form a log reader can use.
fn describe_for_log(thrown: &Thrown) -> String {
    match thrown {
        Thrown::Missing => "null".to_owned(),
        Thrown::Text(text) | Thrown::Primitive { text, .. } => text.clone(),
        Thrown::Error(shape) => {
            format!("{}: {}", shape.name, shape.message.as_deref().unwrap_or(""))
        }
        Thrown::Record { json, .. } => json.clone().unwrap_or_else(|| "[object Object]".to_owned()),
    }
}

/// The formatter's recursion: `with_cause` appends the cause chain to an Error's message.
fn format_with(thrown: &Thrown, with_cause: bool, env: &Env) -> String {
    if matches!(thrown, Thrown::Missing) {
        return GENERIC_ERROR.to_owned();
    }
    if env.session_lost && signed_out_refusal(thrown) {
        return SESSION_LOST_MESSAGE.to_owned();
    }
    match thrown {
        Thrown::Missing => GENERIC_ERROR.to_owned(),
        Thrown::Text(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed == "[object Object]" {
                GENERIC_ERROR.to_owned()
            } else {
                trimmed.to_owned()
            }
        }
        Thrown::Error(shape) => describe_error(shape, with_cause, env),
        Thrown::Record { shape, json } => format_record(shape, json.as_deref(), with_cause, env),
        Thrown::Primitive { json, .. } => json_or_generic(json.as_deref()),
    }
}

/// The JSON of a value, unless it is empty or `{}` or `null`.
fn json_or_generic(json: Option<&str>) -> String {
    match json {
        Some(text) if !text.is_empty() && text != "{}" && text != "null" => text.to_owned(),
        _ => GENERIC_ERROR.to_owned(),
    }
}

/// The message of an `Error`, with its runtime name and cause chain when asked.
fn describe_error(shape: &ErrorShape, with_cause: bool, env: &Env) -> String {
    let trimmed = shape.message.as_deref().map_or("", str::trim);
    if trimmed.is_empty() || trimmed == "[object Object]" {
        let name = if shape.name.is_empty() {
            "Error"
        } else {
            shape.name.as_str()
        };
        let chain = if with_cause {
            cause_chain(shape)
        } else {
            String::new()
        };
        return format!("{name} (no message){chain}");
    }
    if let Some(network) = network_failure_message(trimmed, env) {
        return network;
    }
    let named = if RUNTIME_ERROR_NAMES.contains(&shape.name.as_str())
        && !trimmed.contains(shape.name.as_str())
    {
        format!("{}: {trimmed}", shape.name)
    } else {
        trimmed.to_owned()
    };
    if with_cause {
        format!("{named}{}", cause_chain(shape))
    } else {
        named
    }
}

/// The formatter for a non-Error object: its `message`, `error` field, or joined PostgREST parts.
fn format_record(shape: &ErrorShape, json: Option<&str>, with_cause: bool, env: &Env) -> String {
    if shape.code.as_deref() == Some("PGRST202") {
        return missing_function_message(shape.message.as_deref());
    }
    if let Some(trimmed) = shape
        .message
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return network_failure_message(trimmed, env).unwrap_or_else(|| trimmed.to_owned());
    }
    if let Some(object) = shape.message_object.as_deref() {
        return format_with(object, with_cause, env);
    }
    if let Some(nested) = shape
        .error
        .as_deref()
        .map(|inner| format_with(inner, with_cause, env))
        && nested != GENERIC_ERROR
    {
        return nested;
    }
    joined_parts(shape, json)
}

/// `details — hint — (code)`, with the migration hint when the text names a missing table.
fn joined_parts(shape: &ErrorShape, json: Option<&str>) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(details) = non_empty(shape.details.as_deref()) {
        parts.push(details.to_owned());
    }
    if let Some(hint) = non_empty(shape.hint.as_deref()) {
        parts.push(hint.to_owned());
    }
    let code = shape.code.as_deref();
    if let Some(code) = non_empty(code) {
        parts.push(format!("({code})"));
    }
    if parts.is_empty() {
        return json_or_generic(json);
    }
    let text = parts.join(" — ");
    if text.contains("api_tokens") || matches!(code, Some("PGRST205" | "42P01")) {
        format!("{text}{API_TOKENS_HINT}")
    } else {
        text
    }
}

/// `Some(value)` when the optional string is present and not empty.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// The message for PostgREST's "no such function", which means a migration has not run.
fn missing_function_message(message: Option<&str>) -> String {
    let function = message.and_then(function_name);
    let named = function
        .map(|name| {
            format!(
                " (it has no {} function yet)",
                name.strip_prefix("public.").unwrap_or(name)
            )
        })
        .unwrap_or_default();
    format!(
        "The server's database is older than this version of the app{named}. \
         Whoever runs the server needs to apply the latest migrations (npm run migrate:schema). (PGRST202)"
    )
}

/// The name in the first `function <name>(` of `message`, where the name is `[\w.]+`.
fn function_name(message: &str) -> Option<&str> {
    let mut from = 0;
    while let Some(offset) = message[from..].find("function ") {
        let start = from + offset + "function ".len();
        let run = message[start..]
            .bytes()
            .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'.')
            .count();
        if run > 0 && message.as_bytes().get(start + run) == Some(&b'(') {
            return Some(&message[start..start + run]);
        }
        from = start;
    }
    None
}

/// The network-failure wording, or `None` when `message` is not one. The `(could not reach h)`,
/// `(host answered)` and `(browser said: …)` markers, when present, are carried through.
fn network_failure_message(message: &str, env: &Env) -> Option<String> {
    if message
        .to_lowercase()
        .contains("dynamically imported module")
    {
        return Some(CHUNK_RELOAD.to_owned());
    }
    if !is_network_failure(message) {
        return None;
    }
    let host = marker_value(message, "(could not reach ");
    if message.contains("(host answered)") {
        let browser_said = marker_value(message, "(browser said: ");
        return Some(answered_message(host, browser_said, env));
    }
    Some(unanswered_message(host, env))
}

/// The wording when the host answered a reachability probe: the request failed, not the connection.
fn answered_message(host: Option<&str>, browser_said: Option<&str>, env: &Env) -> String {
    let host = host.unwrap_or("the server");
    let origin = env.origin.as_deref().unwrap_or("this app");
    let said = browser_said
        .map(|text| format!("The browser said: “{text}”. "))
        .unwrap_or_default();
    format!(
        "The API at {host} answered a reachability check, so it is running — but this request from {origin} failed. \
         {said}That is what a CORS refusal, a blocked request or an expired session looks like from here, \
         and the distinction needs the Network tab or the server's log. Reload and try again; if it \
         persists, the browser's own words above are the part worth passing on."
    )
}

/// The wording when the host did not answer: the connection is the first thing to check.
fn unanswered_message(host: Option<&str>, env: &Env) -> String {
    let what = host.map_or_else(
        || "Could not reach the server.".to_owned(),
        |name| format!("Could not reach {name}."),
    );
    let hint = match (env.origin.as_deref(), host) {
        (Some(origin), Some(_)) => {
            format!(
                " If the network is fine, check that this origin ({origin}) is on the API's CORS allow-list."
            )
        }
        _ => String::new(),
    };
    format!(
        "{what} The request never left this browser, so check your connection, VPN, or any extension blocking it, then try again.{hint}"
    )
}

/// The text between `prefix` and the next `)`, or `None` when it is absent or empty.
fn marker_value<'a>(message: &'a str, prefix: &str) -> Option<&'a str> {
    let start = message.find(prefix)?;
    let from = start + prefix.len();
    let end = message[from..].find(')')? + from;
    (end > from).then(|| &message[from..end])
}

/// Whether a refusal with no sign-in means "sign in" (`isSignedOutRefusal`).
fn signed_out_refusal(thrown: &Thrown) -> bool {
    match thrown {
        Thrown::Text(text) => is_signed_out_refusal(text, None),
        Thrown::Error(shape) | Thrown::Record { shape, .. } => is_signed_out_refusal(
            shape.message.as_deref().unwrap_or(""),
            shape.code.as_deref(),
        ),
        Thrown::Missing | Thrown::Primitive { .. } => false,
    }
}

/// The `cause` chain, innermost last, at most three links so a cycle cannot loop.
fn cause_chain(shape: &ErrorShape) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut cause: Option<&Thrown> = shape.cause.as_deref();
    for _ in 0..3 {
        let Some(value) = cause else { break };
        match value {
            Thrown::Error(inner) => {
                let message = non_empty(inner.message.as_deref()).unwrap_or("(no message)");
                let code = inner
                    .code
                    .as_deref()
                    .map(|code| format!(" [{code}]"))
                    .unwrap_or_default();
                parts.push(format!("{}: {message}{code}", inner.name));
                cause = inner.cause.as_deref();
            }
            other => {
                parts.push(describe_for_log(other));
                break;
            }
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" (cause: {})", parts.join(" ← "))
    }
}

/// The database code of `thrown`, trimmed: a SQLSTATE or a `PGRST` code, else `None`.
fn database_code(thrown: &Thrown) -> Option<String> {
    let raw = match thrown {
        Thrown::Error(shape) | Thrown::Record { shape, .. } => shape.code.as_deref()?,
        _ => return None,
    };
    let code = raw.trim();
    let known = code.starts_with("PGRST")
        || (code.len() == 5
            && code
                .get(..2)
                .is_some_and(|class| SQLSTATE_CLASSES.contains(&class)));
    known.then(|| code.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> Env {
        Env::default()
    }

    fn with_origin(origin: &str) -> Env {
        Env {
            origin: Some(origin.to_owned()),
            session_lost: false,
        }
    }

    fn text(value: &str) -> Thrown {
        Thrown::Text(value.to_owned())
    }

    fn error(name: &str, message: &str) -> Thrown {
        Thrown::Error(ErrorShape {
            name: name.to_owned(),
            message: Some(message.to_owned()),
            ..ErrorShape::default()
        })
    }

    fn error_with_cause(message: &str, cause: Thrown) -> Thrown {
        Thrown::Error(ErrorShape {
            name: "Error".to_owned(),
            message: Some(message.to_owned()),
            cause: Some(Box::new(cause)),
            ..ErrorShape::default()
        })
    }

    fn record(message: Option<&str>, code: Option<&str>) -> ErrorShape {
        ErrorShape {
            message: message.map(str::to_owned),
            code: code.map(str::to_owned),
            ..ErrorShape::default()
        }
    }

    fn object(shape: ErrorShape) -> Thrown {
        Thrown::Record { shape, json: None }
    }

    fn show(thrown: &Thrown) -> String {
        format_error(thrown, &env())
    }

    #[test]
    fn null_and_undefined_give_the_generic_message() {
        assert_eq!(show(&Thrown::Missing), "Something went wrong.");
    }

    #[test]
    fn strings_pass_through_and_junk_is_replaced() {
        assert_eq!(show(&text("  boom  ")), "boom");
        assert_eq!(show(&text("[object Object]")), "Something went wrong.");
        assert_eq!(show(&text("   ")), "Something went wrong.");
    }

    #[test]
    fn an_error_uses_its_message() {
        assert_eq!(show(&error("Error", "kaboom")), "kaboom");
    }

    #[test]
    fn a_plain_object_with_a_message() {
        assert_eq!(show(&object(record(Some("nope"), None))), "nope");
    }

    #[test]
    fn a_nested_error_field_is_unwrapped() {
        let inner = object(record(Some("inner failure"), None));
        let outer = Thrown::Record {
            shape: ErrorShape {
                error: Some(Box::new(inner)),
                ..ErrorShape::default()
            },
            json: None,
        };
        assert_eq!(show(&outer), "inner failure");
    }

    #[test]
    fn details_hint_and_code_join_when_there_is_no_message() {
        let shape = ErrorShape {
            details: Some("row 3".to_owned()),
            hint: Some("check it".to_owned()),
            code: Some("P0001".to_owned()),
            ..ErrorShape::default()
        };
        assert_eq!(show(&object(shape)), "row 3 — check it — (P0001)");
    }

    #[test]
    fn the_api_tokens_migration_hint_is_appended() {
        let by_text = ErrorShape {
            details: Some("relation api_tokens does not exist".to_owned()),
            code: Some("42P01".to_owned()),
            ..ErrorShape::default()
        };
        assert!(
            show(&object(by_text))
                .contains("Apply the schema migrations (npm run migrate:schema; migration 0061)")
        );
        let by_code = ErrorShape {
            details: Some("schema cache miss".to_owned()),
            code: Some("PGRST205".to_owned()),
            ..ErrorShape::default()
        };
        assert!(show(&object(by_code)).contains("migration 0061"));
    }

    #[test]
    fn an_opaque_object_falls_back_to_its_json() {
        let thrown = Thrown::Record {
            shape: ErrorShape::default(),
            json: Some("{\"weird\":1}".to_owned()),
        };
        assert_eq!(show(&thrown), "{\"weird\":1}");
    }

    #[test]
    fn a_network_failure_is_explained_not_shown_raw() {
        for raw in [
            "Failed to fetch",
            "NetworkError when attempting to fetch resource.",
            "Load failed",
        ] {
            let message = show(&error("TypeError", raw));
            assert!(message.contains("Could not reach the server"), "{message}");
            assert!(
                !message.contains("Failed to fetch")
                    && !message.contains("NetworkError")
                    && !message.contains("Load failed")
            );
        }
    }

    #[test]
    fn a_missing_chunk_under_a_running_tab_says_to_reload() {
        let message = show(&error(
            "TypeError",
            "Failed to fetch dynamically imported module: https://example.test/_next/static/chunks/x.js",
        ));
        assert!(message.contains("reload the page"));
    }

    #[test]
    fn a_server_error_keeps_its_own_words() {
        assert_eq!(
            show(&error("Error", "permission denied for table user_settings")),
            "permission denied for table user_settings"
        );
    }

    #[test]
    fn the_host_the_client_named_survives() {
        let message = show(&error(
            "TypeError",
            "Failed to fetch (could not reach api.weaveforge.org)",
        ));
        assert!(
            message.contains("Could not reach api.weaveforge.org."),
            "{message}"
        );
    }

    #[test]
    fn a_failed_fetch_as_a_plain_object_still_gets_network_wording() {
        let thrown = object(record(
            Some("TypeError: Failed to fetch (could not reach api.weaveforge.org)"),
            None,
        ));
        assert!(show(&thrown).contains("check your connection"));
    }

    #[test]
    fn a_network_failure_names_this_origin() {
        let message = format_error(
            &error(
                "TypeError",
                "Failed to fetch (could not reach api.weaveforge.org)",
            ),
            &with_origin("https://weaveforge-preview-abc.vercel.app"),
        );
        assert!(message.contains("Could not reach api.weaveforge.org."));
        assert!(
            message.contains("weaveforge-preview-abc.vercel.app"),
            "the origin must be named"
        );
        assert!(
            message.contains("CORS allow-list"),
            "and the likely cause stated"
        );
    }

    #[test]
    fn a_host_that_answered_does_not_get_its_allow_list_blamed() {
        let message = format_error(
            &error(
                "TypeError",
                "Failed to fetch (could not reach api.weaveforge.org) (host answered) (browser said: Failed to fetch)",
            ),
            &with_origin("http://localhost:4100"),
        );
        assert!(message.contains("answered a reachability check, so it is running"));
        assert!(
            message.contains("from http://localhost:4100"),
            "the origin is named"
        );
        assert!(
            message.contains("Failed to fetch"),
            "the browser's own words are carried"
        );
        assert!(!message.contains("CORS_ALLOWED_ORIGINS"));
        assert!(!message.contains("check your connection"));
    }

    #[test]
    fn a_host_that_did_not_answer_still_gets_the_connection_advice() {
        let message = show(&error(
            "TypeError",
            "Failed to fetch (could not reach api.weaveforge.org)",
        ));
        assert!(message.contains("Could not reach api.weaveforge.org."));
        assert!(message.contains("check your connection"));
        assert!(!message.contains("CORS_ALLOWED_ORIGINS"));
    }

    #[test]
    fn response_database_message_never_reaches_the_client() {
        let shape = ErrorShape {
            message: Some(
                "duplicate key value violates unique constraint \"api_tokens_token_hash_idx\""
                    .to_owned(),
            ),
            details: Some("Key (token_hash)=(\\xdeadbeef) already exists.".to_owned()),
            code: Some("23505".to_owned()),
            ..ErrorShape::default()
        };
        let safe = format_for_response(&object(shape), "test", &env()).message;
        assert!(!safe.contains("api_tokens"));
        assert!(!safe.contains("token_hash"));
        assert!(!safe.contains("deadbeef"));
        assert!(safe.contains("already in use"));
        assert!(safe.contains("23505"));
    }

    #[test]
    fn an_rls_refusal_reads_as_a_permission_problem() {
        let shape = ErrorShape {
            message: Some(
                "new row violates row-level security policy for table \"experiment_metric_points\""
                    .to_owned(),
            ),
            code: Some("42501".to_owned()),
            ..ErrorShape::default()
        };
        let safe = format_for_response(&object(shape), "api", &env()).message;
        assert!(!safe.contains("experiment_metric_points"));
        assert!(safe.to_lowercase().contains("permission"));
    }

    #[test]
    fn each_caller_fault_sqlstate_gets_its_own_wording() {
        let coded = |code: &str| {
            format_for_response(&object(record(None, Some(code))), "api", &env()).message
        };
        assert!(coded("23503").contains("no longer exists"));
        assert!(coded("23514").contains("not accepted"));
        assert!(coded("22P02").contains("wrong format"));
        assert!(coded("23502").contains("required field"));
    }

    #[test]
    fn a_missing_migration_is_surfaced_without_the_table_name() {
        for code in ["42P01", "PGRST205"] {
            let shape = ErrorShape {
                message: Some("relation \"api_tokens\" does not exist".to_owned()),
                code: Some(code.to_owned()),
                ..ErrorShape::default()
            };
            let safe = format_for_response(&object(shape), "api", &env()).message;
            assert!(safe.to_lowercase().contains("migration"));
            assert!(safe.contains("npm run migrate:schema"));
            assert!(
                !safe.contains("api_tokens"),
                "the hint must not carry the table name"
            );
        }
    }

    #[test]
    fn anything_not_from_the_database_passes_through() {
        let plain =
            |message: &str| format_for_response(&error("Error", message), "api", &env()).message;
        assert_eq!(
            plain("A professor cannot create an admin account."),
            "A professor cannot create an admin account."
        );
        assert_eq!(
            plain("Server is missing SUPABASE_JWT_SECRET for API token auth."),
            "Server is missing SUPABASE_JWT_SECRET for API token auth."
        );
        assert!(plain("Failed to fetch").contains("Could not reach the server"));
    }

    #[test]
    fn a_node_error_code_is_not_mistaken_for_a_sqlstate() {
        let message = "ENOENT: no such file or directory, open '/var/data/x'";
        assert_eq!(
            format_for_response(&error("Error", message), "api", &env()).message,
            message
        );
        let refused = object(record(Some("connect ECONNREFUSED"), Some("ECONNREFUSED")));
        assert_eq!(
            format_for_response(&refused, "api", &env()).message,
            "connect ECONNREFUSED"
        );
    }

    #[test]
    fn an_unknown_database_code_is_generic_but_still_coded() {
        for code in ["XX000", "P0001", "HV000", "0A000"] {
            let safe = format_for_response(
                &object(record(
                    Some("internal detail nobody should see"),
                    Some(code),
                )),
                "api",
                &env(),
            )
            .message;
            assert!(!safe.contains("internal detail"), "{code}");
            assert!(
                safe.contains("Something went wrong on the server"),
                "{code}"
            );
            assert!(safe.contains(code), "{code}");
        }
    }

    #[test]
    fn node_errno_codes_are_five_letters_too_and_not_sqlstates() {
        for code in ["EPERM", "EBADF", "ENXIO", "EPIPE", "EROFS"] {
            let message = format!("{code}: an operating-system message that is not ours to hide");
            let thrown = object(record(Some(&message), Some(code)));
            assert_eq!(
                format_for_response(&thrown, "api", &env()).message,
                message,
                "{code} is a filesystem code"
            );
        }
    }

    #[test]
    fn a_missing_database_function_says_the_server_needs_its_migrations() {
        let shape = ErrorShape {
            code: Some("PGRST202".to_owned()),
            message: Some(
                "Could not find the function public.metric_history(p_experiment_id, p_max_points, p_metric) in the schema cache"
                    .to_owned(),
            ),
            ..ErrorShape::default()
        };
        let message = show(&object(shape));
        assert!(message.contains("older than this version of the app"));
        assert!(message.contains("no metric_history function"));
        assert!(!message.contains("[object Object]"));
    }

    #[test]
    fn a_refusal_while_signed_out_says_to_sign_in_and_only_then() {
        let refusal = object(ErrorShape {
            code: Some("42501".to_owned()),
            message: Some("permission denied for table projects".to_owned()),
            ..ErrorShape::default()
        });
        assert_eq!(show(&refusal), "permission denied for table projects");
        let lost = Env {
            origin: None,
            session_lost: true,
        };
        assert_eq!(format_error(&refusal, &lost), SESSION_LOST_MESSAGE);
        assert_eq!(
            format_error(&error("Error", "permission denied for table papers"), &lost),
            SESSION_LOST_MESSAGE
        );
        assert_eq!(
            format_error(&error("Error", "disk full"), &lost),
            "disk full"
        );
    }

    #[test]
    fn runtime_error_names_and_the_cause_chain_are_kept() {
        assert_eq!(
            show(&error("TypeError", "x is undefined")),
            "TypeError: x is undefined"
        );
        assert_eq!(show(&error("Error", "")), "Error (no message)");
        let cause = Thrown::Error(ErrorShape {
            name: "Error".to_owned(),
            message: Some("connect ECONNREFUSED".to_owned()),
            code: Some("ECONNREFUSED".to_owned()),
            ..ErrorShape::default()
        });
        assert_eq!(
            show(&error_with_cause("Upload failed", cause)),
            "Upload failed (cause: Error: connect ECONNREFUSED [ECONNREFUSED])"
        );
    }

    #[test]
    fn the_wire_form_never_puts_the_cause_in_the_body() {
        let thrown = error_with_cause("Upload failed", error("Error", "connect 10.0.0.5:5432"));
        let formatted = format_for_response(&thrown, "api", &env());
        assert_eq!(formatted.message, "Upload failed");
        assert!(formatted.log.is_some_and(|line| line.contains("10.0.0.5")));
    }

    #[test]
    fn response_error_names_server_words_status_and_path_never_the_query() {
        let context = http_context(
            "https://x.test/api/blobs/upload?token=secret",
            502,
            "Bad Gateway",
        );
        assert_eq!(
            response_error_text(&text("R2 down"), "Upload failed.", &context, &env()),
            "R2 down (HTTP 502 Bad Gateway from /api/blobs/upload)"
        );
        assert_eq!(
            response_error_text(&Thrown::Missing, "Upload failed.", &context, &env()),
            "Upload failed. (HTTP 502 Bad Gateway from /api/blobs/upload)"
        );
    }

    #[test]
    fn json_body_error_keeps_the_parsers_reason() {
        let reason = error(
            "SyntaxError",
            "Expected property name or '}' in JSON at position 1",
        );
        assert!(json_body_error(&reason).starts_with("Invalid JSON body: Expected property name"));
        assert_eq!(
            json_body_error(&error("SyntaxError", "")),
            "Invalid JSON body: SyntaxError"
        );
    }

    #[test]
    fn describe_rejection_reads_a_plain_object_as_its_message_and_code() {
        let aborted = object(ErrorShape {
            message: Some("current transaction is aborted".to_owned()),
            code: Some("25P02".to_owned()),
            ..ErrorShape::default()
        });
        assert_eq!(
            describe_rejection(&aborted, &env()),
            "current transaction is aborted (25P02)"
        );
        assert_eq!(
            describe_rejection(&error("TypeError", "boom"), &env()),
            "TypeError boom"
        );
        assert_eq!(describe_rejection(&text("plain"), &env()), "plain");
        assert_eq!(describe_rejection(&Thrown::Missing, &env()), "");
    }

    #[test]
    fn empty_body_parses_to_an_empty_object() {
        assert_eq!(parse_json_body("", "ctx"), serde_json::json!({}));
    }

    #[test]
    fn object_body_is_parsed_as_is() {
        assert_eq!(
            parse_json_body("{\"a\":1}", "ctx"),
            serde_json::json!({ "a": 1 })
        );
    }

    #[test]
    fn array_body_is_wrapped_under_data() {
        assert_eq!(
            parse_json_body("[1,2]", "ctx"),
            serde_json::json!({ "data": [1, 2] })
        );
    }

    #[test]
    fn invalid_json_body_becomes_an_error_field() {
        let out = parse_json_body("not json", "(HTTP 500)");
        let error_text = out
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        assert!(error_text.contains("not json"));
        assert!(error_text.ends_with("(HTTP 500)"));
    }

    #[test]
    fn http_context_drops_the_query_and_empty_url() {
        assert_eq!(http_context("", 500, ""), "(HTTP 500)");
        assert_eq!(
            http_context("https://x.test/a/b?secret=1", 404, "Not Found"),
            "(HTTP 404 Not Found from /a/b)"
        );
    }

    #[test]
    fn function_name_needs_an_open_paren_directly_after_the_name() {
        assert_eq!(function_name("function public.f(x)"), Some("public.f"));
        assert_eq!(function_name("function f x"), None);
    }
}

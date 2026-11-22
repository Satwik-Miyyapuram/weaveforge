//! Turns database errors into wording a caller may see. The raw message is neither
//! logged nor returned, because it can name schema objects or echo the caller's values.

use crate::postgrest::DbError;

/// Generic message for any server-side failure.
pub const SERVER_FAULT: &str = "Something went wrong on the server.";

const MIGRATION_HINT: &str = "The server is missing a database migration; apply the schema migrations (npm run migrate:schema) and try again.";

/// SQLSTATE classes that PostgreSQL defines (two-character prefix of the code).
const SQLSTATE_CLASSES: &[&str] = &[
    "00", "01", "02", "03", "08", "09", "0A", "0B", "0F", "0L", "0P", "0Z", "20", "21", "22", "23",
    "24", "25", "26", "27", "28", "2B", "2D", "2F", "34", "38", "39", "3B", "3D", "3F", "40", "42",
    "44", "53", "54", "55", "57", "58", "72", "F0", "HV", "P0", "XX",
];

/// Wording for the refusals the caller can fix.
fn caller_fault_message(code: &str) -> Option<&'static str> {
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

/// A PostgreSQL SQLSTATE (five of `0-9A-Z` in a known class) or a PostgREST code
/// (`PGRST` and three digits), trimmed; `None` for anything else.
#[must_use]
pub fn database_code(code: Option<&str>) -> Option<String> {
    let code = code?.trim();
    if code.is_empty() {
        return None;
    }
    if let Some(number) = code.strip_prefix("PGRST") {
        let valid = number.len() == 3 && number.bytes().all(|b| b.is_ascii_digit());
        return valid.then(|| code.to_string());
    }
    let shaped = code.len() == 5
        && code
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase());
    if shaped && SQLSTATE_CLASSES.contains(&&code[..2]) {
        return Some(code.to_string());
    }
    None
}

/// The message a route may put in a response body for a database error.
#[must_use]
pub fn format_error_for_response(err: &DbError, context: &str) -> String {
    eprintln!("{}", log_line(err, context));
    let Some(code) = database_code(err.code.as_deref()) else {
        return SERVER_FAULT.to_string();
    };
    let safe = if code == "42P01" || code == "PGRST205" {
        MIGRATION_HINT
    } else {
        caller_fault_message(&code).unwrap_or(SERVER_FAULT)
    };
    format!("{safe} ({code})")
}

/// The server log line for a database error: the context and a recognised code only.
/// The message is never logged, since it can echo request values such as keys.
#[must_use]
pub fn log_line(err: &DbError, context: &str) -> String {
    let given = err.code.as_deref().map(str::trim).filter(|c| !c.is_empty());
    let code = match (given, database_code(given)) {
        (_, Some(code)) => code,
        (None, None) => "(no code)".to_string(),
        (Some(_), None) => "(unrecognised code)".to_string(),
    };
    format!("[{context}] database error {code}")
}

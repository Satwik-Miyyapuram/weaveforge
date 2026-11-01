//! Turns database errors into wording a caller may see. The raw message is logged
//! and never returned, because it can name schema objects or echo the caller's values.

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

/// A PostgreSQL SQLSTATE or a PostgREST code, trimmed; `None` for anything else.
#[must_use]
pub fn database_code(code: Option<&str>) -> Option<String> {
    let code = code?.trim();
    if code.is_empty() {
        return None;
    }
    if code.starts_with("PGRST") {
        return Some(code.to_string());
    }
    let class = code.get(..2)?;
    if code.len() == 5 && SQLSTATE_CLASSES.contains(&class) {
        return Some(code.to_string());
    }
    None
}

/// The message a route may put in a response body for a database error.
#[must_use]
pub fn format_error_for_response(err: &DbError, context: &str) -> String {
    let Some(code) = database_code(err.code.as_deref()) else {
        eprintln!("[{context}] {}", err.message);
        return SERVER_FAULT.to_string();
    };
    let safe = if code == "42P01" || code == "PGRST205" {
        MIGRATION_HINT
    } else {
        caller_fault_message(&code).unwrap_or(SERVER_FAULT)
    };
    eprintln!("[{context}] database error {code}: {}", err.message);
    format!("{safe} ({code})")
}

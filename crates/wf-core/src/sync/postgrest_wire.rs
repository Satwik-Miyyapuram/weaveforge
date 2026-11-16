//! PostgREST wire rules for the sync transport: which columns a write may name,
//! and what an error body says. Pure; the HTTP and the retry decisions stay in
//! `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`.

use serde::Serialize;
use serde_json::{Map, Value};

/// Columns the server computes per table; PostgREST refuses any write that names them.
const GENERATED: &[(&str, &[&str])] =
    &[("vault_pages", &["body_preview"]), ("paper_tags", &["id"])];

/// Longest slice of a non-JSON error body kept as its reason (UTF-16 units, as JS `slice`).
const RAW_REASON_UNITS: usize = 200;

/// The payload with the table's generated columns removed. A missing payload is empty.
#[must_use]
pub fn writable(table: &str, payload: Option<Map<String, Value>>) -> Map<String, Value> {
    let mut body = payload.unwrap_or_default();
    if let Some((_, columns)) = GENERATED.iter().find(|(name, _)| *name == table) {
        for column in *columns {
            let _ = body.remove(*column);
        }
    }
    body
}

/// What a PostgREST error body says: its Postgres `code`, and the reason to keep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ErrorInfo {
    /// `code` when the body is JSON with a string code.
    pub code: Option<String>,
    /// The JSON `message` when present, else the first 200 units of the raw body.
    pub first_line: String,
}

/// Reads an error body. A body that is not JSON yields no code and its raw text as the reason.
#[must_use]
pub fn error_info(body: &str) -> ErrorInfo {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let code = parsed
        .as_ref()
        .and_then(|value| value.get("code"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let first_line = message.unwrap_or_else(|| {
        let units: Vec<u16> = body.encode_utf16().take(RAW_REASON_UNITS).collect();
        String::from_utf16_lossy(&units)
    });
    ErrorInfo { code, first_line }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn payload(value: Value) -> Option<Map<String, Value>> {
        match value {
            serde_json::Value::Object(map) => Some(map),
            _ => None,
        }
    }

    #[test]
    fn writable_drops_generated_columns_for_their_table_only() {
        let body = writable(
            "vault_pages",
            payload(json!({ "id": "a", "body_preview": "x", "title": "t" })),
        );
        assert_eq!(Value::Object(body), json!({ "id": "a", "title": "t" }));

        let tags = writable("paper_tags", payload(json!({ "id": "a", "paper_id": "p" })));
        assert_eq!(Value::Object(tags), json!({ "paper_id": "p" }));

        let other = writable("notes", payload(json!({ "body_preview": "kept" })));
        assert_eq!(Value::Object(other), json!({ "body_preview": "kept" }));
    }

    #[test]
    fn writable_of_no_payload_is_empty() {
        assert!(writable("notes", None).is_empty());
    }

    #[test]
    fn error_info_reads_json_code_and_message() {
        let info = error_info(r#"{"code":"23503","message":"fk missing"}"#);
        assert_eq!(info.code.as_deref(), Some("23503"));
        assert_eq!(info.first_line, "fk missing");
    }

    #[test]
    fn error_info_json_without_message_keeps_raw_body() {
        let body = r#"{"code":"42501"}"#;
        let info = error_info(body);
        assert_eq!(info.code.as_deref(), Some("42501"));
        assert_eq!(info.first_line, body);
    }

    #[test]
    fn error_info_non_json_has_no_code_and_truncates_reason() {
        let info = error_info("gateway down");
        assert_eq!(info.code, None);
        assert_eq!(info.first_line, "gateway down");

        let long = "a".repeat(300);
        assert_eq!(error_info(&long).first_line.len(), 200);
    }

    #[test]
    fn error_info_empty_body() {
        let info = error_info("");
        assert_eq!(info.code, None);
        assert_eq!(info.first_line, "");
    }

    #[test]
    fn error_info_non_string_code_is_none() {
        assert_eq!(error_info(r#"{"code":23503}"#).code, None);
    }
}

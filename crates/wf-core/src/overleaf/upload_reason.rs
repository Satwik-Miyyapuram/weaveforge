//! The reason an Overleaf upload was refused, read from the answer body (wf-core
//! `overleaf::upload_reason`). Parity with the former TypeScript `reason` in
//! `apps/web/src/features/overleaf/infrastructure/overleaf-upload.ts`.

/// The text appended to an upload failure: `": <message>"` when the body is a JSON value whose
/// `error` field is a string, else empty. A body that is not JSON gives empty too.
#[must_use]
pub fn error_suffix(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .map_or_else(String::new, |message| format!(": {message}"))
}

#[cfg(test)]
mod tests {
    use super::error_suffix;

    #[test]
    fn a_string_error_becomes_a_suffix() {
        assert_eq!(
            error_suffix(r#"{"error":"Project is locked"}"#),
            ": Project is locked"
        );
    }

    #[test]
    fn anything_else_gives_no_suffix() {
        for body in [
            "",
            "not json",
            "null",
            "[]",
            r#"{"error":42}"#,
            r#"{"message":"x"}"#,
        ] {
            assert_eq!(error_suffix(body), "", "{body}");
        }
    }
}

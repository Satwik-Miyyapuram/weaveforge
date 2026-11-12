//! Ports the SQL text and the row reading of `DeviceSecretsStore` in
//! `apps/web/src/backend/providers/local/parts.ts`. The row is this device's
//! integration credentials, one per machine. The PGlite query and the
//! `LOCAL_USER_ID` identity stay in TypeScript.

/// Reads this device's secrets row. `$1` is the local user id.
pub const LOAD_SECRETS_SQL: &str = "select secrets from local_secrets where user_id = $1";

/// Writes this device's secrets row. `$1` is the local user id, `$2` the secrets as JSON text.
pub const SAVE_SECRETS_SQL: &str = "insert into local_secrets (user_id, secrets, updated_at) values ($1, $2, now()) on conflict (user_id) do update set secrets = excluded.secrets, updated_at = now()";

/// The statement that reads the device's secrets row.
#[must_use]
pub fn load_secrets_sql() -> &'static str {
    LOAD_SECRETS_SQL
}

/// The statement that writes the device's secrets row.
#[must_use]
pub fn save_secrets_sql() -> &'static str {
    SAVE_SECRETS_SQL
}

/// The secrets JSON text to parse: the stored text, or `{}` when there is no row
/// yet or the stored text is empty (`DeviceSecretsStore.load` answers `{}`).
#[must_use]
pub fn secrets_json_text(stored: Option<&str>) -> String {
    match stored {
        Some(text) if !text.is_empty() => text.to_owned(),
        _ => "{}".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // it: "reads the row for the device's own identity"
    #[test]
    fn load_reads_local_secrets_for_one_user() {
        assert!(load_secrets_sql().contains("from local_secrets"));
        assert!(load_secrets_sql().ends_with("user_id = $1"));
    }

    // it: "writes one row for this device, and never a route"
    #[test]
    fn save_writes_one_upserted_row() {
        let sql = save_secrets_sql();
        assert!(sql.contains("local_secrets"));
        assert!(sql.contains("on conflict (user_id) do update"));
        assert!(sql.contains("values ($1, $2, now())"));
    }

    // it: "parses a json column that came back as text"
    #[test]
    fn stored_text_is_returned_for_parsing() {
        assert_eq!(
            secrets_json_text(Some(r#"{"zoteroApiKey":"k"}"#)),
            r#"{"zoteroApiKey":"k"}"#
        );
    }

    // it: "answers with nothing rather than throwing when there is no row yet"
    #[test]
    fn missing_row_reads_as_empty_object() {
        assert_eq!(secrets_json_text(None), "{}");
        assert_eq!(secrets_json_text(Some("")), "{}");
    }
}

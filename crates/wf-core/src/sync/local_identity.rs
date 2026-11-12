//! Ports the decisions of `apps/web/src/backend/providers/local/local-identity.ts`
//! and `local-first-marker.ts`: which account the device's marker names, whether
//! local mode is on, whether the local-first wiring applies, and which user the
//! device's queries run as. The localStorage reads and writes, the desktop bridge
//! lookup, the session promise cache and the `LOCAL_USER` object stay in TypeScript.

use serde::{Deserialize, Serialize};

/// The localStorage key of the local-mode choice (`"1"` when on).
pub const LOCAL_MODE_KEY: &str = "weaveforge.local-mode";

/// The localStorage key of the local-first account marker (a JSON object).
pub const LOCAL_FIRST_KEY: &str = "weaveforge.local-first";

/// The query that reads the signed-in user as the database sees it.
pub const DEVICE_USER_SQL: &str = "select auth.uid()::text as id";

/// The account a device's database belongs to, once adopted (`LocalFirstAccount` in TS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFirstAccount {
    /// The account's user id.
    pub id: String,
    /// Whatever the marker holds under `email` unless it is null (`parsed.email ?? null`), so a
    /// non-string value passes through as the old TypeScript did.
    pub email: Option<serde_json::Value>,
}

/// Whether the stored local-mode value means local mode is on: only `"1"` does.
#[must_use]
pub fn is_local_mode(stored: Option<&str>) -> bool {
    stored == Some("1")
}

/// Whether this window should be wired local-first: not in local mode, and on the desktop.
#[must_use]
pub fn local_first_wanted(local_mode: bool, desktop: bool) -> bool {
    !local_mode && desktop
}

/// The account in the marker, or `None` when there is no marker, it is not JSON, or it
/// has no string `id` (`parsed.id` must be a string; a missing `email` becomes `null`).
#[must_use]
pub fn local_first_account_from_marker(raw: Option<&str>) -> Option<LocalFirstAccount> {
    let value: serde_json::Value = serde_json::from_str(raw?).ok()?;
    let object = value.as_object()?;
    let id = object.get("id")?.as_str()?.to_owned();
    let email = object.get("email").filter(|v| !v.is_null()).cloned();
    Some(LocalFirstAccount { id, email })
}

/// The user a device's queries run as: the id the database reports when it is non-empty,
/// otherwise the fallback (`row?.id || LOCAL_USER_ID`).
#[must_use]
pub fn device_user_id(reported: Option<&str>, fallback: &str) -> String {
    match reported {
        Some(id) if !id.is_empty() => id.to_owned(),
        _ => fallback.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKER: &str = r#"{"id":"a1","email":"a@example.com"}"#;

    // it: "is absent where there is no window"
    #[test]
    fn no_marker_means_no_account() {
        assert_eq!(local_first_account_from_marker(None), None);
    }

    // it: "remembers the account and forgets it on sign-out"
    #[test]
    fn a_stored_marker_reads_back_as_the_account() {
        assert_eq!(
            local_first_account_from_marker(Some(MARKER)),
            Some(LocalFirstAccount {
                id: "a1".to_owned(),
                email: Some(serde_json::json!("a@example.com")),
            })
        );
    }

    // it: "remembers the account and forgets it on sign-out" (a non-string email is kept, as the TS did)
    #[test]
    fn a_non_string_email_is_kept_as_the_marker_holds_it() {
        assert_eq!(
            local_first_account_from_marker(Some(r#"{"id":"a1","email":5}"#)),
            Some(LocalFirstAccount {
                id: "a1".to_owned(),
                email: Some(serde_json::json!(5)),
            })
        );
    }

    // it: "remembers the account and forgets it on sign-out" (a null email is kept as null)
    #[test]
    fn a_marker_without_an_email_has_none() {
        assert_eq!(
            local_first_account_from_marker(Some(r#"{"id":"a1"}"#)),
            Some(LocalFirstAccount {
                id: "a1".to_owned(),
                email: None,
            })
        );
    }

    // it: "ignores a marker it cannot read"
    #[test]
    fn an_unreadable_marker_is_ignored() {
        assert_eq!(local_first_account_from_marker(Some("{not json")), None);
        assert_eq!(local_first_account_from_marker(Some(r#"{"email":"x"}"#)), None);
        assert_eq!(local_first_account_from_marker(Some("5")), None);
    }

    #[test]
    fn local_mode_is_on_only_for_the_stored_one() {
        assert!(is_local_mode(Some("1")));
        assert!(!is_local_mode(Some("0")));
        assert!(!is_local_mode(None));
    }

    #[test]
    fn local_first_applies_on_the_desktop_outside_local_mode() {
        assert!(local_first_wanted(false, true));
        assert!(!local_first_wanted(true, true));
        assert!(!local_first_wanted(false, false));
    }

    // it: "falls back to the local user when the database has no identity"
    #[test]
    fn device_user_falls_back_when_the_database_reports_none() {
        assert_eq!(device_user_id(None, "local-user"), "local-user");
        assert_eq!(device_user_id(Some(""), "local-user"), "local-user");
        assert_eq!(device_user_id(Some("u1"), "local-user"), "u1");
    }

    #[test]
    fn device_user_query_reads_auth_uid() {
        assert_eq!(DEVICE_USER_SQL, "select auth.uid()::text as id");
    }
}

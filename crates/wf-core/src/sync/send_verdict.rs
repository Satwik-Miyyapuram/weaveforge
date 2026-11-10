//! Ports the status decision in `send` and the missing-id rule in `missingIds`
//! of `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`. The
//! HTTP calls and the follow-up reads (`conflict`, `gone`, `tombstoned`) stay in TS.

use serde::{Deserialize, Serialize};

/// Postgres `foreign_key_violation`: the row's parent is not on the server yet.
const FK_VIOLATION: &str = "23503";

/// Postgres `insufficient_privilege`, which is what a failed RLS check raises.
const RLS_VIOLATION: &str = "42501";

/// What one PostgREST write means for the outbox entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SendVerdict {
    /// A 409 whose cause is a missing parent. Kept and retried once the parent is up.
    AwaitingParent,
    /// A 409 over the row itself. TS reads the server copy to decide.
    Conflict,
    /// A 5xx, or a 401/403 that is about the session. The queue waits.
    Offline,
    /// A 403 that is a row-level-security refusal. Burns an attempt on this row only.
    RlsRefused,
    /// Any other 4xx. The row is refused.
    Refused,
    /// A guarded write that matched no row. TS checks whether a delete already landed.
    GuardMissed,
    /// The write went through.
    Accepted,
}

/// Classifies one write's answer. `error_code` is the Postgres error code read
/// from the body, when there is one. `rows` is how many rows a guarded write
/// returned, or `None` when the body was not an array.
///
/// The order matters: a 409 is always a conflict-or-parent answer even when
/// `rows` is empty, and the empty-rows check only applies to a 2xx.
#[must_use]
pub fn classify_send(status: u16, error_code: Option<&str>, rows: Option<usize>) -> SendVerdict {
    if status == 409 {
        return if error_code == Some(FK_VIOLATION) {
            SendVerdict::AwaitingParent
        } else {
            SendVerdict::Conflict
        };
    }
    if status >= 500 {
        return SendVerdict::Offline;
    }
    if status == 403 && error_code == Some(RLS_VIOLATION) {
        return SendVerdict::RlsRefused;
    }
    if status == 401 || status == 403 {
        return SendVerdict::Offline;
    }
    if status >= 400 {
        return SendVerdict::Refused;
    }
    if rows == Some(0) {
        return SendVerdict::GuardMissed;
    }
    SendVerdict::Accepted
}

/// A paper_tags insert is a link whose id hashes the key, so a duplicate means
/// another device already made the same link: accepted, not a conflict.
#[must_use]
pub fn is_link_insert(op: &str, table: &str) -> bool {
    op == "insert" && table == "paper_tags"
}

/// The ids in `chunk` the server did not return and has no tombstone for. A
/// deleted-elsewhere row is left out, so a resend does not bring it back.
#[must_use]
pub fn missing_ids(chunk: &[String], held: &[String], tombstoned: &[String]) -> Vec<String> {
    chunk
        .iter()
        .filter(|id| !held.contains(id) && !tombstoned.contains(id))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{SendVerdict, classify_send, is_link_insert, missing_ids};

    #[test]
    fn missing_parent_is_awaiting_parent_not_conflict() {
        assert_eq!(
            classify_send(409, Some("23503"), None),
            SendVerdict::AwaitingParent
        );
        assert_eq!(
            classify_send(409, Some("23505"), None),
            SendVerdict::Conflict
        );
        assert_eq!(classify_send(409, None, Some(0)), SendVerdict::Conflict);
    }

    #[test]
    fn server_errors_and_session_auth_wait() {
        assert_eq!(classify_send(503, None, None), SendVerdict::Offline);
        assert_eq!(classify_send(401, None, None), SendVerdict::Offline);
        assert_eq!(classify_send(403, None, None), SendVerdict::Offline);
    }

    #[test]
    fn rls_403_refuses_the_row_only() {
        assert_eq!(
            classify_send(403, Some("42501"), None),
            SendVerdict::RlsRefused
        );
    }

    #[test]
    fn other_4xx_is_refused() {
        assert_eq!(classify_send(400, None, None), SendVerdict::Refused);
        assert_eq!(
            classify_send(422, Some("42501"), None),
            SendVerdict::Refused
        );
    }

    #[test]
    fn empty_guarded_write_is_guard_missed() {
        assert_eq!(classify_send(200, None, Some(0)), SendVerdict::GuardMissed);
        assert_eq!(classify_send(200, None, Some(1)), SendVerdict::Accepted);
        assert_eq!(classify_send(204, None, None), SendVerdict::Accepted);
    }

    #[test]
    fn only_paper_tag_inserts_are_links() {
        assert!(is_link_insert("insert", "paper_tags"));
        assert!(!is_link_insert("update", "paper_tags"));
        assert!(!is_link_insert("insert", "notes"));
    }

    #[test]
    fn missing_ids_skips_held_and_tombstoned() {
        let chunk = ["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let held = ["b".to_owned()];
        let tombstoned = ["c".to_owned()];
        assert_eq!(
            missing_ids(&chunk, &held, &tombstoned),
            vec!["a".to_owned()]
        );
    }
}

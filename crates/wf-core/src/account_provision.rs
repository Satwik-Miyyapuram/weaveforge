//! Create-user reply decision and citation-alert failure log line (TS `HttpAccountProvisioner.createMember`
//! and `reportCitationAlertError` in apps/web/src/container/parts.ts). Pure: the fetch, the cache
//! invalidation and the log write stay in TS.

use serde::Serialize;

/// Thrown when the create-user reply is not ok and the server gave no message.
pub const CREATE_MEMBER_FAILED: &str = "Failed to create account.";
/// Thrown when the create-user reply is ok but carries no member.
pub const CREATE_MEMBER_NO_MEMBER: &str = "Account created but no member returned.";

/// Level of a citation-alert failure log line.
pub const CITATION_ALERT_LOG_LEVEL: &str = "warn";
/// Source of a citation-alert failure log line.
pub const CITATION_ALERT_LOG_SOURCE: &str = "citation-alerts";
/// Message of a citation-alert failure log line.
pub const CITATION_ALERT_FAILED_MESSAGE: &str = "A citation alert check or notification failed";

/// What a create-user reply means (TS branch on `res.ok` and `payload.member`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CreateMemberReply {
    /// The reply carries the new member; the caller refreshes its caches.
    Created,
    /// Refused: throw the server's message, or `fallback` when it gave none.
    Rejected {
        /// The message to show when the server gave none.
        fallback: &'static str,
    },
}

/// Decide a create-user reply. `ok` is the HTTP status; `has_member` is whether the parsed body
/// carries a truthy `member`.
#[must_use]
pub fn create_member_reply(ok: bool, has_member: bool) -> CreateMemberReply {
    if ok && has_member {
        return CreateMemberReply::Created;
    }
    CreateMemberReply::Rejected {
        fallback: if ok {
            CREATE_MEMBER_NO_MEMBER
        } else {
            CREATE_MEMBER_FAILED
        },
    }
}

/// The log line for one citation alert that failed (TS `logToApp` input).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationAlertLog {
    /// The log level for the failure.
    pub level: &'static str,
    /// The component that reports the failure.
    pub source: &'static str,
    /// The fixed failure message.
    pub message: &'static str,
    /// The paper id and the reason the alert failed.
    pub detail: String,
}

/// Build the citation-alert failure log line; `detail` is `"<paperId>: <reason>"`.
#[must_use]
pub fn citation_alert_failure_log(paper_id: &str, reason: &str) -> CitationAlertLog {
    CitationAlertLog {
        level: CITATION_ALERT_LOG_LEVEL,
        source: CITATION_ALERT_LOG_SOURCE,
        message: CITATION_ALERT_FAILED_MESSAGE,
        detail: format!("{paper_id}: {reason}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_reply_with_member_is_created() {
        assert_eq!(create_member_reply(true, true), CreateMemberReply::Created);
    }

    #[test]
    fn ok_reply_without_member_uses_the_no_member_text() {
        assert_eq!(
            create_member_reply(true, false),
            CreateMemberReply::Rejected {
                fallback: "Account created but no member returned."
            }
        );
    }

    #[test]
    fn refused_reply_uses_the_failed_text_even_with_a_member() {
        assert_eq!(
            create_member_reply(false, true),
            CreateMemberReply::Rejected {
                fallback: "Failed to create account."
            }
        );
        assert_eq!(
            create_member_reply(false, false),
            CreateMemberReply::Rejected {
                fallback: "Failed to create account."
            }
        );
    }

    #[test]
    fn citation_alert_detail_is_paper_id_colon_reason() {
        let log = citation_alert_failure_log("paper-1", "network down");
        assert_eq!(log.detail, "paper-1: network down");
        assert_eq!(log.level, "warn");
        assert_eq!(log.source, "citation-alerts");
        assert_eq!(log.message, "A citation alert check or notification failed");
    }
}

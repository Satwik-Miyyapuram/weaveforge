//! Shaping of an AI-originated proposal before it is saved (TS `create-ai-proposal-draft.use-case.ts`).
//!
//! The policy check and the save stay in TS; this module owns the record's shape and the
//! content rules.

use serde_json::Value;

use super::access_policy::AiProposalKind;
use crate::search::js_text::is_js_whitespace;

/// The fields the caller supplies (TS `CreateAiProposalDraftUseCase.execute` input, after policy).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProposalDraftInput {
    /// Proposal id.
    pub id: String,
    /// Kind of change proposed.
    pub kind: AiProposalKind,
    /// Resource the change targets.
    pub resource_id: String,
    /// Preview text; trimmed, required.
    pub content: String,
    /// Kind-specific payload, kept as given.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub payload: Value,
    /// Creation time, ISO 8601, from the caller's clock.
    pub created_at: String,
    /// Source links; absent means none.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub source_links: Option<Vec<String>>,
    /// Revision the change expects to apply to.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub expected_revision: Option<String>,
    /// Evidence entries; kept only when non-empty.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(type = Option<Vec<specta_typescript::Unknown>>, optional))]
    pub evidence: Option<Vec<Value>>,
}

/// Lifecycle state of a new proposal. Only `pending` exists at creation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ProposalDraftStatus {
    /// Awaiting the user's decision.
    Pending,
}

/// A proposal ready to save (TS `AiWriteProposal`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProposalDraft {
    /// Proposal id.
    pub id: String,
    /// Kind of change proposed.
    pub kind: AiProposalKind,
    /// Resource the change targets.
    pub resource_id: String,
    /// Trimmed preview text.
    pub content: String,
    /// Kind-specific payload.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub payload: Value,
    /// Creation time, ISO 8601.
    pub created_at: String,
    /// Always `pending` at creation.
    pub status: ProposalDraftStatus,
    /// Source links; empty when none given.
    pub source_links: Vec<String>,
    /// Expected revision, when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub expected_revision: Option<String>,
    /// Evidence; present only when non-empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<Vec<specta_typescript::Unknown>>, optional))]
    pub evidence: Option<Vec<Value>>,
}

/// Trim the preview and build the pending proposal.
///
/// Trimming uses JavaScript whitespace, as `String.prototype.trim` does.
///
/// # Errors
///
/// Returns `A proposal needs a preview describing what it will do.` when the trimmed content is empty.
pub fn shape_proposal_draft(input: ProposalDraftInput) -> Result<ProposalDraft, String> {
    let content = input.content.trim_matches(is_js_whitespace).to_owned();
    if content.is_empty() {
        return Err("A proposal needs a preview describing what it will do.".to_owned());
    }
    let evidence = input.evidence.filter(|items| !items.is_empty());
    Ok(ProposalDraft {
        id: input.id,
        kind: input.kind,
        resource_id: input.resource_id,
        content,
        payload: input.payload,
        created_at: input.created_at,
        status: ProposalDraftStatus::Pending,
        source_links: input.source_links.unwrap_or_default(),
        expected_revision: input.expected_revision,
        evidence,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn input(content: &str) -> ProposalDraftInput {
        ProposalDraftInput {
            id: "p1".to_owned(),
            kind: AiProposalKind::CreateVaultNote,
            resource_id: "r1".to_owned(),
            content: content.to_owned(),
            payload: json!({ "title": "x" }),
            created_at: "2026-11-10T10:00:00.000Z".to_owned(),
            source_links: None,
            expected_revision: None,
            evidence: None,
        }
    }

    #[test]
    fn trims_content_and_starts_pending() {
        let draft = shape_proposal_draft(input("  hello\n")).expect("shaped");
        assert_eq!(draft.content, "hello");
        assert_eq!(draft.status, ProposalDraftStatus::Pending);
        assert!(draft.source_links.is_empty());
        assert!(draft.evidence.is_none());
        assert!(draft.expected_revision.is_none());
    }

    #[test]
    fn trims_js_whitespace_including_byte_order_mark() {
        let draft = shape_proposal_draft(input("\u{feff} body \u{feff}")).expect("shaped");
        assert_eq!(draft.content, "body");
    }

    #[test]
    fn blank_content_is_rejected() {
        assert_eq!(
            shape_proposal_draft(input(" \t\n ")).unwrap_err(),
            "A proposal needs a preview describing what it will do."
        );
    }

    #[test]
    fn empty_evidence_is_dropped_and_non_empty_kept() {
        let mut empty = input("a");
        empty.evidence = Some(Vec::new());
        assert!(
            shape_proposal_draft(empty)
                .expect("shaped")
                .evidence
                .is_none()
        );

        let mut some = input("a");
        some.evidence = Some(vec![json!({ "quote": "q" })]);
        let draft = shape_proposal_draft(some).expect("shaped");
        assert_eq!(draft.evidence.map(|items| items.len()), Some(1));
    }

    #[test]
    fn keeps_links_and_revision_when_given() {
        let mut given = input("a");
        given.source_links = Some(vec!["/papers/1".to_owned()]);
        given.expected_revision = Some("rev-1".to_owned());
        let draft = shape_proposal_draft(given).expect("shaped");
        assert_eq!(draft.source_links, vec!["/papers/1".to_owned()]);
        assert_eq!(draft.expected_revision.as_deref(), Some("rev-1"));
    }
}

//! Sharing and comment rules: grant coverage and access, and comment-input normalization. Pure.
//! The JS names match `packages/core/src/features/sharing/domain/share.ts` and `comment.ts`.

use crate::reader_analysis::lines::js_trim;

/// A type a share can cover (TS `ShareableType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ShareableType {
    /// A milestone.
    Milestone,
    /// An experiment.
    Experiment,
    /// A report section.
    ReportSection,
    /// A reading list.
    ReadingList,
    /// A paper.
    Paper,
    /// A vault page.
    VaultPage,
}

/// How much a share lets the recipient do (TS `ShareAccess`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ShareAccess {
    /// Read only.
    View,
    /// Read and comment.
    Comment,
    /// Read, comment and collaboratively edit.
    Edit,
}

/// Every type a share can cover (TS `SHAREABLE_TYPES`).
pub const SHAREABLE_TYPES: &[ShareableType] = &[
    ShareableType::Milestone,
    ShareableType::Experiment,
    ShareableType::ReportSection,
    ShareableType::ReadingList,
    ShareableType::Paper,
    ShareableType::VaultPage,
];

/// Share types that support collaborative editing (TS `CRDT_EDITABLE_SHARE_TYPES`).
pub const CRDT_EDITABLE_SHARE_TYPES: &[ShareableType] =
    &[ShareableType::VaultPage, ShareableType::ReportSection];

/// A grant request (TS `NewShareInput`). `access` defaults to comment when absent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewShareInput {
    /// The member receiving the grant.
    pub recipient_id: String,
    /// The type of item shared.
    pub resource_type: ShareableType,
    /// The item shared; `None` shares every item of the type.
    pub resource_id: Option<String>,
    /// The access level; absent means comment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub access: Option<ShareAccess>,
}

/// A normalized grant (TS `Required<NewShareInput>`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NormalizedShareInput {
    /// The member receiving the grant.
    pub recipient_id: String,
    /// The type of item shared.
    pub resource_type: ShareableType,
    /// The item shared; `None` shares every item of the type.
    pub resource_id: Option<String>,
    /// The access level, never absent.
    pub access: ShareAccess,
}

/// The fields of TS `Share` that coverage reads (`Pick` of type, resource and owner).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ShareScope {
    /// The type of item shared.
    pub resource_type: ShareableType,
    /// The item shared; `None` shares every item of the type.
    pub resource_id: Option<String>,
    /// The sharer.
    pub owner_id: String,
}

/// The fields of TS `Share` that access reads (`ShareScope` plus `access`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ShareGrant {
    /// The type of item shared.
    pub resource_type: ShareableType,
    /// The item shared; `None` shares every item of the type.
    pub resource_id: Option<String>,
    /// The sharer.
    pub owner_id: String,
    /// The access level.
    pub access: ShareAccess,
}

/// A passage with a little context either side (TS `CommentAnchor`, W3C TextQuoteSelector).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CommentAnchor {
    /// The quoted text.
    pub quote: String,
    /// Text just before the quote.
    pub prefix: String,
    /// Text just after the quote.
    pub suffix: String,
}

/// A comment request (TS `NewCommentInput`). Optional fields may be absent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewCommentInput {
    /// The type of item commented on.
    pub resource_type: String,
    /// The item commented on.
    pub resource_id: String,
    /// The comment text.
    pub body: String,
    /// The passage commented on, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub anchor: Option<CommentAnchor>,
    /// The thread root this answers, if a reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub parent_id: Option<String>,
}

/// A normalized comment: every field present, `null` when unset.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NormalizedComment {
    /// The type of item commented on.
    pub resource_type: String,
    /// The item commented on.
    pub resource_id: String,
    /// The trimmed comment text.
    pub body: String,
    /// The passage commented on; `None` for a reply or a page-level comment.
    pub anchor: Option<CommentAnchor>,
    /// The thread root this answers; `None` on a root.
    pub parent_id: Option<String>,
}

/// Whether a share grant covers every resource of a type (TS `isBlanketShare`).
#[must_use]
pub fn is_blanket_share(resource_id: Option<&str>) -> bool {
    resource_id.is_none()
}

/// Whether a grant on `resource_id` can be edited collaboratively (TS `shareSupportsEditAccess`).
#[must_use]
pub fn share_supports_edit_access(resource_type: ShareableType, resource_id: Option<&str>) -> bool {
    resource_id.is_some() && CRDT_EDITABLE_SHARE_TYPES.contains(&resource_type)
}

/// Whether a grant covers a specific resource, blanket grants included (TS `shareCoversResource`).
#[must_use]
pub fn share_covers_resource(
    share: &ShareScope,
    resource_type: ShareableType,
    resource_id: &str,
    owner_id: &str,
) -> bool {
    covers(
        share.resource_type,
        share.resource_id.as_deref(),
        &share.owner_id,
        resource_type,
        resource_id,
        owner_id,
    )
}

/// Whether a share grant allows commenting on a specific resource (TS `shareAllowsComment`).
#[must_use]
pub fn share_allows_comment(
    share: &ShareGrant,
    resource_type: ShareableType,
    resource_id: &str,
    owner_id: &str,
) -> bool {
    covers(
        share.resource_type,
        share.resource_id.as_deref(),
        &share.owner_id,
        resource_type,
        resource_id,
        owner_id,
    ) && matches!(share.access, ShareAccess::Comment | ShareAccess::Edit)
}

/// Whether a share grant allows collaborative editing (TS `shareAllowsEdit`).
#[must_use]
pub fn share_allows_edit(
    share: &ShareGrant,
    resource_type: ShareableType,
    resource_id: &str,
    owner_id: &str,
) -> bool {
    covers(
        share.resource_type,
        share.resource_id.as_deref(),
        &share.owner_id,
        resource_type,
        resource_id,
        owner_id,
    ) && share.access == ShareAccess::Edit
}

/// Normalize and validate a grant request (TS `normalizeShareInput`).
///
/// # Errors
///
/// Fails when the recipient is empty, or when edit access is asked for on anything but a single
/// vault page or report section.
pub fn normalize_share_input(input: &NewShareInput) -> Result<NormalizedShareInput, String> {
    if input.recipient_id.is_empty() {
        return Err("A recipient is required.".to_owned());
    }
    let access = input.access.unwrap_or(ShareAccess::Comment);
    // Edit only means something where a CRDT edit path exists; elsewhere the
    // grant would be stored and then silently act as comment.
    if access == ShareAccess::Edit
        && !share_supports_edit_access(input.resource_type, input.resource_id.as_deref())
    {
        return Err(
            "Edit access is only available for a single vault page or report section.".to_owned(),
        );
    }
    Ok(NormalizedShareInput {
        recipient_id: input.recipient_id.clone(),
        resource_type: input.resource_type,
        resource_id: input.resource_id.clone(),
        access,
    })
}

/// Normalize and validate a comment request (TS `normalizeCommentInput`).
///
/// # Errors
///
/// Fails when the body is blank after trimming, or when `resource_id` is empty.
pub fn normalize_comment_input(input: &NewCommentInput) -> Result<NormalizedComment, String> {
    let body = js_trim(&input.body);
    if body.is_empty() {
        return Err("A comment can't be empty.".to_owned());
    }
    if input.resource_id.is_empty() {
        return Err("A target resource is required.".to_owned());
    }
    let parent_id = input.parent_id.as_deref().filter(|p| !p.is_empty());
    // A reply belongs to its root's passage; an anchor on it would be a second one.
    let anchor = match &input.anchor {
        Some(a) if parent_id.is_none() && !js_trim(&a.quote).is_empty() => Some(a.clone()),
        _ => None,
    };
    Ok(NormalizedComment {
        resource_type: input.resource_type.clone(),
        resource_id: input.resource_id.clone(),
        body: body.to_owned(),
        anchor,
        parent_id: parent_id.map(str::to_owned),
    })
}

/// Same type and owner, and the grant names this resource or every resource of its type.
fn covers(
    share_type: ShareableType,
    share_resource_id: Option<&str>,
    share_owner_id: &str,
    resource_type: ShareableType,
    resource_id: &str,
    owner_id: &str,
) -> bool {
    share_type == resource_type
        && share_owner_id == owner_id
        && share_resource_id.is_none_or(|id| id == resource_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn share_input(
        access: Option<ShareAccess>,
        resource_type: ShareableType,
        resource_id: Option<&str>,
    ) -> NewShareInput {
        NewShareInput {
            recipient_id: "u1".to_owned(),
            resource_type,
            resource_id: resource_id.map(str::to_owned),
            access,
        }
    }

    fn comment(body: &str) -> NewCommentInput {
        NewCommentInput {
            resource_type: "vault_page".to_owned(),
            resource_id: "p1".to_owned(),
            body: body.to_owned(),
            anchor: None,
            parent_id: None,
        }
    }

    #[test]
    fn share_defaults_to_comment_and_keeps_blanket_null() {
        let input = share_input(None, ShareableType::Milestone, None);
        let got = normalize_share_input(&input).unwrap();
        assert_eq!(got.access, ShareAccess::Comment);
        assert_eq!(got.resource_id, None);
        assert!(is_blanket_share(None));
        assert!(!is_blanket_share(Some("")));
    }

    #[test]
    fn share_rejects_blank_recipient_and_misplaced_edit() {
        let mut blank = share_input(None, ShareableType::Paper, Some("x"));
        blank.recipient_id = String::new();
        assert_eq!(
            normalize_share_input(&blank).unwrap_err(),
            "A recipient is required."
        );
        let edit = Some(ShareAccess::Edit);
        let paper = share_input(edit, ShareableType::Paper, Some("x"));
        assert!(normalize_share_input(&paper).is_err());
        assert!(normalize_share_input(&share_input(edit, ShareableType::VaultPage, None)).is_err());
        let page = share_input(edit, ShareableType::VaultPage, Some("x"));
        assert_eq!(
            normalize_share_input(&page).unwrap().access,
            ShareAccess::Edit
        );
    }

    #[test]
    fn coverage_needs_same_owner_and_type_and_blanket_covers_all() {
        let blanket = ShareScope {
            resource_type: ShareableType::Experiment,
            resource_id: None,
            owner_id: "o1".to_owned(),
        };
        assert!(share_covers_resource(
            &blanket,
            ShareableType::Experiment,
            "e1",
            "o1"
        ));
        assert!(!share_covers_resource(
            &blanket,
            ShareableType::Experiment,
            "e1",
            "o2"
        ));
        assert!(!share_covers_resource(
            &blanket,
            ShareableType::Paper,
            "e1",
            "o1"
        ));
        let single = ShareScope {
            resource_id: Some("e1".to_owned()),
            ..blanket
        };
        assert!(!share_covers_resource(
            &single,
            ShareableType::Experiment,
            "e2",
            "o1"
        ));
    }

    #[test]
    fn access_levels_gate_comment_and_edit() {
        let grant = |access| ShareGrant {
            resource_type: ShareableType::VaultPage,
            resource_id: Some("p1".to_owned()),
            owner_id: "o1".to_owned(),
            access,
        };
        let t = ShareableType::VaultPage;
        assert!(!share_allows_comment(
            &grant(ShareAccess::View),
            t,
            "p1",
            "o1"
        ));
        assert!(share_allows_comment(
            &grant(ShareAccess::Comment),
            t,
            "p1",
            "o1"
        ));
        assert!(!share_allows_edit(
            &grant(ShareAccess::Comment),
            t,
            "p1",
            "o1"
        ));
        assert!(share_allows_edit(&grant(ShareAccess::Edit), t, "p1", "o1"));
    }

    #[test]
    fn comment_trims_body_and_keeps_untrimmed_quote() {
        let mut root = comment("  looks good  ");
        root.anchor = Some(CommentAnchor {
            quote: " the claim ".to_owned(),
            prefix: "a".to_owned(),
            suffix: "b".to_owned(),
        });
        let got = normalize_comment_input(&root).unwrap();
        assert_eq!(got.body, "looks good");
        assert_eq!(got.anchor.map(|a| a.quote), Some(" the claim ".to_owned()));
        assert_eq!(got.parent_id, None);
    }

    #[test]
    fn reply_and_blank_quote_drop_anchor() {
        let mut reply = comment("ok");
        reply.anchor = Some(CommentAnchor {
            quote: "q".to_owned(),
            prefix: String::new(),
            suffix: String::new(),
        });
        reply.parent_id = Some("c0".to_owned());
        let got = normalize_comment_input(&reply).unwrap();
        assert_eq!(got.anchor, None);
        assert_eq!(got.parent_id.as_deref(), Some("c0"));

        let mut blank_quote = comment("ok");
        blank_quote.anchor = Some(CommentAnchor {
            quote: "   ".to_owned(),
            prefix: String::new(),
            suffix: String::new(),
        });
        blank_quote.parent_id = Some(String::new());
        let got = normalize_comment_input(&blank_quote).unwrap();
        assert_eq!(got.anchor, None);
        assert_eq!(got.parent_id, None);
    }

    #[test]
    fn comment_rejects_blank_body_and_missing_resource() {
        assert_eq!(
            normalize_comment_input(&comment(" \t ")).unwrap_err(),
            "A comment can't be empty."
        );
        let mut no_resource = comment("hi");
        no_resource.resource_id = String::new();
        assert_eq!(
            normalize_comment_input(&no_resource).unwrap_err(),
            "A target resource is required."
        );
    }
}

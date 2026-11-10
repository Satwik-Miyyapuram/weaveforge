//! Sharing and comment rules: grant coverage and access, and comment-input normalization. Pure.
//! The JS names match `packages/core/src/features/sharing/domain/share.ts` and `comment.ts`.

use crate::overleaf_workshop::encode_uri_component;
use crate::reader::zotero_projection::{ZoteroAnnotationInput, project_zotero_annotations};
use crate::reader_analysis::lines::js_trim;
use crate::sync::instant::format_instant;

/// Days a new view link lives when the caller sets no expiry (TS `SHARE_LINK_DEFAULT_TTL_DAYS`).
pub const SHARE_LINK_DEFAULT_TTL_DAYS: i64 = 7;

/// Milliseconds in one UTC day.
const DAY_MS: i64 = 86_400_000;

/// The default expiry of a new view link: [`SHARE_LINK_DEFAULT_TTL_DAYS`] after `now_ms`,
/// as ISO-8601 UTC. The caller passes the time, so this stays clock-free.
/// Port of `defaultShareLinkExpiresAt` in `packages/core/src/features/sharing/domain/share-link.ts`.
#[must_use]
pub fn default_share_link_expires_at(now_ms: i64) -> String {
    format_instant(now_ms.saturating_add(SHARE_LINK_DEFAULT_TTL_DAYS * DAY_MS))
}

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

const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url of a share-link token, for the `?t=` query parameter.
#[must_use]
pub fn encode_share_link_token(token: &[u8]) -> String {
    let mut out = String::with_capacity(token.len().div_ceil(3) * 4);
    for chunk in token.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..=chunk.len() {
            out.push(char::from(B64URL[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    out
}

/// The token bytes of a `?t=` value. Accepts base64url or standard base64, padded or not,
/// as `atob` does after the url alphabet is mapped back.
///
/// # Errors
///
/// A character outside the alphabet, or a length that cannot be base64.
pub fn decode_share_link_token(encoded: &str) -> Result<Vec<u8>, String> {
    let body = encoded.trim_end_matches('=');
    if encoded.len() - body.len() > 2 || body.len() % 4 == 1 {
        return Err("The share link token is not valid base64.".to_owned());
    }
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in body.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => return Err("The share link token is not valid base64.".to_owned()),
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

/// A `shares` row as the database returns it (snake_case columns; TS `ShareRow`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ShareRow {
    /// Row id.
    pub id: String,
    /// The sharer.
    pub owner_id: String,
    /// The recipient.
    pub recipient_id: String,
    /// The type of item shared.
    pub resource_type: ShareableType,
    /// The item shared; `None` shares every item of the type.
    pub resource_id: Option<String>,
    /// The access level.
    pub access: ShareAccess,
    /// When the grant was made.
    pub created_at: String,
}

/// A share as the app reads it (TS `Share`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Share {
    /// Row id.
    pub id: String,
    /// The sharer.
    pub owner_id: String,
    /// The recipient.
    pub recipient_id: String,
    /// The type of item shared.
    pub resource_type: ShareableType,
    /// The item shared; `None` shares every item of the type.
    pub resource_id: Option<String>,
    /// The access level.
    pub access: ShareAccess,
    /// When the grant was made.
    pub created_at: String,
}

#[must_use]
/// Map a `shares` row to a [`Share`] (TS `toDomain` in `share-rows.ts`).
pub fn share_from_row(row: &ShareRow) -> Share {
    Share {
        id: row.id.clone(),
        owner_id: row.owner_id.clone(),
        recipient_id: row.recipient_id.clone(),
        resource_type: row.resource_type,
        resource_id: row.resource_id.clone(),
        access: row.access,
        created_at: row.created_at.clone(),
    }
}

/// A `comments` row as the database returns it (snake_case columns; TS `CommentRow`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CommentRow {
    /// Row id.
    pub id: String,
    /// The author.
    pub author_id: String,
    /// The type of item commented on.
    pub resource_type: String,
    /// The item commented on.
    pub resource_id: String,
    /// The comment text.
    pub body: String,
    /// When the comment was made.
    pub created_at: String,
    /// The quoted passage; absent for a page-level comment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub anchor_quote: Option<String>,
    /// Text just before the quote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub anchor_prefix: Option<String>,
    /// Text just after the quote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub anchor_suffix: Option<String>,
    /// The thread root this answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub parent_id: Option<String>,
    /// When the thread was resolved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub resolved_at: Option<String>,
}

/// A comment as the app reads it (TS `Comment`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Comment {
    /// Row id.
    pub id: String,
    /// The author.
    pub author_id: String,
    /// The type of item commented on.
    pub resource_type: String,
    /// The item commented on.
    pub resource_id: String,
    /// The comment text.
    pub body: String,
    /// When the comment was made.
    pub created_at: String,
    /// The passage the comment is about; `None` for a page-level comment.
    pub anchor: Option<CommentAnchor>,
    /// The thread root this answers.
    pub parent_id: Option<String>,
    /// When the thread was resolved.
    pub resolved_at: Option<String>,
}

#[must_use]
/// Map a `comments` row to a [`Comment`] (TS `commentToDomain` in `comment-rows.ts`).
///
/// An anchor exists only when the quote is non-empty; its prefix and suffix default to `""`.
pub fn comment_from_row(row: &CommentRow) -> Comment {
    let anchor = row
        .anchor_quote
        .as_deref()
        .filter(|quote| !quote.is_empty())
        .map(|quote| CommentAnchor {
            quote: quote.to_owned(),
            prefix: row.anchor_prefix.clone().unwrap_or_default(),
            suffix: row.anchor_suffix.clone().unwrap_or_default(),
        });
    Comment {
        id: row.id.clone(),
        author_id: row.author_id.clone(),
        resource_type: row.resource_type.clone(),
        resource_id: row.resource_id.clone(),
        body: row.body.clone(),
        created_at: row.created_at.clone(),
        anchor,
        parent_id: row.parent_id.clone(),
        resolved_at: row.resolved_at.clone(),
    }
}

/// Which columns hold a shared item's title and status (TS `SHARED_SOURCES` entry).
/// The TS `table` field is ignored: the fetch stays in TS.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SharedSource {
    /// Column holding the title.
    pub title: String,
    /// Column holding the status; `None` for types without one.
    pub status: Option<String>,
}

/// A shared item as the reader shows it (TS `SharedItem`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SharedItem {
    /// The item id.
    pub id: String,
    /// The type of item.
    pub kind: ShareableType,
    /// The title, or `(untitled)`.
    pub title: String,
    /// The status, or `""`.
    pub status: String,
    /// The owner's user id.
    pub owner_id: String,
    /// The paper's metadata object (or array), for papers only.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub metadata: Option<serde_json::Value>,
}

#[must_use]
/// Shape one table row into a [`SharedItem`] (TS `toSharedItem` in `shared-reader-sources.ts`).
///
/// Reads values the way JS `String(x ?? fallback)` does, so the TS and Rust mappings agree.
pub fn shared_item(
    kind: ShareableType,
    row: &serde_json::Value,
    source: &SharedSource,
) -> SharedItem {
    let metadata = if kind == ShareableType::Paper {
        row.get("metadata")
            .filter(|value| {
                matches!(
                    value,
                    serde_json::Value::Object(_) | serde_json::Value::Array(_)
                )
            })
            .cloned()
    } else {
        None
    };
    SharedItem {
        id: js_string(row.get("id")).unwrap_or_default(),
        kind,
        title: js_string(row.get(source.title.as_str())).unwrap_or_else(|| "(untitled)".to_owned()),
        status: source
            .status
            .as_deref()
            .and_then(|column| js_string(row.get(column)))
            .unwrap_or_default(),
        owner_id: js_string(row.get("user_id")).unwrap_or_default(),
        metadata,
    }
}

/// JS `String(value ?? …)`: `None` when the value is absent or `null`.
fn js_string(value: Option<&serde_json::Value>) -> Option<String> {
    match value? {
        serde_json::Value::Null => None,
        other => Some(js_string_of(other)),
    }
}

/// JS `String(value)` for a non-null JSON value. Arrays join with commas and objects read as JS does.
fn js_string_of(value: &serde_json::Value) -> String {
    use serde_json::Value;
    match value {
        Value::Null => String::new(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => match number.as_f64() {
            Some(float) if float.fract() == 0.0 && float.abs() < 1e15 => {
                #[allow(
                    clippy::cast_possible_truncation,
                    reason = "checked: whole and below 1e15"
                )]
                let whole = float as i64;
                whole.to_string()
            }
            _ => number.to_string(),
        },
        Value::String(text) => text.clone(),
        Value::Array(items) => items.iter().map(js_string_of).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// The kind's snake_case name, as the TS `ShareableType` spells it.
const fn kind_name(kind: ShareableType) -> &'static str {
    match kind {
        ShareableType::Milestone => "milestone",
        ShareableType::Experiment => "experiment",
        ShareableType::ReportSection => "report_section",
        ShareableType::ReadingList => "reading_list",
        ShareableType::Paper => "paper",
        ShareableType::VaultPage => "vault_page",
    }
}

/// Deep-link route for a shared resource (TS `sharedResourceHref`): a read-only detail shell.
#[must_use]
pub fn shared_resource_href(kind: ShareableType, resource_id: &str) -> String {
    let id = encode_uri_component(resource_id);
    match kind {
        ShareableType::Paper => format!("/papers?paper={id}&shared=1"),
        ShareableType::Experiment => format!("/experiments?experiment={id}&shared=1"),
        ShareableType::ReportSection => format!("/report?section={id}&shared=1"),
        ShareableType::ReadingList => format!("/lists?list={id}&shared=1"),
        ShareableType::Milestone => format!("/plan?milestone={id}&shared=1"),
        ShareableType::VaultPage => format!("/notes?page={id}&shared=1"),
    }
}

/// Deep-link route for a shared item (TS `sharedItemHref`).
#[must_use]
pub fn shared_item_href(item: &SharedItem) -> String {
    shared_resource_href(item.kind, &item.id)
}

/// The lower-case noun for a shared item's kind (TS `sharedItemTypeLabel`).
#[must_use]
pub fn shared_item_type_label(kind: ShareableType) -> String {
    if kind == ShareableType::VaultPage {
        return "note".to_owned();
    }
    crate::enum_label::humanise(kind_name(kind)).to_lowercase()
}

/// What a shared paper shows of its Zotero annotations (TS `sharedPaperAnnotationSummary`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SharedPaperAnnotationSummary {
    /// Annotations shown (notes excluded).
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub count: usize,
    /// Up to three trimmed texts, falling back to the comment.
    pub samples: Vec<String>,
}

/// Summarise the Zotero annotations cached on a shared paper's `metadata.annotations`.
#[must_use]
pub fn shared_paper_annotation_summary(
    metadata: Option<&serde_json::Value>,
) -> SharedPaperAnnotationSummary {
    let annotations: Vec<ZoteroAnnotationInput> = metadata
        .and_then(|m| m.get("annotations"))
        .and_then(|a| serde_json::from_value(a.clone()).ok())
        .unwrap_or_default();
    let projected = project_zotero_annotations(&annotations, None, None);
    let samples = projected
        .iter()
        .map(|a| {
            if a.text.is_empty() {
                &a.comment
            } else {
                &a.text
            }
        })
        .map(|s| js_trim(s).to_owned())
        .filter(|s| !s.is_empty())
        .take(3)
        .collect();
    SharedPaperAnnotationSummary {
        count: projected.len(),
        samples,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(title: &str, status: Option<&str>) -> SharedSource {
        SharedSource {
            title: title.to_owned(),
            status: status.map(str::to_owned),
        }
    }

    #[test]
    fn share_from_row_maps_snake_case_to_camel_case() {
        let row = ShareRow {
            id: "s1".into(),
            owner_id: "o1".into(),
            recipient_id: "r1".into(),
            resource_type: ShareableType::VaultPage,
            resource_id: None,
            access: ShareAccess::Comment,
            created_at: "2026-01-02T00:00:00Z".into(),
        };
        let share = share_from_row(&row);
        assert_eq!(share.owner_id, "o1");
        assert_eq!(share.recipient_id, "r1");
        assert_eq!(share.resource_id, None);
        assert_eq!(share.access, ShareAccess::Comment);
        assert_eq!(share.created_at, "2026-01-02T00:00:00Z");
    }

    #[test]
    fn comment_from_row_builds_anchor_only_for_a_non_empty_quote() {
        let mut row = CommentRow {
            id: "c1".into(),
            author_id: "a1".into(),
            resource_type: "paper".into(),
            resource_id: "p1".into(),
            body: "hi".into(),
            created_at: "t".into(),
            anchor_quote: Some("quoted".into()),
            anchor_prefix: None,
            anchor_suffix: Some("after".into()),
            parent_id: None,
            resolved_at: None,
        };
        let anchored = comment_from_row(&row);
        assert_eq!(
            anchored.anchor,
            Some(CommentAnchor {
                quote: "quoted".into(),
                prefix: String::new(),
                suffix: "after".into(),
            })
        );
        assert_eq!(anchored.parent_id, None);
        assert_eq!(anchored.resolved_at, None);

        row.anchor_quote = Some(String::new());
        assert_eq!(comment_from_row(&row).anchor, None);
        row.anchor_quote = None;
        assert_eq!(comment_from_row(&row).anchor, None);
    }

    #[test]
    fn shared_item_falls_back_like_the_ts_mapping() {
        let row = serde_json::json!({ "id": 7, "title": null, "status": "open", "user_id": "u1" });
        let item = shared_item(
            ShareableType::Experiment,
            &row,
            &source("name", Some("status")),
        );
        assert_eq!(item.id, "7");
        assert_eq!(item.title, "(untitled)");
        assert_eq!(item.status, "open");
        assert_eq!(item.owner_id, "u1");
        assert_eq!(item.metadata, None);

        let no_status = shared_item(ShareableType::ReadingList, &row, &source("title", None));
        assert_eq!(no_status.status, "");
    }

    #[test]
    fn shared_item_keeps_paper_metadata_only_for_papers() {
        let row = serde_json::json!({ "id": "p", "title": "T", "user_id": "u", "metadata": { "doi": "x" } });
        let paper = shared_item(ShareableType::Paper, &row, &source("title", Some("status")));
        assert_eq!(paper.title, "T");
        assert_eq!(paper.metadata, Some(serde_json::json!({ "doi": "x" })));
        let vault = shared_item(ShareableType::VaultPage, &row, &source("title", None));
        assert_eq!(vault.metadata, None);
    }

    #[test]
    fn share_link_token_round_trips_unpadded_base64url() {
        for len in 0..40_u8 {
            let bytes: Vec<u8> = (0..len)
                .map(|i| i.wrapping_mul(97).wrapping_add(250))
                .collect();
            let enc = encode_share_link_token(&bytes);
            assert!(!enc.contains(['=', '+', '/']), "{enc}");
            assert_eq!(decode_share_link_token(&enc).unwrap(), bytes);
        }
        assert_eq!(encode_share_link_token(&[0xfb, 0xff]), "-_8");
        assert_eq!(encode_share_link_token(&[0_u8; 32]).len(), 43);
        assert_eq!(decode_share_link_token("-_8=").unwrap(), vec![0xfb, 0xff]);
        assert_eq!(decode_share_link_token("+/8").unwrap(), vec![0xfb, 0xff]);
    }

    #[test]
    fn share_link_token_rejects_what_atob_rejects() {
        assert!(decode_share_link_token("a").is_err());
        assert!(decode_share_link_token("ab$c").is_err());
        assert!(decode_share_link_token("ab===").is_err());
    }

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

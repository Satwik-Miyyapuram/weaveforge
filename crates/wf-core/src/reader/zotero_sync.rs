//! R5 Zotero write-back: sync decisions, field diffs, conflict merges and write payloads.
//! A faithful port of packages/core/src/reader/zotero-write-back.ts.
//!
//! Stays in TS: `DryRunZoteroAnnotationWriteBack` and `IZoteroAnnotationWriteBack`
//! (async `push` through an injected write port, with the `live` guard).

use super::anchor::AnchorCombinedPdf;
use crate::sync::frontmatter::js_number;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Per-library write-back mode (TS `ZoteroLibrarySyncMode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZoteroSyncLibraryMode {
    /// `bidirectional`.
    Bidirectional,
    /// `read_only`.
    ReadOnly,
    /// `ignored`.
    Ignored,
}

impl ZoteroSyncLibraryMode {
    /// The mode for a JS string. Unknown strings act as `bidirectional`, as the TS checks do.
    #[must_use]
    pub fn from_js(value: &str) -> Self {
        match value {
            "ignored" => Self::Ignored,
            "read_only" => Self::ReadOnly,
            _ => Self::Bidirectional,
        }
    }
}

/// Whether `value` is a library sync mode (TS `isZoteroLibrarySyncMode`).
#[must_use]
pub fn is_zotero_library_sync_mode(value: &str) -> bool {
    matches!(value, "bidirectional" | "read_only" | "ignored")
}

/// Zotero's annotation provenance (TS `AnnotationOrigin`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ZoteroAnnotationOrigin {
    /// Pulled from Zotero.
    Zotero,
    /// Made in this app.
    Local,
}

/// Zotero's annotation types (TS `ReaderAnnotationType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ZoteroAnnotationType {
    /// Text highlight.
    Highlight,
    /// Text underline.
    Underline,
    /// Note.
    Note,
    /// Image region.
    Image,
    /// Pen ink.
    Ink,
    /// Text box.
    Text,
}

/// R5 write-back state of a local row (TS `AnnotationSyncState`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ZoteroAnnotationSyncState {
    /// Never synced.
    Local,
    /// In step with Zotero.
    Synced,
    /// Edited since the last sync.
    Pending,
    /// Needs a conflict resolution.
    Conflict,
}

/// `null` stays `Some(None)`, a missing key stays `None` (TS `zoteroVersion?: number | null`).
fn deserialize_double_option<'de, D>(deserializer: D) -> Result<Option<Option<f64>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<f64>::deserialize(deserializer).map(Some)
}

/// A local reader annotation with its R5 bookkeeping (TS `ReaderAnnotation` and the
/// `AnnotationSyncRow.local` shape). Both sync fields are optional here; the TS
/// row requires them, and a missing value behaves as the TS `undefined` does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationLocal {
    /// Local row id.
    pub id: String,
    /// Where the row came from.
    pub origin: ZoteroAnnotationOrigin,
    /// Zotero item key when pulled from Zotero; `null` for local-only rows.
    pub zotero_key: Option<String>,
    /// Annotation type (`type` in TS).
    #[serde(rename = "type")]
    pub kind: ZoteroAnnotationType,
    /// Colour as written.
    pub color: String,
    /// Selected text.
    pub text: String,
    /// Researcher comment.
    pub comment: String,
    /// Tags, in order.
    pub tags: Vec<String>,
    /// Rects and locus.
    pub anchor: AnchorCombinedPdf,
    /// Zotero's ordering key.
    pub sort_index: String,
    /// ISO creation time.
    pub created_at: String,
    /// ISO update time.
    pub updated_at: String,
    /// Absent until sync touches the row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_state: Option<ZoteroAnnotationSyncState>,
    /// Absent, `null`, or Zotero's version for the item.
    #[serde(
        default,
        deserialize_with = "deserialize_double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub zotero_version: Option<Option<f64>>,
}

/// The Zotero-side copy of an annotation (TS `ZoteroAnnotationRemote`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationRemote {
    /// Zotero item key.
    pub key: String,
    /// Zotero item version.
    pub version: f64,
    /// Annotation type (`type` in TS).
    #[serde(rename = "type")]
    pub kind: ZoteroAnnotationType,
    /// Colour as written.
    pub color: String,
    /// Selected text.
    pub text: String,
    /// Comment.
    pub comment: String,
    /// Tags, in order.
    pub tags: Vec<String>,
    /// Rects and locus.
    pub anchor: AnchorCombinedPdf,
    /// Zotero's ordering key.
    pub sort_index: String,
    /// ISO update time.
    pub updated_at: String,
}

/// One local annotation with its Zotero counterpart, if any (TS `AnnotationSyncRow`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationSyncRow {
    /// The local row.
    pub local: ZoteroAnnotationLocal,
    /// The Zotero copy, or `null`.
    #[serde(default)]
    pub remote: Option<ZoteroAnnotationRemote>,
}

/// A field a sync can compare (TS `AnnotationConflictField`), in TS comparison order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ZoteroAnnotationField {
    /// Colour.
    Color,
    /// Selected text.
    Text,
    /// Comment.
    Comment,
    /// Tags.
    Tags,
    /// Anchor.
    Anchor,
    /// Annotation type.
    Type,
    /// Sort index.
    SortIndex,
}

/// The fields in TS `COMPARABLE_FIELDS` order.
const COMPARABLE_FIELDS: [ZoteroAnnotationField; 7] = [
    ZoteroAnnotationField::Color,
    ZoteroAnnotationField::Text,
    ZoteroAnnotationField::Comment,
    ZoteroAnnotationField::Tags,
    ZoteroAnnotationField::Anchor,
    ZoteroAnnotationField::Type,
    ZoteroAnnotationField::SortIndex,
];

/// A field value on one side of a conflict (TS `unknown` in `AnnotationFieldConflict`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ZoteroAnnotationFieldValue {
    /// A string field.
    Text(String),
    /// The tag list.
    Tags(Vec<String>),
    /// The annotation type.
    Kind(ZoteroAnnotationType),
    /// The anchor.
    Anchor(Box<AnchorCombinedPdf>),
}

/// One differing field (TS `AnnotationFieldConflict`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationFieldConflict {
    /// Which field differs.
    pub field: ZoteroAnnotationField,
    /// Local value.
    pub local: ZoteroAnnotationFieldValue,
    /// Remote value.
    pub remote: ZoteroAnnotationFieldValue,
}

/// What a sync should do with one annotation (TS `AnnotationSyncDecision`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ZoteroAnnotationDecision {
    /// Send the local row.
    Push {
        /// Why.
        reason: String,
    },
    /// Take the remote row.
    Pull {
        /// Why.
        reason: String,
    },
    /// Nothing to do.
    Noop {
        /// Why.
        reason: String,
    },
    /// Fields differ in a way that needs a choice.
    Conflict {
        /// The differing fields.
        fields: Vec<ZoteroAnnotationFieldConflict>,
        /// Why.
        reason: String,
    },
    /// Leave the row alone.
    Skip {
        /// Why.
        reason: String,
    },
}

/// The local side of a comparable field.
fn local_value(
    local: &ZoteroAnnotationLocal,
    field: ZoteroAnnotationField,
) -> ZoteroAnnotationFieldValue {
    match field {
        ZoteroAnnotationField::Color => ZoteroAnnotationFieldValue::Text(local.color.clone()),
        ZoteroAnnotationField::Text => ZoteroAnnotationFieldValue::Text(local.text.clone()),
        ZoteroAnnotationField::Comment => ZoteroAnnotationFieldValue::Text(local.comment.clone()),
        ZoteroAnnotationField::Tags => ZoteroAnnotationFieldValue::Tags(local.tags.clone()),
        ZoteroAnnotationField::Anchor => {
            ZoteroAnnotationFieldValue::Anchor(Box::new(local.anchor.clone()))
        }
        ZoteroAnnotationField::Type => ZoteroAnnotationFieldValue::Kind(local.kind),
        ZoteroAnnotationField::SortIndex => {
            ZoteroAnnotationFieldValue::Text(local.sort_index.clone())
        }
    }
}

/// The remote side of [`local_value`].
fn remote_value(
    remote: &ZoteroAnnotationRemote,
    field: ZoteroAnnotationField,
) -> ZoteroAnnotationFieldValue {
    match field {
        ZoteroAnnotationField::Color => ZoteroAnnotationFieldValue::Text(remote.color.clone()),
        ZoteroAnnotationField::Text => ZoteroAnnotationFieldValue::Text(remote.text.clone()),
        ZoteroAnnotationField::Comment => ZoteroAnnotationFieldValue::Text(remote.comment.clone()),
        ZoteroAnnotationField::Tags => ZoteroAnnotationFieldValue::Tags(remote.tags.clone()),
        ZoteroAnnotationField::Anchor => {
            ZoteroAnnotationFieldValue::Anchor(Box::new(remote.anchor.clone()))
        }
        ZoteroAnnotationField::Type => ZoteroAnnotationFieldValue::Kind(remote.kind),
        ZoteroAnnotationField::SortIndex => {
            ZoteroAnnotationFieldValue::Text(remote.sort_index.clone())
        }
    }
}

/// The JSON form of a value. Key order is ignored by `Value` equality and NaN
/// reads as `null`, as `JSON.stringify` does in the TS `valuesEqual`.
fn field_json(value: &ZoteroAnnotationFieldValue) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// Diff local vs remote annotation fields (TS `diffAnnotationFields`). Empty without a remote.
#[must_use]
pub fn diff_annotation_fields(row: &ZoteroAnnotationSyncRow) -> Vec<ZoteroAnnotationFieldConflict> {
    let Some(remote) = &row.remote else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for field in COMPARABLE_FIELDS {
        let local = local_value(&row.local, field);
        let remote = remote_value(remote, field);
        if field_json(&local) != field_json(&remote) {
            out.push(ZoteroAnnotationFieldConflict {
                field,
                local,
                remote,
            });
        }
    }
    out
}

/// Decide push/pull/conflict for one annotation given library mode and versions
/// (TS `decideAnnotationSync`). Never mutates.
#[must_use]
pub fn decide_annotation_sync(
    row: &ZoteroAnnotationSyncRow,
    mode: ZoteroSyncLibraryMode,
) -> ZoteroAnnotationDecision {
    match mode {
        ZoteroSyncLibraryMode::Ignored => ZoteroAnnotationDecision::Skip {
            reason: "Library sync mode is ignored.".to_owned(),
        },
        ZoteroSyncLibraryMode::ReadOnly => decide_read_only(row),
        ZoteroSyncLibraryMode::Bidirectional => decide_bidirectional(row),
    }
}

/// The `read_only` branch of [`decide_annotation_sync`].
fn decide_read_only(row: &ZoteroAnnotationSyncRow) -> ZoteroAnnotationDecision {
    if row.remote.is_none() {
        return ZoteroAnnotationDecision::Skip {
            reason: "Read-only library; local-only annotation is not pushed.".to_owned(),
        };
    }
    if diff_annotation_fields(row).is_empty() {
        return ZoteroAnnotationDecision::Noop {
            reason: "Already matches remote.".to_owned(),
        };
    }
    ZoteroAnnotationDecision::Pull {
        reason: "Read-only library accepts remote.".to_owned(),
    }
}

/// The `bidirectional` branch of [`decide_annotation_sync`].
fn decide_bidirectional(row: &ZoteroAnnotationSyncRow) -> ZoteroAnnotationDecision {
    let Some(remote) = &row.remote else {
        return ZoteroAnnotationDecision::Push {
            reason: "No remote counterpart; push local.".to_owned(),
        };
    };
    let fields = diff_annotation_fields(row);
    if fields.is_empty() {
        return ZoteroAnnotationDecision::Noop {
            reason: "Local and remote are identical.".to_owned(),
        };
    }
    let Some(local_version) = row.local.zotero_version.flatten() else {
        return ZoteroAnnotationDecision::Conflict {
            fields,
            reason: "Local never synced but remote exists; resolve field conflicts.".to_owned(),
        };
    };
    let remote_version = remote.version;
    if remote_version > local_version {
        if matches!(
            row.local.sync_state,
            Some(ZoteroAnnotationSyncState::Pending | ZoteroAnnotationSyncState::Conflict)
        ) {
            return ZoteroAnnotationDecision::Conflict {
                fields,
                reason: "Remote version ahead while local has pending edits.".to_owned(),
            };
        }
        return ZoteroAnnotationDecision::Pull {
            reason: "Remote version is newer.".to_owned(),
        };
    }
    if remote_version < local_version {
        return ZoteroAnnotationDecision::Conflict {
            fields,
            reason: "Local version is ahead of remote (unexpected); resolve manually.".to_owned(),
        };
    }
    ZoteroAnnotationDecision::Conflict {
        fields,
        reason: "Same zotero_version but fields diverge.".to_owned(),
    }
}

/// Apply a conflict choice (TS `resolveAnnotationConflict`). `keep_local` and
/// `accept_remote` are exact; any other choice merges, as the TS fall-through does.
#[must_use]
pub fn resolve_annotation_conflict(
    row: &ZoteroAnnotationSyncRow,
    choice: &str,
) -> ZoteroAnnotationLocal {
    let Some(remote) = &row.remote else {
        return row.local.clone();
    };
    match choice {
        "keep_local" => row.local.clone(),
        "accept_remote" => {
            let mut out = row.local.clone();
            out.kind = remote.kind;
            out.color = remote.color.clone();
            out.text = remote.text.clone();
            out.comment = remote.comment.clone();
            out.tags = remote.tags.clone();
            out.anchor = remote.anchor.clone();
            out.sort_index = remote.sort_index.clone();
            out.zotero_key = Some(remote.key.clone());
            out.updated_at = remote.updated_at.clone();
            out
        }
        _ => {
            // Local comment and tags are kept: researcher prose wins over Zotero.
            let fields = diff_annotation_fields(row);
            let changed = |field: ZoteroAnnotationField| fields.iter().any(|f| f.field == field);
            let mut merged = row.local.clone();
            merged.zotero_key = Some(remote.key.clone());
            if changed(ZoteroAnnotationField::Color) {
                merged.color = remote.color.clone();
            }
            if changed(ZoteroAnnotationField::Text) {
                merged.text = remote.text.clone();
            }
            // The anchor follows Zotero's with the text: together they mark one span.
            if changed(ZoteroAnnotationField::Anchor) {
                merged.anchor = remote.anchor.clone();
            }
            merged
        }
    }
}

/// Payload for a Zotero Web API annotation create/update (TS `ZoteroAnnotationWritePayload`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationWritePayload {
    /// Always `annotation`.
    pub item_type: String,
    /// Parent item key.
    pub parent_item: String,
    /// Annotation type.
    pub annotation_type: ZoteroAnnotationType,
    /// Only on highlights and underlines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation_text: Option<String>,
    /// Comment.
    pub annotation_comment: String,
    /// Colour.
    pub annotation_color: String,
    /// Sort index.
    pub annotation_sort_index: String,
    /// `JSON.stringify` of the Zotero position, as a string.
    pub annotation_position: String,
    /// Tags as `{ tag }` objects.
    pub tags: Vec<ZoteroAnnotationTag>,
}

/// One tag in a write payload (TS `{ tag: string }`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationTag {
    /// Tag text.
    pub tag: String,
}

/// A number as `JSON.stringify` writes it: non-finite values become `null`.
fn json_number(n: f64) -> String {
    if n.is_finite() {
        js_number(n)
    } else {
        "null".to_owned()
    }
}

/// A `[[..], [..]]` matrix of numbers.
fn json_matrix(rows: &[Vec<f64>]) -> String {
    let rows: Vec<String> = rows
        .iter()
        .map(|row| {
            let cells: Vec<String> = row.iter().map(|&n| json_number(n)).collect();
            format!("[{}]", cells.join(","))
        })
        .collect();
    format!("[{}]", rows.join(","))
}

/// `JSON.stringify(anchor.zoteroPosition ?? {})`: fields in struct order, absent fields dropped.
fn zotero_position_json(anchor: &AnchorCombinedPdf) -> String {
    let Some(pos) = &anchor.zotero_position else {
        return "{}".to_owned();
    };
    let mut parts: Vec<String> = Vec::new();
    if let Some(page) = pos.page_index {
        parts.push(format!("\"pageIndex\":{}", json_number(page)));
    }
    if let Some(rects) = &pos.rects {
        parts.push(format!("\"rects\":{}", json_matrix(rects)));
    }
    if let Some(paths) = &pos.paths {
        parts.push(format!("\"paths\":{}", json_matrix(paths)));
    }
    if let Some(width) = pos.width {
        parts.push(format!("\"width\":{}", json_number(width)));
    }
    if let Some(rects) = &pos.next_page_rects {
        parts.push(format!("\"nextPageRects\":{}", json_matrix(rects)));
    }
    format!("{{{}}}", parts.join(","))
}

/// Payload for one annotation (TS `toZoteroWritePayload`).
#[must_use]
pub fn to_zotero_write_payload(
    ann: &ZoteroAnnotationLocal,
    parent_item_key: &str,
) -> ZoteroAnnotationWritePayload {
    let text_bearing = matches!(
        ann.kind,
        ZoteroAnnotationType::Highlight | ZoteroAnnotationType::Underline
    );
    ZoteroAnnotationWritePayload {
        item_type: "annotation".to_owned(),
        parent_item: parent_item_key.to_owned(),
        annotation_type: ann.kind,
        annotation_text: text_bearing.then(|| ann.text.clone()),
        annotation_comment: ann.comment.clone(),
        annotation_color: ann.color.clone(),
        annotation_sort_index: ann.sort_index.clone(),
        annotation_position: zotero_position_json(&ann.anchor),
        tags: ann
            .tags
            .iter()
            .map(|tag| ZoteroAnnotationTag { tag: tag.clone() })
            .collect(),
    }
}

/// Indices of the annotations a write-back sends: everything but ink, and only
/// those with a PDF page (TS `zoteroWriteBackAnnotations`). Indices, so the
/// caller keeps its own objects, as the TS filter does.
#[must_use]
pub fn zotero_write_back_annotations(annotations: &[ZoteroAnnotationLocal]) -> Vec<usize> {
    annotations
        .iter()
        .enumerate()
        .filter(|(_, ann)| {
            ann.kind != ZoteroAnnotationType::Ink
                && ann
                    .anchor
                    .zotero_position
                    .as_ref()
                    .and_then(|pos| pos.page_index)
                    .is_some()
        })
        .map(|(i, _)| i)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::anchor::AnchorZoteroPosition;
    use super::*;

    fn anchor_rects(page: f64, rects: Vec<Vec<f64>>) -> AnchorCombinedPdf {
        AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(page),
                rects: Some(rects),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn base_local() -> ZoteroAnnotationLocal {
        ZoteroAnnotationLocal {
            id: "local-1".to_owned(),
            origin: ZoteroAnnotationOrigin::Local,
            zotero_key: None,
            kind: ZoteroAnnotationType::Highlight,
            color: "#ffd400".to_owned(),
            text: "hello".to_owned(),
            comment: String::new(),
            tags: Vec::new(),
            anchor: anchor_rects(0.0, vec![vec![1.0, 2.0, 3.0, 4.0]]),
            sort_index: "00000|000000|00000".to_owned(),
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            updated_at: "2026-01-01T00:00:00.000Z".to_owned(),
            sync_state: None,
            zotero_version: None,
        }
    }

    fn remote_of(local: &ZoteroAnnotationLocal) -> ZoteroAnnotationRemote {
        ZoteroAnnotationRemote {
            key: "K".to_owned(),
            version: 2.0,
            kind: local.kind,
            color: local.color.clone(),
            text: local.text.clone(),
            comment: local.comment.clone(),
            tags: local.tags.clone(),
            anchor: local.anchor.clone(),
            sort_index: local.sort_index.clone(),
            updated_at: "2026-01-04T00:00:00.000Z".to_owned(),
        }
    }

    fn row(
        local: ZoteroAnnotationLocal,
        remote: Option<ZoteroAnnotationRemote>,
    ) -> ZoteroAnnotationSyncRow {
        ZoteroAnnotationSyncRow { local, remote }
    }

    fn conflict_fields(decision: &ZoteroAnnotationDecision) -> Vec<ZoteroAnnotationField> {
        match decision {
            ZoteroAnnotationDecision::Conflict { fields, .. } => {
                fields.iter().map(|f| f.field).collect()
            }
            _ => Vec::new(),
        }
    }

    #[test]
    fn library_sync_mode_guard() {
        assert!(is_zotero_library_sync_mode("bidirectional"));
        assert!(!is_zotero_library_sync_mode("write"));
    }

    #[test]
    fn decide_pushes_local_only_in_bidirectional() {
        let mut local = base_local();
        local.sync_state = Some(ZoteroAnnotationSyncState::Local);
        let decision =
            decide_annotation_sync(&row(local, None), ZoteroSyncLibraryMode::Bidirectional);
        assert!(matches!(decision, ZoteroAnnotationDecision::Push { .. }));
    }

    #[test]
    fn decide_skips_push_in_read_only_and_ignored() {
        let mut local = base_local();
        local.sync_state = Some(ZoteroAnnotationSyncState::Local);
        let local_only = row(local, None);
        assert!(matches!(
            decide_annotation_sync(&local_only, ZoteroSyncLibraryMode::ReadOnly),
            ZoteroAnnotationDecision::Skip { .. }
        ));
        assert!(matches!(
            decide_annotation_sync(&local_only, ZoteroSyncLibraryMode::Ignored),
            ZoteroAnnotationDecision::Skip { .. }
        ));
    }

    #[test]
    fn decide_conflicts_when_same_version_diverges() {
        let mut local = base_local();
        local.color = "#ff6666".to_owned();
        local.zotero_key = Some("ABCD".to_owned());
        local.sync_state = Some(ZoteroAnnotationSyncState::Pending);
        local.zotero_version = Some(Some(3.0));
        let mut remote = remote_of(&local);
        remote.version = 3.0;
        remote.color = "#ffd400".to_owned();
        let decision = decide_annotation_sync(
            &row(local, Some(remote)),
            ZoteroSyncLibraryMode::Bidirectional,
        );
        assert!(matches!(
            decision,
            ZoteroAnnotationDecision::Conflict { .. }
        ));
        assert!(conflict_fields(&decision).contains(&ZoteroAnnotationField::Color));
    }

    #[test]
    fn decide_pulls_when_remote_ahead_and_local_clean() {
        let mut local = base_local();
        local.zotero_key = Some("ABCD".to_owned());
        local.sync_state = Some(ZoteroAnnotationSyncState::Synced);
        local.zotero_version = Some(Some(2.0));
        let mut remote = remote_of(&local);
        remote.version = 4.0;
        remote.color = "#2ea8e5".to_owned();
        remote.comment = "remote".to_owned();
        let decision = decide_annotation_sync(
            &row(local, Some(remote)),
            ZoteroSyncLibraryMode::Bidirectional,
        );
        assert!(matches!(decision, ZoteroAnnotationDecision::Pull { .. }));
    }

    #[test]
    fn diff_and_resolve_conflict() {
        let mut local = base_local();
        local.comment = "mine".to_owned();
        local.zotero_key = Some("K".to_owned());
        local.sync_state = Some(ZoteroAnnotationSyncState::Conflict);
        local.zotero_version = Some(Some(1.0));
        let mut remote = remote_of(&local);
        remote.version = 2.0;
        remote.color = "#ff6666".to_owned();
        remote.comment = "theirs".to_owned();
        remote.tags = vec!["a".to_owned()];
        let sync_row = row(local, Some(remote));
        assert!(diff_annotation_fields(&sync_row).len() >= 2);
        assert_eq!(
            resolve_annotation_conflict(&sync_row, "keep_local").comment,
            "mine"
        );
        let accepted = resolve_annotation_conflict(&sync_row, "accept_remote");
        assert_eq!(accepted.color, "#ff6666");
        assert_eq!(accepted.comment, "theirs");
        let merged = resolve_annotation_conflict(&sync_row, "merge");
        assert_eq!(merged.color, "#ff6666");
        assert_eq!(merged.comment, "mine");
    }

    #[test]
    fn payload_has_parent_and_empty_tags() {
        let payload = to_zotero_write_payload(&base_local(), "PARENT");
        assert_eq!(payload.parent_item, "PARENT");
        assert!(payload.tags.is_empty());
        assert_eq!(
            payload.annotation_position,
            "{\"pageIndex\":0,\"rects\":[[1,2,3,4]]}"
        );
    }

    #[test]
    fn write_back_sends_marks_and_never_strokes() {
        let mut stroke = base_local();
        stroke.id = "stroke".to_owned();
        stroke.kind = ZoteroAnnotationType::Ink;
        stroke.anchor = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                paths: Some(vec![vec![1.0, 2.0, 3.0, 4.0]]),
                width: Some(2.0),
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut hl = base_local();
        hl.id = "hl".to_owned();
        let mut ul = base_local();
        ul.id = "ul".to_owned();
        ul.kind = ZoteroAnnotationType::Underline;
        let mut note = base_local();
        note.id = "note".to_owned();
        note.kind = ZoteroAnnotationType::Note;
        let annotations = vec![hl, ul, note, stroke];
        let kept: Vec<&ZoteroAnnotationLocal> = zotero_write_back_annotations(&annotations)
            .into_iter()
            .map(|i| &annotations[i])
            .collect();
        let ids: Vec<&str> = kept.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, ["hl", "ul", "note"]);
        let types: Vec<ZoteroAnnotationType> = kept
            .iter()
            .map(|a| to_zotero_write_payload(a, "PARENT").annotation_type)
            .collect();
        assert_eq!(
            types,
            [
                ZoteroAnnotationType::Highlight,
                ZoteroAnnotationType::Underline,
                ZoteroAnnotationType::Note
            ]
        );
    }

    #[test]
    fn merge_takes_remote_anchor_with_remote_text() {
        let mut local = base_local();
        local.zotero_key = Some("K".to_owned());
        let moved = anchor_rects(1.0, vec![vec![5.0, 6.0, 7.0, 8.0]]);
        let mut both = remote_of(&local);
        both.text = "hello world".to_owned();
        both.anchor = moved.clone();
        let merged_both = resolve_annotation_conflict(&row(local.clone(), Some(both)), "merge");
        assert_eq!(merged_both.text, "hello world");
        assert_eq!(merged_both.anchor, moved);

        let mut anchor_only = remote_of(&local);
        anchor_only.anchor = moved.clone();
        let merged_anchor =
            resolve_annotation_conflict(&row(local.clone(), Some(anchor_only)), "merge");
        assert_eq!(merged_anchor.text, "hello");
        assert_eq!(merged_anchor.anchor, moved);

        let mut neither = remote_of(&local);
        neither.color = "#000000".to_owned();
        let merged_neither =
            resolve_annotation_conflict(&row(local.clone(), Some(neither)), "merge");
        assert_eq!(merged_neither.anchor, local.anchor);
    }

    #[test]
    fn key_order_alone_is_not_a_conflict() {
        let mut local = base_local();
        local.zotero_key = Some("K".to_owned());
        let same = remote_of(&local);
        assert!(diff_annotation_fields(&row(local.clone(), Some(same))).is_empty());

        let mut flipped = remote_of(&local);
        flipped.anchor = anchor_rects(0.0, vec![vec![4.0, 3.0, 2.0, 1.0]]);
        let fields: Vec<ZoteroAnnotationField> =
            diff_annotation_fields(&row(local.clone(), Some(flipped)))
                .iter()
                .map(|f| f.field)
                .collect();
        assert_eq!(fields, [ZoteroAnnotationField::Anchor]);

        let mut tags_flipped = base_local();
        tags_flipped.zotero_key = Some("K".to_owned());
        tags_flipped.tags = vec!["a".to_owned(), "b".to_owned()];
        let mut remote_tags = remote_of(&tags_flipped);
        remote_tags.tags = vec!["b".to_owned(), "a".to_owned()];
        let fields: Vec<ZoteroAnnotationField> =
            diff_annotation_fields(&row(tags_flipped, Some(remote_tags)))
                .iter()
                .map(|f| f.field)
                .collect();
        assert_eq!(fields, [ZoteroAnnotationField::Tags]);
    }
}

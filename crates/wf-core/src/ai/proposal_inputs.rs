//! Per-kind readers for AI write proposals (TS `createAiProposalExecutors` in
//! `apps/web/src/features/ai-assistant/application/parts.ts`).
//!
//! Each reader checks a payload and returns the input the host use case takes, or the TS
//! error message. Conflict checks, the database, dispatch and the ink-note check stay in TS.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::ai::proposal_payload::{
    enum_value, js_trim, object, optional_number, optional_text, optional_year, record,
    string_list, text,
};
use crate::papers::paper_field::{
    PaperFieldKind, PaperFieldValueData, PaperFieldValueInput, paper_field_value_refusal,
    parse_paper_field_value,
};

/// Milestone statuses (TS `MILESTONE_STATUSES`, `packages/core/src/features/plan/domain/parts.ts`).
pub const MILESTONE_STATUSES: &[&str] = &["planned", "in_progress", "done", "blocked"];
/// Experiment statuses (TS `EXPERIMENT_STATUSES`, `packages/core/src/features/experiments/domain/parts.ts`).
pub const EXPERIMENT_STATUSES: &[&str] = &["planned", "running", "done", "failed", "abandoned"];
const PAPER_STATUSES: &[&str] = &["to_read", "reading", "read", "skimmed"];
const RELATIONS: &[&str] = &[
    "cites",
    "extends",
    "contradicts",
    "similar",
    "builds_on",
    "uses_method",
];
const LOG_KINDS: &[&str] = &["daily", "weekly"];
const ANNOTATION_TYPES: &[&str] = &["highlight", "note"];
const DEFAULT_ANNOTATION_COLOR: &str = "#ffd400";

/// `create_vault_note`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct VaultNoteInput {
    /// Note title.
    pub title: String,
    /// Note body.
    pub body: String,
    /// Parent note id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

/// `create_log_entry`. `kind` is left to the host when absent, as in TS.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ProposalLogEntryInput"))]
pub struct LogEntryInput {
    /// Entry text.
    pub body: String,
    /// Date of the entry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_date: Option<String>,
    /// Entry kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// `paper_update`: at least one of the three fields is present.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperUpdateInput {
    /// New status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// New rating.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    /// New tags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// One paper-field definition, as the host lists it (only the fields the check needs).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperFieldDefInput {
    /// Field id.
    pub id: String,
    /// Field name.
    pub name: String,
    /// Field type.
    pub kind: PaperFieldKind,
    /// Allowed options, for choice fields.
    #[serde(default)]
    pub options: Vec<String>,
}

/// `paper_field_value`: the field to write and the checked value.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperFieldFillInput {
    /// Id of the field to write.
    pub field_id: String,
    /// The checked value.
    pub value: PaperFieldValueData,
}

/// The target of a reading-list change: exactly one paper or one vault note.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ReadingListTarget {
    /// A paper, by id.
    Paper(String),
    /// A vault note, by id.
    Note(String),
}

/// `reading_list_change`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReadingListChangeInput {
    /// Id of the reading list.
    pub list_id: String,
    /// Note on the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// What the change applies to.
    pub target: ReadingListTarget,
}

/// `relation`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelationInput {
    /// Id of the paper the relation starts at.
    pub from_paper: String,
    /// Id of the paper the relation points to.
    pub to_paper: String,
    /// Relation type.
    pub relation: String,
}

/// `zotero_import`: the paper fields a Zotero draft may set.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ProposalZoteroPaperInput"))]
pub struct ZoteroPaperInput {
    /// Paper title.
    pub title: String,
    /// Author names.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    /// Publication year.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<f64>,
    /// DOI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    /// Paper URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Abstract text.
    #[serde(rename = "abstract", skip_serializing_if = "Option::is_none")]
    pub abstract_text: Option<String>,
}

/// `milestone_follow_up`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ProposalMilestoneInput"))]
pub struct MilestoneInput {
    /// Milestone title.
    pub title: String,
    /// Milestone description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Milestone status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Target date.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
}

/// `experiment_follow_up`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExperimentFollowUpInput {
    /// Experiment name.
    pub name: String,
    /// The experiment's hypothesis.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hypothesis: Option<String>,
    /// Experiment status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Id of the related paper.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_paper: Option<String>,
}

/// `edit_vault_note`: the title and/or body to set. The body is kept as sent (untrimmed).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct VaultNoteEditInput {
    /// New title, when changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// New body, when changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// `experiment_update`. Metrics are a free-form object, so no specta derive (TS types them as a record).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentUpdateInput {
    /// New status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Metrics to set, keyed by name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<Map<String, Value>>,
    /// Artifacts to set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifacts: Option<Vec<String>>,
}

/// A quote selector: the reader finds the words on the page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct QuoteSelector {
    /// Selector type.
    #[serde(rename = "type")]
    pub kind: String,
    /// The exact words to find on the page.
    pub exact: String,
}

/// The locus of a quote: the selector that finds it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct QuoteLocus {
    /// The quote selector.
    pub quote: QuoteSelector,
}

/// The anchor of a quote: the locus that holds it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct QuoteAnchor {
    /// Where the quote sits in the document.
    pub locus: QuoteLocus,
}

/// `paper_annotation`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperAnnotationInput {
    /// Annotation kind.
    #[serde(rename = "type")]
    pub kind: String,
    /// Mark colour.
    pub color: String,
    /// Quoted text.
    pub text: String,
    /// The reader's note on the mark.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Where the mark sits in the document.
    pub anchor: QuoteAnchor,
    /// Page the mark sits on.
    pub page_index: f64,
}

/// `append_paper_note`: the addition, falling back to the proposal's own content (TS `payload.addition`).
#[must_use]
pub fn paper_note_addition(payload: &Value, content: &str) -> String {
    payload
        .get("addition")
        .and_then(Value::as_str)
        .map_or_else(|| content.to_owned(), str::to_owned)
}

/// `create_vault_note`.
pub fn vault_note(payload: &Value) -> Result<VaultNoteInput, String> {
    let map = object(payload)?;
    Ok(VaultNoteInput {
        title: text(map, "title")?,
        body: text(map, "body")?,
        parent_id: optional_text(map, "parentId"),
    })
}

/// `create_log_entry`.
pub fn log_entry(payload: &Value) -> Result<LogEntryInput, String> {
    let map = object(payload)?;
    Ok(LogEntryInput {
        body: text(map, "body")?,
        entry_date: optional_text(map, "entryDate"),
        kind: enum_value(map, "kind", LOG_KINDS)?.map(str::to_owned),
    })
}

/// `paper_update`.
pub fn paper_update(payload: &Value) -> Result<PaperUpdateInput, String> {
    let map = object(payload)?;
    let input = PaperUpdateInput {
        status: enum_value(map, "status", PAPER_STATUSES)?.map(str::to_owned),
        rating: optional_number(map, "rating")?,
        tags: string_list(map, "tags")?,
    };
    if input.status.is_none() && input.rating.is_none() && input.tags.is_none() {
        return Err("Paper update proposal contains no allowed changes.".to_owned());
    }
    Ok(input)
}

/// The `fieldId` of a `paper_field_value` payload. The host reads the field list only after this passes.
pub fn paper_field_id(payload: &Value) -> Result<String, String> {
    text(object(payload)?, "fieldId")
}

/// `paper_field_value`: check the value against the listed field definition (TS order: field found,
/// kind fillable, value parsed, then select / multi-select options).
pub fn paper_field_fill(
    payload: &Value,
    defs: &[PaperFieldDefInput],
) -> Result<PaperFieldFillInput, String> {
    let map = object(payload)?;
    let field_id = text(map, "fieldId")?;
    let def = defs
        .iter()
        .find(|def| def.id == field_id)
        .ok_or_else(|| format!("No field with id \"{field_id}\"."))?;
    if !matches!(
        def.kind,
        PaperFieldKind::Text
            | PaperFieldKind::Number
            | PaperFieldKind::Select
            | PaperFieldKind::MultiSelect
    ) {
        return Err(
            "Only text, number, select, and multi_select fields can be filled via AI.".to_owned(),
        );
    }
    let raw = map.get("value").cloned().unwrap_or(Value::Null);
    let input = serde_json::from_value::<PaperFieldValueInput>(raw)
        .map_err(|_| paper_field_value_refusal("Proposal value"))?;
    let value = parse_paper_field_value(input, "Proposal value")?;
    match (def.kind, &value) {
        (PaperFieldKind::Select, PaperFieldValueData::Text(choice))
            if def.options.contains(choice) => {}
        (PaperFieldKind::Select, _) => {
            return Err(format!(
                "Value is not one of the allowed options for «{}».",
                def.name
            ));
        }
        (PaperFieldKind::MultiSelect, PaperFieldValueData::List(items))
            if items.iter().all(|item| def.options.contains(item)) => {}
        (PaperFieldKind::MultiSelect, _) => {
            return Err(format!(
                "Value contains options not allowed for «{}».",
                def.name
            ));
        }
        _ => {}
    }
    Ok(PaperFieldFillInput { field_id, value })
}

/// `reading_list_change`. A paper target wins over a note target when both are sent, as in TS.
pub fn reading_list_change(payload: &Value) -> Result<ReadingListChangeInput, String> {
    let map = object(payload)?;
    let list_id = text(map, "listId")?;
    let note = optional_text(map, "note");
    let paper_id = optional_text(map, "paperId");
    let vault_page_id = optional_text(map, "vaultPageId");
    // Both absent compares equal too, so a payload with no target is refused here.
    if paper_id == vault_page_id {
        return Err(
            "Reading-list proposal must target exactly one paper or vault note.".to_owned(),
        );
    }
    let target = match (paper_id, vault_page_id) {
        (Some(paper), _) => ReadingListTarget::Paper(paper),
        (None, Some(note_id)) => ReadingListTarget::Note(note_id),
        // Unreachable: the equal-case check above already refused (None, None).
        (None, None) => return Err("Reading-list proposal needs a target.".to_owned()),
    };
    Ok(ReadingListChangeInput {
        list_id,
        note,
        target,
    })
}

/// `relation`.
pub fn relation_change(payload: &Value) -> Result<RelationInput, String> {
    let map = object(payload)?;
    let relation = enum_value(map, "relation", RELATIONS)?
        .ok_or_else(|| "Proposal relation is required.".to_owned())?;
    Ok(RelationInput {
        from_paper: text(map, "fromPaper")?,
        to_paper: text(map, "toPaper")?,
        relation: relation.to_owned(),
    })
}

/// `zotero_import`. Authors are trimmed and blanks dropped; other fields are checked as read.
pub fn zotero_import(payload: &Value) -> Result<ZoteroPaperInput, String> {
    let map = object(payload)?;
    let title = text(map, "title")?;
    let authors = string_list(map, "authors")?.map(|list| {
        list.iter()
            .map(|author| js_trim(author).to_owned())
            .filter(|author| !author.is_empty())
            .collect::<Vec<String>>()
    });
    Ok(ZoteroPaperInput {
        title,
        authors,
        year: optional_year(map, "year")?,
        doi: optional_text(map, "doi"),
        url: optional_text(map, "url"),
        abstract_text: optional_text(map, "abstract"),
    })
}

/// `milestone_follow_up`.
pub fn milestone_follow_up(payload: &Value) -> Result<MilestoneInput, String> {
    let map = object(payload)?;
    Ok(MilestoneInput {
        title: text(map, "title")?,
        description: optional_text(map, "description"),
        status: enum_value(map, "status", MILESTONE_STATUSES)?.map(str::to_owned),
        target_date: optional_text(map, "targetDate"),
    })
}

/// `experiment_follow_up`.
pub fn experiment_follow_up(payload: &Value) -> Result<ExperimentFollowUpInput, String> {
    let map = object(payload)?;
    Ok(ExperimentFollowUpInput {
        name: text(map, "name")?,
        hypothesis: optional_text(map, "hypothesis"),
        status: enum_value(map, "status", EXPERIMENT_STATUSES)?.map(str::to_owned),
        related_paper: optional_text(map, "relatedPaper"),
    })
}

/// `edit_vault_note`: the title is trimmed, the body is kept as sent.
pub fn edit_vault_note(payload: &Value) -> Result<VaultNoteEditInput, String> {
    let map = object(payload)?;
    let input = VaultNoteEditInput {
        title: optional_text(map, "title"),
        body: map.get("body").and_then(Value::as_str).map(str::to_owned),
    };
    if input.title.is_none() && input.body.is_none() {
        return Err("Note edit proposal contains no changes.".to_owned());
    }
    Ok(input)
}

/// `append_vault_note`: the new body, given the note's current body. The addition is trimmed.
pub fn append_vault_note_body(existing: &str, payload: &Value) -> Result<String, String> {
    let addition = text(object(payload)?, "addition")?;
    let kept = existing.trim_end_matches(crate::search::js_text::is_js_whitespace);
    Ok(if kept.is_empty() {
        addition
    } else {
        format!("{kept}\n\n{addition}")
    })
}

/// `report_edit`: the notes, kept as sent. Only a string is accepted.
pub fn report_notes(payload: &Value) -> Result<String, String> {
    object(payload)?
        .get("notes")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Proposal notes is required.".to_owned())
}

/// `milestone_status`.
pub fn milestone_status(payload: &Value) -> Result<String, String> {
    enum_value(object(payload)?, "status", MILESTONE_STATUSES)?
        .map(str::to_owned)
        .ok_or_else(|| "Proposal status is required.".to_owned())
}

/// `experiment_update`. At least one of status, metrics or artifacts must be present.
pub fn experiment_update(payload: &Value) -> Result<ExperimentUpdateInput, String> {
    let map = object(payload)?;
    let status = enum_value(map, "status", EXPERIMENT_STATUSES)?.map(str::to_owned);
    let metrics = match map.get("metrics") {
        None => None,
        Some(_) => Some(record(map, "metrics")?.clone()),
    };
    let artifacts = string_list(map, "artifacts")?;
    if status.is_none() && metrics.is_none() && artifacts.is_none() {
        return Err("Experiment update proposal contains no allowed changes.".to_owned());
    }
    Ok(ExperimentUpdateInput {
        status,
        metrics,
        artifacts,
    })
}

/// `paper_annotation`: a quote-anchored highlight or note on a page (page 0 by default).
pub fn paper_annotation(payload: &Value) -> Result<PaperAnnotationInput, String> {
    let map = object(payload)?;
    let page_index = optional_number(map, "pageIndex")?.unwrap_or(0.0);
    if page_index.fract() != 0.0 || page_index < 0.0 {
        return Err("Proposal pageIndex is invalid.".to_owned());
    }
    let kind = enum_value(map, "type", ANNOTATION_TYPES)?.unwrap_or("highlight");
    let color = optional_text(map, "color").unwrap_or_else(|| DEFAULT_ANNOTATION_COLOR.to_owned());
    let quote = text(map, "quote")?;
    Ok(PaperAnnotationInput {
        kind: kind.to_owned(),
        color,
        text: quote.clone(),
        comment: optional_text(map, "comment"),
        anchor: QuoteAnchor {
            locus: QuoteLocus {
                quote: QuoteSelector {
                    kind: "TextQuoteSelector".to_owned(),
                    exact: quote,
                },
            },
        },
        page_index,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn field(id: &str, kind: PaperFieldKind, options: &[&str]) -> PaperFieldDefInput {
        PaperFieldDefInput {
            id: id.to_owned(),
            name: id.to_owned(),
            kind,
            options: options.iter().map(|o| (*o).to_owned()).collect(),
        }
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "test helper takes json! literals"
    )]
    fn fill_error(defs: &[PaperFieldDefInput], payload: Value) -> String {
        paper_field_fill(&payload, defs).unwrap_err()
    }

    #[test]
    fn paper_note_addition_falls_back_to_content() {
        assert_eq!(
            paper_note_addition(&json!({"addition": "more"}), "Append this"),
            "more"
        );
        assert_eq!(
            paper_note_addition(&json!({"addition": 3}), "Append this"),
            "Append this"
        );
        assert_eq!(
            paper_note_addition(&json!(null), "Append this"),
            "Append this"
        );
    }

    #[test]
    fn vault_note_and_log_entry_read_their_fields() {
        let note =
            vault_note(&json!({"title": " Note ", "body": "Body", "parentId": " p1 "})).unwrap();
        assert_eq!(note.title, "Note");
        assert_eq!(note.parent_id.as_deref(), Some("p1"));
        let log = log_entry(&json!({"body": "Body", "kind": "daily"})).unwrap();
        assert_eq!(log.kind.as_deref(), Some("daily"));
        assert!(log.entry_date.is_none());
        assert_eq!(
            log_entry(&json!({"body": "Body", "kind": "monthly"})).unwrap_err(),
            "Proposal kind is invalid."
        );
    }

    #[test]
    fn paper_update_reads_allowed_changes_and_refuses_empty() {
        let update =
            paper_update(&json!({"status": "read", "rating": 4, "tags": ["method"]})).unwrap();
        assert_eq!(update.status.as_deref(), Some("read"));
        assert_eq!(update.rating, Some(4.0));
        assert_eq!(update.tags, Some(vec!["method".to_owned()]));
        assert_eq!(
            paper_update(&json!({"status": "someday"})).unwrap_err(),
            "Proposal status is invalid."
        );
        assert_eq!(
            paper_update(&json!({"other": 1})).unwrap_err(),
            "Paper update proposal contains no allowed changes."
        );
    }

    #[test]
    fn paper_field_value_fills_a_text_field() {
        let defs = [field("f1", PaperFieldKind::Text, &[])];
        let fill = paper_field_fill(&json!({"fieldId": "f1", "value": "VAE"}), &defs).unwrap();
        assert_eq!(fill.field_id, "f1");
        assert_eq!(fill.value, PaperFieldValueData::Text("VAE".to_owned()));
    }

    #[test]
    fn paper_field_id_is_read_before_the_host_lists_fields() {
        assert_eq!(paper_field_id(&json!({"fieldId": " f1 "})).unwrap(), "f1");
        assert_eq!(
            paper_field_id(&json!({})).unwrap_err(),
            "Proposal fieldId is required."
        );
        assert_eq!(
            paper_field_id(&json!(null)).unwrap_err(),
            "Proposal payload is missing or invalid."
        );
    }

    #[test]
    fn paper_field_value_refuses_an_unknown_field() {
        let defs = [field("f1", PaperFieldKind::Text, &[])];
        assert_eq!(
            fill_error(&defs, json!({"fieldId": "zz", "value": "x"})),
            "No field with id \"zz\"."
        );
    }

    #[test]
    fn paper_field_value_rejects_non_fillable_field_kinds() {
        let defs = [field("rel", PaperFieldKind::Relation, &[])];
        let message = fill_error(&defs, json!({"fieldId": "rel", "value": ["p2"]}));
        assert!(
            message.contains("Only text, number, select, and multi_select"),
            "{message}"
        );
    }

    #[test]
    fn paper_field_value_rejects_select_values_outside_options() {
        let defs = [field("s1", PaperFieldKind::Select, &["A", "B"])];
        let message = fill_error(&defs, json!({"fieldId": "s1", "value": "Z"}));
        assert!(
            message.contains("not one of the allowed options"),
            "{message}"
        );
        let list = fill_error(&defs, json!({"fieldId": "s1", "value": ["A"]}));
        assert!(list.contains("not one of the allowed options"), "{list}");
        let ok = paper_field_fill(&json!({"fieldId": "s1", "value": "B"}), &defs).unwrap();
        assert_eq!(ok.value, PaperFieldValueData::Text("B".to_owned()));
    }

    #[test]
    fn paper_field_value_checks_multi_select_options() {
        let defs = [field("m1", PaperFieldKind::MultiSelect, &["A", "B"])];
        let bad = fill_error(&defs, json!({"fieldId": "m1", "value": ["A", "Z"]}));
        assert_eq!(bad, "Value contains options not allowed for «m1».");
        let text_value = fill_error(&defs, json!({"fieldId": "m1", "value": "A"}));
        assert_eq!(text_value, "Value contains options not allowed for «m1».");
        let ok = paper_field_fill(&json!({"fieldId": "m1", "value": [" A ", "B"]}), &defs).unwrap();
        assert_eq!(
            ok.value,
            PaperFieldValueData::List(vec!["A".to_owned(), "B".to_owned()])
        );
    }

    #[test]
    fn paper_field_value_rejects_empty_and_blank_values() {
        let defs = [field("f1", PaperFieldKind::Text, &[])];
        let empty = fill_error(&defs, json!({"fieldId": "f1", "value": []}));
        assert!(
            empty.contains("string, number, or non-empty string list"),
            "{empty}"
        );
        let blank = fill_error(&defs, json!({"fieldId": "f1", "value": "   "}));
        assert!(blank.contains("non-empty string"), "{blank}");
        let blank_list = fill_error(&defs, json!({"fieldId": "f1", "value": ["  ", ""]}));
        assert!(blank_list.contains("non-empty string list"), "{blank_list}");
        let missing = fill_error(&defs, json!({"fieldId": "f1"}));
        assert!(missing.contains("non-empty string"), "{missing}");
        let nested = fill_error(&defs, json!({"fieldId": "f1", "value": [1, 2]}));
        assert!(nested.contains("non-empty string list"), "{nested}");
    }

    #[test]
    fn reading_list_change_targets_exactly_one_item() {
        let paper =
            reading_list_change(&json!({"listId": "list-1", "paperId": "paper-1"})).unwrap();
        assert_eq!(paper.target, ReadingListTarget::Paper("paper-1".to_owned()));
        let note =
            reading_list_change(&json!({"listId": "list-1", "vaultPageId": "n1", "note": "why"}))
                .unwrap();
        assert_eq!(note.target, ReadingListTarget::Note("n1".to_owned()));
        assert_eq!(note.note.as_deref(), Some("why"));
        let both = reading_list_change(&json!({"listId": "l", "paperId": "p", "vaultPageId": "n"}))
            .unwrap();
        assert_eq!(both.target, ReadingListTarget::Paper("p".to_owned()));
        assert_eq!(
            reading_list_change(&json!({"listId": "l"})).unwrap_err(),
            "Reading-list proposal must target exactly one paper or vault note."
        );
        assert_eq!(
            reading_list_change(&json!({"paperId": "p"})).unwrap_err(),
            "Proposal listId is required."
        );
    }

    #[test]
    fn relation_requires_a_listed_relation() {
        let ok = relation_change(
            &json!({"fromPaper": "paper-1", "toPaper": "paper-2", "relation": "extends"}),
        )
        .unwrap();
        assert_eq!(ok.relation, "extends");
        assert_eq!(
            relation_change(&json!({"fromPaper": "a", "toPaper": "b"})).unwrap_err(),
            "Proposal relation is required."
        );
        assert_eq!(
            relation_change(&json!({"fromPaper": "a", "toPaper": "b", "relation": "likes"}))
                .unwrap_err(),
            "Proposal relation is invalid."
        );
    }

    #[test]
    fn zotero_import_passes_only_checked_paper_fields() {
        let payload = json!({
            "title": " A paper ", "authors": ["Ada", " "], "year": "2021",
            "doi": "10.1/x", "url": "https://x.org", "abstract": "Abs",
            "item": {"itemType": "journalArticle"}, "status": "read"
        });
        let input = zotero_import(&payload).unwrap();
        assert_eq!(
            input,
            ZoteroPaperInput {
                title: "A paper".to_owned(),
                authors: Some(vec!["Ada".to_owned()]),
                year: Some(2021.0),
                doi: Some("10.1/x".to_owned()),
                url: Some("https://x.org".to_owned()),
                abstract_text: Some("Abs".to_owned()),
            }
        );
    }

    #[test]
    fn malformed_zotero_import_is_refused() {
        let cases = [
            json!({}),
            json!({"title": 7}),
            json!({"title": "T", "authors": "Ada"}),
            json!({"title": "T", "year": "soon"}),
            json!({"title": "T", "year": 20.5}),
        ];
        for payload in cases {
            let message = zotero_import(&payload).unwrap_err();
            assert!(message.contains("Proposal"), "{message}");
        }
    }

    #[test]
    fn follow_ups_pass_only_checked_fields() {
        let milestone = milestone_follow_up(&json!({
            "title": "M", "description": "D", "status": "planned",
            "targetDate": "2026-11-01", "dependencies": "x"
        }))
        .unwrap();
        assert_eq!(
            milestone,
            MilestoneInput {
                title: "M".to_owned(),
                description: Some("D".to_owned()),
                status: Some("planned".to_owned()),
                target_date: Some("2026-11-01".to_owned()),
            }
        );
        let experiment = experiment_follow_up(&json!({
            "name": "E", "hypothesis": "H", "status": "running",
            "relatedPaper": "p-1", "config": "x"
        }))
        .unwrap();
        assert_eq!(
            experiment,
            ExperimentFollowUpInput {
                name: "E".to_owned(),
                hypothesis: Some("H".to_owned()),
                status: Some("running".to_owned()),
                related_paper: Some("p-1".to_owned()),
            }
        );
    }

    #[test]
    fn malformed_follow_ups_are_refused() {
        let refused = [
            milestone_follow_up(&json!({})).unwrap_err(),
            milestone_follow_up(&json!({"title": "M", "status": "someday"})).unwrap_err(),
            experiment_follow_up(&json!({"title": "no name"})).unwrap_err(),
            experiment_follow_up(&json!({"name": "E", "status": "maybe"})).unwrap_err(),
        ];
        for message in refused {
            assert!(message.contains("Proposal"), "{message}");
        }
    }

    #[test]
    fn edit_vault_note_keeps_body_as_sent_and_needs_a_change() {
        let edit = edit_vault_note(&json!({"body": "New"})).unwrap();
        assert_eq!(
            edit,
            VaultNoteEditInput {
                title: None,
                body: Some("New".to_owned())
            }
        );
        assert_eq!(
            edit_vault_note(&json!({"body": 3})).unwrap_err(),
            "Note edit proposal contains no changes."
        );
    }

    #[test]
    fn append_vault_note_joins_with_a_blank_line() {
        assert_eq!(
            append_vault_note_body("Old", &json!({"addition": "More"})).unwrap(),
            "Old\n\nMore"
        );
        assert_eq!(
            append_vault_note_body("Old \n ", &json!({"addition": " More "})).unwrap(),
            "Old\n\nMore"
        );
        assert_eq!(
            append_vault_note_body("  ", &json!({"addition": "More"})).unwrap(),
            "More"
        );
        assert_eq!(
            append_vault_note_body("Old", &json!({"addition": "  "})).unwrap_err(),
            "Proposal addition is required."
        );
    }

    #[test]
    fn report_notes_must_be_a_string() {
        assert_eq!(report_notes(&json!({"notes": "Draft"})).unwrap(), "Draft");
        assert_eq!(report_notes(&json!({"notes": ""})).unwrap(), "");
        assert_eq!(
            report_notes(&json!({"notes": 1})).unwrap_err(),
            "Proposal notes is required."
        );
    }

    #[test]
    fn milestone_status_and_experiment_update_reject_empty_or_unknown_values() {
        assert_eq!(
            milestone_status(&json!({"status": "done"})).unwrap(),
            "done"
        );
        assert!(milestone_status(&json!({"status": "someday"})).is_err());
        assert_eq!(
            milestone_status(&json!({})).unwrap_err(),
            "Proposal status is required."
        );
        assert_eq!(
            experiment_update(&json!({})).unwrap_err(),
            "Experiment update proposal contains no allowed changes."
        );
    }

    #[test]
    fn experiment_update_reads_status_metrics_and_artifacts() {
        let update = experiment_update(&json!({
            "status": "done", "metrics": {"acc": 0.9}, "artifacts": ["model.pt"]
        }))
        .unwrap();
        assert_eq!(update.status.as_deref(), Some("done"));
        assert_eq!(
            update.metrics.as_ref().and_then(|m| m.get("acc")),
            Some(&json!(0.9))
        );
        assert_eq!(update.artifacts, Some(vec!["model.pt".to_owned()]));
        assert_eq!(
            experiment_update(&json!({"metrics": null})).unwrap_err(),
            "Proposal metrics must be an object."
        );
    }

    #[test]
    fn paper_annotation_builds_a_quote_anchored_highlight() {
        let annotation =
            paper_annotation(&json!({"quote": "the words", "comment": "why", "pageIndex": 2}))
                .unwrap();
        assert_eq!(
            annotation,
            PaperAnnotationInput {
                kind: "highlight".to_owned(),
                color: "#ffd400".to_owned(),
                text: "the words".to_owned(),
                comment: Some("why".to_owned()),
                anchor: QuoteAnchor {
                    locus: QuoteLocus {
                        quote: QuoteSelector {
                            kind: "TextQuoteSelector".to_owned(),
                            exact: "the words".to_owned(),
                        },
                    },
                },
                page_index: 2.0,
            }
        );
    }

    #[test]
    fn paper_annotation_refuses_bad_page_index_type_and_quote() {
        assert_eq!(
            paper_annotation(&json!({"quote": "x", "pageIndex": -1})).unwrap_err(),
            "Proposal pageIndex is invalid."
        );
        assert_eq!(
            paper_annotation(&json!({"quote": "x", "pageIndex": 1.5})).unwrap_err(),
            "Proposal pageIndex is invalid."
        );
        assert_eq!(
            paper_annotation(&json!({"quote": "x", "type": "underline"})).unwrap_err(),
            "Proposal type is invalid."
        );
        assert_eq!(
            paper_annotation(&json!({})).unwrap_err(),
            "Proposal quote is required."
        );
    }
}

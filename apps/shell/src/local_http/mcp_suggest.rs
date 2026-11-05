//! MCP `suggest_*` tools: each one leaves a draft for the user to accept. Ported from the `suggest_*` cases of `callTool` in apps/shell/sidecar/src/local-mcp.ts.

use std::collections::HashMap;

use serde_json::{Map, Value, json};
use wf_core::ai::access_policy::AiProposalKind;
use wf_core::logbook::log_entry::LOG_KINDS;
use wf_core::papers::paper::PAPER_STATUSES;
use wf_core::plan::milestone::MILESTONE_STATUSES;
use wf_core::sync::folder_layout::WorkspaceEntityType;

use super::mcp_call::Ctx;
use super::mcp_draft::{Draft, EXPERIMENT_STATUSES, RELATION_TYPES, leave_draft};
use super::mcp_read::{Entry, field, id_of, one_of, pick, text};

/// Runs one `suggest_*` tool. `name` is canonical; `raw_name` is what the agent sent.
pub(crate) fn call_suggest(ctx: &Ctx<'_>, name: &str, raw_name: &str) -> Result<Value, String> {
    match name {
        "suggest_note_create" => note_create(ctx, name),
        "suggest_note_edit" => note_edit(ctx, name),
        "suggest_note_append" => note_append(ctx, name),
        "suggest_log_entry" => log_entry(ctx, name),
        "suggest_milestone" => milestone(ctx, name),
        "suggest_milestone_status" => milestone_status(ctx, name),
        "suggest_experiment" => experiment(ctx, name),
        "suggest_experiment_update" => experiment_update(ctx, name),
        "suggest_paper_update" => paper_update(ctx, name),
        "suggest_paper_note" => paper_note(ctx, name),
        "suggest_annotation" => annotation(ctx, name),
        "suggest_relation" => relation(ctx, name),
        "suggest_reading_list_change" => reading_list_change(ctx, name),
        "suggest_report_edit" => report_edit(ctx, name),
        _ => Err(format!("No tool named {raw_name}.")),
    }
}

/// A raw param as sent, `null` when absent (TS `params.x`).
fn raw_param(params: &Map<String, Value>, key: &str) -> Value {
    params.get(key).cloned().unwrap_or(Value::Null)
}

/// A trimmed required text param (TS `text(params, key, true)`).
fn required_text(params: &Map<String, Value>, key: &str) -> Result<String, String> {
    Ok(text(params, key, true)?.unwrap_or_default())
}

/// Inserts one payload key.
fn put(payload: &mut Map<String, Value>, key: &str, value: Value) {
    let _ = payload.insert(key.to_owned(), value);
}

/// A random v4 UUID string (TS `randomUUID`).
fn random_uuid() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|err| err.to_string())?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

/// `YYYY-MM-DD` by shape only (TS `/^\d{4}-\d{2}-\d{2}$/`).
#[must_use]
fn is_day(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
}

/// A JSON object whose values are all numbers (TS `metrics` check).
#[must_use]
fn numeric_map(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|map| map.values().all(Value::is_number))
}

/// A JSON array of strings (TS `artifacts` / `tags` check).
#[must_use]
fn string_list(value: &Value) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.iter().all(Value::is_string))
}

/// A whole number from 0 to 5 (TS `rating` check).
#[must_use]
fn whole_rating(value: &Value) -> bool {
    value.as_i64().is_some_and(|n| (0..=5).contains(&n))
}

/// A whole page number from 1 (TS `page` check).
#[must_use]
fn whole_page(value: &Value) -> bool {
    value.as_i64().is_some_and(|n| n >= 1)
}

/// The wire names of a serde enum list, as the TS string lists have them.
fn wire_names<T: serde::Serialize>(all: &[T]) -> Vec<String> {
    all.iter()
        .filter_map(|v| serde_json::to_value(v).ok())
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect()
}

/// `one_of` over the wire names of a serde enum list.
fn one_of_enum<T: serde::Serialize>(
    params: &Map<String, Value>,
    key: &str,
    all: &[T],
    required: bool,
) -> Result<Option<String>, String> {
    let names = wire_names(all);
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    one_of(params, key, &refs, required)
}

/// TS `suggest_note_create`.
fn note_create(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let title = required_text(ctx.params, "title")?;
    let body = ctx
        .params
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let project = ctx.home()?;
    let parent_note = match text(ctx.params, "parent", false)? {
        Some(_) => Some(ctx.find_one(
            WorkspaceEntityType::VaultPage,
            &raw_param(ctx.params, "parent"),
            "note",
            Some(&project),
        )?),
        None => None,
    };
    let mut payload = Map::new();
    put(&mut payload, "title", json!(title));
    put(&mut payload, "body", json!(body));
    let mut shown = None;
    if let Some(parent) = &parent_note {
        put(&mut payload, "parentId", json!(id_of(parent)?));
        shown = Some(HashMap::from([(
            "parentId".to_owned(),
            parent.title.clone(),
        )]));
    }
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::CreateVaultNote,
            tool: name.to_owned(),
            resource_id: random_uuid()?,
            resource_type: "vault_page".to_owned(),
            summary: format!("New note: {title}"),
            payload,
            expected_revision: None,
            project: Some(project),
            shown,
        },
    )
}

/// TS `suggest_note_edit`.
fn note_edit(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let note = ctx.find_one(
        WorkspaceEntityType::VaultPage,
        &raw_param(ctx.params, "note"),
        "note",
        None,
    )?;
    let title = text(ctx.params, "title", false)?;
    let body = ctx.params.get("body").and_then(Value::as_str);
    if title.is_none() && body.is_none() {
        return Err("Suggest a new title or body.".to_owned());
    }
    let mut payload = Map::new();
    if let Some(title) = &title {
        put(&mut payload, "title", json!(title));
    }
    if let Some(body) = body {
        put(&mut payload, "body", json!(body));
    }
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::EditVaultNote,
            tool: name.to_owned(),
            resource_id: id_of(&note)?,
            resource_type: "vault_page".to_owned(),
            summary: format!("Edit note: {}", note.title),
            payload,
            expected_revision: field(&note, "updated-at"),
            project: Some(note.project.clone()),
            shown: None,
        },
    )
}

/// TS `suggest_note_append`.
fn note_append(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let note = ctx.find_one(
        WorkspaceEntityType::VaultPage,
        &raw_param(ctx.params, "note"),
        "note",
        None,
    )?;
    let addition = required_text(ctx.params, "addition")?;
    let mut payload = Map::new();
    put(&mut payload, "addition", json!(addition));
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::AppendVaultNote,
            tool: name.to_owned(),
            resource_id: id_of(&note)?,
            resource_type: "vault_page".to_owned(),
            summary: format!("Add to note: {}", note.title),
            payload,
            expected_revision: field(&note, "updated-at"),
            project: Some(note.project.clone()),
            shown: None,
        },
    )
}

/// TS `suggest_log_entry`.
fn log_entry(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let body = required_text(ctx.params, "body")?;
    let entry_date = text(ctx.params, "entryDate", false)?;
    if let Some(date) = &entry_date
        && !is_day(date)
    {
        return Err("entryDate must be YYYY-MM-DD.".to_owned());
    }
    let kind = one_of_enum(ctx.params, "kind", LOG_KINDS, false)?;
    let mut payload = Map::new();
    put(&mut payload, "body", json!(body));
    if let Some(date) = &entry_date {
        put(&mut payload, "entryDate", json!(date));
    }
    if let Some(kind) = &kind {
        put(&mut payload, "kind", json!(kind));
    }
    let summary = match &entry_date {
        Some(date) => format!("New log entry for {date}"),
        None => "New log entry".to_owned(),
    };
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::CreateLogEntry,
            tool: name.to_owned(),
            resource_id: random_uuid()?,
            resource_type: "log_entry".to_owned(),
            summary,
            payload,
            expected_revision: None,
            project: Some(ctx.home()?),
            shown: None,
        },
    )
}

/// TS `suggest_milestone`.
fn milestone(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let title = required_text(ctx.params, "title")?;
    let status = one_of_enum(ctx.params, "status", MILESTONE_STATUSES, false)?;
    let description = text(ctx.params, "description", false)?;
    let target_date = text(ctx.params, "targetDate", false)?;
    let mut payload = Map::new();
    put(&mut payload, "title", json!(title));
    if let Some(description) = &description {
        put(&mut payload, "description", json!(description));
    }
    if let Some(status) = &status {
        put(&mut payload, "status", json!(status));
    }
    if let Some(target_date) = &target_date {
        put(&mut payload, "targetDate", json!(target_date));
    }
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::MilestoneFollowUp,
            tool: name.to_owned(),
            resource_id: random_uuid()?,
            resource_type: "milestone".to_owned(),
            summary: format!("New milestone: {title}"),
            payload,
            expected_revision: None,
            project: Some(ctx.home()?),
            shown: None,
        },
    )
}

/// TS `suggest_milestone_status`.
fn milestone_status(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let milestone = ctx.find_one(
        WorkspaceEntityType::Milestone,
        &raw_param(ctx.params, "milestone"),
        "milestone",
        None,
    )?;
    let status = one_of_enum(ctx.params, "status", MILESTONE_STATUSES, true)?.unwrap_or_default();
    let mut payload = Map::new();
    put(&mut payload, "status", json!(status));
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::MilestoneStatus,
            tool: name.to_owned(),
            resource_id: id_of(&milestone)?,
            resource_type: "milestone".to_owned(),
            summary: format!("Mark '{}' {status}", milestone.title),
            payload,
            expected_revision: None,
            project: Some(milestone.project.clone()),
            shown: None,
        },
    )
}

/// TS `suggest_experiment`.
fn experiment(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let experiment = required_text(ctx.params, "name")?;
    let hypothesis = text(ctx.params, "hypothesis", false)?;
    let status = one_of(ctx.params, "status", EXPERIMENT_STATUSES, false)?;
    let mut payload = Map::new();
    put(&mut payload, "name", json!(experiment));
    if let Some(hypothesis) = &hypothesis {
        put(&mut payload, "hypothesis", json!(hypothesis));
    }
    if let Some(status) = &status {
        put(&mut payload, "status", json!(status));
    }
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::ExperimentFollowUp,
            tool: name.to_owned(),
            resource_id: random_uuid()?,
            resource_type: "experiment".to_owned(),
            summary: format!("New experiment: {experiment}"),
            payload,
            expected_revision: None,
            project: Some(ctx.home()?),
            shown: None,
        },
    )
}

/// TS `suggest_experiment_update`.
fn experiment_update(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let experiment = ctx.find_one(
        WorkspaceEntityType::Experiment,
        &raw_param(ctx.params, "experiment"),
        "experiment",
        None,
    )?;
    let status = one_of(ctx.params, "status", EXPERIMENT_STATUSES, false)?;
    let metrics = ctx.params.get("metrics");
    if metrics.is_some_and(|m| !numeric_map(m)) {
        return Err("metrics must map names to numbers.".to_owned());
    }
    let artifacts = ctx.params.get("artifacts");
    if artifacts.is_some_and(|a| !string_list(a)) {
        return Err("artifacts must be a list of strings.".to_owned());
    }
    if status.is_none() && metrics.is_none() && artifacts.is_none() {
        return Err("Suggest a status, metrics or artifacts.".to_owned());
    }
    let mut payload = Map::new();
    if let Some(status) = &status {
        put(&mut payload, "status", json!(status));
    }
    if let Some(metrics) = metrics {
        put(&mut payload, "metrics", metrics.clone());
    }
    if let Some(artifacts) = artifacts {
        put(&mut payload, "artifacts", artifacts.clone());
    }
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::ExperimentUpdate,
            tool: name.to_owned(),
            resource_id: id_of(&experiment)?,
            resource_type: "experiment".to_owned(),
            summary: format!("Update experiment: {}", experiment.title),
            payload,
            expected_revision: None,
            project: Some(experiment.project.clone()),
            shown: None,
        },
    )
}

/// TS `suggest_paper_update`.
fn paper_update(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let paper = pick(&ctx.papers(None)?, &raw_param(ctx.params, "paper"), "paper")?;
    let status = one_of_enum(ctx.params, "status", PAPER_STATUSES, false)?;
    let rating = ctx.params.get("rating");
    if rating.is_some_and(|r| !whole_rating(r)) {
        return Err("rating must be a whole number from 0 to 5.".to_owned());
    }
    let tags = ctx.params.get("tags");
    if tags.is_some_and(|t| !string_list(t)) {
        return Err("tags must be a list of strings.".to_owned());
    }
    if status.is_none() && rating.is_none() && tags.is_none() {
        return Err("Suggest a status, rating or tags.".to_owned());
    }
    let mut payload = Map::new();
    if let Some(status) = &status {
        put(&mut payload, "status", json!(status));
    }
    if let Some(rating) = rating {
        put(&mut payload, "rating", rating.clone());
    }
    if let Some(tags) = tags {
        put(&mut payload, "tags", tags.clone());
    }
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::PaperUpdate,
            tool: name.to_owned(),
            resource_id: id_of(&paper)?,
            resource_type: "paper".to_owned(),
            summary: format!("Update paper: {}", paper.title),
            payload,
            expected_revision: field(&paper, "updated-at"),
            project: Some(paper.project.clone()),
            shown: None,
        },
    )
}

/// TS `suggest_paper_note`.
fn paper_note(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let paper = pick(&ctx.papers(None)?, &raw_param(ctx.params, "paper"), "paper")?;
    let addition = required_text(ctx.params, "addition")?;
    let mut payload = Map::new();
    put(&mut payload, "addition", json!(addition));
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::AppendPaperNote,
            tool: name.to_owned(),
            resource_id: id_of(&paper)?,
            resource_type: "paper".to_owned(),
            summary: format!("Add to notes on: {}", paper.title),
            payload,
            expected_revision: field(&paper, "updated-at"),
            project: Some(paper.project.clone()),
            shown: None,
        },
    )
}

/// TS `suggest_annotation`.
fn annotation(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let paper = pick(&ctx.papers(None)?, &raw_param(ctx.params, "paper"), "paper")?;
    let quote = required_text(ctx.params, "quote")?;
    let comment = text(ctx.params, "comment", false)?;
    let page = ctx.params.get("page");
    if page.is_some_and(|p| !whole_page(p)) {
        return Err("page must be 1 or more.".to_owned());
    }
    let mut payload = Map::new();
    put(&mut payload, "quote", json!(quote));
    if let Some(comment) = &comment {
        put(&mut payload, "comment", json!(comment));
    }
    if let Some(index) = page.and_then(Value::as_i64).map(|p| p - 1) {
        put(&mut payload, "pageIndex", json!(index));
    }
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::PaperAnnotation,
            tool: name.to_owned(),
            resource_id: id_of(&paper)?,
            resource_type: "paper".to_owned(),
            summary: format!("Highlight in: {}", paper.title),
            payload,
            expected_revision: None,
            project: Some(paper.project.clone()),
            shown: None,
        },
    )
}

/// TS `suggest_relation`.
fn relation(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let from_paper = pick(&ctx.papers(None)?, &raw_param(ctx.params, "from"), "paper")?;
    let from = id_of(&from_paper)?;
    let to_paper = pick(
        &ctx.papers(Some(&from_paper.project))?,
        &raw_param(ctx.params, "to"),
        "paper",
    )?;
    let to = id_of(&to_paper)?;
    if from == to {
        return Err("A paper cannot be linked to itself.".to_owned());
    }
    let relation = one_of(ctx.params, "relation", RELATION_TYPES, true)?.unwrap_or_default();
    let mut payload = Map::new();
    put(&mut payload, "fromPaper", json!(from));
    put(&mut payload, "toPaper", json!(to));
    put(&mut payload, "relation", json!(relation));
    let shown = HashMap::from([
        ("fromPaper".to_owned(), String::new()),
        ("toPaper".to_owned(), String::new()),
        ("relation".to_owned(), String::new()),
    ]);
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::Relation,
            tool: name.to_owned(),
            resource_id: from,
            resource_type: "paper_relation".to_owned(),
            summary: format!(
                "Link: {} {} {}",
                from_paper.title,
                relation.replace('_', " "),
                to_paper.title
            ),
            payload,
            expected_revision: None,
            project: Some(from_paper.project.clone()),
            shown: Some(shown),
        },
    )
}

/// TS `suggest_reading_list_change`.
fn reading_list_change(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let list = ctx.find_one(
        WorkspaceEntityType::ReadingList,
        &raw_param(ctx.params, "list"),
        "reading list",
        None,
    )?;
    let paper_entry = match text(ctx.params, "paper", false)? {
        Some(_) => Some(pick(
            &ctx.papers(Some(&list.project))?,
            &raw_param(ctx.params, "paper"),
            "paper",
        )?),
        None => None,
    };
    let note_entry = match text(ctx.params, "note", false)? {
        Some(_) => Some(ctx.find_one(
            WorkspaceEntityType::VaultPage,
            &raw_param(ctx.params, "note"),
            "note",
            Some(&list.project),
        )?),
        None => None,
    };
    let paper = paper_entry.as_ref().map(id_of).transpose()?;
    let note = note_entry.as_ref().map(id_of).transpose()?;
    if paper.is_some() == note.is_some() {
        return Err("Name exactly one paper or one note.".to_owned());
    }
    let comment = text(ctx.params, "comment", false)?;
    let list_id = id_of(&list)?;
    let mut payload = Map::new();
    put(&mut payload, "listId", json!(list_id));
    if let Some(paper) = &paper {
        put(&mut payload, "paperId", json!(paper));
    } else if let Some(note) = &note {
        put(&mut payload, "vaultPageId", json!(note));
    }
    if let Some(comment) = &comment {
        put(&mut payload, "note", json!(comment));
    }
    let shown = HashMap::from([
        ("listId".to_owned(), String::new()),
        ("paperId".to_owned(), title_of(paper_entry.as_ref())),
        ("vaultPageId".to_owned(), title_of(note_entry.as_ref())),
    ]);
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::ReadingListChange,
            tool: name.to_owned(),
            resource_id: list_id,
            resource_type: "reading_list_item".to_owned(),
            summary: format!("Add to reading list: {}", list.title),
            payload,
            expected_revision: None,
            project: Some(list.project.clone()),
            shown: Some(shown),
        },
    )
}

/// The entry's title, or empty when there is none.
fn title_of(entry: Option<&Entry>) -> String {
    entry.map(|e| e.title.clone()).unwrap_or_default()
}

/// TS `suggest_report_edit`.
fn report_edit(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let section = ctx.find_one(
        WorkspaceEntityType::ReportSection,
        &raw_param(ctx.params, "section"),
        "report section",
        None,
    )?;
    // propose_report_edit called the text `proposal`.
    let notes = match text(ctx.params, "notes", false)? {
        Some(notes) => notes,
        None => text(ctx.params, "proposal", false)?.unwrap_or_default(),
    };
    if notes.is_empty() {
        return Err("notes is required.".to_owned());
    }
    let mut payload = Map::new();
    put(&mut payload, "notes", json!(notes));
    // Report files carry no updated-at, so there is no revision to check against.
    leave_draft(
        ctx.session,
        ctx.params,
        &Draft {
            kind: AiProposalKind::ReportEdit,
            tool: name.to_owned(),
            resource_id: id_of(&section)?,
            resource_type: "report_section".to_owned(),
            summary: format!("New notes for: {}", section.title),
            payload,
            expected_revision: None,
            project: Some(section.project.clone()),
            shown: None,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_is_v4_shape() -> Result<(), String> {
        let id = random_uuid()?;
        let lens: Vec<usize> = id.split('-').map(str::len).collect();
        assert_eq!(lens, [8_usize, 4, 4, 4, 12]);
        assert_eq!(id.as_bytes()[14], b'4');
        assert!(matches!(id.as_bytes()[19], b'8' | b'9' | b'a' | b'b'));
        Ok(())
    }

    #[test]
    fn day_and_metric_checks() {
        assert!(is_day("2026-11-05"));
        assert!(!is_day("2026-1-05"));
        assert!(numeric_map(&json!({"loss": 0.2})));
        assert!(!numeric_map(&json!({"loss": "x"})));
        assert!(!numeric_map(&json!([1])));
    }
}

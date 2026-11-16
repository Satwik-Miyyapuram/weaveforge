//! Draft files the MCP leaves for the app to review. Ported from apps/shell/sidecar/src/local-mcp.ts
//! (`draftPreview`, `leaveDraft`) and packages/core mcp-folder-draft.ts and ai-types.ts.

use std::collections::HashMap;
use std::time::SystemTime;

use serde_json::{Map, Value, json};
use wf_core::ai::access_policy::AiProposalKind;
use wf_core::ai::untrusted_context::UntrustedItem;

use super::mcp_projects::ProjectRef;
use super::mcp_read::{content, stamp};
use crate::vault::{VaultSession, iso_utc};

/// Where the local MCP leaves suggestions for the app to pick up; never applied on its own.
pub(crate) const FOLDER_DRAFTS_DIR: &str = ".weaveforge/proposals";

/// Longest accepted file, in UTF-16 units.
const MAX_RAW_CHARS: usize = 256 * 1024;
/// Longest accepted draft content, in UTF-16 units.
const MAX_CONTENT_CHARS: usize = 64 * 1024;
/// Longest accepted id, in UTF-16 units.
const MAX_ID_CHARS: usize = 512;

/// Every experiment status (TS `EXPERIMENT_STATUSES`).
pub(crate) const EXPERIMENT_STATUSES: &[&str] =
    &["planned", "running", "done", "failed", "abandoned"];

/// Every paper relation kind (TS `RELATION_TYPES`); wf-core has the enum but no list.
pub(crate) const RELATION_TYPES: &[&str] = &[
    "cites",
    "extends",
    "contradicts",
    "similar",
    "builds_on",
    "uses_method",
];

/// Payload fields that are the draft's text itself, shown without a label.
pub(crate) const PROSE_KEYS: &[&str] = &["body", "notes", "text", "content"];

/// What a tool call wants left for review (TS `Draft`).
#[derive(Debug, Clone)]
pub(crate) struct Draft {
    /// The change the app applies on approval.
    pub(crate) kind: AiProposalKind,
    pub(crate) tool: String,
    pub(crate) resource_id: String,
    /// A workspace entity type, `reading_list_item`, or `paper_relation`, kept as text.
    pub(crate) resource_type: String,
    pub(crate) summary: String,
    pub(crate) payload: Map<String, Value>,
    pub(crate) expected_revision: Option<String>,
    pub(crate) project: Option<ProjectRef>,
    /// Titles for id fields, so the reviewer reads names, not ids.
    pub(crate) shown: Option<HashMap<String, String>>,
}

/// One suggestion file the app may import (TS `FolderDraft`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FolderDraft {
    pub(crate) kind: AiProposalKind,
    pub(crate) tool: String,
    pub(crate) resource_id: String,
    pub(crate) resource_type: Option<String>,
    pub(crate) content: String,
    pub(crate) payload: Option<Map<String, Value>>,
    pub(crate) source_links: Option<Vec<String>>,
    pub(crate) expected_revision: Option<String>,
    pub(crate) created_at: Option<String>,
    pub(crate) project_id: Option<String>,
}

/// The canonical tool name; pre-rename `propose_*` names still resolve (TS `canonicalAiToolName`).
#[must_use]
pub(crate) fn canonical_ai_tool_name(name: &str) -> String {
    match name.strip_prefix("propose_") {
        Some(rest) => format!("suggest_{rest}"),
        None => name.to_owned(),
    }
}

/// A draft file's parsed form, or `None` when it is not one; the file is agent-written, so nothing is trusted.
#[must_use]
pub(crate) fn parse_folder_draft(raw: &str) -> Option<FolderDraft> {
    if utf16_len(raw) > MAX_RAW_CHARS {
        return None;
    }
    let value: Value = serde_json::from_str(raw).ok()?;
    let obj = value.as_object()?;
    let kind: AiProposalKind = serde_json::from_value(obj.get("kind")?.clone()).ok()?;
    let resource_id = optional_string(obj.get("resourceId"))?;
    if utf16_len(&resource_id) > MAX_ID_CHARS {
        return None;
    }
    let content = optional_string(obj.get("content"))?;
    if utf16_len(&content) > MAX_CONTENT_CHARS {
        return None;
    }
    let payload = match obj.get("payload") {
        None => None,
        Some(Value::Object(map)) => Some(map.clone()),
        Some(_) => return None,
    };
    let source_links = match obj.get("sourceLinks") {
        None => None,
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .map(|item| item.as_str().map(str::to_owned))
                .collect::<Option<Vec<String>>>()?,
        ),
        Some(_) => return None,
    };
    let project_id = optional_string(obj.get("projectId"));
    if project_id
        .as_deref()
        .is_some_and(|id| utf16_len(id) > MAX_ID_CHARS)
    {
        return None;
    }
    Some(FolderDraft {
        kind,
        tool: optional_string(obj.get("tool")).unwrap_or_else(|| "local-mcp".to_owned()),
        resource_id,
        resource_type: optional_string(obj.get("resourceType")),
        content,
        payload,
        source_links,
        expected_revision: optional_string(obj.get("expectedRevision")),
        created_at: optional_string(obj.get("createdAt")),
        project_id,
    })
}

/// What the reviewer reads: the change itself, not just the agent's reason for it (TS `draftPreview`).
#[must_use]
pub(crate) fn draft_preview(draft: &Draft, rationale: Option<&str>) -> String {
    let mut out = format!("**{}**", draft.summary);
    if let Some(project) = &draft.project {
        push_block(&mut out, &format!("Project: {}", project.name));
    }
    if let Some(why) = rationale.filter(|r| !r.is_empty()) {
        push_block(&mut out, &format!("Why: {why}"));
    }
    for (key, value) in &draft.payload {
        if let Some(block) = payload_block(draft, key, value) {
            push_block(&mut out, &block);
        }
    }
    out
}

/// The label for a payload field; `None` when the field has nothing to show.
fn payload_block(draft: &Draft, key: &str, value: &Value) -> Option<String> {
    if let Some(shown) = draft.shown.as_ref().and_then(|m| m.get(key)) {
        if shown.is_empty() {
            return None;
        }
        let label_key = if key == "vaultPageId" {
            "note"
        } else {
            key.strip_suffix("Id").unwrap_or(key)
        };
        return Some(format!("{}: {shown}", field_label(label_key)));
    }
    if let Some(text) = value.as_str()
        && (PROSE_KEYS.contains(&key) || text.contains('\n'))
    {
        return Some(text.to_owned());
    }
    if key == "pageIndex"
        && let Some(n) = value.as_f64()
    {
        return Some(format!("Page: {}", n + 1.0));
    }
    Some(format!("{}: {}", field_label(key), preview_value(value)))
}

/// Appends a blank line and then `block`, as the TS `lines.push("", block)` joins them.
fn push_block(out: &mut String, block: &str) {
    out.push_str("\n\n");
    out.push_str(block);
}

/// A camelCase or snake_case key as a sentence label, e.g. `vaultPageId` to `Vault page id` (TS `fieldLabel`).
#[must_use]
pub(crate) fn field_label(key: &str) -> String {
    let mut spaced = String::with_capacity(key.len() + 4);
    let mut prev_lower = false;
    for c in key.chars() {
        if c.is_ascii_uppercase() && prev_lower {
            spaced.push(' ');
        }
        spaced.push(c);
        prev_lower = c.is_ascii_lowercase();
    }
    let words = spaced.replace('_', " ").to_lowercase();
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// A payload value as reviewer text: strings as-is, primitive lists joined, else compact JSON (TS `previewValue`).
#[must_use]
pub(crate) fn preview_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) if items.iter().all(is_primitive) => {
            if items.is_empty() {
                "none".to_owned()
            } else {
                items
                    .iter()
                    .map(primitive_text)
                    .collect::<Vec<String>>()
                    .join(", ")
            }
        }
        _ => value.to_string(),
    }
}

/// Mirrors the TS check `typeof item !== "object"`, which excludes null and arrays too.
fn is_primitive(value: &Value) -> bool {
    !matches!(value, Value::Null | Value::Array(_) | Value::Object(_))
}

fn primitive_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// Writes one draft file and returns the MCP answer; checked with the same parser the app imports with (TS `leaveDraft`).
pub(crate) fn leave_draft(
    session: &VaultSession,
    params: &Map<String, Value>,
    draft: &Draft,
) -> Result<Value, String> {
    let rationale = params
        .get("rationale")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|r| !r.is_empty());
    let mut body = json!({
        "kind": draft.kind,
        "tool": draft.tool,
        "resourceId": draft.resource_id,
        "resourceType": draft.resource_type,
        "content": draft_preview(draft, rationale),
        "payload": draft.payload,
        "createdAt": iso_utc(SystemTime::now()),
    });
    if let Some(map) = body.as_object_mut() {
        if let Some(rev) = draft.expected_revision.as_deref().filter(|r| !r.is_empty()) {
            let _ = map.insert("expectedRevision".to_owned(), Value::String(rev.to_owned()));
        }
        if let Some(id) = draft
            .project
            .as_ref()
            .and_then(|p| p.id.as_deref())
            .filter(|id| !id.is_empty())
        {
            let _ = map.insert("projectId".to_owned(), Value::String(id.to_owned()));
        }
    }
    let json_text = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
    if parse_folder_draft(&json_text).is_none() {
        return Err("That suggestion is too large or incomplete to leave.".to_owned());
    }
    let kind = body.get("kind").and_then(Value::as_str).unwrap_or_default();
    let at = format!(
        "{FOLDER_DRAFTS_DIR}/{}--{kind}--{}.json",
        stamp(),
        random_hex4()?
    );
    session.write_text(&at, &json_text)?;
    let place = draft
        .project
        .as_ref()
        .map(|p| format!(" in {}", p.name))
        .unwrap_or_default();
    content(&[UntrustedItem {
        label: "draft".to_owned(),
        text: format!(
            "Left{place} at {at}. Nothing changes until a person approves it in WeaveForge."
        ),
    }])
}

/// Eight lowercase hex digits, as the first eight characters of a UUID (TS `randomUUID().slice(0, 8)`).
fn random_hex4() -> Result<String, String> {
    let mut buf = [0u8; 4];
    getrandom::fill(&mut buf).map_err(|_| "no OS randomness".to_owned())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// `None` for an absent, non-string, or blank value; otherwise the trimmed text (TS `optionalString`).
fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// UTF-16 length, as the TS limits count it.
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(payload: Map<String, Value>) -> Draft {
        Draft {
            kind: AiProposalKind::Relation,
            tool: "suggest_relation".to_owned(),
            resource_id: "r1".to_owned(),
            resource_type: "paper_relation".to_owned(),
            summary: "Add relation".to_owned(),
            payload,
            expected_revision: None,
            project: None,
            shown: None,
        }
    }

    #[test]
    fn canonical_name_maps_only_the_propose_prefix() {
        assert_eq!(
            canonical_ai_tool_name("propose_relation"),
            "suggest_relation"
        );
        assert_eq!(
            canonical_ai_tool_name("suggest_relation"),
            "suggest_relation"
        );
        assert_eq!(
            canonical_ai_tool_name("search_workspace"),
            "search_workspace"
        );
    }

    #[test]
    fn field_label_splits_camel_case_and_underscores() {
        assert_eq!(field_label("vaultPageId"), "Vault page id");
        assert_eq!(field_label("reading_list_id"), "Reading list id");
        assert_eq!(field_label("status"), "Status");
    }

    #[test]
    fn preview_value_joins_primitive_lists_and_stringifies_the_rest() {
        assert_eq!(preview_value(&json!("text")), "text");
        assert_eq!(preview_value(&json!(["a", 2, true])), "a, 2, true");
        assert_eq!(preview_value(&json!([])), "none");
        assert_eq!(preview_value(&json!([{ "k": 1 }])), r#"[{"k":1}]"#);
        assert_eq!(preview_value(&json!(null)), "null");
    }

    #[test]
    fn draft_preview_shows_project_reason_titles_and_prose() {
        let mut payload = Map::new();
        let _ = payload.insert("body".to_owned(), json!("Hello"));
        let _ = payload.insert("paperId".to_owned(), json!("p1"));
        let mut d = draft(payload);
        d.project = Some(ProjectRef {
            id: Some("p".to_owned()),
            name: "Lab".to_owned(),
            dir: "lab--p".to_owned(),
        });
        d.shown = Some(HashMap::from([(
            "paperId".to_owned(),
            "Attention".to_owned(),
        )]));
        assert_eq!(
            draft_preview(&d, Some("because")),
            "**Add relation**\n\nProject: Lab\n\nWhy: because\n\nHello\n\nPaper: Attention"
        );
    }

    #[test]
    fn draft_preview_numbers_pages_and_skips_blank_titles() {
        let mut payload = Map::new();
        let _ = payload.insert("pageIndex".to_owned(), json!(2));
        let _ = payload.insert("paperId".to_owned(), json!("p1"));
        let _ = payload.insert("tags".to_owned(), json!(["x", "y"]));
        let mut d = draft(payload);
        d.shown = Some(HashMap::from([("paperId".to_owned(), String::new())]));
        assert_eq!(
            draft_preview(&d, None),
            "**Add relation**\n\nPage: 3\n\nTags: x, y"
        );
    }
}

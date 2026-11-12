//! MCP tool-call planning (TS `dispatchMcpTool` and `buildPaperEvidence` in `mcp-browser-relay.ts`).
//!
//! Pure rules only: the canonical tool name, the argument checks, the draft each proposal tool
//! makes, and the paper-evidence check against an excerpt the host has already fetched. The host
//! calls (search, excerpt, drafting) and the relay stay in TS, which runs the plan in the order it
//! names. Refusals carry the same messages the TS threw.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::papers::paper_field::{
    PaperFieldValueData, PaperFieldValueInput, paper_field_value_refusal, parse_paper_field_value,
};

use super::ai_tool_name::canonical_ai_tool_name;

/// Longest quote affix kept, in UTF-16 units (TS `optionalRaw`).
const AFFIX_UNITS: usize = 2_000;
const NOT_ENABLED_DEPLOYMENT: &str = "This MCP tool is not enabled for this deployment.";
const NOT_ENABLED_LIVE: &str = "This MCP tool is not enabled for live execution.";
const NO_EXCERPT: &str = "sourceId was provided but no excerpt could be resolved for evidence.";
const QUOTE_NOT_FOUND: &str = "quoteExact was not found in the source excerpt.";
const NOT_PAPER_SCOPED: &str = "Evidence sourceId must resolve to a paper-scoped source.";
const OTHER_PAPER: &str = "Evidence source belongs to a different paper than paperId.";

/// What one tool call asks the host to do, in order (TS `dispatchMcpTool`'s switch).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum McpPlan {
    /// `ai.searchWorkspace`.
    SearchWorkspace(SearchWorkspacePlan),
    /// `ai.getSourceExcerpt`.
    GetSourceExcerpt(SourceExcerptPlan),
    /// `ai.getWorkspaceOutline`.
    GetWorkspaceOutline,
    /// `ai.proposeZoteroImport`.
    ProposeZoteroImport(ZoteroImportPlan),
    /// `ai.proposeDraft`, after the evidence (when there is any) is fetched and checked.
    ProposeDraft(DraftPlan),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkspacePlan {
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceExcerptPlan {
    pub source_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroImportPlan {
    pub title: String,
    pub authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// A string or a number, as sent; anything else is dropped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<Value>,
    #[serde(rename = "abstract", skip_serializing_if = "Option::is_none")]
    pub abstract_text: Option<String>,
}

/// One proposal: what `proposeDraft` receives, minus the session and settings the host adds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftPlan {
    pub kind: &'static str,
    pub tool: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_type: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<String>,
    pub content: String,
    pub payload: Value,
    /// Evidence to fetch and check with [`paper_evidence`] before the draft is made.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<EvidenceRequest>,
}

/// Paper-scoped evidence a tool asked for, before the excerpt is checked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRequest {
    pub paper_id: String,
    pub source_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_exact: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_suffix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u64>,
}

/// The excerpt the host resolved for a source (TS `AiRetrievalDocument`, the fields used here).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptDoc {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub source: Option<ExcerptSource>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptSource {
    #[serde(default)]
    pub resource_type: Option<String>,
    #[serde(default)]
    pub resource_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub href: Option<String>,
}

/// One checked evidence item (TS `AiEvidence`, as the draft carries it).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperEvidence {
    pub source_id: String,
    pub excerpt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub paper_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locus: Option<Locus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Locus {
    pub quote: Quote,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub exact: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
}

/// Plan one tool call. `tool` is the name as the model sent it (a `propose_*` name is accepted),
/// `enabled` the names this deployment serves (empty when MCP is off), `arguments` the decrypted
/// argument object. Every argument is untrusted until it is checked here.
///
/// # Errors
///
/// Returns the refusal message when the tool is not enabled, a required argument is missing, or a
/// field value has the wrong shape.
pub fn plan_tool_call(tool: &str, arguments: &Value, enabled: &[String]) -> Result<McpPlan, String> {
    let name = canonical_ai_tool_name(tool);
    if name.is_empty() || !enabled.iter().any(|item| item == &name) {
        return Err(NOT_ENABLED_DEPLOYMENT.to_owned());
    }
    let empty: Map<String, Value> = Map::new();
    let args = arguments.as_object().unwrap_or(&empty);
    match name.as_str() {
        "search_workspace" => Ok(McpPlan::SearchWorkspace(SearchWorkspacePlan {
            query: js_string_arg(args, "query"),
            limit: truthy_number(js_number_arg(args, "limit")),
        })),
        "get_source_excerpt" => Ok(McpPlan::GetSourceExcerpt(SourceExcerptPlan {
            source_id: js_string_arg(args, "sourceId"),
        })),
        "get_workspace_outline" => Ok(McpPlan::GetWorkspaceOutline),
        "suggest_zotero_import" => Ok(McpPlan::ProposeZoteroImport(ZoteroImportPlan {
            title: js_string_arg(args, "title"),
            authors: args
                .get("authors")
                .and_then(Value::as_array)
                .map(|items| items.iter().map(js_value_string).collect())
                .unwrap_or_default(),
            doi: raw_string(args, "doi").map(str::to_owned),
            url: raw_string(args, "url").map(str::to_owned),
            year: args.get("year").filter(|v| v.is_string() || v.is_number()).cloned(),
            abstract_text: raw_string(args, "abstract").map(str::to_owned),
        })),
        "suggest_append_paper_note" => {
            let addition = required(args, "addition")?;
            let paper_id = required(args, "paperId")?;
            let evidence = optional(args, "sourceId")
                .map(|source_id| evidence_request(args, &paper_id, source_id, optional_raw(args, "quoteExact")));
            Ok(McpPlan::ProposeDraft(DraftPlan {
                resource_id: Some(paper_id),
                resource_type: Some("paper_note"),
                expected_revision: optional(args, "expectedRevision"),
                evidence,
                ..new_draft(
                    "append_paper_note",
                    "suggest_append_paper_note",
                    format!("Append to paper note:\n\n{addition}"),
                    object(vec![("addition", text(&addition))]),
                )
            }))
        }
        "suggest_create_vault_note" => {
            let title = required(args, "title")?;
            let body = required(args, "body")?;
            Ok(McpPlan::ProposeDraft(new_draft(
                "create_vault_note",
                "suggest_create_vault_note",
                format!("Create vault note: {title}"),
                object(vec![
                    ("title", text(&title)),
                    ("body", text(&body)),
                    ("parentId", maybe(optional(args, "parentId"))),
                ]),
            )))
        }
        "suggest_create_log_entry" => {
            let body = required(args, "body")?;
            let kind = optional(args, "kind").unwrap_or_else(|| "daily".to_owned());
            Ok(McpPlan::ProposeDraft(new_draft(
                "create_log_entry",
                "suggest_create_log_entry",
                format!("Create log entry:\n\n{body}"),
                object(vec![
                    ("body", text(&body)),
                    ("entryDate", maybe(optional(args, "entryDate"))),
                    ("kind", text(&kind)),
                ]),
            )))
        }
        "suggest_paper_update" => {
            let paper_id = required(args, "paperId")?;
            let tags = string_list(args.get("tags"));
            Ok(McpPlan::ProposeDraft(DraftPlan {
                resource_id: Some(paper_id),
                resource_type: Some("paper"),
                expected_revision: optional(args, "expectedRevision"),
                ..new_draft(
                    "paper_update",
                    "suggest_paper_update",
                    "Update paper metadata".to_owned(),
                    object(vec![
                        ("status", maybe(optional(args, "status"))),
                        ("rating", args.get("rating").filter(|v| v.is_number()).cloned()),
                        ("tags", tags.map(|items| json!(items))),
                    ]),
                )
            }))
        }
        "suggest_paper_field_value" => {
            let paper_id = required(args, "paperId")?;
            let field_id = required(args, "fieldId")?;
            let value = field_value(args.get("value"))?;
            let source_id = required(args, "sourceId")?;
            let quote_exact = required_raw(args, "quoteExact")?;
            let preview = match &value {
                PaperFieldValueData::Text(plain) => plain.clone(),
                PaperFieldValueData::Number(number) => js_number_string(*number),
                PaperFieldValueData::List(items) => items.join("; "),
            };
            let value_json = serde_json::to_value(&value).map_err(|error| error.to_string())?;
            // resourceId stays the paper id; no resourceType, so a note-only session is not refused
            // by a metadata grant the field value never needed.
            Ok(McpPlan::ProposeDraft(DraftPlan {
                resource_id: Some(paper_id.clone()),
                expected_revision: optional(args, "expectedRevision"),
                evidence: Some(evidence_request(args, &paper_id, source_id, Some(quote_exact))),
                ..new_draft(
                    "paper_field_value",
                    "suggest_paper_field_value",
                    format!("Set field `{field_id}` to:\n\n{preview}"),
                    object(vec![
                        ("paperId", text(&paper_id)),
                        ("fieldId", text(&field_id)),
                        ("value", Some(value_json)),
                        ("listId", maybe(optional(args, "listId"))),
                        ("fieldName", maybe(optional(args, "fieldName"))),
                    ]),
                )
            }))
        }
        "suggest_reading_list_change" => {
            let list_id = required(args, "listId")?;
            Ok(McpPlan::ProposeDraft(DraftPlan {
                resource_id: Some(list_id.clone()),
                resource_type: Some("reading_list"),
                ..new_draft(
                    "reading_list_change",
                    "suggest_reading_list_change",
                    "Add an item to a reading list".to_owned(),
                    object(vec![
                        ("listId", text(&list_id)),
                        ("paperId", maybe(optional(args, "paperId"))),
                        ("vaultPageId", maybe(optional(args, "vaultPageId"))),
                        ("note", maybe(optional(args, "note"))),
                    ]),
                )
            }))
        }
        "suggest_relation" => {
            // Order matters: the content names the relation before the payload checks toPaper.
            let from_paper = required(args, "fromPaper")?;
            let relation = required(args, "relation")?;
            let to_paper = required(args, "toPaper")?;
            Ok(McpPlan::ProposeDraft(DraftPlan {
                resource_id: Some(from_paper.clone()),
                resource_type: Some("paper"),
                ..new_draft(
                    "relation",
                    "suggest_relation",
                    format!("Add {relation} relation"),
                    object(vec![
                        ("fromPaper", text(&from_paper)),
                        ("toPaper", text(&to_paper)),
                        ("relation", text(&relation)),
                    ]),
                )
            }))
        }
        "suggest_milestone_follow_up" => {
            let title = required(args, "title")?;
            Ok(McpPlan::ProposeDraft(new_draft(
                "milestone_follow_up",
                "suggest_milestone_follow_up",
                format!("Create milestone: {title}"),
                object(vec![
                    ("title", text(&title)),
                    ("description", maybe(optional(args, "description"))),
                    ("targetDate", maybe(optional(args, "targetDate"))),
                ]),
            )))
        }
        "suggest_experiment_follow_up" => {
            let name = required(args, "name")?;
            Ok(McpPlan::ProposeDraft(new_draft(
                "experiment_follow_up",
                "suggest_experiment_follow_up",
                format!("Create experiment: {name}"),
                object(vec![
                    ("name", text(&name)),
                    ("hypothesis", maybe(optional(args, "hypothesis"))),
                    ("relatedPaper", maybe(optional(args, "relatedPaper"))),
                ]),
            )))
        }
        _ => Err(NOT_ENABLED_LIVE.to_owned()),
    }
}

/// Check paper-scoped evidence against the excerpt the host resolved for its source (TS
/// `buildPaperEvidence`, after `getSourceExcerpt`). A quote must appear in the excerpt, and the
/// source must resolve to the paper being edited. `doc` is `None` when the source resolved to nothing.
///
/// # Errors
///
/// Returns the refusal message when no excerpt resolved, the quote is not in it, the source is not
/// paper-scoped, or it belongs to another paper.
pub fn paper_evidence(request: &EvidenceRequest, doc: Option<&ExcerptDoc>) -> Result<Vec<PaperEvidence>, String> {
    let text = doc
        .and_then(|doc| doc.text.as_deref())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| NO_EXCERPT.to_owned())?;
    let quote = request.quote_exact.as_deref().filter(|quote| !quote.is_empty());
    if let Some(exact) = quote {
        if !text.contains(exact) {
            return Err(QUOTE_NOT_FOUND.to_owned());
        }
    }
    let source = doc.and_then(|doc| doc.source.as_ref());
    let paper = source_paper(source).ok_or_else(|| NOT_PAPER_SCOPED.to_owned())?;
    if paper != request.paper_id {
        return Err(OTHER_PAPER.to_owned());
    }
    let locus = quote.map(|exact| Locus {
        quote: Quote {
            kind: "TextQuoteSelector",
            exact: exact.to_owned(),
            prefix: request.quote_prefix.clone().filter(|prefix| !prefix.is_empty()),
            suffix: request.quote_suffix.clone().filter(|suffix| !suffix.is_empty()),
        },
    });
    Ok(vec![PaperEvidence {
        source_id: request.source_id.clone(),
        excerpt: text.to_owned(),
        label: source.and_then(|source| source.label.clone()),
        paper_id: paper,
        href: source.and_then(|source| source.href.clone()),
        locus,
        page: request.page,
    }])
}

/// The paper a source belongs to. A paper or paper note is its own id; a Zotero annotation or note
/// hangs off a paper and is named `paperId:itemKey`, so the paper is the part before the colon.
fn source_paper(source: Option<&ExcerptSource>) -> Option<String> {
    let source = source?;
    let resource_id = source.resource_id.as_deref().unwrap_or("");
    let paper = match source.resource_type.as_deref() {
        Some("paper" | "paper_note") => Some(resource_id),
        Some("zotero_annotation" | "zotero_note") => resource_id.split(':').next(),
        _ => None,
    };
    paper.filter(|paper| !paper.is_empty()).map(str::to_owned)
}

fn evidence_request(
    args: &Map<String, Value>,
    paper_id: &str,
    source_id: String,
    quote_exact: Option<String>,
) -> EvidenceRequest {
    EvidenceRequest {
        paper_id: paper_id.to_owned(),
        source_id,
        quote_exact,
        quote_prefix: optional_raw(args, "quotePrefix"),
        quote_suffix: optional_raw(args, "quoteSuffix"),
        page: optional_page(args.get("page")),
    }
}

fn field_value(raw: Option<&Value>) -> Result<PaperFieldValueData, String> {
    let input = raw.and_then(|value| serde_json::from_value::<PaperFieldValueInput>(value.clone()).ok());
    match input {
        Some(input) => parse_paper_field_value(input, "value"),
        None => Err(paper_field_value_refusal("value")),
    }
}

fn new_draft(kind: &'static str, tool: &'static str, content: String, payload: Value) -> DraftPlan {
    DraftPlan {
        kind,
        tool,
        resource_id: None,
        resource_type: None,
        expected_revision: None,
        content,
        payload,
        evidence: None,
    }
}

/// A payload object with only the keys that have a value, so an absent field is absent (JS
/// `undefined`), not `null`.
fn object(entries: Vec<(&str, Option<Value>)>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .filter_map(|(key, value)| value.map(|value| (key.to_owned(), value)))
            .collect(),
    )
}

fn text(value: &str) -> Option<Value> {
    Some(Value::String(value.to_owned()))
}

fn maybe(value: Option<String>) -> Option<Value> {
    value.map(Value::String)
}

fn raw_string<'a>(args: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

/// A trimmed, non-empty string argument (TS `optional`).
fn optional(args: &Map<String, Value>, key: &str) -> Option<String> {
    raw_string(args, key)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// A required argument (TS `required`).
fn required(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    optional(args, key).ok_or_else(|| format!("{key} is required."))
}

/// A non-empty string kept exactly as sent, truncated to [`AFFIX_UNITS`] (TS `optionalRaw`). Quote
/// affixes must keep their whitespace to match, so they are not trimmed.
fn optional_raw(args: &Map<String, Value>, key: &str) -> Option<String> {
    let value = raw_string(args, key).filter(|value| !value.is_empty())?;
    Some(truncate_units(value, AFFIX_UNITS))
}

/// A required quote: exact text, but blank is refused (TS `requiredRaw`).
fn required_raw(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    optional_raw(args, key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required."))
}

fn truncate_units(text: &str, max: usize) -> String {
    if text.encode_utf16().count() <= max {
        return text.to_owned();
    }
    let units: Vec<u16> = text.encode_utf16().take(max).collect();
    String::from_utf16_lossy(&units)
}

/// A page number: a non-negative integer, as a number or as text (TS `optionalPage`).
fn optional_page(value: Option<&Value>) -> Option<u64> {
    match value? {
        Value::Number(number) => as_index(number.as_f64()?),
        Value::String(text) if !text.trim().is_empty() => as_index(js_string_number(text)),
        _ => None,
    }
}

fn as_index(number: f64) -> Option<u64> {
    (number.is_finite() && number >= 0.0 && number.fract() == 0.0).then(|| number as u64)
}

/// A list of strings, or `None` when the value is not an array of only strings (TS `stringList`).
fn string_list(value: Option<&Value>) -> Option<Vec<String>> {
    value?
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(str::to_owned))
        .collect()
}

/// `String(args[key] ?? "")`.
fn js_string_arg(args: &Map<String, Value>, key: &str) -> String {
    match args.get(key) {
        None | Some(Value::Null) => String::new(),
        Some(value) => js_value_string(value),
    }
}

/// `String(value)` for a JSON value. Arrays join their items with commas, as JS does.
fn js_value_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => js_number_string(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| if item.is_null() { String::new() } else { js_value_string(item) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `Number(args[key])`. Arrays and objects are not converted and read as NaN.
fn js_number_arg(args: &Map<String, Value>, key: &str) -> f64 {
    match args.get(key) {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => js_string_number(text),
        Some(_) => f64::NAN,
    }
}

/// `Number(text)` for a string: blank is 0, hex is read, and anything else that is not a plain
/// decimal is NaN.
fn js_string_number(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    if let Some(hex) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X")) {
        return u64::from_str_radix(hex, 16).map_or(f64::NAN, |value| value as f64);
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'))
    {
        trimmed.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `Number(x) || undefined`: zero and NaN become absent.
fn truthy_number(number: f64) -> Option<f64> {
    (number != 0.0 && !number.is_nan()).then_some(number)
}

/// `String(number)` for a finite-or-not JS number, for the whole-number and special cases.
fn js_number_string(number: f64) -> String {
    if number.is_nan() {
        "NaN".to_owned()
    } else if number.is_infinite() {
        if number > 0.0 { "Infinity".to_owned() } else { "-Infinity".to_owned() }
    } else if number == 0.0 {
        "0".to_owned()
    } else if number.fract() == 0.0 && number.abs() < 1e21 {
        format!("{}", number as i128)
    } else {
        format!("{number}")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const ALL_TOOLS: &[&str] = &[
        "search_workspace",
        "get_source_excerpt",
        "get_workspace_outline",
        "suggest_append_paper_note",
        "suggest_create_vault_note",
        "suggest_create_log_entry",
        "suggest_paper_update",
        "suggest_paper_field_value",
        "suggest_reading_list_change",
        "suggest_relation",
        "suggest_zotero_import",
        "suggest_milestone_follow_up",
        "suggest_experiment_follow_up",
    ];

    /// Source ids are `type|id`, so a test can ask for any resource type it needs.
    const EXCERPT: &str = "Transformers replace recurrence with attention entirely.";

    fn enabled() -> Vec<String> {
        ALL_TOOLS.iter().map(|name| (*name).to_owned()).collect()
    }

    fn plan(tool: &str, args: Value) -> Result<McpPlan, String> {
        plan_tool_call(tool, &args, &enabled())
    }

    fn draft_of(tool: &str, args: Value) -> DraftPlan {
        match plan(tool, args) {
            Ok(McpPlan::ProposeDraft(draft)) => draft,
            other => panic!("{tool} should make a draft, got {other:?}"),
        }
    }

    /// Minimal arguments that satisfy each tool, so the sweep below can reach them all.
    fn happy_args(tool: &str) -> Value {
        match tool {
            "search_workspace" => json!({ "query": "attention" }),
            "get_source_excerpt" => json!({ "sourceId": "paper|paper-1" }),
            "get_workspace_outline" => json!({}),
            "suggest_append_paper_note" => json!({ "paperId": "paper-1", "addition": "A remark." }),
            "suggest_create_vault_note" => json!({ "title": "Note", "body": "Body" }),
            "suggest_create_log_entry" => json!({ "body": "Did a thing." }),
            "suggest_paper_update" => json!({ "paperId": "paper-1", "status": "read" }),
            "suggest_paper_field_value" => json!({
                "paperId": "paper-1", "fieldId": "field-1", "value": "yes",
                "sourceId": "paper|paper-1", "quoteExact": "attention entirely",
            }),
            "suggest_reading_list_change" => json!({ "listId": "list-1", "paperId": "paper-1" }),
            "suggest_relation" => json!({ "fromPaper": "paper-1", "toPaper": "paper-2", "relation": "cites" }),
            "suggest_zotero_import" => json!({ "title": "Attention is all you need" }),
            "suggest_milestone_follow_up" => json!({ "title": "Write intro" }),
            "suggest_experiment_follow_up" => json!({ "name": "Ablation" }),
            _ => json!({}),
        }
    }

    /// The excerpt the host would resolve for a `type|id` source id, or nothing for a bad id.
    fn excerpt_for(source_id: &str) -> Option<ExcerptDoc> {
        let (resource_type, resource_id) = source_id.split_once('|')?;
        if resource_type.is_empty() || resource_id.is_empty() {
            return None;
        }
        serde_json::from_value(json!({
            "text": EXCERPT,
            "source": {
                "sourceId": source_id,
                "resourceType": resource_type,
                "resourceId": resource_id,
                "label": "Attention is all you need",
                "href": format!("/papers/{resource_id}"),
            },
        }))
        .ok()
    }

    /// Plan a field-value or append call, then check its evidence against the excerpt.
    fn evidence_of(tool: &str, args: Value) -> Result<Vec<PaperEvidence>, String> {
        let request = draft_of(tool, args).evidence.expect("a sourceId asks for evidence");
        let doc = excerpt_for(&request.source_id);
        paper_evidence(&request, doc.as_ref())
    }

    // it: "every advertised tool name is dispatchable, and nothing else is"
    #[test]
    fn every_advertised_tool_name_is_dispatchable_and_nothing_else_is() {
        for name in ALL_TOOLS {
            assert!(plan(name, happy_args(name)).is_ok(), "{name} should dispatch");
        }
        assert_eq!(
            plan("delete_everything", json!({})).unwrap_err(),
            "This MCP tool is not enabled for this deployment."
        );
        assert_eq!(
            plan("", json!({})).unwrap_err(),
            "This MCP tool is not enabled for this deployment."
        );
        assert_eq!(
            plan_tool_call("search_workspace", &json!({ "query": "x" }), &[]).unwrap_err(),
            "This MCP tool is not enabled for this deployment.",
            "a deployment with MCP off refuses even a known tool"
        );
    }

    // it: "each proposal tool drafts its own kind, and never writes directly"
    #[test]
    fn each_proposal_tool_drafts_its_own_kind() {
        let kinds = [
            ("suggest_append_paper_note", "append_paper_note"),
            ("suggest_create_vault_note", "create_vault_note"),
            ("suggest_create_log_entry", "create_log_entry"),
            ("suggest_paper_update", "paper_update"),
            ("suggest_paper_field_value", "paper_field_value"),
            ("suggest_reading_list_change", "reading_list_change"),
            ("suggest_relation", "relation"),
            ("suggest_milestone_follow_up", "milestone_follow_up"),
            ("suggest_experiment_follow_up", "experiment_follow_up"),
        ];
        for (tool, kind) in kinds {
            let draft = draft_of(tool, happy_args(tool));
            assert_eq!(draft.kind, kind);
            assert_eq!(draft.tool, tool);
        }
        match plan("suggest_zotero_import", happy_args("suggest_zotero_import")) {
            Ok(McpPlan::ProposeZoteroImport(import)) => assert_eq!(import.title, "Attention is all you need"),
            other => panic!("zotero import should plan an import, got {other:?}"),
        }
    }

    // it: "a missing required argument is refused before any draft is written"
    #[test]
    fn a_missing_required_argument_is_refused() {
        let cases: [(&str, Value, &str); 7] = [
            ("suggest_append_paper_note", json!({ "paperId": "paper-1" }), "addition is required."),
            ("suggest_append_paper_note", json!({ "addition": "x" }), "paperId is required."),
            ("suggest_create_vault_note", json!({ "title": "t" }), "body is required."),
            ("suggest_create_log_entry", json!({}), "body is required."),
            ("suggest_relation", json!({ "fromPaper": "a", "toPaper": "b" }), "relation is required."),
            (
                "suggest_paper_field_value",
                json!({ "paperId": "p", "fieldId": "f", "value": "v", "sourceId": "paper|p" }),
                "quoteExact is required.",
            ),
            ("suggest_experiment_follow_up", json!({}), "name is required."),
        ];
        for (tool, args, message) in cases {
            assert_eq!(plan(tool, args.clone()).unwrap_err(), message, "{tool} {args}");
        }
    }

    // it: "a field value must be a string, a number, or a non-empty list of strings"
    #[test]
    fn a_field_value_must_be_a_string_a_number_or_a_list_of_strings() {
        let refusal = paper_field_value_refusal("value");
        for value in [json!(null), json!({}), json!([]), json!(["  "]), json!([1]), json!(true), json!("")] {
            let mut args = happy_args("suggest_paper_field_value");
            args["value"] = value.clone();
            assert_eq!(plan("suggest_paper_field_value", args).unwrap_err(), refusal, "{value}");
        }
        let mut args = happy_args("suggest_paper_field_value");
        args["value"] = json!([" a ", "b", " "]);
        let draft = draft_of("suggest_paper_field_value", args);
        assert_eq!(draft.payload["value"], json!(["a", "b"]), "list values are trimmed and empty entries dropped");
    }

    // it: "evidence is checked against the real excerpt, not taken on the model's word"
    #[test]
    fn evidence_is_checked_against_the_real_excerpt() {
        let base = happy_args("suggest_paper_field_value");
        let with = |key: &str, value: Value| {
            let mut args = base.clone();
            args[key] = value;
            args
        };
        // A quote the source does not contain.
        assert_eq!(
            evidence_of("suggest_paper_field_value", with("quoteExact", json!("recurrence is essential"))).unwrap_err(),
            "quoteExact was not found in the source excerpt."
        );
        // A source that resolves to a different paper than the one being edited.
        assert_eq!(
            evidence_of("suggest_paper_field_value", with("sourceId", json!("paper|paper-9"))).unwrap_err(),
            "Evidence source belongs to a different paper than paperId."
        );
        // A source that is not paper-scoped at all.
        assert_eq!(
            evidence_of("suggest_paper_field_value", with("sourceId", json!("vault_page|page-1"))).unwrap_err(),
            "Evidence sourceId must resolve to a paper-scoped source."
        );
        // A source id that resolves to nothing.
        assert_eq!(
            evidence_of("suggest_paper_field_value", with("sourceId", json!("unresolvable"))).unwrap_err(),
            "sourceId was provided but no excerpt could be resolved for evidence."
        );

        let mut args = base.clone();
        args["page"] = json!(3);
        args["quotePrefix"] = json!("with ");
        args["quoteSuffix"] = json!(".");
        let evidence = evidence_of("suggest_paper_field_value", args).expect("a matching quote is accepted");
        let item = &evidence[0];
        assert_eq!(item.paper_id, "paper-1");
        assert_eq!(item.excerpt, EXCERPT);
        assert_eq!(item.page, Some(3));
        let quote = &item.locus.as_ref().expect("a quote gives a locus").quote;
        assert_eq!(quote.kind, "TextQuoteSelector");
        assert_eq!(quote.exact, "attention entirely");
        assert_eq!(quote.prefix.as_deref(), Some("with "));
        assert_eq!(quote.suffix.as_deref(), Some("."));
    }

    // it: "a zotero annotation cites the paper it hangs off, not its own composite id"
    #[test]
    fn a_zotero_annotation_cites_the_paper_it_hangs_off() {
        let evidence = evidence_of(
            "suggest_append_paper_note",
            json!({
                "paperId": "paper-1", "addition": "A remark.",
                "sourceId": "zotero_annotation|paper-1:ABCD", "quoteExact": "attention entirely",
            }),
        )
        .expect("the annotation resolves to its paper");
        assert_eq!(evidence[0].paper_id, "paper-1");
    }

    // it: "append-paper-note takes evidence without a quote, and refuses one that does not match"
    #[test]
    fn append_paper_note_takes_evidence_without_a_quote() {
        let evidence = evidence_of(
            "suggest_append_paper_note",
            json!({ "paperId": "paper-1", "addition": "A remark.", "sourceId": "paper|paper-1" }),
        )
        .expect("evidence without a quote is accepted");
        assert!(evidence[0].locus.is_none(), "no quote means no locus, not an empty one");
        assert_eq!(evidence[0].excerpt, EXCERPT);

        assert_eq!(
            evidence_of(
                "suggest_append_paper_note",
                json!({ "paperId": "paper-1", "addition": "x", "sourceId": "paper|paper-1", "quoteExact": "not in there" }),
            )
            .unwrap_err(),
            "quoteExact was not found in the source excerpt."
        );

        // No sourceId at all is allowed: the note simply carries no evidence.
        let bare = draft_of("suggest_append_paper_note", json!({ "paperId": "paper-1", "addition": "x" }));
        assert!(bare.evidence.is_none());
    }

    // it: "an over-long quote affix is truncated rather than passed through"
    #[test]
    fn an_over_long_quote_affix_is_truncated() {
        let mut args = happy_args("suggest_paper_field_value");
        args["quotePrefix"] = json!("x".repeat(5_000));
        let request = draft_of("suggest_paper_field_value", args).evidence.expect("evidence");
        assert_eq!(request.quote_prefix.expect("a prefix").len(), 2_000);
    }
}

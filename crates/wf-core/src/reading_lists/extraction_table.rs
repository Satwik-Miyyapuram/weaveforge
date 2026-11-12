//! Extraction-table rules (TS `features/reading-lists/application/extraction-table.ts`): cell
//! values with rollup columns, markdown and CSV export, the cells still to fill, and the prompt
//! that asks the AI to fill them. Pure: the caller passes the papers' values and definitions.
//! The TS adapter in `application/extraction-rows.ts` does the paper lookups.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::enum_label::enum_label;
use crate::papers::compute_rollup::{RollupFieldDef, RollupValue, compute_rollup_for_papers};
use crate::papers::paper_field::{PaperFieldKind, PaperFieldValueData};

/// A field as the extraction table reads it: its column header, and the kind and options a
/// rollup column needs.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExtractionFieldDef {
    /// Field id.
    pub id: String,
    /// Column header when the field has no other label.
    pub name: String,
    /// Field kind. A `rollup` field is computed for every paper.
    pub kind: PaperFieldKind,
    /// Encoded options (rollups only).
    #[serde(default)]
    pub options: Vec<String>,
}

/// A paper's own cells: the id, plus the title, year and status columns.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExtractionPaper {
    /// Paper id.
    pub id: String,
    /// Title.
    pub title: String,
    /// Publication year, when known.
    #[cfg_attr(feature = "specta", specta(type = Option<u32>))]
    pub year: Option<i64>,
    /// Reading status, a `paperStatus` option value.
    pub status: String,
}

/// One row of the table: a paper and every cell value on it, keyed by field id.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExtractionRow {
    /// The paper's own cells.
    pub paper: ExtractionPaper,
    /// Stored and rollup values, keyed by field id.
    pub values: BTreeMap<String, PaperFieldValueData>,
}

/// One paper's field values, stored and rollup, keyed by field id.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExtractionValues {
    /// Paper id.
    pub paper_id: String,
    /// Values keyed by field id.
    pub values: BTreeMap<String, PaperFieldValueData>,
}

/// A paper listed in the fill prompt.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FillPaper {
    /// Paper id.
    pub id: String,
    /// Title, shown after the id.
    pub title: String,
}

/// Inputs to the fill prompt for one extraction column.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProposeFillInput {
    /// Reading list id.
    pub list_id: String,
    /// Field id of the column.
    pub field_id: String,
    /// Field name of the column.
    pub field_name: String,
    /// Papers to fill, in table order.
    pub papers: Vec<FillPaper>,
}

/// The AI write proposals the table reads. Only the fields a pending fill needs are read.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExtractionProposal {
    /// Proposal id.
    pub id: String,
    /// Proposal kind, such as `paper_field_value`.
    pub kind: String,
    /// Proposal status, such as `pending`.
    pub status: String,
    /// Resource the proposal is about; the paper id when the payload has none.
    pub resource_id: String,
    /// Human-readable summary, shown when the payload has no usable value.
    pub content: String,
    /// Typed executor input.
    #[cfg_attr(
        feature = "specta",
        specta(optional, type = Option<std::collections::BTreeMap<String, specta_typescript::Unknown>>)
    )]
    pub payload: Option<BTreeMap<String, Value>>,
}

/// A cell that has a pending AI fill waiting for review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExtractionPendingFill {
    /// Proposal id.
    pub proposal_id: String,
    /// Paper the fill is for.
    pub paper_id: String,
    /// Field the fill is for.
    pub field_id: String,
    /// The proposed value, as text.
    pub preview: String,
}

/// Each row's values: its stored values, then every rollup column, in list order. A paper that is
/// listed twice keeps its first place. When a `(paper, field)` pair is stored twice the last
/// value wins; a rollup value replaces a stored value under the same field id.
#[must_use]
pub fn paper_value_rows(
    paper_ids: &[String],
    values: &[RollupValue],
    defs: &[ExtractionFieldDef],
) -> Vec<ExtractionValues> {
    let mut seen = BTreeSet::new();
    let ids: Vec<String> = paper_ids
        .iter()
        .filter(|id| seen.insert(id.as_str()))
        .cloned()
        .collect();

    let mut stored: BTreeMap<&str, BTreeMap<String, PaperFieldValueData>> = BTreeMap::new();
    for row in values {
        let _ = stored
            .entry(row.paper_id.as_str())
            .or_default()
            .insert(row.field_id.clone(), row.value.clone());
    }

    let rollup_defs: Vec<RollupFieldDef> = defs.iter().map(to_rollup_def).collect();
    let mut columns: Vec<(&str, BTreeMap<String, PaperFieldValueData>)> = Vec::new();
    for def in defs.iter().filter(|def| def.kind == PaperFieldKind::Rollup) {
        // One call per column: the values are read once for every paper in the list.
        let computed = compute_rollup_for_papers(&ids, &to_rollup_def(def), &rollup_defs, values);
        let column = ids
            .iter()
            .zip(computed)
            .filter_map(|(id, value)| value.map(|value| (id.clone(), value)))
            .collect();
        columns.push((def.id.as_str(), column));
    }

    ids.into_iter()
        .map(|id| {
            let mut cells = stored.get(id.as_str()).cloned().unwrap_or_default();
            for (field_id, column) in &columns {
                if let Some(value) = column.get(&id) {
                    let _ = cells.insert((*field_id).to_owned(), value.clone());
                }
            }
            ExtractionValues {
                paper_id: id,
                values: cells,
            }
        })
        .collect()
}

fn to_rollup_def(def: &ExtractionFieldDef) -> RollupFieldDef {
    RollupFieldDef {
        id: def.id.clone(),
        kind: def.kind,
        options: def.options.clone(),
    }
}

/// A column as the table names it: `title`, `year`, `status`, or `field:<id>`.
enum Column<'a> {
    Title,
    Year,
    Status,
    Field(&'a str),
}

fn parse_column(column: &str) -> Column<'_> {
    match column {
        "title" => Column::Title,
        "year" => Column::Year,
        "status" => Column::Status,
        other => Column::Field(other.strip_prefix("field:").unwrap_or(other)),
    }
}

fn column_label(column: &str, defs: &[ExtractionFieldDef]) -> String {
    match parse_column(column) {
        Column::Title => "Title".to_owned(),
        Column::Year => "Year".to_owned(),
        Column::Status => "Status".to_owned(),
        Column::Field(id) => defs
            .iter()
            .find(|def| def.id == id)
            .map_or_else(|| id.to_owned(), |def| def.name.clone()),
    }
}

fn cell_text(row: &ExtractionRow, column: &str) -> String {
    match parse_column(column) {
        Column::Title => row.paper.title.clone(),
        Column::Year => row
            .paper
            .year
            .map_or_else(String::new, |year| year.to_string()),
        Column::Status => enum_label("paperStatus", &row.paper.status),
        Column::Field(id) => format_cell(row.values.get(id)),
    }
}

fn format_cell(value: Option<&PaperFieldValueData>) -> String {
    match value {
        None => String::new(),
        Some(PaperFieldValueData::Text(text)) => text.clone(),
        Some(PaperFieldValueData::Number(number)) => js_number(*number),
        Some(PaperFieldValueData::List(items)) => items.join("; "),
    }
}

/// A Markdown table of the given columns, one row per table row.
#[must_use]
pub fn extraction_markdown(
    rows: &[ExtractionRow],
    defs: &[ExtractionFieldDef],
    columns: &[String],
) -> String {
    let headers: Vec<String> = columns
        .iter()
        .map(|column| column_label(column, defs))
        .collect();
    let mut lines = vec![
        format!("| {} |", headers.join(" | ")),
        format!("| {} |", vec!["---"; headers.len()].join(" | ")),
    ];
    for row in rows {
        let cells: Vec<String> = columns
            .iter()
            .map(|column| escape_md(&cell_text(row, column)))
            .collect();
        lines.push(format!("| {} |", cells.join(" | ")));
    }
    lines.join("\n")
}

/// A CSV of the given columns, with a header line.
#[must_use]
pub fn extraction_csv(
    rows: &[ExtractionRow],
    defs: &[ExtractionFieldDef],
    columns: &[String],
) -> String {
    let headers: Vec<String> = columns
        .iter()
        .map(|column| csv_escape(&column_label(column, defs)))
        .collect();
    let mut lines = vec![headers.join(",")];
    for row in rows {
        let cells: Vec<String> = columns
            .iter()
            .map(|column| csv_escape(&cell_text(row, column)))
            .collect();
        lines.push(cells.join(","));
    }
    lines.join("\n")
}

fn escape_md(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

fn csv_escape(value: &str) -> String {
    if value.contains(['"', ',', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// The papers whose cell for `field_id` is empty and not already in `pending_paper_ids`, in row
/// order. `pending_paper_ids` are the papers with a pending fill for this field.
#[must_use]
pub fn empty_cell_paper_ids(
    rows: &[ExtractionRow],
    field_id: &str,
    pending_paper_ids: &[String],
) -> Vec<String> {
    let pending: BTreeSet<&str> = pending_paper_ids.iter().map(String::as_str).collect();
    rows.iter()
        .filter(|row| !pending.contains(row.paper.id.as_str()))
        .filter(|row| is_empty_cell(row.values.get(field_id)))
        .map(|row| row.paper.id.clone())
        .collect()
}

fn is_empty_cell(value: Option<&PaperFieldValueData>) -> bool {
    match value {
        None => true,
        Some(PaperFieldValueData::Text(text)) => text.trim().is_empty(),
        Some(PaperFieldValueData::List(items)) => items.is_empty(),
        Some(PaperFieldValueData::Number(_)) => false,
    }
}

/// The prompt that asks the AI to fill one extraction column for the given papers.
#[must_use]
pub fn build_propose_fill_prompt(input: &ProposeFillInput) -> String {
    let mut lines = vec![
        format!(
            "Fill extraction column «{}» ({}) for reading list {}.",
            input.field_name, input.field_id, input.list_id
        ),
        String::new(),
        "For each paper below:".to_owned(),
        "1. Call get_source_excerpt on an approved paper/note/annotation source.".to_owned(),
        "2. Extract the value for this column from the source.".to_owned(),
        "3. Call suggest_paper_field_value with paperId, fieldId, value, fieldName, sourceId, and quoteExact (required). Optionally quotePrefix, quoteSuffix, page.".to_owned(),
        "Do not write cells directly — every value must land as a pending proposal for /ai-review.".to_owned(),
        String::new(),
        "Papers:".to_owned(),
    ];
    lines.extend(
        input
            .papers
            .iter()
            .map(|paper| format!("- {} — {}", paper.id, paper.title)),
    );
    lines.join("\n")
}

/// The pending `paper_field_value` proposals, one per cell. `field_id` limits them to one field;
/// an empty or missing id keeps every field. A proposal with no usable paper or field id is
/// skipped.
#[must_use]
pub fn pending_field_fills(
    proposals: &[ExtractionProposal],
    field_id: Option<&str>,
) -> Vec<ExtractionPendingFill> {
    let filter = field_id.filter(|id| !id.is_empty());
    let mut out = Vec::new();
    for proposal in proposals {
        if proposal.kind != "paper_field_value" || proposal.status != "pending" {
            continue;
        }
        let Some(payload) = proposal.payload.as_ref() else {
            continue;
        };
        let paper_id = payload
            .get("paperId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map_or_else(|| proposal.resource_id.clone(), str::to_owned);
        let field = payload
            .get("fieldId")
            .and_then(Value::as_str)
            .map_or("", str::trim);
        if paper_id.is_empty() || field.is_empty() {
            continue;
        }
        if filter.is_some_and(|wanted| field != wanted) {
            continue;
        }
        let preview = match payload.get("value") {
            Some(Value::String(text)) => text.clone(),
            Some(Value::Number(number)) => number
                .as_f64()
                .map_or_else(|| number.to_string(), js_number),
            Some(Value::Array(items)) => items.iter().map(js_string).collect::<Vec<_>>().join("; "),
            _ => proposal.content.clone(),
        };
        out.push(ExtractionPendingFill {
            proposal_id: proposal.id.clone(),
            paper_id,
            field_id: field.to_owned(),
            preview,
        });
    }
    out
}

/// JavaScript's `String(value)` for a JSON value, as the TS preview used it.
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number
            .as_f64()
            .map_or_else(|| number.to_string(), js_number),
        Value::String(text) => text.clone(),
        // Nested arrays join with "," and show a null item as an empty string.
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// JavaScript's `String(number)` for the whole numbers and finite decimals a field holds.
fn js_number(number: f64) -> String {
    if number.is_nan() {
        "NaN".to_owned()
    } else if number.is_infinite() {
        (if number > 0.0 {
            "Infinity"
        } else {
            "-Infinity"
        })
        .to_owned()
    } else if number.fract() == 0.0 && number.abs() < 1e21 {
        // `{:.0}` keeps the sign of -0.0; JavaScript prints it as "0".
        let text = format!("{number:.0}");
        if text == "-0" { "0".to_owned() } else { text }
    } else {
        number.to_string()
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn paper(id: &str, title: &str) -> ExtractionPaper {
        ExtractionPaper {
            id: id.to_owned(),
            title: title.to_owned(),
            year: None,
            status: "to_read".to_owned(),
        }
    }

    fn row(id: &str, title: &str, cells: &[(&str, PaperFieldValueData)]) -> ExtractionRow {
        ExtractionRow {
            paper: paper(id, title),
            values: cells
                .iter()
                .map(|(field, value)| ((*field).to_owned(), value.clone()))
                .collect(),
        }
    }

    fn method_def() -> ExtractionFieldDef {
        ExtractionFieldDef {
            id: "f1".to_owned(),
            name: "Method".to_owned(),
            kind: PaperFieldKind::Text,
            options: Vec::new(),
        }
    }

    fn proposal(id: &str, kind: &str, resource_id: &str, payload: Value) -> ExtractionProposal {
        ExtractionProposal {
            id: id.to_owned(),
            kind: kind.to_owned(),
            status: "pending".to_owned(),
            resource_id: resource_id.to_owned(),
            content: "summary".to_owned(),
            payload: serde_json::from_value(payload).ok(),
        }
    }

    #[test]
    fn paper_rows_keep_list_order_and_first_place_of_duplicates() {
        let ids: Vec<String> = ["p1", "p2", "p1"]
            .iter()
            .map(|id| (*id).to_owned())
            .collect();
        let values = vec![RollupValue {
            paper_id: "p1".to_owned(),
            field_id: "f1".to_owned(),
            value: PaperFieldValueData::Text("RL".to_owned()),
        }];
        let rows = paper_value_rows(&ids, &values, &[method_def()]);
        assert_eq!(
            rows.iter()
                .map(|row| row.paper_id.as_str())
                .collect::<Vec<_>>(),
            vec!["p1", "p2"]
        );
        assert_eq!(
            rows.first().and_then(|row| row.values.get("f1")),
            Some(&PaperFieldValueData::Text("RL".to_owned()))
        );
    }

    #[test]
    fn markdown_and_csv_include_the_selected_columns() {
        let rows = vec![row(
            "p1",
            "A",
            &[("f1", PaperFieldValueData::Text("RL".to_owned()))],
        )];
        let columns = vec!["title".to_owned(), "field:f1".to_owned()];
        assert_eq!(
            extraction_markdown(&rows, &[method_def()], &columns),
            "| Title | Method |\n| --- | --- |\n| A | RL |"
        );
        assert_eq!(
            extraction_csv(&rows, &[method_def()], &columns),
            "Title,Method\nA,RL"
        );
    }

    #[test]
    fn pending_fills_join_only_paper_field_value_proposals_for_the_field() {
        let proposals = vec![
            proposal(
                "prop-1",
                "paper_field_value",
                "p2",
                json!({"paperId": "p2", "fieldId": "f1", "value": "VAE"}),
            ),
            proposal(
                "prop-2",
                "append_paper_note",
                "p1",
                json!({"addition": "x"}),
            ),
            proposal(
                "prop-3",
                "paper_field_value",
                "p1",
                json!({"paperId": "p1", "fieldId": "f2", "value": 3}),
            ),
        ];
        assert_eq!(
            pending_field_fills(&proposals, Some("f1")),
            vec![ExtractionPendingFill {
                proposal_id: "prop-1".to_owned(),
                paper_id: "p2".to_owned(),
                field_id: "f1".to_owned(),
                preview: "VAE".to_owned(),
            }]
        );
    }

    #[test]
    fn empty_cells_skip_papers_with_a_pending_fill() {
        let rows = vec![
            row(
                "p1",
                "A",
                &[("f1", PaperFieldValueData::Text("RL".to_owned()))],
            ),
            row("p2", "B", &[]),
        ];
        assert_eq!(
            empty_cell_paper_ids(&rows, "f1", &[]),
            vec!["p2".to_owned()]
        );
        assert_eq!(
            empty_cell_paper_ids(&rows, "f1", &["p2".to_owned()]),
            Vec::<String>::new()
        );
    }

    #[test]
    fn fill_prompt_names_the_tool_the_list_and_each_paper() {
        let prompt = build_propose_fill_prompt(&ProposeFillInput {
            list_id: "list-1".to_owned(),
            field_id: "f1".to_owned(),
            field_name: "Method".to_owned(),
            papers: vec![FillPaper {
                id: "p2".to_owned(),
                title: "B".to_owned(),
            }],
        });
        assert!(prompt.contains("suggest_paper_field_value"));
        assert!(prompt.contains("quoteExact"));
        assert!(prompt.contains("- p2 — B"));
        assert!(prompt.contains("list-1"));
    }
}

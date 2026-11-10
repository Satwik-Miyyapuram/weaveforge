//! Live results tables in report notes:
//!
//!   ![caption](exptable:<experimentId>,<experimentId>,…)
//!
//! The note stores only the run ids. The table is rebuilt from the runs' current metrics on every
//! render and export, so it never goes stale. Ported from
//! `apps/web/src/features/report/application/results-table-refs.ts`.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::Serialize;
use serde_json::Value;

use super::artifact_markdown::safe_artifact_caption;
use super::artifact_refs::{decode_uri_component, utf16_len};
use super::markdown_to_latex::escape_latex_text;
use crate::experiment_status::{self, ResultsTable};

/// The Markdown destination prefix of a results-table ref.
pub const RESULTS_TABLE_PREFIX: &str = "exptable:";

static REF_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\(exptable:([^)\s]*)\)").ok());

/// One `exptable:` reference found in report markdown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ResultsTableRef {
    /// The run ids in the ref, in order, with undecodable or empty parts dropped.
    pub experiment_ids: Vec<String>,
    /// The alt text, as written.
    pub caption: String,
    /// UTF-16 offset of the first character of the ref.
    pub start: usize,
    /// UTF-16 offset just past the ref.
    pub end: usize,
    /// The ref exactly as it appears in the markdown.
    pub raw: String,
}

/// A ref with byte offsets, used internally by the resolver.
struct FoundRef {
    experiment_ids: Vec<String>,
    caption: String,
    byte_start: usize,
    byte_end: usize,
    raw: String,
}

/// Canonical `![caption](exptable:…)` for the given run ids. The caption loses brackets and line
/// breaks, and the ids are percent-encoded so a parenthesis cannot end the destination.
#[must_use]
pub fn serialise_results_table_ref(experiment_ids: &[String], caption: &str) -> String {
    let ids: Vec<String> = experiment_ids.iter().map(|id| encode_id(id)).collect();
    format!(
        "![{}]({RESULTS_TABLE_PREFIX}{})",
        clean_caption(caption),
        ids.join(",")
    )
}

/// Every `exptable:` reference in the markdown, with UTF-16 offsets.
#[must_use]
pub fn parse_results_table_refs(markdown: &str) -> Vec<ResultsTableRef> {
    scan(markdown)
        .into_iter()
        .map(|found| ResultsTableRef {
            start: utf16_len(&markdown[..found.byte_start]),
            end: utf16_len(&markdown[..found.byte_end]),
            experiment_ids: found.experiment_ids,
            caption: found.caption,
            raw: found.raw,
        })
        .collect()
}

/// Replaces every results-table ref with its table, each on lines of its own. `latex` picks the
/// LaTeX figure block over the Markdown table. Runs missing from `experiments` are reported with
/// a warning line.
#[must_use]
pub fn resolve_results_tables(body: &str, experiments: &[Value], latex: bool) -> String {
    let refs = scan(body);
    if refs.is_empty() {
        return body.to_owned();
    }
    let by_id: HashMap<&str, &Value> = experiments
        .iter()
        .filter_map(|e| e.get("id").and_then(Value::as_str).map(|id| (id, e)))
        .collect();
    let mut out = String::new();
    let mut cursor = 0;
    for found in &refs {
        out.push_str(&body[cursor..found.byte_start]);
        cursor = found.byte_end;
        let block = render_block(found, &by_id, latex);
        // Tables and figure blocks only parse at the start of a line.
        let lead = if out.is_empty() || out.ends_with("\n\n") {
            ""
        } else {
            "\n\n"
        };
        let rest = &body[cursor..];
        let trail = if rest.is_empty() || rest.starts_with("\n\n") {
            ""
        } else {
            "\n\n"
        };
        out.push_str(lead);
        out.push_str(&block);
        out.push_str(trail);
    }
    out.push_str(&body[cursor..]);
    out
}

/// Scans `markdown` for refs whose id list decodes to at least one id.
fn scan(markdown: &str) -> Vec<FoundRef> {
    let Some(regex) = REF_RE.as_ref() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for captures in regex.captures_iter(markdown) {
        let Some(whole) = captures.get(0) else {
            continue;
        };
        let caption = captures.get(1).map_or("", |m| m.as_str());
        let ids_part = captures.get(2).map_or("", |m| m.as_str());
        let experiment_ids: Vec<String> = ids_part.split(',').filter_map(decode_id).collect();
        if experiment_ids.is_empty() {
            continue;
        }
        out.push(FoundRef {
            experiment_ids,
            caption: caption.to_owned(),
            byte_start: whole.start(),
            byte_end: whole.end(),
            raw: whole.as_str().to_owned(),
        });
    }
    out
}

/// One id part, decoded and trimmed. `None` for a malformed escape or an empty id.
fn decode_id(part: &str) -> Option<String> {
    decode_uri_component(part)
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}

/// `encodeURIComponent`, with `()` also encoded so a parenthesis cannot end the destination.
fn encode_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for &byte in id.as_bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'')
        {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// Drops brackets and line breaks, then trims. The parser reads alt with `[^\]]*`.
fn clean_caption(caption: &str) -> String {
    caption
        .chars()
        .filter(|c| !matches!(c, '[' | ']' | '\r' | '\n'))
        .collect::<String>()
        .trim()
        .to_owned()
}

/// Turns every run of `\r` and `\n` into one space.
fn newline_runs_to_space(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_break = false;
    for ch in text.chars() {
        if ch == '\r' || ch == '\n' {
            if !in_break {
                out.push(' ');
            }
            in_break = true;
        } else {
            out.push(ch);
            in_break = false;
        }
    }
    out
}

/// The table or warning text that replaces one ref.
fn render_block(found: &FoundRef, by_id: &HashMap<&str, &Value>, latex: bool) -> String {
    let runs: Vec<Value> = found
        .experiment_ids
        .iter()
        .filter_map(|id| by_id.get(id.as_str()).map(|run| (*run).clone()))
        .collect();
    let missing = found.experiment_ids.len().saturating_sub(runs.len());
    let caption = if found.caption.is_empty() {
        "Results"
    } else {
        found.caption.as_str()
    };
    let mut parts = Vec::new();
    if !runs.is_empty() {
        let table = experiment_status::results_table(&runs);
        parts.push(if latex {
            table_latex(&table, caption)
        } else {
            table_markdown(&table, caption)
        });
    }
    if missing > 0 {
        parts.push(not_found(caption, missing));
    }
    parts.join("\n\n")
}

/// A GFM table under a bold caption.
fn table_markdown(table: &ResultsTable, caption: &str) -> String {
    let divider: Vec<String> = table.header.iter().map(|_| "---".to_owned()).collect();
    let mut lines = vec![
        format!("**{}**", safe_artifact_caption(Some(caption))),
        String::new(),
        markdown_row(&table.header),
        markdown_row(&divider),
    ];
    lines.extend(table.rows.iter().map(|row| markdown_row(row)));
    lines.join("\n")
}

/// One table row. Pipes are escaped and line breaks flattened, so a cell stays on its row.
fn markdown_row(cells: &[String]) -> String {
    let joined: Vec<String> = cells
        .iter()
        .map(|cell| newline_runs_to_space(&cell.replace('|', "\\|")))
        .collect();
    format!("| {} |", joined.join(" | "))
}

/// A `figure` block holding a `tabular`. The Markdown-to-LaTeX converter passes figure blocks
/// through untouched, so the cells are escaped here.
fn table_latex(table: &ResultsTable, caption: &str) -> String {
    let columns = "r".repeat(table.header.len().saturating_sub(1));
    let mut lines = vec![
        "\\begin{figure}[ht]".to_owned(),
        "\\centering".to_owned(),
        format!("\\begin{{tabular}}{{l{columns}}}"),
        "\\hline".to_owned(),
        latex_row(&table.header),
        "\\hline".to_owned(),
    ];
    lines.extend(table.rows.iter().map(|row| latex_row(row)));
    lines.push("\\hline".to_owned());
    lines.push("\\end{tabular}".to_owned());
    lines.push(format!("\\caption{{{}}}", latex_cell(caption)));
    lines.push("\\end{figure}".to_owned());
    lines.join("\n")
}

fn latex_row(cells: &[String]) -> String {
    let joined: Vec<String> = cells.iter().map(|cell| latex_cell(cell)).collect();
    format!("{} \\\\", joined.join(" & "))
}

fn latex_cell(text: &str) -> String {
    escape_latex_text(&newline_runs_to_space(text)).replace('|', "\\textbar{}")
}

/// The warning line for runs that are not in the export.
fn not_found(caption: &str, count: usize) -> String {
    let noun = if count == 1 { "run" } else { "runs" };
    format!(
        "> ⚠️ Results table “{}”: {count} {noun} not found.",
        safe_artifact_caption(Some(caption))
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn exp(id: &str, name: &str, metrics: &Value) -> Value {
        json!({ "id": id, "name": name, "metrics": metrics })
    }

    fn run_a() -> Value {
        exp("a", "baseline", &json!({ "acc": 0.9, "loss": 0.25 }))
    }

    fn run_b() -> Value {
        exp("b", "big|lr", &json!({ "acc": 0.95, "f1": 0.8 }))
    }

    fn table_ab() -> ResultsTable {
        experiment_status::results_table(&[run_a(), run_b()])
    }

    #[test]
    fn serialise_and_parse_round_trip_ids_and_caption() {
        let ids = vec!["a".to_owned(), "b,c".to_owned()];
        let md = format!(
            "Intro {} end",
            serialise_results_table_ref(&ids, "Main [results]")
        );
        let refs = parse_results_table_refs(&md);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].experiment_ids, ["a", "b,c"]);
        assert_eq!(refs[0].caption, "Main results");
        assert_eq!(&md[refs[0].start..refs[0].end], refs[0].raw);
    }

    #[test]
    fn serialise_encodes_parentheses_and_keeps_unreserved_marks() {
        let ids = vec!["x(1)!*'~".to_owned()];
        assert_eq!(
            serialise_results_table_ref(&ids, "R"),
            "![R](exptable:x%281%29!*'~)"
        );
    }

    #[test]
    fn parse_offsets_count_utf16_units_after_non_ascii() {
        let md = "é 😀 ![a](exptable:e1)";
        let refs = parse_results_table_refs(md);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].start, 5);
        assert_eq!(refs[0].end, 5 + refs[0].raw.encode_utf16().count());
    }

    #[test]
    fn parse_ignores_expartifact_refs_empty_id_lists_and_plain_images() {
        let md = "![x](expartifact:a/loss.png) ![y](exptable:) ![z](https://e.org/t.png)";
        assert!(parse_results_table_refs(md).is_empty());
    }

    #[test]
    fn table_header_and_rows_match_the_run_metrics() {
        let table = table_ab();
        assert_eq!(table.header, ["Run", "acc", "f1", "loss"]);
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.rows[0][0], "baseline");
        assert_eq!(table.rows[0][2], "—");
        assert_eq!(table.rows[1][3], "—");
    }

    #[test]
    fn markdown_table_escapes_pipes_and_is_gfm() {
        let md = table_markdown(&table_ab(), "Results");
        let lines: Vec<&str> = md.split('\n').collect();
        assert!(lines.contains(&"| Run | acc | f1 | loss |"), "{md}");
        assert!(lines.contains(&"| --- | --- | --- | --- |"), "{md}");
        assert!(md.contains("big\\|lr"), "{md}");
        assert!(md.starts_with("**Results**"), "{md}");
    }

    #[test]
    fn latex_table_is_a_figure_block_with_escaped_cells() {
        let tex = table_latex(&table_ab(), "Results & more");
        let lines: Vec<&str> = tex.split('\n').collect();
        assert_eq!(lines[0], "\\begin{figure}[ht]");
        assert_eq!(lines.last().copied(), Some("\\end{figure}"));
        assert!(tex.contains("\\begin{tabular}{lrrr}"), "{tex}");
        assert!(tex.contains("Run & acc & f1 & loss \\\\"), "{tex}");
        assert!(tex.contains("big\\textbar{}lr"), "{tex}");
        assert!(tex.contains("\\caption{Results \\& more}"), "{tex}");
    }

    #[test]
    fn resolve_rebuilds_tables_in_ref_order_on_their_own_lines() {
        let body = format!(
            "Before {} after.",
            serialise_results_table_ref(&["b".to_owned(), "a".to_owned()], "R")
        );
        let md = resolve_results_tables(&body, &[run_a(), run_b()], false);
        assert!(md.starts_with("Before \n\n**R**"), "{md}");
        assert!(md.find("big\\|lr") < md.find("baseline"), "{md}");
        assert!(md.ends_with("\n\n after."), "{md}");
        let updated = resolve_results_tables(
            &body,
            &[exp("a", "baseline", &json!({ "acc": 0.5 })), run_b()],
            false,
        );
        assert_ne!(updated, md);
    }

    #[test]
    fn resolve_skips_unknown_ids_and_warns_when_none_are_found() {
        let partial_body = serialise_results_table_ref(&["a".to_owned(), "gone".to_owned()], "R");
        let partial = resolve_results_tables(&partial_body, &[run_a()], false);
        assert!(
            partial.contains("baseline") && partial.contains("1 run not found"),
            "{partial}"
        );
        let none_body = serialise_results_table_ref(&["gone".to_owned()], "R");
        let none = resolve_results_tables(&none_body, &[run_a()], true);
        assert!(
            !none.contains("tabular") && none.contains("not found"),
            "{none}"
        );
    }

    #[test]
    fn resolve_leaves_a_body_without_table_refs_untouched() {
        let body = "plain ![x](expartifact:a/b.png)";
        assert_eq!(resolve_results_tables(body, &[run_a()], true), body);
    }

    #[test]
    fn empty_caption_falls_back_to_results() {
        let body = "![](exptable:a)";
        let md = resolve_results_tables(body, &[run_a()], false);
        assert!(md.starts_with("**Results**"), "{md}");
    }
}

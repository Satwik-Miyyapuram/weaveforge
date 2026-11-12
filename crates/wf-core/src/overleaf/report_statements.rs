//! Statements for the Overleaf link rows written from the desktop copy (port of the statement
//! building in apps/web/src/features/overleaf/infrastructure/local-overleaf-gateway.ts). The
//! gateway runs the statement; the rules about what may go in a row live here, next to the
//! route's rules in `overleaf`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{entry_file_error, external_url, is_valid_project_id, sanitize_section_targets};
use crate::reader_analysis::lines::js_trim;

/// Entry file used when the caller leaves it blank.
const DEFAULT_ENTRY: &str = "main.tex";

/// A statement with its bound parameters, in `$1..$n` order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    /// The SQL text with `$1..$n` placeholders.
    pub sql: String,
    /// The values bound to the placeholders.
    pub params: Vec<String>,
}

/// A new link row to insert.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReport {
    /// The workspace project the report belongs to.
    pub project_id: String,
    /// The Overleaf connection used to reach the project.
    pub connection_id: String,
    /// The report's display title.
    pub title: String,
    /// The Overleaf project id.
    pub overleaf_project_id: String,
    /// The entry file of the report within the Overleaf project.
    pub entry_file: String,
}

/// The fields of a link row to change. A `None` field is left as it is.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchReport {
    /// The id of the link row to change.
    pub id: String,
    /// A new display title, or `None` to keep it.
    pub title: Option<String>,
    /// A new Overleaf project id, or `None` to keep it.
    pub overleaf_project_id: Option<String>,
    /// A new entry file, or `None` to keep it.
    pub entry_file: Option<String>,
    /// New section targets, or `None` to keep them.
    pub section_targets: Option<Value>,
}

/// The insert for a new link row. Refuses an Overleaf id that could reshape a clone URL, and an
/// unsafe entry file; a blank entry file becomes `main.tex`.
///
/// # Errors
///
/// Fails with the refusal message: the project id or entry file is invalid.
pub fn create_report_statement(input: &CreateReport) -> Result<Statement, String> {
    let entry_file = non_blank_entry(&input.entry_file);
    if !is_valid_project_id(&input.overleaf_project_id) {
        return Err("Overleaf project id is invalid.".to_owned());
    }
    if let Some(message) = entry_file_error(&entry_file) {
        return Err(message.to_owned());
    }
    Ok(Statement {
        sql: "insert into overleaf_linked_reports\n         (user_id, project_id, connection_id, title, overleaf_project_id, entry_file, external_url)\n       values (auth.uid(), $1, $2, $3, $4, $5, $6)".to_owned(),
        params: vec![
            input.project_id.clone(),
            input.connection_id.clone(),
            js_trim(&input.title).to_owned(),
            input.overleaf_project_id.clone(),
            entry_file,
            external_url(&input.overleaf_project_id),
        ],
    })
}

/// The update for one link row. Only the fields named change, so a title save never overwrites the
/// section targets. Pointing at another project or file also clears the recorded failure.
///
/// # Errors
///
/// Fails with the refusal message: section targets, title, project id or entry file is invalid, or
/// no field is named.
pub fn patch_report_statement(input: &PatchReport) -> Result<Statement, String> {
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();

    if let Some(raw) = &input.section_targets {
        let targets = sanitize_section_targets(raw)
            .ok_or_else(|| "Section targets are invalid.".to_owned())?;
        // The column is jsonb and the parameter is text, so it is cast here.
        let json = serde_json::to_string(&targets).unwrap_or_default();
        bind(&mut sets, &mut params, "section_targets", json, "::jsonb");
    }
    if let Some(raw) = &input.title {
        let title = js_trim(raw);
        if title.is_empty() {
            return Err("Title cannot be empty.".to_owned());
        }
        bind(&mut sets, &mut params, "title", title.to_owned(), "");
    }
    if let Some(raw) = &input.overleaf_project_id {
        let id = js_trim(raw);
        if !is_valid_project_id(id) {
            return Err("Overleaf project id is invalid.".to_owned());
        }
        bind(
            &mut sets,
            &mut params,
            "overleaf_project_id",
            id.to_owned(),
            "",
        );
        // Recomputed, not carried over: a stale link would point at the old project.
        bind(&mut sets, &mut params, "external_url", external_url(id), "");
    }
    if let Some(raw) = &input.entry_file {
        let entry_file = non_blank_entry(raw);
        if let Some(message) = entry_file_error(&entry_file) {
            return Err(message.to_owned());
        }
        bind(&mut sets, &mut params, "entry_file", entry_file, "");
    }
    if sets.is_empty() {
        return Err("Nothing to update.".to_owned());
    }
    // A different project or file invalidates what was fetched under the old target.
    if input.overleaf_project_id.is_some() || input.entry_file.is_some() {
        sets.push("last_error = null".to_owned());
    }

    params.push(input.id.clone());
    let sql = format!(
        "update overleaf_linked_reports set {}, updated_at = now()\n       where id = ${} and user_id = auth.uid()",
        sets.join(", "),
        params.len()
    );
    Ok(Statement { sql, params })
}

/// Binds `value` to the next `$n` and adds `column = $n<cast>` to the set list.
fn bind(sets: &mut Vec<String>, params: &mut Vec<String>, column: &str, value: String, cast: &str) {
    params.push(value);
    sets.push(format!("{column} = ${}{cast}", params.len()));
}

/// The trimmed entry file, or `main.tex` when it is blank.
fn non_blank_entry(raw: &str) -> String {
    let trimmed = js_trim(raw);
    if trimmed.is_empty() {
        DEFAULT_ENTRY.to_owned()
    } else {
        trimmed.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CreateReport, PatchReport, create_report_statement, patch_report_statement};

    fn patch(id: &str) -> PatchReport {
        PatchReport {
            id: id.to_owned(),
            title: None,
            overleaf_project_id: None,
            entry_file: None,
            section_targets: None,
        }
    }

    // it: "gateway: a title edit writes the title and nothing else"
    #[test]
    fn title_edit_writes_title_only() {
        let mut input = patch("r1");
        input.title = Some("MSc thesis".to_owned());
        let statement = patch_report_statement(&input).expect("title edit");
        assert!(
            statement.sql.contains("set title = $1, updated_at = now()"),
            "{}",
            statement.sql
        );
        assert!(
            !statement.sql.contains("section_targets"),
            "{}",
            statement.sql
        );
        assert_eq!(
            statement.params,
            vec!["MSc thesis".to_owned(), "r1".to_owned()]
        );
    }

    // it: "gateway: re-pointing a link clears the recorded failure with it"
    #[test]
    fn repointing_clears_last_error_and_recomputes_url() {
        let mut input = patch("r1");
        input.overleaf_project_id = Some("654321".to_owned());
        let statement = patch_report_statement(&input).expect("repoint");
        assert!(
            statement.sql.contains("last_error = null"),
            "{}",
            statement.sql
        );
        assert!(
            statement
                .params
                .contains(&"https://www.overleaf.com/project/654321".to_owned())
        );
    }

    // it: "gateway: an Overleaf id that could reshape a clone URL is refused"
    #[test]
    fn unsafe_overleaf_id_is_refused() {
        let mut input = patch("r1");
        input.overleaf_project_id = Some("../../etc".to_owned());
        let error = patch_report_statement(&input).expect_err("refused");
        assert!(error.contains("invalid"), "{error}");
    }

    // it: "gateway: an edit that names nothing is a mistake, not an empty update"
    #[test]
    fn empty_edit_is_refused() {
        let error = patch_report_statement(&patch("r1")).expect_err("refused");
        assert_eq!(error, "Nothing to update.");
    }

    #[test]
    fn blank_title_is_refused() {
        let mut input = patch("r1");
        input.title = Some("   ".to_owned());
        assert_eq!(
            patch_report_statement(&input).expect_err("refused"),
            "Title cannot be empty."
        );
    }

    #[test]
    fn section_targets_are_written_as_jsonb() {
        let mut input = patch("r1");
        input.section_targets = Some(json!({ "Intro": 3 }));
        let statement = patch_report_statement(&input).expect("targets");
        assert!(
            statement
                .sql
                .contains("set section_targets = $1::jsonb, updated_at"),
            "{}",
            statement.sql
        );
        assert_eq!(statement.params[0], "{\"Intro\":3}");
    }

    #[test]
    fn invalid_section_targets_are_refused() {
        let mut input = patch("r1");
        input.section_targets = Some(json!("not a map"));
        assert_eq!(
            patch_report_statement(&input).expect_err("refused"),
            "Section targets are invalid."
        );
    }

    #[test]
    fn blank_entry_file_becomes_main_tex() {
        let mut input = patch("r1");
        input.entry_file = Some("  ".to_owned());
        let statement = patch_report_statement(&input).expect("entry");
        assert!(statement.params.contains(&"main.tex".to_owned()));
        assert!(statement.sql.contains("last_error = null"));
    }

    #[test]
    fn traversal_entry_file_is_refused() {
        let mut input = patch("r1");
        input.entry_file = Some("../x.tex".to_owned());
        assert!(patch_report_statement(&input).is_err());
    }

    #[test]
    fn create_binds_user_scoped_insert() {
        let input = CreateReport {
            project_id: "p1".to_owned(),
            connection_id: "c1".to_owned(),
            title: " T ".to_owned(),
            overleaf_project_id: "0123456789abcdef01234567".to_owned(),
            entry_file: String::new(),
        };
        let statement = create_report_statement(&input).expect("create");
        assert!(statement.sql.contains("auth.uid()"));
        assert_eq!(statement.params[2], "T");
        assert_eq!(statement.params[4], "main.tex");
        assert_eq!(
            statement.params[5],
            "https://www.overleaf.com/project/0123456789abcdef01234567"
        );
    }

    #[test]
    fn create_refuses_unsafe_project_id() {
        let input = CreateReport {
            project_id: "p1".to_owned(),
            connection_id: "c1".to_owned(),
            title: "T".to_owned(),
            overleaf_project_id: "a/b".to_owned(),
            entry_file: "main.tex".to_owned(),
        };
        assert_eq!(
            create_report_statement(&input).expect_err("refused"),
            "Overleaf project id is invalid."
        );
    }
}

//! The MCP tool catalogue: names, descriptions and input schemas. Ported from apps/shell/sidecar/src/local-mcp-tools.ts.

use serde_json::{Map, Value, json};
use wf_core::sync::folder_layout::{ENTITY_DIRS, WorkspaceEntityType};

/// How many pages `get_paper_text` returns at a time.
pub const DEFAULT_PAGE_SPAN: u32 = 10;

// No `as_str` in wf-core for these; the strings are the TS lists, in TS order.
// From packages/core/src/features/experiments/domain/experiment.ts.
const EXPERIMENT_STATUSES: &[&str] = &["planned", "running", "done", "failed", "abandoned"];
// From packages/core/src/features/logbook/domain/log-entry.ts.
const LOG_KINDS: &[&str] = &["daily", "weekly"];
// From packages/core/src/features/plan/domain/milestone.ts.
const MILESTONE_STATUSES: &[&str] = &["planned", "in_progress", "done", "blocked"];
// From packages/core/src/features/papers/domain/paper.ts.
const PAPER_STATUSES: &[&str] = &["to_read", "reading", "read", "skimmed"];
// From packages/core/src/features/relations/domain/paper-relation.ts.
const RELATION_TYPES: &[&str] = &[
    "cites",
    "extends",
    "contradicts",
    "similar",
    "builds_on",
    "uses_method",
];

const DRAFT_NOTE: &str =
    " Leaves a draft; nothing changes until a person approves it in WeaveForge.";

/// What an agent needs to log runs from code it writes; only for tokens that may log experiments.
pub struct TrackingSetup {
    /// The local API the Python SDK talks to.
    pub api_url: String,
    /// The file Connect wrote; the SDK reads the token from it, so the token never enters code.
    pub token_file: String,
    /// Project names to pass as WEAVEFORGE_PROJECT.
    pub projects: Vec<String>,
}

/// Entity kinds except "ink_page", in ENTITY_DIRS order, as their TS string names.
#[must_use]
pub fn kinds() -> Vec<&'static str> {
    ENTITY_DIRS
        .iter()
        .map(|(kind, _)| *kind)
        .filter(|kind| *kind != WorkspaceEntityType::InkPage)
        .map(WorkspaceEntityType::as_str)
        .collect()
}

/// The TOOLS array as JSON, same order, names, descriptions and schemas as TS.
#[must_use]
#[allow(clippy::too_many_lines, reason = "the tool list is data")]
pub fn tools() -> Vec<Value> {
    let kinds = kinds();
    vec![
        tool(
            "list_projects",
            "List the projects: name, id, folder and what each holds. Start here, then pass project to the other tools.",
            json!({}),
            &[],
            false,
        ),
        tool(
            "search_workspace",
            &format!(
                "Search the workspace folder for text. Each hit gives project, path, kind, title and id. Optionally restrict to one kind: {}.",
                kinds.join(", ")
            ),
            json!({
                "query": text("Text to look for, case-insensitive."),
                "kind": { "type": "string", "enum": kinds, "description": "Restrict to one kind of entry." },
                "exclude": { "type": "array", "items": { "type": "string", "enum": kinds }, "description": "Kinds to leave out, e.g. [\"log_entry\"]." },
            }),
            &["query"],
            true,
        ),
        tool(
            "list_workspace",
            "List the entries of one kind: title, id, path and status.",
            merge(&[
                json!({ "kind": { "type": "string", "enum": kinds } }),
                rows(),
            ]),
            &["kind"],
            true,
        ),
        tool(
            "read_entry",
            "Read one file from the workspace folder, by its path.",
            merge(&[json!({ "path": text("Path inside the folder.") }), paged()]),
            &["path"],
            false,
        ),
        tool(
            "get_note",
            "Read one note, by its id or title.",
            merge(&[reference("note"), paged()]),
            &["ref"],
            true,
        ),
        tool(
            "get_paper",
            "Read one paper's entry and say whether its PDF is on disk.",
            reference("paper"),
            &["ref"],
            true,
        ),
        tool(
            "get_paper_text",
            &format!(
                "Read a paper's PDF text, by page (1-based, up to {DEFAULT_PAGE_SPAN} pages at a time). Needs the paper opened once in WeaveForge."
            ),
            merge(&[
                reference("paper"),
                json!({
                    "fromPage": { "type": "integer", "minimum": 1 },
                    "toPage": { "type": "integer", "minimum": 1 },
                }),
            ]),
            &["ref"],
            true,
        ),
        tool(
            "get_report_section",
            "Read one report section, by its id or title.",
            merge(&[reference("section"), paged()]),
            &["ref"],
            true,
        ),
        tool(
            "get_experiment",
            "Read one experiment, by its id or title.",
            merge(&[reference("experiment"), paged()]),
            &["ref"],
            true,
        ),
        tool(
            "list_experiments",
            "List the experiments in the workspace folder.",
            rows(),
            &[],
            true,
        ),
        tool(
            "get_milestone",
            "Read one plan milestone, by its id or title.",
            merge(&[reference("milestone"), paged()]),
            &["ref"],
            true,
        ),
        tool(
            "get_log",
            "Read one logbook entry, by its id or its date (YYYY-MM-DD).",
            json!({ "ref": text("The entry's id or date.") }),
            &["ref"],
            true,
        ),
        tool(
            "get_reading_list",
            "Read one reading list and the papers and notes in it.",
            reference("list"),
            &["ref"],
            true,
        ),
        tool(
            "list_tags",
            "List the tags in the workspace.",
            json!({}),
            &[],
            true,
        ),
        tool(
            "get_relations",
            "List links between papers, optionally only those touching one paper.",
            json!({ "paper": text("Optional paper id or title.") }),
            &[],
            true,
        ),
        tool(
            "get_backlinks",
            "For one note or paper: the [[links]] in it, the notes that link to it, and (papers) its relations.",
            reference("note's or paper"),
            &["ref"],
            true,
        ),
        tool(
            "suggest_note_create",
            &format!("Suggest a new note.{DRAFT_NOTE}"),
            json!({
                "title": text("The note's title."),
                "body": text("Markdown body."),
                "parent": text("Optional parent note id or title."),
                "rationale": rationale(),
            }),
            &["title", "body"],
            true,
        ),
        tool(
            "suggest_note_edit",
            &format!("Suggest a new title or body for a note.{DRAFT_NOTE}"),
            json!({
                "note": text("The note's id, or its title."),
                "title": text("New title."),
                "body": text("New full markdown body."),
                "rationale": rationale(),
            }),
            &["note"],
            true,
        ),
        tool(
            "suggest_note_append",
            &format!("Suggest text to add to the end of a note.{DRAFT_NOTE}"),
            json!({
                "note": text("The note's id, or its title."),
                "addition": text("Markdown to append."),
                "rationale": rationale(),
            }),
            &["note", "addition"],
            true,
        ),
        tool(
            "suggest_log_entry",
            &format!("Suggest a logbook entry.{DRAFT_NOTE}"),
            json!({
                "body": text("Markdown body."),
                "entryDate": text("YYYY-MM-DD, default today."),
                "kind": { "type": "string", "enum": LOG_KINDS },
                "rationale": rationale(),
            }),
            &["body"],
            true,
        ),
        tool(
            "suggest_milestone",
            &format!("Suggest a new plan milestone.{DRAFT_NOTE}"),
            json!({
                "title": text("Milestone title."),
                "description": text("Optional description."),
                "status": { "type": "string", "enum": MILESTONE_STATUSES },
                "targetDate": text("YYYY-MM-DD."),
                "rationale": rationale(),
            }),
            &["title"],
            true,
        ),
        tool(
            "suggest_milestone_status",
            &format!("Suggest a status for a plan milestone.{DRAFT_NOTE}"),
            json!({
                "milestone": text("The milestone's id, or its title."),
                "status": { "type": "string", "enum": MILESTONE_STATUSES },
                "rationale": rationale(),
            }),
            &["milestone", "status"],
            true,
        ),
        tool(
            "suggest_experiment",
            &format!("Suggest a new experiment.{DRAFT_NOTE}"),
            json!({
                "name": text("Experiment name."),
                "hypothesis": text("Optional hypothesis."),
                "status": { "type": "string", "enum": EXPERIMENT_STATUSES },
                "rationale": rationale(),
            }),
            &["name"],
            true,
        ),
        tool(
            "suggest_experiment_update",
            &format!("Suggest a status, metrics or artifacts for an experiment.{DRAFT_NOTE}"),
            json!({
                "experiment": text("The experiment's id, or its title."),
                "status": { "type": "string", "enum": EXPERIMENT_STATUSES },
                "metrics": { "type": "object", "description": "Metric name to number." },
                "artifacts": { "type": "array", "items": { "type": "string" } },
                "rationale": rationale(),
            }),
            &["experiment"],
            true,
        ),
        tool(
            "suggest_paper_update",
            &format!("Suggest a paper's reading status, rating or tags.{DRAFT_NOTE}"),
            json!({
                "paper": text("The paper's id, or its title."),
                "status": { "type": "string", "enum": PAPER_STATUSES },
                "rating": { "type": "integer", "minimum": 0, "maximum": 5 },
                "tags": { "type": "array", "items": { "type": "string" } },
                "rationale": rationale(),
            }),
            &["paper"],
            true,
        ),
        tool(
            "suggest_paper_note",
            &format!("Suggest text to add to a paper's notes.{DRAFT_NOTE}"),
            json!({
                "paper": text("The paper's id, or its title."),
                "addition": text("Markdown to append."),
                "rationale": rationale(),
            }),
            &["paper", "addition"],
            true,
        ),
        tool(
            "suggest_annotation",
            &format!(
                "Suggest a highlight on a paper's PDF, anchored by an exact quote.{DRAFT_NOTE}"
            ),
            json!({
                "paper": text("The paper's id, or its title."),
                "quote": text("Exact text from the PDF."),
                "comment": text("Optional comment."),
                "page": { "type": "integer", "minimum": 1, "description": "1-based page, if known." },
                "rationale": rationale(),
            }),
            &["paper", "quote"],
            true,
        ),
        tool(
            "suggest_relation",
            &format!("Suggest a link between two papers.{DRAFT_NOTE}"),
            json!({
                "from": text("Paper id or title."),
                "to": text("Paper id or title."),
                "relation": { "type": "string", "enum": RELATION_TYPES },
                "rationale": rationale(),
            }),
            &["from", "to", "relation"],
            true,
        ),
        tool(
            "suggest_reading_list_change",
            &format!("Suggest adding a paper or note to a reading list.{DRAFT_NOTE}"),
            json!({
                "list": text("The list's id, or its title."),
                "paper": text("Paper id or title."),
                "note": text("Note id or title."),
                "comment": text("Why it belongs in the list."),
                "rationale": rationale(),
            }),
            &["list"],
            true,
        ),
        tool(
            "suggest_report_edit",
            &format!("Suggest new notes for a report section.{DRAFT_NOTE}"),
            json!({
                "section": text("The section's id, or its title."),
                "notes": text("The suggested text."),
                "rationale": rationale(),
            }),
            &["section", "notes"],
            true,
        ),
    ]
}

/// The `experiment_tracking_setup` tool.
#[must_use]
pub fn tracking_tool() -> Value {
    tool(
        "experiment_tracking_setup",
        "How to log experiment runs, metrics and figures to WeaveForge from code you write: the Python SDK to install, the address, where the token is, and the project names. Call before adding tracking to a training script.",
        json!({}),
        &[],
        false,
    )
}

/// The setup text for a training script: install, token file, projects and an example.
#[must_use]
pub fn tracking_setup(setup: &TrackingSetup) -> String {
    // The SDK looks in ~/.weaveforge/mcp.json unless told otherwise (WeaveForge Dev writes mcp-dev.json).
    let where_ =
        if setup.token_file.ends_with("/mcp.json") || setup.token_file.ends_with("\\mcp.json") {
            "so set nothing else".to_owned()
        } else {
            format!("once WEAVEFORGE_MCP_FILE={} is set", setup.token_file)
        };
    let token_line = format!(
        "The token is already on this computer in {}. The SDK reads it and the address ({}) from there when WEAVEFORGE_TOKEN is unset, {}. Never copy the token into code, notebooks, logs or commits.",
        setup.token_file, setup.api_url, where_
    );
    let projects_line = if setup.projects.is_empty() {
        "There are no projects yet; runs without a project go to the default list.".to_owned()
    } else {
        let names: Vec<String> = setup
            .projects
            .iter()
            .map(|name| Value::from(name.as_str()).to_string())
            .collect();
        format!("Projects: {}.", names.join(", "))
    };
    [
        "Log experiments to WeaveForge with its Python SDK (open source, PyPI: weaveforge).",
        "",
        "Install: pip install weaveforge",
        "Extras when the script uses them: weaveforge[figures] (matplotlib/plotly), weaveforge[tensorboard], weaveforge[wandb], weaveforge[lightning], weaveforge[keras], or weaveforge[all].",
        "",
        token_line.as_str(),
        r#"Pick the WeaveForge project the runs belong to: pass project="<name>" to track(), or set WEAVEFORGE_PROJECT. WeaveForge must be running while the script logs."#,
        "",
        projects_line.as_str(),
        "",
        "Example:",
        "```python",
        "from weaveforge import track",
        "",
        r#"with track("resnet18-baseline", project="<project name>", config={"lr": 3e-4, "epochs": 10}) as run:"#,
        "    for epoch in range(10):",
        "        train_loss, val_loss = train_one_epoch()",
        r#"        run.log_metrics({"train_loss": train_loss, "val_loss": val_loss}, step=epoch)"#,
        r#"    run.log_figure(fig, name="confusion-matrix")  # matplotlib or plotly; needs weaveforge[figures]"#,
        r#"    run.log_summary({"val_loss": val_loss})"#,
        "```",
        r#"Decorator form: @track_experiment(name=..., config=...) on a train(run, ...) function. Existing logs: track(..., sync={"tensorboard": "runs/x"}) or mirror="wandb"."#,
        "Runs show up live under Experiments in WeaveForge.",
    ]
    .join("\n")
}

/// A string-typed schema property with a description.
fn text(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

/// The optional rationale every suggest tool takes.
fn rationale() -> Value {
    text("Why, in a sentence or two. Shown to the person who approves it.")
}

/// The `project` property added to scoped tools.
fn project_property() -> Value {
    text(
        "Project name or id (see list_projects). Reads: only that project. New entries: the project they go in, needed when there is more than one.",
    )
}

/// One tool. `scoped` adds the `project` property, as TS does by default.
fn tool(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
    scoped: bool,
) -> Value {
    let properties = if scoped {
        merge(&[properties, json!({ "project": project_property() })])
    } else {
        properties
    };
    json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": properties, "required": required },
    })
}

/// A `ref` property naming the entity by id or title.
fn reference(what: &str) -> Value {
    json!({ "ref": text(&format!("The {what}'s id or title.")) })
}

/// Paging for long reads.
fn paged() -> Value {
    json!({
        "heading": text("Optional heading: only that section."),
        "offset": { "type": "integer", "minimum": 0, "description": "Start at this character; the answer says where the next part starts." },
        "limit": { "type": "integer", "minimum": 1, "description": "Characters to return, at most 7500." },
    })
}

/// Paging for row lists.
fn rows() -> Value {
    json!({
        "offset": { "type": "integer", "minimum": 0, "description": "Skip this many rows." },
        "limit": { "type": "integer", "minimum": 1, "description": "Rows to return, default 100, at most 500." },
    })
}

/// Object properties merged in order; a later key wins, as a JS spread does.
fn merge(parts: &[Value]) -> Value {
    let mut out = Map::new();
    for part in parts {
        if let Some(map) = part.as_object() {
            for (key, value) in map {
                let _ = out.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names() -> Vec<String> {
        tools()
            .iter()
            .map(|t| t["name"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    fn properties_of(name: &str) -> Value {
        let all = tools();
        let found = all.iter().find(|t| t["name"] == name);
        found.map_or(Value::Null, |t| t["inputSchema"]["properties"].clone())
    }

    #[test]
    fn tools_names_in_ts_order() {
        assert_eq!(
            names(),
            [
                "list_projects",
                "search_workspace",
                "list_workspace",
                "read_entry",
                "get_note",
                "get_paper",
                "get_paper_text",
                "get_report_section",
                "get_experiment",
                "list_experiments",
                "get_milestone",
                "get_log",
                "get_reading_list",
                "list_tags",
                "get_relations",
                "get_backlinks",
                "suggest_note_create",
                "suggest_note_edit",
                "suggest_note_append",
                "suggest_log_entry",
                "suggest_milestone",
                "suggest_milestone_status",
                "suggest_experiment",
                "suggest_experiment_update",
                "suggest_paper_update",
                "suggest_paper_note",
                "suggest_annotation",
                "suggest_relation",
                "suggest_reading_list_change",
                "suggest_report_edit",
            ]
        );
    }

    #[test]
    fn scoped_tools_take_project_and_unscoped_do_not() {
        assert!(properties_of("get_note").get("project").is_some());
        assert!(properties_of("list_tags").get("project").is_some());
        assert!(properties_of("read_entry").get("project").is_none());
        assert!(properties_of("list_projects").get("project").is_none());
    }

    #[test]
    fn kinds_exclude_ink_page() {
        assert_eq!(
            kinds(),
            [
                "vault_page",
                "paper",
                "reading_list",
                "report_section",
                "experiment",
                "milestone",
                "log_entry"
            ]
        );
    }

    #[test]
    fn page_span_is_ten() {
        assert_eq!(DEFAULT_PAGE_SPAN, 10);
        let text = tools()[6]["description"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        assert!(text.contains("up to 10 pages at a time"));
    }

    #[test]
    fn tracking_tool_takes_no_arguments() {
        let tool = tracking_tool();
        assert_eq!(tool["name"], "experiment_tracking_setup");
        assert_eq!(tool["inputSchema"]["properties"], json!({}));
        assert_eq!(tool["inputSchema"]["required"], json!([]));
    }

    #[test]
    fn tracking_setup_home_file_lists_projects_quoted() {
        let setup = TrackingSetup {
            api_url: "http://127.0.0.1:27123".to_owned(),
            token_file: "/home/me/.weaveforge/mcp.json".to_owned(),
            projects: vec!["Thesis".to_owned(), "Lab \"B\"".to_owned()],
        };
        let text = tracking_setup(&setup);
        assert!(text.contains("Install: pip install weaveforge"));
        assert!(
            text.contains(
                "The token is already on this computer in /home/me/.weaveforge/mcp.json."
            )
        );
        assert!(text.contains(
            "from there when WEAVEFORGE_TOKEN is unset, so set nothing else. Never copy"
        ));
        assert!(text.contains("Projects: \"Thesis\", \"Lab \\\"B\\\"\"."));
        assert!(!text.contains("WEAVEFORGE_MCP_FILE="));
    }

    #[test]
    fn tracking_setup_windows_mcp_json_sets_nothing_else() {
        let setup = TrackingSetup {
            api_url: "http://127.0.0.1:27123".to_owned(),
            token_file: "C:\\Users\\u\\.weaveforge\\mcp.json".to_owned(),
            projects: Vec::new(),
        };
        let text = tracking_setup(&setup);
        assert!(text.contains("so set nothing else"));
        assert!(
            text.contains(
                "There are no projects yet; runs without a project go to the default list."
            )
        );
    }

    #[test]
    fn tracking_setup_other_token_file_names_the_env_var() {
        let setup = TrackingSetup {
            api_url: "http://127.0.0.1:27123".to_owned(),
            token_file: "C:\\Users\\u\\.weaveforge\\mcp-dev.json".to_owned(),
            projects: Vec::new(),
        };
        let text = tracking_setup(&setup);
        assert!(
            text.contains(
                "once WEAVEFORGE_MCP_FILE=C:\\Users\\u\\.weaveforge\\mcp-dev.json is set"
            )
        );
    }
}

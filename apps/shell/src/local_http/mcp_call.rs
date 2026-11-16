//! One MCP tool call. Ported from `callTool` in apps/shell/sidecar/src/local-mcp.ts.
//!
//! Read tools live here; `suggest_*` tools live in `mcp_suggest`.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};
use wf_core::sync::folder_layout::{
    ENTITY_DIRS, WORKSPACE_META_DIR, WorkspaceEntityType, entity_dir, entity_dir_name,
    paper_pdf_path,
};
use wf_core::vault::page::{body_links_to, extract_wikilinks, normalize_title_key};

use super::mcp_draft::canonical_ai_tool_name;
use super::mcp_projects::{ProjectRef, pick_project};
use super::mcp_read::{
    Entry, MAX_PAPER_TEXT_CHARS, MAX_ROWS, cached_pages, content, count, field, hidden, id_of,
    kind_of, load_entries, named, number_of, pick, read_json_array, read_text, ref_param, text,
    windowed,
};
use crate::vault::VaultSession;
use crate::vault_search::search_vault;
use wf_core::ai::untrusted_context::UntrustedItem;

/// Pages a `get_paper_text` window spans when `toPage` is absent (TS `DEFAULT_PAGE_SPAN`).
const DEFAULT_PAGE_SPAN: usize = 10;

/// What every tool handler needs (the closures at the top of TS `callTool`).
pub(crate) struct Ctx<'a> {
    pub(crate) session: &'a VaultSession,
    pub(crate) params: &'a Map<String, Value>,
    /// Every project in the workspace, resolved once per call.
    pub(crate) projects: &'a [ProjectRef],
}

impl Ctx<'_> {
    /// The named project, or all of them (TS `scope`).
    pub(crate) fn scope(&self) -> Result<Vec<ProjectRef>, String> {
        if text(self.params, "project", false)?.is_some() {
            let project = self.params.get("project").cloned().unwrap_or(Value::Null);
            return Ok(vec![pick_project(self.projects, &project)?]);
        }
        Ok(self.projects.to_vec())
    }

    /// Where a new entry goes: the named project, else the only one there is (TS `home`).
    pub(crate) fn home(&self) -> Result<ProjectRef, String> {
        if text(self.params, "project", false)?.is_some() {
            let project = self.params.get("project").cloned().unwrap_or(Value::Null);
            return pick_project(self.projects, &project);
        }
        match self.projects {
            [only] => Ok(only.clone()),
            all => Err(format!(
                "Name the project: {}.",
                all.iter()
                    .map(|p| p.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
        }
    }

    /// Entries of one kind in `within`, else in scope (TS `entries`).
    pub(crate) fn entries(
        &self,
        kind: WorkspaceEntityType,
        within: Option<&ProjectRef>,
    ) -> Result<Vec<Entry>, String> {
        match within {
            Some(project) => load_entries(self.session, kind, std::slice::from_ref(project)),
            None => load_entries(self.session, kind, &self.scope()?),
        }
    }

    /// The one entry `needle` names (TS `findOne`).
    pub(crate) fn find_one(
        &self,
        kind: WorkspaceEntityType,
        needle: &Value,
        what: &str,
        within: Option<&ProjectRef>,
    ) -> Result<Entry, String> {
        pick(&self.entries(kind, within)?, needle, what)
    }

    /// Papers in `within`, else in scope (TS `papers`).
    pub(crate) fn papers(&self, within: Option<&ProjectRef>) -> Result<Vec<Entry>, String> {
        self.entries(WorkspaceEntityType::Paper, within)
    }

    /// One entry's raw text, windowed (TS `one`).
    pub(crate) fn one(
        &self,
        kind: WorkspaceEntityType,
        key: &str,
        what: &str,
    ) -> Result<Value, String> {
        let entry = self.find_one(kind, &ref_param(self.params, key), what, None)?;
        content(&[UntrustedItem {
            label: placed(&entry.project, &entry.path),
            text: windowed(&entry.raw, self.params)?,
        }])
    }

    /// `from —relation→ to` lines, by paper title, optionally only those touching `focus` (TS `relationLines`).
    pub(crate) fn relation_lines(
        &self,
        project: &ProjectRef,
        focus: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let papers = self.papers(Some(project))?;
        let label = |id: Option<&Value>| {
            let id = id.map(as_text).unwrap_or_default();
            papers
                .iter()
                .find(|p| p.id.as_deref() == Some(id.as_str()))
                .map_or(id, |p| p.title.clone())
        };
        Ok(read_json_array(self.session, project, "relations.json")?
            .iter()
            .filter(|row| {
                focus.is_none_or(|f| {
                    row.get("fromPaper").and_then(Value::as_str) == Some(f)
                        || row.get("toPaper").and_then(Value::as_str) == Some(f)
                })
            })
            .map(|row| {
                let relation = row.get("relation").map(as_text).unwrap_or_default();
                format!(
                    "{} —{relation}→ {}",
                    label(row.get("fromPaper")),
                    label(row.get("toPaper"))
                )
            })
            .collect())
    }
}

/// `project: path`, as the TS `placed` labels an entry.
pub(crate) fn placed(project: &ProjectRef, path: &str) -> String {
    format!("{}: {path}", project.name)
}

/// A JSON value as JS `String(value)` would print it (strings unquoted).
pub(crate) fn as_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Runs one tool. `Err` carries the message shown to the agent (TS throws).
/// `search_workspace` answers unranked here; the router ranks it through `search_hits` and `search_answer`.
pub(crate) fn call_tool(
    session: &VaultSession,
    raw_name: &str,
    params: &Map<String, Value>,
    projects: &[ProjectRef],
) -> Result<Value, String> {
    let name = canonical_ai_tool_name(raw_name);
    let ctx = Ctx {
        session,
        params,
        projects,
    };
    if name.starts_with("suggest_") {
        return super::mcp_suggest::call_suggest(&ctx, &name, raw_name);
    }
    if name == "search_workspace" {
        return search_answer(search_hits(&ctx)?.1, None);
    }
    call_read(&ctx, &name, raw_name)
}

/// One search hit as shown: where it is, what it is, and its matching lines.
pub(crate) struct SearchRow {
    /// Path relative to the workspace root; the ranker's key.
    pub(crate) filename: String,
    /// `project: path | type | title | id`, as TS `placed` plus `tag`.
    pub(crate) label: String,
    /// The matching lines, one per line.
    pub(crate) text: String,
}

/// The hits `search_workspace` shows, in search order, with the query (TS `case "search_workspace"` before ranking).
///
/// # Errors
/// `query` is blank, or a file could not be read.
pub(crate) fn search_hits(ctx: &Ctx<'_>) -> Result<(String, Vec<SearchRow>), String> {
    let query = text(ctx.params, "query", true)?.unwrap_or_default();
    let kind = kind_of(ctx.params);
    let skip: HashSet<String> = ctx
        .params
        .get("exclude")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(as_text).collect())
        .unwrap_or_default();
    let meta_prefix = format!("{WORKSPACE_META_DIR}/");
    let mut rows = Vec::new();
    for project in ctx.scope()? {
        let dir = kind.map_or_else(
            || project.dir.clone(),
            |only| entity_dir(only, &project.dir),
        );
        let found = search_vault(ctx.session, &query, &dir);
        let mut known: HashMap<String, Entry> = HashMap::new();
        for each in kind.map_or_else(kinds, |only| vec![only]) {
            for entry in load_entries(ctx.session, each, std::slice::from_ref(&project))? {
                let _ = known.insert(entry.path.clone(), entry);
            }
        }
        for hit in found {
            let entry = known.get(&hit.filename);
            let skipped = entry.is_some_and(|e| skip.contains(e.entity_type.as_str()));
            if hidden(&hit.filename) || hit.filename.contains(&meta_prefix) || skipped {
                continue;
            }
            let snippet = hit
                .matches
                .iter()
                .map(|m| m.context.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            rows.push(SearchRow {
                label: placed(&project, &hit.filename) + &tag(entry),
                text: snippet,
                filename: hit.filename,
            });
        }
    }
    Ok((query, rows))
}

/// The search answer: ranked rows first in the ranker's order, the rest after in place (TS `reorder`).
///
/// # Errors
/// The OS random source failed while fencing the answer.
pub(crate) fn search_answer(
    rows: Vec<SearchRow>,
    ordered: Option<&[String]>,
) -> Result<Value, String> {
    let rows = match ordered {
        Some(order) => reorder_rows(rows, order),
        None => rows,
    };
    let items: Vec<UntrustedItem> = rows
        .into_iter()
        .map(|row| UntrustedItem {
            label: row.label,
            text: row.text,
        })
        .collect();
    content(&items)
}

/// Stable sort by rank; rows the ranker did not name keep their order after the ranked ones.
fn reorder_rows(mut rows: Vec<SearchRow>, order: &[String]) -> Vec<SearchRow> {
    let rank: HashMap<&str, usize> = order
        .iter()
        .enumerate()
        .map(|(index, name)| (name.as_str(), index))
        .collect();
    rows.sort_by_key(|row| {
        rank.get(row.filename.as_str())
            .copied()
            .unwrap_or(order.len())
    });
    rows
}

/// Every entity kind a workspace keeps; ink pages are folded into notes, so not offered (TS `KINDS`).
fn kinds() -> Vec<WorkspaceEntityType> {
    ENTITY_DIRS
        .iter()
        .map(|(kind, _)| *kind)
        .filter(|kind| *kind != WorkspaceEntityType::InkPage)
        .collect()
}

/// The entry details after a search label: type, title, id (TS `tag`).
fn tag(entry: Option<&Entry>) -> String {
    entry.map_or_else(String::new, |e| {
        format!(
            " | {} | {} | {}",
            e.entity_type.as_str(),
            e.title,
            e.id.as_deref().unwrap_or("-")
        )
    })
}

/// Lines joined by newlines, or `empty` when there are none (TS `join("\n") || empty`).
fn joined(lines: &[String], empty: &str) -> String {
    let body = lines.join("\n");
    if body.is_empty() {
        empty.to_owned()
    } else {
        body
    }
}

/// A value that is set and non-empty, else `None` (TS truthy `value ? ... : ...` for strings).
fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null() && v.as_str() != Some(""))
}

/// Every read tool except `search_workspace`.
fn call_read(ctx: &Ctx<'_>, name: &str, raw_name: &str) -> Result<Value, String> {
    match name {
        "list_projects" => list_projects(ctx),
        "list_workspace" | "list_experiments" => list_workspace(ctx, name),
        "read_entry" => read_entry(ctx),
        // One call each; the TS cases are a single `one(...)` too.
        "get_note" => ctx.one(WorkspaceEntityType::VaultPage, "note", "note"),
        "get_report_section" => ctx.one(
            WorkspaceEntityType::ReportSection,
            "section",
            "report section",
        ),
        "get_experiment" => ctx.one(WorkspaceEntityType::Experiment, "experiment", "experiment"),
        "get_milestone" => ctx.one(WorkspaceEntityType::Milestone, "milestone", "milestone"),
        "get_log" => get_log(ctx),
        "get_paper" => get_paper(ctx),
        "get_paper_text" => get_paper_text(ctx),
        "get_reading_list" => get_reading_list(ctx),
        "list_tags" => list_tags(ctx),
        "get_relations" => get_relations(ctx),
        "get_backlinks" => get_backlinks(ctx),
        _ => Err(format!("No tool named {raw_name}.")),
    }
}

/// `list_projects`: one line per project with its entry counts (TS case list_projects).
fn list_projects(ctx: &Ctx<'_>) -> Result<Value, String> {
    let mut lines = Vec::new();
    for project in ctx.projects {
        let mut counts = Vec::new();
        for kind in kinds() {
            let n = load_entries(ctx.session, kind, std::slice::from_ref(project))?.len();
            if n > 0 {
                counts.push(format!("{} {n}", entity_dir_name(kind)));
            }
        }
        let dir = if project.dir.is_empty() {
            "(root)"
        } else {
            project.dir.as_str()
        };
        let counts = if counts.is_empty() {
            "empty".to_owned()
        } else {
            counts.join(", ")
        };
        let parts = [
            project.name.as_str(),
            project.id.as_deref().unwrap_or(""),
            dir,
            counts.as_str(),
        ];
        lines.push(
            parts
                .iter()
                .filter(|part| !part.is_empty())
                .copied()
                .collect::<Vec<_>>()
                .join(" | "),
        );
    }
    content(&[UntrustedItem {
        label: "projects".to_owned(),
        text: lines.join("\n"),
    }])
}

/// `list_workspace` and `list_experiments`: one page of rows, grouped by project (TS cases of the same names).
fn list_workspace(ctx: &Ctx<'_>, name: &str) -> Result<Value, String> {
    let kind = if name == "list_experiments" {
        Some(WorkspaceEntityType::Experiment)
    } else {
        kind_of(ctx.params)
    };
    let Some(kind) = kind else {
        return Err("That is not a kind this workspace keeps.".to_owned());
    };
    let scoped = ctx.scope()?;
    let rows = load_entries(ctx.session, kind, &scoped)?;
    let offset = count(ctx.params, "offset", 0, usize::MAX);
    let limit = match count(ctx.params, "limit", 100, MAX_ROWS) {
        0 => 100,
        n => n,
    };
    let end = rows.len().min(offset.saturating_add(limit));
    let page = rows.get(offset..end).unwrap_or(&[]);
    let mut items = Vec::new();
    for project in &scoped {
        let lines: Vec<String> = page
            .iter()
            .filter(|entry| entry.project == *project)
            .map(|entry| {
                let parts = [
                    entry.title.clone(),
                    entry.id.clone().unwrap_or_else(|| "-".to_owned()),
                    entry.path.clone(),
                    field(entry, "status").unwrap_or_default(),
                ];
                parts
                    .into_iter()
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>()
                    .join(" | ")
            })
            .collect();
        if lines.is_empty() && !page.is_empty() {
            continue;
        }
        let label = if scoped.len() > 1 {
            format!("{} / {}", project.name, entity_dir_name(kind))
        } else {
            entity_dir_name(kind).to_owned()
        };
        items.push(UntrustedItem {
            label,
            text: joined(&lines, "(nothing yet)"),
        });
    }
    if offset > 0 || end < rows.len() {
        let more = if end < rows.len() {
            format!("; pass offset={end} for more")
        } else {
            String::new()
        };
        let text = format!("{}-{end} of {}{more}", offset.saturating_add(1), rows.len());
        items.push(UntrustedItem {
            label: "page".to_owned(),
            text,
        });
    }
    content(&items)
}

/// `read_entry`: one workspace file by its vault path, windowed (TS case read_entry).
fn read_entry(ctx: &Ctx<'_>) -> Result<Value, String> {
    let at = text(ctx.params, "path", true)?.unwrap_or_default();
    if hidden(&at) || at.split('/').any(|part| part == WORKSPACE_META_DIR) {
        return Err("That file is WeaveForge's own; use the other tools.".to_owned());
    }
    let dirs: Vec<&str> = ctx
        .projects
        .iter()
        .map(|p| p.dir.as_str())
        .filter(|dir| !dir.is_empty())
        .collect();
    if !dirs.is_empty() && !dirs.iter().any(|dir| at.starts_with(&format!("{dir}/"))) {
        return Err("That path is in no project; see list_projects.".to_owned());
    }
    let Some(read) = read_text(ctx.session, &at)? else {
        return Err("No such file.".to_owned());
    };
    content(&[UntrustedItem {
        label: at.clone(),
        text: windowed(&read, ctx.params)?,
    }])
}

/// `get_log`: the entries dated `ref`, else the one log entry `ref` names (TS case get_log).
fn get_log(ctx: &Ctx<'_>) -> Result<Value, String> {
    let all = ctx.entries(WorkspaceEntityType::LogEntry, None)?;
    let wanted = match ref_param(ctx.params, "entry") {
        Value::Null => String::new(),
        value => as_text(&value),
    };
    let wanted = wanted.trim().to_owned();
    if wanted.is_empty() {
        return Err("ref is required.".to_owned());
    }
    let by_date: Vec<Entry> = all
        .iter()
        .filter(|entry| field(entry, "entry-date").as_deref() == Some(wanted.as_str()))
        .cloned()
        .collect();
    let found = if by_date.is_empty() {
        vec![pick(&all, &Value::String(wanted), "log entry")?]
    } else {
        by_date
    };
    let items: Vec<UntrustedItem> = found
        .iter()
        .map(|entry| UntrustedItem {
            label: placed(&entry.project, &entry.path),
            text: entry.raw.clone(),
        })
        .collect();
    content(&items)
}

/// `get_paper`: the paper's record, and whether its PDF is on disk (TS case get_paper).
fn get_paper(ctx: &Ctx<'_>) -> Result<Value, String> {
    let paper = ctx.find_one(
        WorkspaceEntityType::Paper,
        &ref_param(ctx.params, "paper"),
        "paper",
        None,
    )?;
    let pdf = paper
        .id
        .as_deref()
        .filter(|id| !id.is_empty())
        .map(|id| paper_pdf_path(id, &paper.project.dir));
    let pdf_line = match pdf.as_deref() {
        Some(path) if matches!(ctx.session.stat(path), Ok(Some(_))) => {
            format!("PDF on disk at {path}. Read it with get_paper_text.")
        }
        _ => "No PDF on disk for this paper.".to_owned(),
    };
    content(&[
        UntrustedItem {
            label: placed(&paper.project, &paper.path),
            text: paper.raw.clone(),
        },
        UntrustedItem {
            label: "pdf".to_owned(),
            text: pdf_line,
        },
    ])
}

/// `get_paper_text`: a page window of the reader's cached text, capped (TS case get_paper_text).
fn get_paper_text(ctx: &Ctx<'_>) -> Result<Value, String> {
    let paper = ctx.find_one(
        WorkspaceEntityType::Paper,
        &ref_param(ctx.params, "paper"),
        "paper",
        None,
    )?;
    let Some(pages) = cached_pages(ctx.session, &id_of(&paper)?)? else {
        return Err(format!(
            "No text for '{}' yet. Open its PDF once in WeaveForge and try again.",
            paper.title
        ));
    };
    let from = count(ctx.params, "fromPage", 1, usize::MAX).max(1);
    if from > pages.len() {
        return Err(format!(
            "'{}' has {} pages; fromPage {from} is past the end.",
            paper.title,
            pages.len()
        ));
    }
    let default_to = from + DEFAULT_PAGE_SPAN - 1;
    let asked = match count(ctx.params, "toPage", default_to, usize::MAX) {
        0 => default_to,
        n => n,
    };
    let mut to = pages.len().min(asked.max(from));
    let mut out = String::new();
    for (i, page) in pages.get(from - 1..to).unwrap_or(&[]).iter().enumerate() {
        let next = page_block(page);
        // Only the first page can overflow alone; later ones stop the window instead.
        if !out.is_empty() && out.chars().count() + next.chars().count() > MAX_PAPER_TEXT_CHARS {
            to = from + i - 1;
            break;
        }
        out.push_str(&next);
    }
    let cut = if out.chars().count() > MAX_PAPER_TEXT_CHARS {
        format!("; page {from} cut at {MAX_PAPER_TEXT_CHARS} characters")
    } else {
        String::new()
    };
    let more = if to < pages.len() {
        format!("; next fromPage {}", to + 1)
    } else {
        String::new()
    };
    let label = format!(
        "{}: {}, pages {from}-{to} of {}{cut}{more}",
        paper.project.name,
        paper.title,
        pages.len()
    );
    let shown: String = out.chars().take(MAX_PAPER_TEXT_CHARS).collect();
    content(&[UntrustedItem {
        label,
        text: joined(&[shown], "(no text on those pages)"),
    }])
}

/// One cached page as `--- page N ---` and its text (TS `next` in get_paper_text).
fn page_block(page: &Value) -> String {
    let index = number_of(page.get("pageIndex")).map_or(f64::NAN, |n| n + 1.0);
    let body = page
        .get("text")
        .map_or_else(|| "undefined".to_owned(), as_text);
    format!("--- page {index} ---\n{body}\n")
}

/// `get_reading_list`: the list's record and its items in order (TS case get_reading_list).
fn get_reading_list(ctx: &Ctx<'_>) -> Result<Value, String> {
    let list = ctx.find_one(
        WorkspaceEntityType::ReadingList,
        &ref_param(ctx.params, "list"),
        "reading list",
        None,
    )?;
    let list_id = id_of(&list)?;
    let items = read_json_array(ctx.session, &list.project, "reading-list-items.json")?;
    let mut titles: HashMap<String, String> = HashMap::new();
    let papers = ctx.papers(Some(&list.project))?;
    let notes = ctx.entries(WorkspaceEntityType::VaultPage, Some(&list.project))?;
    for entry in papers.into_iter().chain(notes) {
        if let Some(id) = entry.id {
            let _ = titles.insert(id, entry.title);
        }
    }
    let mut rows: Vec<&Map<String, Value>> = items
        .iter()
        .filter(|row| row.get("listId").and_then(Value::as_str) == Some(list_id.as_str()))
        .collect();
    rows.sort_by(|a, b| {
        number_of(a.get("sortOrder"))
            .unwrap_or(0.0)
            .total_cmp(&number_of(b.get("sortOrder")).unwrap_or(0.0))
    });
    let lines: Vec<String> = rows
        .iter()
        .map(|row| {
            let target = ["paperId", "vaultPageId"]
                .iter()
                .filter_map(|key| row.get(*key))
                .find(|v| !v.is_null())
                .map(as_text)
                .unwrap_or_default();
            let label = if row
                .get("paperId")
                .and_then(Value::as_str)
                .is_some_and(|s| !s.is_empty())
            {
                "paper"
            } else {
                "note"
            };
            let title = titles
                .get(&target)
                .cloned()
                .unwrap_or_else(|| target.clone());
            let note = present(row.get("note"))
                .map(|v| format!(" — {}", as_text(v)))
                .unwrap_or_default();
            format!("- {label}: {title}{note}")
        })
        .collect();
    content(&[
        UntrustedItem {
            label: list.path.clone(),
            text: list.raw.clone(),
        },
        UntrustedItem {
            label: "items".to_owned(),
            text: joined(&lines, "(empty)"),
        },
    ])
}

/// `list_tags`: every tag name in scope, in first-seen order (TS case list_tags).
fn list_tags(ctx: &Ctx<'_>) -> Result<Value, String> {
    let mut names: Vec<String> = Vec::new();
    for project in ctx.scope()? {
        for row in read_json_array(ctx.session, &project, "tags.json")? {
            let Some(name) = present(row.get("name")).map(as_text) else {
                continue;
            };
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    content(&[UntrustedItem {
        label: "tags".to_owned(),
        text: joined(&names, "(no tags)"),
    }])
}

/// `get_relations`: relation lines for one paper, else for every project in scope (TS case get_relations).
fn get_relations(ctx: &Ctx<'_>) -> Result<Value, String> {
    let focus = if text(ctx.params, "paper", false)?.is_some() {
        let needle = ctx.params.get("paper").cloned().unwrap_or(Value::Null);
        Some(ctx.find_one(WorkspaceEntityType::Paper, &needle, "paper", None)?)
    } else {
        None
    };
    let focus_id = match &focus {
        Some(paper) => Some(id_of(paper)?),
        None => None,
    };
    let projects = match &focus {
        Some(paper) => vec![paper.project.clone()],
        None => ctx.scope()?,
    };
    let mut lines = Vec::new();
    for project in &projects {
        lines.extend(ctx.relation_lines(project, focus_id.as_deref())?);
    }
    content(&[UntrustedItem {
        label: "relations".to_owned(),
        text: joined(&lines, "(none)"),
    }])
}

/// `get_backlinks`: links out, links in, and relations for one note or paper (TS case get_backlinks).
fn get_backlinks(ctx: &Ctx<'_>) -> Result<Value, String> {
    let mut all = ctx.entries(WorkspaceEntityType::VaultPage, None)?;
    all.extend(ctx.papers(None)?);
    let entry = pick(&all, &ref_param(ctx.params, "entry"), "note or paper")?;
    let mut near = ctx.entries(WorkspaceEntityType::VaultPage, Some(&entry.project))?;
    near.extend(ctx.papers(Some(&entry.project))?);
    let by_title: HashMap<String, Entry> = near
        .iter()
        .map(|e| (normalize_title_key(&e.title), e.clone()))
        .collect();
    let mut out: Vec<String> = Vec::new();
    for link in extract_wikilinks(&entry.body) {
        let line = by_title
            .get(&normalize_title_key(&link.target))
            .map_or_else(|| format!("{} (no such note)", link.target), named);
        if !out.contains(&line) {
            out.push(line);
        }
    }
    let key = normalize_title_key(&entry.title);
    let into: Vec<String> = near
        .iter()
        .filter(|e| e.path != entry.path && body_links_to(&e.body, &key))
        .map(named)
        .collect();
    let mut items = vec![
        UntrustedItem {
            label: "Links out".to_owned(),
            text: joined(&out, "(none)"),
        },
        UntrustedItem {
            label: "Links here".to_owned(),
            text: joined(&into, "(none)"),
        },
    ];
    if entry.entity_type == WorkspaceEntityType::Paper {
        let id = id_of(&entry)?;
        let lines = ctx.relation_lines(&entry.project, Some(id.as_str()))?;
        items.push(UntrustedItem {
            label: "Relations".to_owned(),
            text: joined(&lines, "(none)"),
        });
    }
    content(&items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(filename: &str) -> SearchRow {
        SearchRow {
            filename: filename.to_owned(),
            label: filename.to_owned(),
            text: String::new(),
        }
    }

    #[test]
    fn ranked_rows_come_first_then_the_rest_in_place() {
        let rows = vec![row("a.md"), row("b.md"), row("c.md")];
        let order = vec!["c.md".to_owned(), "a.md".to_owned()];
        let names: Vec<String> = reorder_rows(rows, &order)
            .into_iter()
            .map(|r| r.filename)
            .collect();
        assert_eq!(names, ["c.md", "a.md", "b.md"]);
    }

    #[test]
    fn joined_falls_back_when_empty() {
        assert_eq!(joined(&[], "(none)"), "(none)");
        assert_eq!(joined(&["x".to_owned(), "y".to_owned()], "(none)"), "x\ny");
    }

    #[test]
    fn kinds_leave_out_ink_pages() {
        let all = kinds();
        assert!(!all.contains(&WorkspaceEntityType::InkPage));
        assert!(all.contains(&WorkspaceEntityType::VaultPage));
        assert_eq!(all.len(), ENTITY_DIRS.len() - 1);
    }
}

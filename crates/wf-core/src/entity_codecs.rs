//! One file codec per entity kind (0.9.7 L3): log entries, experiments, report
//! sections and reading lists. The upgrade export and the File* repositories both
//! call these, so the file shape is defined once.
//!
//! A row is the app's camelCase domain object (`Experiment`, `LogEntry`, ...). A file
//! is a note: `weaveforge-id`, `weaveforge-type`, `wf`, then one `key: <JSON>` line
//! per field (JSON is YAML flow syntax, so Obsidian reads it as properties), then the
//! body. Paper files use the same line form (`papers::paper_file`).
//!
//! Laws (proved in `tests/entity_codecs.rs`):
//! - `parse(render(row)) == row`, and rendering the read row again gives the same bytes.
//! - A save keeps every key it does not own byte for byte and in place; a cleared field
//!   is removed; a save never changes the id or the type.
//! - A file from a newer app (`wf` above [`FORMAT_VERSION`]) is read-only.
//! - Files written by the 0.9.5 serializer (bare scalars, experiment notes as
//!   `## Hypothesis` / `## Result` body sections) read back. Pure: no I/O.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::papers::paper_file::{entries, entry_key, entry_value, push_line, split_frontmatter};
use crate::sync::folder_layout::{WorkspaceEntityType, flat_path, log_path};
use crate::sync::frontmatter::{FORMAT_VERSION, canonical_text, value_text};

const ID_KEY: &str = "weaveforge-id";
const TYPE_KEY: &str = "weaveforge-type";
const WF_KEY: &str = "wf";

/// The kinds this module writes. Crosses to JS as its snake_case name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    /// `logbook/YYYY/MM/<date>--<id>.log.md`
    LogEntry,
    /// `experiments/<slug>--<id>.experiment.md`; metrics in the `metrics/` folder beside it.
    Experiment,
    /// `report/<slug>--<id>.section.md`, outline in `parent` and `order`.
    ReportSection,
    /// `reading-lists/<slug>--<id>.list.md`; members as `[[links]]` in `members`.
    ReadingList,
}

#[derive(Clone, Copy)]
enum Shape {
    Text,
    Number,
    Json,
}

struct Spec {
    entity: WorkspaceEntityType,
    /// The row key the path's title comes from.
    title: &'static str,
    /// `(row key, file key, shape)`, in write order.
    fields: &'static [(&'static str, &'static str, Shape)],
    /// The row key held in the body, and whether the row always has it.
    body: (&'static str, bool),
}

const LOG: Spec = Spec {
    entity: WorkspaceEntityType::LogEntry,
    title: "entryDate",
    fields: &[
        ("entryDate", "entry-date", Shape::Text),
        ("kind", "kind", Shape::Text),
        ("links", "links", Shape::Json),
        ("createdAt", "created-at", Shape::Text),
    ],
    body: ("body", true),
};

const EXPERIMENT: Spec = Spec {
    entity: WorkspaceEntityType::Experiment,
    title: "name",
    fields: &[
        ("name", "title", Shape::Text),
        ("status", "status", Shape::Text),
        ("hypothesis", "hypothesis", Shape::Text),
        ("repoUrl", "repo-url", Shape::Text),
        ("commitSha", "commit-sha", Shape::Text),
        ("branch", "branch", Shape::Text),
        ("runCommand", "run-command", Shape::Text),
        ("config", "config", Shape::Json),
        ("metrics", "metrics", Shape::Json),
        ("artifacts", "artifacts", Shape::Json),
        ("startedAt", "started-at", Shape::Text),
        ("finishedAt", "finished-at", Shape::Text),
        ("relatedPaper", "related-paper", Shape::Text),
        ("createdAt", "created-at", Shape::Text),
    ],
    body: ("resultNote", false),
};

const SECTION: Spec = Spec {
    entity: WorkspaceEntityType::ReportSection,
    title: "title",
    fields: &[
        ("title", "title", Shape::Text),
        ("sectionNo", "section-no", Shape::Text),
        ("parentId", "parent", Shape::Text),
        ("status", "status", Shape::Text),
        ("wordCount", "word-count", Shape::Number),
        ("targetWords", "target-words", Shape::Number),
        ("deadline", "deadline", Shape::Text),
        ("draftUrl", "draft-url", Shape::Text),
        ("sortOrder", "order", Shape::Number),
        ("createdAt", "created-at", Shape::Text),
        ("updatedAt", "updated-at", Shape::Text),
    ],
    body: ("notes", false),
};

const LIST: Spec = Spec {
    entity: WorkspaceEntityType::ReadingList,
    title: "name",
    fields: &[
        ("name", "title", Shape::Text),
        ("parentId", "parent", Shape::Text),
        ("sortOrder", "order", Shape::Number),
        ("color", "color", Shape::Text),
        ("createdAt", "created-at", Shape::Text),
        ("members", "members", Shape::Json),
        ("memberNotes", "member-notes", Shape::Json),
    ],
    body: ("description", false),
};

const fn spec(kind: EntityKind) -> &'static Spec {
    match kind {
        EntityKind::LogEntry => &LOG,
        EntityKind::Experiment => &EXPERIMENT,
        EntityKind::ReportSection => &SECTION,
        EntityKind::ReadingList => &LIST,
    }
}

/// Why a file could not be read or written. Nothing is written in any case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodecError {
    /// The text is not a file of this kind (no frontmatter, no id, another type).
    NotThisKind,
    /// The file was written by a newer app; it opens read-only.
    NewerFormat(u64),
    /// The row cannot be written: no id, or another id than the file's.
    BadRow(String),
}

impl fmt::Display for CodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotThisKind => f.write_str("This file is not of the expected kind."),
            Self::NewerFormat(v) => write!(
                f,
                "This file was saved by a newer WeaveForge (format {v}), so it opens read-only."
            ),
            Self::BadRow(why) => write!(f, "This item cannot be saved: {why}"),
        }
    }
}

impl std::error::Error for CodecError {}

/// The file's frontmatter entries (raw, with their keys) and its body.
struct Parsed {
    entries: Vec<(Option<String>, String)>,
    body: String,
}

fn split(text: &str) -> Option<Parsed> {
    let text = canonical_text(text);
    let (head, body) = split_frontmatter(&text)?;
    let entries = entries(head)
        .into_iter()
        .map(|raw| (entry_key(&raw).map(str::to_owned), raw))
        .collect();
    Some(Parsed {
        entries,
        body: body.to_owned(),
    })
}

impl Parsed {
    fn raw(&self, key: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|(k, _)| k.as_deref() == Some(key))
            .map(|(_, raw)| raw.as_str())
    }

    fn value(&self, key: &str) -> Option<Value> {
        self.raw(key).and_then(|raw| entry_value(key, raw))
    }

    fn text(&self, key: &str) -> Option<String> {
        match self.value(key)? {
            Value::Null | Value::Array(_) | Value::Object(_) => None,
            v => Some(value_text(&v)).filter(|t| !t.is_empty()),
        }
    }

    /// Checks the type and the format version; returns the id.
    fn check(&self, s: &Spec) -> Result<String, CodecError> {
        let id = self
            .text(ID_KEY)
            .filter(|id| !id.trim().is_empty())
            .ok_or(CodecError::NotThisKind)?;
        if self.text(TYPE_KEY).as_deref() != Some(s.entity.as_str()) {
            return Err(CodecError::NotThisKind);
        }
        match self.value(WF_KEY).and_then(|v| v.as_u64()) {
            Some(v) if v > FORMAT_VERSION => Err(CodecError::NewerFormat(v)),
            _ => Ok(id),
        }
    }
}

fn read_field(file: &Parsed, key: &str, shape: Shape) -> Option<Value> {
    match shape {
        Shape::Text => file.text(key).map(Value::String),
        Shape::Number => match file.value(key)? {
            Value::Number(n) => Some(Value::Number(n)),
            Value::String(s) => s
                .trim()
                .parse::<f64>()
                .ok()
                .and_then(|f| serde_json::Number::from_f64(f).map(Value::Number)),
            _ => None,
        },
        Shape::Json => file.value(key).filter(|v| !v.is_null()),
    }
}

/// The body without the one newline the writer adds.
fn body_text(body: &str) -> &str {
    body.strip_suffix('\n').unwrap_or(body)
}

/// A 0.9.5 experiment body: `## Hypothesis` and `## Result` sections.
fn legacy_sections(body: &str) -> (Option<String>, Option<String>) {
    let mut hypothesis = None;
    let mut result = None;
    let mut current: Option<&mut Option<String>> = None;
    let mut buffer = String::new();
    let flush = |slot: Option<&mut Option<String>>, buffer: &mut String| {
        if let Some(slot) = slot {
            let t = buffer.trim();
            if !t.is_empty() {
                *slot = Some(t.to_owned());
            }
        }
        buffer.clear();
    };
    for line in body.lines() {
        match line.trim_end() {
            "## Hypothesis" => {
                flush(current.take(), &mut buffer);
                current = Some(&mut hypothesis);
            }
            "## Result" => {
                flush(current.take(), &mut buffer);
                current = Some(&mut result);
            }
            _ => {
                buffer.push_str(line);
                buffer.push('\n');
            }
        }
    }
    flush(current, &mut buffer);
    (hypothesis, result)
}

/// Reads one file of `kind` as its camelCase row.
///
/// # Errors
///
/// [`CodecError::NotThisKind`] for another kind or no frontmatter,
/// [`CodecError::NewerFormat`] for a file from a newer app.
pub fn parse_entity_row(kind: EntityKind, text: &str) -> Result<Map<String, Value>, CodecError> {
    let s = spec(kind);
    let file = split(text).ok_or(CodecError::NotThisKind)?;
    let id = file.check(s)?;
    let mut row = Map::new();
    let _ = row.insert("id".into(), Value::String(id));
    for (row_key, file_key, shape) in s.fields {
        if let Some(v) = read_field(&file, file_key, *shape) {
            let _ = row.insert((*row_key).into(), v);
        }
    }
    let body = body_text(&file.body);
    let legacy = kind == EntityKind::Experiment
        && file.raw(WF_KEY).is_none()
        && file.raw("hypothesis").is_none()
        && body
            .lines()
            .any(|l| matches!(l.trim_end(), "## Hypothesis" | "## Result"));
    if legacy {
        let (hypothesis, result) = legacy_sections(body);
        if let Some(h) = hypothesis {
            let _ = row.insert("hypothesis".into(), Value::String(h));
        }
        if let Some(r) = result {
            let _ = row.insert("resultNote".into(), Value::String(r));
        }
        return Ok(row);
    }
    let (body_key, always) = s.body;
    if always || !body.is_empty() {
        let _ = row.insert(body_key.into(), Value::String(body.to_owned()));
    }
    Ok(row)
}

/// Writes `row` as a file of `kind`. With `existing`, every key the kind does not own
/// stays as it was, in place; owned keys are replaced in place, added at the end, or
/// removed when the row has no value for them.
///
/// # Errors
///
/// [`CodecError::BadRow`] when the row has no id or another id than `existing`;
/// the errors of [`parse_entity_row`] for `existing`.
pub fn render_entity_row(
    kind: EntityKind,
    existing: Option<&str>,
    row: &Map<String, Value>,
) -> Result<String, CodecError> {
    let s = spec(kind);
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| CodecError::BadRow("it has no id".into()))?;
    let kept = match existing {
        Some(text) => {
            let file = split(text).ok_or(CodecError::NotThisKind)?;
            if file.check(s)? != id {
                return Err(CodecError::BadRow(
                    "the file belongs to another item".into(),
                ));
            }
            file.entries
        }
        None => Vec::new(),
    };

    let mut wanted: Vec<(&str, Value)> = vec![
        (ID_KEY, Value::String(id.to_owned())),
        (TYPE_KEY, Value::String(s.entity.as_str().to_owned())),
        (WF_KEY, Value::from(FORMAT_VERSION)),
    ];
    for (row_key, file_key, shape) in s.fields {
        let value = match (row.get(*row_key), shape) {
            (None | Some(Value::Null), _) => continue,
            (Some(Value::String(t)), Shape::Text) if t.is_empty() => continue,
            (Some(v), _) => v.clone(),
        };
        wanted.push((file_key, value));
    }
    let mut out = String::from("---\n");
    let mut written: Vec<&str> = Vec::new();
    let owned = |key: &str| {
        key == ID_KEY || key == TYPE_KEY || key == WF_KEY || s.fields.iter().any(|f| f.1 == key)
    };
    for (key, raw) in &kept {
        match key.as_deref() {
            Some(k) if owned(k) => {
                if let Some((wk, v)) = wanted.iter().find(|(wk, _)| *wk == k)
                    && !written.contains(wk)
                {
                    push_line(&mut out, wk, v);
                    written.push(wk);
                }
            }
            _ => out.push_str(raw),
        }
    }
    for (key, value) in &wanted {
        if !written.contains(key) {
            push_line(&mut out, key, value);
        }
    }
    out.push_str("---\n");
    let body = row
        .get(s.body.0)
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !body.is_empty() {
        out.push_str(body);
        out.push('\n');
    }
    Ok(canonical_text(&out))
}

/// Where a new item of `kind` is written, under `project_root` ("" for the root).
///
/// # Errors
///
/// [`CodecError::BadRow`] when the row has no id (or, for a log entry, no date).
pub fn entity_path(
    kind: EntityKind,
    row: &Map<String, Value>,
    project_root: &str,
) -> Result<String, CodecError> {
    let s = spec(kind);
    let field = |key: &str| row.get(key).and_then(Value::as_str).unwrap_or_default();
    let id = field("id");
    if id.is_empty() {
        return Err(CodecError::BadRow("it has no id".into()));
    }
    if kind == EntityKind::LogEntry {
        let date = field("entryDate");
        if date.is_empty() {
            return Err(CodecError::BadRow("a log entry needs a date".into()));
        }
        return Ok(log_path(id, date, project_root));
    }
    Ok(flat_path(s.entity, id, field(s.title), project_root))
}

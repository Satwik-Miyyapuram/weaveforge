//! A paper as a workspace file (files-first, L1): `<slug>--<id-suffix>.paper.md` with
//! the paper's fields in frontmatter and the reader's own notes as the body.
//!
//! Every value the app owns is written as one line of JSON after `key: `. JSON is
//! valid YAML flow syntax, keeps types and escapes newlines, so the file stays
//! readable by any YAML tool and parses back exactly. A key the app does not know
//! is kept byte for byte, after the known ones. A value the app cannot read is
//! kept the same way, so a write never loses what was in the file.

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::index::IndexEntry;
use crate::sync::frontmatter::{FORMAT_VERSION, canonical_text, read_frontmatter};

/// The `weaveforge-type` of a paper file.
pub const PAPER_TYPE: &str = "paper";

/// Frontmatter keys the app owns besides id, type, `wf`, `tags` and `relations`,
/// in the order they are written.
pub const VALUE_KEYS: [&str; 20] = [
    "title",
    "authors",
    "year",
    "venue",
    "doi",
    "arxiv-id",
    "url",
    "pdf-path",
    "status",
    "rating",
    "read-at",
    "bibtex",
    "abstract",
    "summary",
    "metadata",
    "fields",
    "anchors",
    "alert",
    "created-at",
    "updated-at",
];

/// `Paper` field (camelCase, as `packages/core` names it) and its frontmatter key.
const PAPER_FIELDS: [(&str, &str); 17] = [
    ("title", "title"),
    ("authors", "authors"),
    ("year", "year"),
    ("venue", "venue"),
    ("doi", "doi"),
    ("arxivId", "arxiv-id"),
    ("url", "url"),
    ("pdfPath", "pdf-path"),
    ("status", "status"),
    ("rating", "rating"),
    ("readAt", "read-at"),
    ("bibtex", "bibtex"),
    ("abstract", "abstract"),
    ("summary", "summary"),
    ("metadata", "metadata"),
    ("createdAt", "created-at"),
    ("updatedAt", "updated-at"),
];

/// One outgoing relation in a paper's frontmatter: `{"to": id, "type": kind, ...}`.
/// A target that no file declares is kept; the index shows it as missing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RelationRef {
    /// The id the relation points to.
    pub to: String,
    /// The relation type, such as `cites`.
    #[serde(rename = "type")]
    pub relation_type: String,
    /// Any other keys on the relation, kept as they are.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A parsed paper file.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PaperFile {
    /// `weaveforge-id`.
    pub id: String,
    /// The `wf` format version the file declares; a missing one reads as current.
    pub wf: u64,
    /// Known values by frontmatter key (only keys in [`VALUE_KEYS`] are written).
    pub values: Map<String, Value>,
    /// `tags`; written even when empty.
    pub tags: Vec<String>,
    /// `relations`; written only when not empty.
    pub relations: Vec<RelationRef>,
    /// Frontmatter entries the app does not own, as their raw text (each ends in `\n`).
    pub unknown: Vec<String>,
    /// Everything after the closing `---` line.
    pub body: String,
}

/// Why a text is not a writable paper file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaperFileError {
    /// The text has no `---` frontmatter block.
    NoFrontmatter,
    /// `weaveforge-type` names another kind.
    NotAPaper(String),
    /// No `weaveforge-id`.
    MissingId,
    /// The file is from a newer app (`wf` above [`FORMAT_VERSION`]).
    ReadOnly(u64),
}

impl fmt::Display for PaperFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoFrontmatter => write!(f, "The file has no frontmatter."),
            Self::NotAPaper(kind) => write!(f, "The file is a {kind}, not a paper."),
            Self::MissingId => write!(f, "The file has no weaveforge-id."),
            Self::ReadOnly(wf) => write!(f, "The file is format wf: {wf}, newer than this app."),
        }
    }
}

impl PaperFile {
    /// An empty paper file with this id, at the current format version.
    #[must_use]
    pub fn new(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            wf: FORMAT_VERSION,
            ..Self::default()
        }
    }

    /// True when the file is from a newer app and must not be written.
    #[must_use]
    pub const fn is_read_only(&self) -> bool {
        self.wf > FORMAT_VERSION
    }
}

/// True when the app may write the file behind this index entry: it is not from a
/// newer app and no other file claims the same id.
#[must_use]
pub const fn may_write(entry: &IndexEntry) -> bool {
    !entry.read_only && !entry.duplicate
}

/// Parses a paper file. The text is read in canonical form (NFC, LF).
///
/// # Errors
///
/// [`PaperFileError::NoFrontmatter`], [`PaperFileError::NotAPaper`] or
/// [`PaperFileError::MissingId`].
pub fn parse_paper_file(text: &str) -> Result<PaperFile, PaperFileError> {
    let text = canonical_text(text);
    let (head, body) = split_frontmatter(&text).ok_or(PaperFileError::NoFrontmatter)?;
    let mut paper = PaperFile {
        wf: FORMAT_VERSION,
        body: body.to_owned(),
        ..PaperFile::default()
    };
    let mut seen = HashSet::new();
    for entry in entries(head) {
        let key = entry_key(&entry).filter(|key| seen.insert((*key).to_owned()));
        let kept = match key {
            Some(key) => apply_entry(&mut paper, key, &entry)?,
            None => false,
        };
        if !kept {
            paper.unknown.push(entry);
        }
    }
    if paper.id.is_empty() {
        return Err(PaperFileError::MissingId);
    }
    Ok(paper)
}

/// Renders a paper file. `render(parse(f)) == f` for every file this wrote.
#[must_use]
pub fn render_paper_file(paper: &PaperFile) -> String {
    let mut out = String::from("---\n");
    push_line(&mut out, "weaveforge-id", &Value::String(paper.id.clone()));
    out.push_str("weaveforge-type: paper\n");
    out.push_str(&format!("wf: {}\n", paper.wf));
    let tags = paper.tags.iter().cloned().map(Value::String).collect();
    push_line(&mut out, "tags", &Value::Array(tags));
    for key in VALUE_KEYS {
        if let Some(value) = paper.values.get(key).filter(|value| !value.is_null()) {
            push_line(&mut out, key, value);
        }
    }
    if !paper.relations.is_empty() {
        let rows = paper.relations.iter().map(relation_value).collect();
        push_line(&mut out, "relations", &Value::Array(rows));
    }
    for raw in &paper.unknown {
        out.push_str(raw);
    }
    out.push_str("---\n");
    out.push_str(&paper.body);
    out
}

/// The paper as a `Paper` row (camelCase keys): id, tags and every known field the
/// file holds. Missing `title`, `authors`, `status` and `metadata` get their defaults.
#[must_use]
pub fn paper_row(file: &PaperFile) -> Map<String, Value> {
    let mut row = Map::new();
    let _ = row.insert("id".to_owned(), Value::String(file.id.clone()));
    for (field, key) in PAPER_FIELDS {
        if let Some(value) = file.values.get(key) {
            let _ = row.insert(field.to_owned(), value.clone());
        }
    }
    let tags = file.tags.iter().cloned().map(Value::String).collect();
    let _ = row.insert("tags".to_owned(), Value::Array(tags));
    for (field, default) in [
        ("title", Value::String(String::new())),
        ("authors", Value::Array(Vec::new())),
        ("status", Value::String("to_read".to_owned())),
        ("metadata", Value::Object(Map::new())),
    ] {
        let _ = row.entry(field).or_insert(default);
    }
    row
}

/// Writes a `Paper` row into `existing` (or a new file when `None`), keeping the
/// body, relations, unknown keys and values the row does not carry.
///
/// # Errors
///
/// A parse error of `existing`, [`PaperFileError::ReadOnly`] for a newer file, or
/// [`PaperFileError::MissingId`] when the row has no string `id`.
pub fn write_paper_row(
    existing: Option<&str>,
    row: &Map<String, Value>,
) -> Result<String, PaperFileError> {
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or(PaperFileError::MissingId)?;
    let mut file = match existing {
        Some(text) => parse_paper_file(text)?,
        None => PaperFile::new(id),
    };
    if file.is_read_only() {
        return Err(PaperFileError::ReadOnly(file.wf));
    }
    file.id = id.to_owned();
    for (field, key) in PAPER_FIELDS {
        match row.get(field).filter(|value| !value.is_null()) {
            Some(value) => {
                let _ = file.values.insert(key.to_owned(), value.clone());
            }
            None => {
                let _ = file.values.shift_remove(key);
            }
        }
    }
    file.tags = row.get("tags").map(string_list).unwrap_or_default();
    Ok(render_paper_file(&file))
}

/// Reads one entry the app owns into `paper`. False when the key is not owned or
/// the value cannot be read, so the caller keeps the entry as unknown.
fn apply_entry(paper: &mut PaperFile, key: &str, entry: &str) -> Result<bool, PaperFileError> {
    let owned = matches!(
        key,
        "weaveforge-id" | "weaveforge-type" | "wf" | "tags" | "relations"
    ) || VALUE_KEYS.contains(&key);
    if !owned {
        return Ok(false);
    }
    let Some(value) = entry_value(key, entry) else {
        return Ok(false);
    };
    match key {
        "weaveforge-id" => match scalar_text(&value) {
            Some(id) => paper.id = id,
            None => return Ok(false),
        },
        "weaveforge-type" => match value.as_str() {
            Some(PAPER_TYPE) => {}
            Some(other) => return Err(PaperFileError::NotAPaper(other.to_owned())),
            None => return Ok(false),
        },
        "wf" => match value.as_u64() {
            Some(wf) => paper.wf = wf,
            None => return Ok(false),
        },
        "tags" => match value {
            Value::Array(_) | Value::String(_) => paper.tags = string_list(&value),
            _ => return Ok(false),
        },
        "relations" => match serde_json::from_value(value) {
            Ok(rows) => paper.relations = rows,
            Err(_) => return Ok(false),
        },
        _ if value.is_null() => {}
        _ => {
            let _ = paper.values.insert(key.to_owned(), value);
        }
    }
    Ok(true)
}

/// The value of a one-entry frontmatter block: one line of JSON, or else what the
/// YAML-subset reader makes of it (plain scalars and block lists a person typed).
fn entry_value(key: &str, entry: &str) -> Option<Value> {
    let first = entry.lines().next().unwrap_or_default();
    let rest = first.get(key.len() + 1..).unwrap_or_default().trim();
    let one_line = entry.lines().skip(1).all(|line| line.trim().is_empty());
    if one_line
        && !rest.is_empty()
        && let Ok(value) = serde_json::from_str(rest)
    {
        return Some(value);
    }
    read_frontmatter(&format!("---\n{entry}---\n"))
        .frontmatter
        .get(key)
        .cloned()
}

/// `---\n<head>---\n<body>`: the head (entries, each line ending in `\n`) and the body.
fn split_frontmatter(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix("---\n")?;
    if let Some(body) = rest.strip_prefix("---\n") {
        return Some(("", body));
    }
    if let Some(end) = rest.find("\n---\n") {
        return Some((&rest[..=end], &rest[end + 5..]));
    }
    rest.strip_suffix("\n---")
        .map(|head| (&text[4..4 + head.len() + 1], ""))
}

/// Splits the head into entries: a top-level `key:` line plus the indented, list
/// and blank lines after it. Lines before the first key form their own entry.
fn entries(head: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in head.split_inclusive('\n') {
        match out.last_mut() {
            Some(last) if entry_key(line).is_none() => last.push_str(line),
            _ => out.push(line.to_owned()),
        }
    }
    out
}

/// The key of a line that opens an entry: `key:` at column 0, followed by a space
/// or the line end, with no spaces or quotes in the key.
fn entry_key(line: &str) -> Option<&str> {
    let first = line.lines().next()?;
    let (key, rest) = first.split_once(':')?;
    let plain = !key.is_empty()
        && !key.starts_with(['-', '#', '[', '{'])
        && !key.contains(|c: char| c.is_whitespace() || c == '"' || c == '\'');
    (plain && (rest.is_empty() || rest.starts_with(' '))).then_some(key)
}

/// `key: <one line of JSON>\n`.
fn push_line(out: &mut String, key: &str, value: &Value) {
    out.push_str(key);
    out.push_str(": ");
    out.push_str(&value.to_string());
    out.push('\n');
}

/// A relation as JSON, `to` and `type` first.
fn relation_value(relation: &RelationRef) -> Value {
    let mut row = Map::new();
    let _ = row.insert("to".to_owned(), Value::String(relation.to.clone()));
    let _ = row.insert(
        "type".to_owned(),
        Value::String(relation.relation_type.clone()),
    );
    for (key, value) in &relation.extra {
        let _ = row.insert(key.clone(), value.clone());
    }
    Value::Object(row)
}

/// A string or number as text; None for other values.
fn scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// A list of strings from an array (non-strings skipped) or a single string.
fn string_list(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        Value::String(text) => vec![text.clone()],
        _ => Vec::new(),
    }
}

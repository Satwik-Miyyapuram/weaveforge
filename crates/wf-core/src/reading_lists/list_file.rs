//! Screening decisions stored in the reading-list file itself (files-first, L6).
//!
//! A list file is a note: frontmatter, then the list's description as the body. Its
//! `items` field holds one entry per screening decision, each written as a one-line
//! JSON object (also a YAML flow map), so a reason with quotes or newlines survives:
//!
//! ```text
//! ---
//! wf: 3
//! title: My review
//! items:
//!   - {"id":"d1","item":"i1","reviewer":"u1","stage":"title_abstract","decision":"included","added":"2026-11-19T10:00:00Z"}
//! ---
//! ```
//!
//! Every entry stays in the file. The decision that counts for an item, reviewer and
//! stage is the one with the latest `added` ([`effective_decisions`]). Pure: no I/O.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::screening::{ScreeningDecision, ScreeningStage, ScreeningState};
use crate::experiment_status::parse_iso_utc_ms;
use crate::sync::frontmatter::{FORMAT_VERSION, read_frontmatter, split_fences, write_frontmatter};

const ITEMS: &str = "items";
const VERSION: &str = "wf";

/// One screening decision as written in the list file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListEntry {
    /// Decision id.
    pub id: String,
    /// The list item the decision is about.
    pub item: String,
    /// Who decided.
    pub reviewer: String,
    /// Which pass.
    pub stage: ScreeningStage,
    /// What they decided.
    pub decision: ScreeningState,
    /// Why, if given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// ISO time of the decision.
    pub added: String,
    /// The item is no longer in the library; the decision is kept anyway.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub missing: bool,
}

impl From<&ScreeningDecision> for ListEntry {
    fn from(d: &ScreeningDecision) -> Self {
        Self {
            id: d.id.clone(),
            item: d.item_id.clone(),
            reviewer: d.reviewer_id.clone(),
            stage: d.stage,
            decision: d.state,
            reason: d.reason.clone(),
            added: d.decided_at.clone(),
            missing: false,
        }
    }
}

impl From<&ListEntry> for ScreeningDecision {
    fn from(e: &ListEntry) -> Self {
        Self {
            id: e.id.clone(),
            item_id: e.item.clone(),
            reviewer_id: e.reviewer.clone(),
            stage: e.stage,
            state: e.decision,
            reason: e.reason.clone(),
            decided_at: e.added.clone(),
        }
    }
}

/// A list file split into its other fields (in file order), its entries and its body.
#[derive(Debug, Clone, PartialEq)]
pub struct ListFile {
    /// Every frontmatter field except `items`, in file order.
    pub fields: Vec<(String, Value)>,
    /// The screening entries, in file order.
    pub entries: Vec<ListEntry>,
    /// The list's description.
    pub body: String,
}

/// Why a list file could not be read or changed. Nothing is written in any case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListFileError {
    /// The file was written by a newer app (`wf` above [`FORMAT_VERSION`]).
    NewerFormat(u64),
    /// An entry is not a decision this app understands; the file is left alone.
    BadEntry(String),
}

impl std::fmt::Display for ListFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NewerFormat(v) => write!(
                f,
                "This list was saved by a newer WeaveForge (format {v}), so it opens read-only."
            ),
            Self::BadEntry(why) => write!(
                f,
                "A screening entry in this list could not be read, so the list was not changed: {why}"
            ),
        }
    }
}

impl std::error::Error for ListFileError {}

/// Splits `text` into fields, entries and body.
///
/// # Errors
///
/// [`ListFileError::BadEntry`] when `items` holds something other than decisions.
pub fn read_list_file(text: &str) -> Result<ListFile, ListFileError> {
    let parsed = read_frontmatter(text);
    let mut fields = Vec::new();
    let mut entries = Vec::new();
    for (key, value) in parsed.frontmatter {
        if key != ITEMS {
            fields.push((key, value));
            continue;
        }
        let Value::Array(lines) = value else {
            if value.as_str().is_some_and(str::is_empty) {
                continue;
            }
            return Err(ListFileError::BadEntry("items is not a list".to_owned()));
        };
        for line in lines {
            let raw = line.as_str().unwrap_or_default();
            let entry =
                serde_json::from_str(raw).map_err(|e| ListFileError::BadEntry(e.to_string()))?;
            entries.push(entry);
        }
    }
    Ok(ListFile {
        fields,
        entries,
        body: parsed.body,
    })
}

/// Writes `file` back as text, adding `wf: 3` first when the file has no version.
///
/// # Errors
///
/// [`ListFileError::NewerFormat`] when the file says a newer format.
pub fn render_list_file(file: &ListFile) -> Result<String, ListFileError> {
    let mut fields = file.fields.clone();
    if !has_version(&fields)? {
        fields.insert(0, (VERSION.to_owned(), Value::from(FORMAT_VERSION)));
    }
    let head = write_frontmatter(&fields, "");
    let open = head.strip_suffix("---\n").unwrap_or(&head);
    let mut out = open.to_owned();
    if !file.entries.is_empty() {
        out.push_str("items:\n");
        for entry in &file.entries {
            out.push_str("  - ");
            out.push_str(&entry_line(entry)?);
            out.push('\n');
        }
    }
    out.push_str("---\n");
    out.push_str(&file.body);
    Ok(out)
}

/// Whether `fields` name a format version.
///
/// # Errors
///
/// [`ListFileError::NewerFormat`] when it is above [`FORMAT_VERSION`].
fn has_version(fields: &[(String, Value)]) -> Result<bool, ListFileError> {
    let Some((_, version)) = fields.iter().find(|(k, _)| k == VERSION) else {
        return Ok(false);
    };
    match version.as_u64().filter(|v| *v > FORMAT_VERSION) {
        Some(v) => Err(ListFileError::NewerFormat(v)),
        None => Ok(true),
    }
}

/// `text` with only its `items` block replaced by `file.entries` (and `wf: 3` added
/// first when the file has no version). Every other frontmatter line and the body
/// are kept as written, so properties this app does not model (spaced keys, block
/// scalars, comments, nested maps) survive, and so does the file's line ending.
///
/// # Errors
///
/// [`ListFileError::NewerFormat`] when the file says a newer format.
fn splice_entries(text: &str, file: &ListFile) -> Result<String, ListFileError> {
    let versioned = has_version(&file.fields)?;
    let Some((block, _)) = split_fences(text) else {
        // No frontmatter: only the body to keep.
        return render_list_file(file);
    };
    // `block` is a slice of `text`, so its offset is the pointer difference.
    let start = block.as_ptr() as usize - text.as_ptr() as usize;
    let end = start + block.len();
    let nl = if block.contains("\r\n") || text[end..].starts_with("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines: Vec<String> = block
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_owned())
        .collect();
    let mut items: Vec<String> = Vec::new();
    if !file.entries.is_empty() {
        items.push(format!("{ITEMS}:"));
        for entry in &file.entries {
            items.push(format!("  - {}", entry_line(entry)?));
        }
    }
    match lines.iter().position(|l| is_items_key(l)) {
        Some(at) => {
            let stop = items_block_end(&lines, at);
            // The splice takes effect when the returned iterator drops here.
            let _ = lines.splice(at..stop, items);
        }
        None => lines.extend(items),
    }
    if !versioned {
        lines.insert(0, format!("{VERSION}: {FORMAT_VERSION}"));
    }
    Ok(format!(
        "{}{}{}",
        &text[..start],
        lines.join(nl),
        &text[end..]
    ))
}

/// A top-level `items:` key line.
fn is_items_key(line: &str) -> bool {
    line.strip_prefix(ITEMS)
        .and_then(|rest| rest.strip_prefix(':'))
        .is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '\t']))
}

/// The line after the `items` block that starts at `at`: its indented or `-` lines,
/// leaving any trailing blank lines in place.
fn items_block_end(lines: &[String], at: usize) -> usize {
    let mut end = at + 1;
    for (i, line) in lines.iter().enumerate().skip(at + 1) {
        if line.trim().is_empty() {
            continue;
        }
        if !line.starts_with([' ', '\t', '-']) {
            break;
        }
        end = i + 1;
    }
    end
}

/// One entry as single-line JSON. U+2028 and U+2029 are escaped too, because the
/// frontmatter reader treats them as line ends.
///
/// # Errors
///
/// [`ListFileError::BadEntry`] when the entry cannot be serialised. The caller then writes
/// nothing, rather than an empty `items` line that would drop the entry.
fn entry_line(entry: &ListEntry) -> Result<String, ListFileError> {
    let json = serde_json::to_string(entry).map_err(|e| ListFileError::BadEntry(e.to_string()))?;
    Ok(json
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029"))
}

/// Every decision in the file, in file order.
///
/// # Errors
///
/// As [`read_list_file`].
pub fn list_decisions(text: &str) -> Result<Vec<ScreeningDecision>, ListFileError> {
    Ok(read_list_file(text)?
        .entries
        .iter()
        .map(ScreeningDecision::from)
        .collect())
}

/// Whether time `a` is the same as or after `b`. Both are compared as instants when
/// both parse as RFC 3339 (so `.500Z` beats `Z` and offsets count); otherwise as text.
fn not_earlier(a: &str, b: &str) -> bool {
    if let (Some(x), Some(y)) = (parse_iso_utc_ms(a), parse_iso_utc_ms(b)) {
        return x >= y;
    }
    a >= b
}

/// The decision that counts per item, reviewer and stage: the latest `decided_at`, a tie
/// going to the one later in `decisions`. Kept in the order each key first appears.
#[must_use]
pub fn effective_decisions(decisions: &[ScreeningDecision]) -> Vec<ScreeningDecision> {
    let mut out: Vec<ScreeningDecision> = Vec::new();
    for d in decisions {
        let slot = out.iter_mut().find(|e| {
            e.item_id == d.item_id && e.reviewer_id == d.reviewer_id && e.stage == d.stage
        });
        match slot {
            Some(e) if not_earlier(&d.decided_at, &e.decided_at) => *e = d.clone(),
            Some(_) => {}
            None => out.push(d.clone()),
        }
    }
    out
}

/// `text` with `decision` recorded: an entry with the same id is replaced in place,
/// otherwise the decision is added at the end. No other entry changes.
///
/// # Errors
///
/// As [`read_list_file`] and [`render_list_file`].
pub fn record_decision(text: &str, decision: &ScreeningDecision) -> Result<String, ListFileError> {
    let mut file = read_list_file(text)?;
    let entry = ListEntry::from(decision);
    match file.entries.iter_mut().find(|e| e.id == decision.id) {
        Some(slot) => *slot = entry,
        None => file.entries.push(entry),
    }
    splice_entries(text, &file)
}

/// `text` without the entry `id`. Removing an id that is not there changes nothing.
///
/// # Errors
///
/// As [`read_list_file`] and [`render_list_file`].
pub fn remove_decision(text: &str, id: &str) -> Result<String, ListFileError> {
    let mut file = read_list_file(text)?;
    file.entries.retain(|e| e.id != id);
    splice_entries(text, &file)
}

/// `text` with each entry marked missing when its item is not in `known_items`, and
/// unmarked when it is. No decision is removed or changed.
///
/// # Errors
///
/// As [`read_list_file`] and [`render_list_file`].
pub fn mark_missing(text: &str, known_items: &[String]) -> Result<String, ListFileError> {
    let mut file = read_list_file(text)?;
    for entry in &mut file.entries {
        entry.missing = !known_items.contains(&entry.item);
    }
    splice_entries(text, &file)
}

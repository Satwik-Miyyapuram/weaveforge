//! A paper's annotations as one workspace file (files-first, L2):
//! the existing sidecar of the paper's PDF (`x.pdf` -> `x.annotations.json`).
//!
//! The file is one JSON array of annotation objects, sorted by `id`, two-space
//! indented, ending in a newline. Only `id` is read; every other key is kept as it
//! is. An empty file reads as no annotations. An edit made outside the app is
//! merged row by row, by `id`, against the base the app last read.

use std::collections::BTreeSet;
use std::fmt;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::sync::folder_layout::{annotations_path, paper_pdf_path};
use crate::sync::frontmatter::canonical_text;
use crate::sync::merge::{Conflict, merge_rows};

/// One annotation: a JSON object with a string `id`.
pub type AnnotationRow = Map<String, Value>;

/// Why a text is not an annotations file. The app does not write over such a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnnotationsFileError {
    /// The text is not JSON.
    NotJson(String),
    /// The JSON is not an array.
    NotAnArray,
    /// The row at this index is not an object with a non-empty string `id`.
    BadRow(usize),
}

impl fmt::Display for AnnotationsFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotJson(error) => write!(f, "The annotations file is not JSON: {error}"),
            Self::NotAnArray => write!(f, "The annotations file is not a JSON array."),
            Self::BadRow(index) => write!(f, "Annotation {index} has no id."),
        }
    }
}

/// The rows of a merge, and the fields both sides changed.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct AnnotationsMerge {
    /// The merged rows, sorted by id.
    pub rows: Vec<AnnotationRow>,
    /// Per annotation id, the fields both sides changed. The row keeps the disk value.
    pub conflicts: Vec<(String, Vec<Conflict>)>,
}

/// `<project>/papers/pdf/<paper-id>.annotations.json` (no project prefix for `""`).
#[must_use]
pub fn annotations_file_path(paper_id: &str, project_root: &str) -> String {
    annotations_path(&paper_pdf_path(paper_id, project_root))
}

/// Parses an annotations file. Empty or blank text is no annotations.
///
/// # Errors
///
/// When the text is not a JSON array of objects that each have a string `id`.
pub fn parse_annotations(text: &str) -> Result<Vec<AnnotationRow>, AnnotationsFileError> {
    let text = canonical_text(text);
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| AnnotationsFileError::NotJson(error.to_string()))?;
    let Value::Array(items) = value else {
        return Err(AnnotationsFileError::NotAnArray);
    };
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| match item {
            Value::Object(row) if row_id(&row).is_some_and(|id| !id.is_empty()) => Ok(row),
            _ => Err(AnnotationsFileError::BadRow(index)),
        })
        .collect()
}

/// Renders rows as the file text: sorted by id (stable for equal ids), two-space
/// indented JSON, one trailing newline. Keys keep their order within a row.
#[must_use]
pub fn render_annotations(rows: &[AnnotationRow]) -> String {
    let mut sorted: Vec<&AnnotationRow> = rows.iter().collect();
    sorted.sort_by(|a, b| row_id(a).cmp(&row_id(b)));
    let array = Value::Array(sorted.into_iter().cloned().map(Value::Object).collect());
    let mut text = serde_json::to_string_pretty(&array).unwrap_or_default();
    text.push('\n');
    text
}

/// Merges this device's rows (`local`) with the file on disk (`disk`) against the
/// rows both started from (`base`), by id. A row only one side has is kept unless
/// the other side deleted it unchanged; a row both sides have is merged field by
/// field. A row edited on one side and deleted on the other is kept.
#[must_use]
pub fn merge_annotations(
    base: &[AnnotationRow],
    local: &[AnnotationRow],
    disk: &[AnnotationRow],
) -> AnnotationsMerge {
    let ids: BTreeSet<&str> = local.iter().chain(disk).filter_map(row_id).collect();
    let mut merge = AnnotationsMerge::default();
    for id in ids {
        let (b, l, r) = (find(base, id), find(local, id), find(disk, id));
        match (b, l, r) {
            (_, Some(l), Some(r)) => {
                let result = merge_rows(b.unwrap_or(&Map::new()), l, r);
                if !result.conflicts.is_empty() {
                    merge.conflicts.push((id.to_owned(), result.conflicts));
                }
                merge.rows.push(result.merged);
            }
            (Some(b), Some(only), None) | (Some(b), None, Some(only)) if only == b => {}
            (_, Some(only), None) | (_, None, Some(only)) => merge.rows.push(only.clone()),
            (_, None, None) => {}
        }
    }
    merge
}

/// The row's `id` when it is a string.
fn row_id(row: &AnnotationRow) -> Option<&str> {
    row.get("id").and_then(Value::as_str)
}

/// The first row with this id.
fn find<'a>(rows: &'a [AnnotationRow], id: &str) -> Option<&'a AnnotationRow> {
    rows.iter().find(|row| row_id(row) == Some(id))
}

//! Export of 0.9.2 annotations, highlights, comments, pins and screening into files.
//! Files are paired by path only: sidecars take their stem from the paper's path, and paper
//! facts are frontmatter properties on the paper file. No file or property is keyed by id.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use wf_core::sync::folder_layout::{annotations_path, comments_path};
use wf_core::sync::frontmatter::{frontmatter_string, read_frontmatter, write_frontmatter};

use super::rules::{Stored, decide, is_trashed, migrated_copy_path, parse_rfc3339};
use super::{WorkspaceFiles, apply};

/// One annotation or highlight, as written to `<paper stem>.annotations.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnnotationRow {
    /// `highlight`, `underline`, `note`, `image`, `ink` or `text`.
    pub kind: String,
    /// Colour as `#rrggbb`.
    pub color: String,
    /// The text the annotation covers.
    pub text: String,
    /// The comment attached to the annotation.
    pub comment: String,
    /// Tags on the annotation.
    pub tags: Vec<String>,
    /// Page the annotation sits on (zero-based).
    pub page_index: i64,
    /// Order among the annotations of the paper (text in the 0.9.2 schema).
    pub sort_index: String,
    /// Where the annotation sits in the paper (jsonb in the 0.9.2 schema).
    pub anchor: Value,
    /// Last change time of the row (ISO-8601 UTC).
    pub updated_at: String,
}

/// One comment, as written to `<item stem>.comments.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentRow {
    /// The comment text.
    pub body: String,
    /// When the comment was made (ISO-8601 UTC).
    pub created_at: String,
}

/// The screening value a paper carries in its frontmatter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screening {
    /// Included in the review.
    Include,
    /// Excluded from the review.
    Exclude,
    /// Not decided yet.
    Maybe,
}

impl Screening {
    /// The frontmatter value.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Include => "include",
            Self::Exclude => "exclude",
            Self::Maybe => "maybe",
        }
    }

    /// Maps a 0.9.2 `screening_decisions.state` to a screening value.
    fn from_db_state(state: &str) -> Result<Self, String> {
        match state {
            "included" => Ok(Self::Include),
            "excluded" => Ok(Self::Exclude),
            "unsure" => Ok(Self::Maybe),
            other => Err(format!(
                "screening state {other} is not included, excluded or unsure"
            )),
        }
    }

    /// Reads a `screening:` frontmatter value.
    fn from_property(text: &str) -> Result<Self, String> {
        match text {
            "include" => Ok(Self::Include),
            "exclude" => Ok(Self::Exclude),
            "maybe" => Ok(Self::Maybe),
            other => Err(format!(
                "screening {other} is not include, exclude or maybe"
            )),
        }
    }
}

/// A paper's screening value and the reason given for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperScreening {
    /// The screening value.
    pub screening: Screening,
    /// The reason, written as `screening_reason:` when present.
    pub reason: Option<String>,
}

/// The paper-level facts written as frontmatter properties.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PaperFacts {
    /// Pinned in the library: written as `pinned: true`. A false value writes nothing.
    pub pinned: bool,
    /// Screening: written as `screening:` and `screening_reason:`.
    pub screening: Option<PaperScreening>,
}

/// One screening decision row for a paper (0.9.2 `screening_decisions`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreeningDecision {
    /// When it was decided (ISO-8601 UTC); the latest decision wins.
    pub decided_at: String,
    /// The 0.9.2 state: `included`, `excluded` or `unsure`.
    pub state: String,
    /// The reason given with the decision.
    pub reason: Option<String>,
}

/// Everything exported for one paper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperExport {
    /// Last change time of the paper's export data (ISO-8601 UTC).
    pub updated_at: String,
    /// Annotations and highlights for the paper.
    pub annotations: Vec<AnnotationRow>,
    /// Comments on the paper.
    pub comments: Vec<CommentRow>,
    /// Pin and screening facts for the paper.
    pub facts: PaperFacts,
}

/// Serialises rows as the annotations sidecar.
#[must_use]
pub fn annotations_document(rows: &[AnnotationRow]) -> String {
    // A list of plain structs cannot fail to serialise.
    serde_json::to_string_pretty(rows).unwrap_or_default()
}

/// Reads an annotations sidecar.
///
/// # Errors
/// The text is not a list of annotation rows.
pub fn read_annotations(text: &str) -> Result<Vec<AnnotationRow>, String> {
    serde_json::from_str(text).map_err(|err| format!("annotations sidecar is not valid: {err}"))
}

/// Serialises rows as the comments sidecar.
#[must_use]
pub fn comments_document(rows: &[CommentRow]) -> String {
    // A list of plain structs cannot fail to serialise.
    serde_json::to_string_pretty(rows).unwrap_or_default()
}

/// Reads a comments sidecar.
///
/// # Errors
/// The text is not a list of comment rows.
pub fn read_comments(text: &str) -> Result<Vec<CommentRow>, String> {
    serde_json::from_str(text).map_err(|err| format!("comments sidecar is not valid: {err}"))
}

/// The screening of a paper: the latest decision wins. Every state is checked, so an unknown
/// one is refused rather than dropped.
///
/// # Errors
/// A decision has a state other than `included`, `excluded` or `unsure`.
pub fn pick_screening(decisions: &[ScreeningDecision]) -> Result<Option<PaperScreening>, String> {
    let mut latest: Option<((i64, u32), &ScreeningDecision)> = None;
    for decision in decisions {
        let _checked = Screening::from_db_state(&decision.state)?;
        let at = parse_rfc3339(&decision.decided_at)
            .ok_or_else(|| format!("decision time {} is not RFC 3339", decision.decided_at))?;
        match latest {
            Some((best, _)) if best >= at => {}
            _ => latest = Some((at, decision)),
        }
    }
    latest
        .map(|(_, decision)| -> Result<PaperScreening, String> {
            Ok(PaperScreening {
                screening: Screening::from_db_state(&decision.state)?,
                reason: decision.reason.clone(),
            })
        })
        .transpose()
}

/// The frontmatter fields the facts ask for.
fn wanted_fields(facts: &PaperFacts) -> Vec<(String, Value)> {
    let mut fields = Vec::new();
    if facts.pinned {
        fields.push(("pinned".to_owned(), Value::Bool(true)));
    }
    if let Some(screening) = &facts.screening {
        fields.push((
            "screening".to_owned(),
            Value::String(screening.screening.as_str().to_owned()),
        ));
        if let Some(reason) = &screening.reason {
            fields.push(("screening_reason".to_owned(), Value::String(reason.clone())));
        }
    }
    fields
}

/// Sets the pin and screening properties on a paper's text. Other properties and the body are
/// kept. Returns the text unchanged when every property already has the value.
#[must_use]
pub fn apply_paper_facts(content: &str, facts: &PaperFacts) -> String {
    let wanted = wanted_fields(facts);
    if wanted.is_empty() {
        return content.to_owned();
    }
    let mut parsed = read_frontmatter(content);
    let mut changed = false;
    for (key, value) in &wanted {
        if parsed.frontmatter.get(key) != Some(value) {
            parsed.frontmatter.insert(key.clone(), value.clone());
            changed = true;
        }
    }
    if !changed {
        return content.to_owned();
    }
    let fields: Vec<(String, Value)> = parsed.frontmatter.into_iter().collect();
    write_frontmatter(&fields, &parsed.body)
}

/// Reads the pin and screening properties back from a paper's text.
///
/// # Errors
/// The `screening:` property is not include, exclude or maybe.
pub fn read_paper_facts(content: &str) -> Result<PaperFacts, String> {
    let fm = read_frontmatter(content).frontmatter;
    let pinned = frontmatter_string(&fm, "pinned").as_deref() == Some("true");
    let screening = match frontmatter_string(&fm, "screening") {
        None => None,
        Some(text) => Some(PaperScreening {
            screening: Screening::from_property(&text)?,
            reason: frontmatter_string(&fm, "screening_reason"),
        }),
    };
    Ok(PaperFacts { pinned, screening })
}

/// Writes one sidecar through the same rules as the rest of the migration. Returns whether a
/// file was written. A sidecar file has no recorded change time, so it is treated as being as
/// new as the row: the file wins on any difference, and the rows go to the migrated copy.
fn write_sidecar<F: WorkspaceFiles + ?Sized>(
    files: &F,
    trash: &[String],
    rel: &str,
    text: &str,
    updated_at: &str,
) -> Result<bool, String> {
    let existing = files.read(rel)?.map(|stored| Stored {
        updated_at: updated_at.to_owned(),
        text: stored,
    });
    let decision = decide(
        rel,
        updated_at,
        text,
        existing.as_ref(),
        is_trashed(rel, trash),
    );
    apply(files, rel, text, &decision)
}

/// Writes the paper's facts into its frontmatter, keeping the rest of the file.
fn write_facts<F: WorkspaceFiles + ?Sized>(
    files: &F,
    paper_rel: &str,
    facts: &PaperFacts,
) -> Result<bool, String> {
    let current = files
        .read(paper_rel)?
        .ok_or_else(|| format!("{paper_rel} is missing"))?;
    let next = apply_paper_facts(&current, facts);
    if next == current {
        return Ok(false);
    }
    if files.write_if(paper_rel, &next, Some(&current))? {
        Ok(true)
    } else {
        Err(format!("{paper_rel} changed while exporting"))
    }
}

/// Exports one paper's annotations, comments and facts beside it. Re-running with the same data
/// writes nothing. A trashed paper gets nothing, not even its sidecars. A paper with data but no
/// file is an error, so nothing is exported beside a missing paper.
///
/// # Errors
/// The paper file is missing while there is data, or the workspace cannot be read or written.
pub fn export_paper<F: WorkspaceFiles + ?Sized>(
    files: &F,
    paper_rel: &str,
    item: &PaperExport,
) -> Result<usize, String> {
    let trash = files.trash_entries()?;
    if is_trashed(paper_rel, &trash) {
        return Ok(0);
    }
    let has_data = !item.annotations.is_empty()
        || !item.comments.is_empty()
        || !wanted_fields(&item.facts).is_empty();
    if !has_data {
        return Ok(0);
    }
    if files.read(paper_rel)?.is_none() {
        return Err(format!(
            "{paper_rel} is missing, so its data cannot be exported"
        ));
    }
    // A sidecar is written only when there is something in it: no empty files.
    let annotations = !item.annotations.is_empty()
        && write_sidecar(
            files,
            &trash,
            &annotations_path(paper_rel),
            &annotations_document(&item.annotations),
            &item.updated_at,
        )?;
    let comments = !item.comments.is_empty()
        && write_sidecar(
            files,
            &trash,
            &comments_path(paper_rel),
            &comments_document(&item.comments),
            &item.updated_at,
        )?;
    let facts = write_facts(files, paper_rel, &item.facts)?;
    Ok(usize::from(annotations) + usize::from(comments) + usize::from(facts))
}

/// Reads the export back. Passes when the paper holds its pin and screening and each non-empty
/// sidecar holds the exported rows, either as the file or as the copy kept beside it.
/// A trashed paper has nothing to check.
///
/// # Errors
/// The paper is missing, or something exported is not in the workspace.
pub fn verify_paper<F: WorkspaceFiles + ?Sized>(
    files: &F,
    paper_rel: &str,
    item: &PaperExport,
) -> Result<(), String> {
    if is_trashed(paper_rel, &files.trash_entries()?) {
        return Ok(());
    }
    let paper = files
        .read(paper_rel)?
        .ok_or_else(|| format!("{paper_rel} is missing"))?;
    if apply_paper_facts(&paper, &item.facts) != paper {
        return Err(format!("{paper_rel} does not hold its pin and screening"));
    }
    let sidecars = [
        (
            !item.annotations.is_empty(),
            annotations_path(paper_rel),
            annotations_document(&item.annotations),
        ),
        (
            !item.comments.is_empty(),
            comments_path(paper_rel),
            comments_document(&item.comments),
        ),
    ];
    for (wanted, rel, document) in sidecars {
        if wanted && !sidecar_holds(files, &rel, &document)? {
            return Err(format!("{rel} does not hold the exported rows"));
        }
    }
    Ok(())
}

fn sidecar_holds<F: WorkspaceFiles + ?Sized>(
    files: &F,
    rel: &str,
    document: &str,
) -> Result<bool, String> {
    let kept = migrated_copy_path(rel);
    Ok(files.read(rel)?.as_deref() == Some(document)
        || files.read(&kept)?.as_deref() == Some(document))
}

/// What the export will write, gathered from the 0.9.2 rows.
#[derive(Debug, Default)]
pub struct ExportPlan {
    /// Each paper's path and its export.
    pub papers: Vec<(String, PaperExport)>,
    /// One line per paper that could not be exported, with the reason.
    pub skipped: Vec<String>,
}

/// The paper's file path, as the workspace writes papers: `papers/<title>.paper.md`.
/// Mirrors `workspace_load::paper_document`; a test pins the format.
#[must_use]
pub fn paper_path(title: &str) -> String {
    let name = if title.is_empty() { "Untitled" } else { title };
    format!("papers/{name}.paper.md")
}

fn text_field(row: &Value, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// The rows whose `key` column holds `id`.
fn matching<'a>(
    rows: &'a [Value],
    key: &'a str,
    id: &'a str,
) -> impl Iterator<Item = &'a Value> + 'a {
    rows.iter()
        .filter(move |row| row.get(key).and_then(Value::as_str) == Some(id))
}

fn annotation_row(row: &Value) -> AnnotationRow {
    let tags = row
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    AnnotationRow {
        kind: text_field(row, "type"),
        color: text_field(row, "color"),
        text: text_field(row, "text"),
        comment: text_field(row, "comment"),
        tags,
        page_index: row
            .get("page_index")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        sort_index: text_field(row, "sort_index"),
        anchor: row.get("anchor").cloned().unwrap_or(Value::Null),
        updated_at: text_field(row, "updated_at"),
    }
}

fn screening_decision(row: &Value) -> ScreeningDecision {
    ScreeningDecision {
        decided_at: text_field(row, "decided_at"),
        state: text_field(row, "state"),
        reason: row.get("reason").and_then(Value::as_str).map(str::to_owned),
    }
}

/// Gathers the export for every paper from the 0.9.2 rows, pairing each row to its paper by the
/// paper's id in memory only. Papers whose path is shared with another paper are skipped, so
/// their data is never mixed into one file. Papers with nothing to export are left out.
#[must_use]
pub fn plan_exports(
    papers: &[Value],
    annotations: &[Value],
    comments: &[Value],
    pins: &[Value],
    screening: &[Value],
) -> ExportPlan {
    let mut path_counts: BTreeMap<String, usize> = BTreeMap::new();
    for paper in papers {
        *path_counts
            .entry(paper_path(&text_field(paper, "title")))
            .or_default() += 1;
    }
    let mut plan = ExportPlan::default();
    for paper in papers {
        let id = text_field(paper, "id");
        let rel = paper_path(&text_field(paper, "title"));
        let annotations_here: Vec<AnnotationRow> = matching(annotations, "paper_id", &id)
            .map(annotation_row)
            .collect();
        let comments_here: Vec<CommentRow> = matching(comments, "resource_id", &id)
            .map(|row| CommentRow {
                body: text_field(row, "body"),
                created_at: text_field(row, "created_at"),
            })
            .collect();
        let pinned = matching(pins, "resource_id", &id).next().is_some();
        let decisions: Vec<ScreeningDecision> = matching(screening, "paper_id", &id)
            .map(screening_decision)
            .collect();
        let screened = match pick_screening(&decisions) {
            Ok(found) => found,
            Err(reason) => {
                plan.skipped.push(format!("{rel}: {reason}"));
                None
            }
        };
        if annotations_here.is_empty() && comments_here.is_empty() && !pinned && screened.is_none()
        {
            continue;
        }
        if path_counts.get(&rel).copied().unwrap_or(0) > 1 {
            plan.skipped.push(format!(
                "{rel}: two papers share this title, so paired by path their data would mix"
            ));
            continue;
        }
        let updated_at = annotations_here
            .iter()
            .map(|row| row.updated_at.as_str())
            .max()
            .unwrap_or_default()
            .to_owned();
        plan.papers.push((
            rel,
            PaperExport {
                updated_at,
                annotations: annotations_here,
                comments: comments_here,
                facts: PaperFacts {
                    pinned,
                    screening: screened,
                },
            },
        ));
    }
    plan
}

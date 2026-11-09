//! Workspace snapshot, PDF pages and reader annotations → search documents.
//! Port of `packages/core/src/search/search-document.ts`,
//! `pdf-search-document.ts` and `annotation-search-document.ts`. The documents
//! and the revision fingerprint match the TypeScript they replace, so a persisted
//! index built by either side is recognised as current.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex_lite::{Captures, Regex};
use serde::{Deserialize, Serialize};

use crate::overleaf_workshop::encode_uri_component;
use crate::papers::paper::extract_hashtags;
use crate::search::acronyms::acronyms_for_title;
use crate::search::js_text::utf16_len;
use crate::search::query::SearchKind;
use crate::search::search_tuning::MAX_INDEXED_BODY_CHARS;
use crate::sync::workspace_snapshot::WorkspaceSnapshot;

/// Pages with almost no text are figures or scan artefacts (TS `MIN_PDF_PAGE_CHARS`).
pub const MIN_PDF_PAGE_CHARS: usize = 24;

/// One indexed record. Field names match the TypeScript `SearchDoc`.
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDoc {
    /// `${kind}:${entityId}`, unique across kinds (PDF pages use `pdf:<paper>#<page>`).
    pub id: String,
    /// Entity kind.
    pub kind: SearchKind,
    /// Id of the entity the document is about.
    pub entity_id: String,
    /// Title shown in a result list.
    pub title: String,
    /// Alternative names a query may match.
    pub aliases: Vec<String>,
    /// Markdown h1–h3 headings lifted out of the body.
    pub headings: Vec<String>,
    /// Tags.
    pub tags: Vec<String>,
    /// Breadcrumb or position text, e.g. "Method/Baselines" or "page 12".
    pub path: String,
    /// Indexed body text, capped at `MAX_INDEXED_BODY_CHARS` UTF-16 units.
    pub body: String,
    /// Last change, ISO-8601.
    pub updated_at: String,
    /// In-app link.
    pub href: String,
    /// Zero-based PDF page, for `pdf` and `annotation` documents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    /// Wiki-graph link degree; zero when unknown.
    pub degree: u32,
}

/// One PDF page's extracted text.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PdfPageText {
    /// Zero-based page index.
    pub page_index: u32,
    /// Extracted text of the page.
    pub text: String,
}

/// A paper's extracted PDF text, ready for indexing.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PdfIndexSource {
    /// Paper id.
    pub paper_id: String,
    /// Paper title.
    pub title: String,
    /// Extracted pages.
    pub pages: Vec<PdfPageText>,
    /// When the text was extracted; drives the recency tiebreak.
    pub extracted_at: String,
}

/// A reader annotation as the index reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnnotationSource {
    /// Annotation id.
    pub id: String,
    /// Paper the annotation belongs to.
    pub paper_id: String,
    /// Zero-based page index.
    pub page_index: u32,
    /// Quoted passage.
    pub text: String,
    /// The reader's own comment.
    pub comment: String,
    /// Tags.
    pub tags: Vec<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last edit timestamp; empty when unknown.
    pub updated_at: String,
}

/// Cut `text` to at most `max_units` UTF-16 code units, never splitting a pair.
#[must_use]
pub fn utf16_prefix(text: &str, max_units: usize) -> &str {
    let mut units = 0usize;
    for (index, ch) in text.char_indices() {
        units += ch.len_utf16();
        if units > max_units {
            return &text[..index];
        }
    }
    text
}

/// Long bodies are truncated, never dropped: the title still has to be findable.
#[must_use]
pub fn bounded_body(body: &str) -> String {
    utf16_prefix(body, MAX_INDEXED_BODY_CHARS as usize).to_owned()
}

/// Markdown h1–h3 headings, ignoring anything inside code.
#[must_use]
pub fn extract_headings(body: Option<&str>) -> Vec<String> {
    let Some(body) = body.filter(|b| !b.is_empty()) else {
        return Vec::new();
    };
    let masked = mask_code(body);
    heading_re()
        .captures_iter(&masked)
        .filter_map(|c| {
            let text = c.get(1)?.as_str().trim();
            (!text.is_empty()).then(|| text.to_owned())
        })
        .collect()
}

fn heading_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?m)^ {0,3}#{1,3}\s+(.+?)\s*#*\s*$").expect("heading pattern is valid")
    })
}

/// Blank fenced and inline code, keeping its length, so `# x` in a snippet is not a heading.
fn mask_code(body: &str) -> String {
    static FENCED: OnceLock<Regex> = OnceLock::new();
    static INLINE: OnceLock<Regex> = OnceLock::new();
    let fenced = FENCED.get_or_init(|| Regex::new(r"(?s)```.*?```").expect("fence pattern is valid"));
    let inline = INLINE.get_or_init(|| Regex::new(r"`[^`\n]*`").expect("inline pattern is valid"));
    let once = fenced.replace_all(body, |c: &Captures<'_>| " ".repeat(c[0].chars().count()));
    inline
        .replace_all(&once, |c: &Captures<'_>| " ".repeat(c[0].chars().count()))
        .into_owned()
}

/// A node of a tree (notes, lists, sections) for breadcrumbs.
struct TreeNode<'a> {
    id: &'a str,
    title: &'a str,
    parent_id: Option<&'a str>,
}

/// Ancestor-title breadcrumb, e.g. "Method/Baselines". Cycles are broken by a
/// visited set so a corrupted parent chain cannot hang the indexer.
fn breadcrumbs(nodes: &[TreeNode<'_>]) -> HashMap<String, String> {
    let by_id: HashMap<&str, &TreeNode<'_>> = nodes.iter().map(|n| (n.id, n)).collect();
    nodes
        .iter()
        .map(|node| {
            let mut parts: Vec<&str> = Vec::new();
            let mut seen: HashSet<&str> = HashSet::from([node.id]);
            let mut current = node.parent_id.and_then(|p| by_id.get(p).copied());
            while let Some(c) = current {
                if !seen.insert(c.id) {
                    break;
                }
                parts.insert(0, c.title);
                current = c.parent_id.and_then(|p| by_id.get(p).copied());
            }
            (node.id.to_owned(), parts.join("/"))
        })
        .collect()
}

/// Route for an entity. PDF pages and annotations build their own hrefs (both
/// need a page number); the arms exist so the match stays exhaustive.
fn href(kind: SearchKind, id: &str) -> String {
    let enc = encode_uri_component(id);
    match kind {
        SearchKind::Paper => format!("/papers?paper={enc}"),
        SearchKind::Note => format!("/notes?page={enc}"),
        SearchKind::Section => format!("/report?section={enc}"),
        SearchKind::Experiment => format!("/experiments?experiment={enc}"),
        SearchKind::Milestone => format!("/plan?milestone={enc}"),
        SearchKind::List => "/lists".to_owned(),
        SearchKind::Log => "/log".to_owned(),
        SearchKind::Pdf | SearchKind::Annotation => format!("/reader?paper={enc}"),
    }
}

/// A document with its id and kind set and every other field empty.
fn blank_doc(kind: SearchKind, entity_id: &str) -> SearchDoc {
    SearchDoc {
        id: format!("{}:{entity_id}", kind.as_str()),
        kind,
        entity_id: entity_id.to_owned(),
        title: String::new(),
        aliases: Vec::new(),
        headings: Vec::new(),
        tags: Vec::new(),
        path: String::new(),
        body: String::new(),
        updated_at: String::new(),
        href: String::new(),
        page: None,
        degree: 0,
    }
}

/// First non-empty value, or "" (the TypeScript `a || b || c` fallback).
fn first_present(values: &[&str]) -> String {
    values
        .iter()
        .find(|v| !v.is_empty())
        .map_or_else(String::new, |v| (*v).to_owned())
}

/// The present, non-empty parts joined by a blank line.
fn join_present(parts: &[Option<&str>]) -> String {
    parts
        .iter()
        .flatten()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Keep only non-empty aliases (the TypeScript `.filter(Boolean)`).
fn present_aliases(values: impl IntoIterator<Item = Option<String>>) -> Vec<String> {
    values
        .into_iter()
        .flatten()
        .filter(|v| !v.is_empty())
        .collect()
}

/// Project a snapshot into search documents. `degrees` carries wiki-graph link
/// counts keyed by `kind:id`; absent entities rank on content alone.
#[must_use]
pub fn to_search_docs(snapshot: &WorkspaceSnapshot, degrees: &HashMap<String, u32>) -> Vec<SearchDoc> {
    let degree = |key: String| degrees.get(&key).copied().unwrap_or(0);
    let mut docs = Vec::new();

    let note_nodes: Vec<TreeNode<'_>> = snapshot
        .vault_pages
        .iter()
        .map(|p| TreeNode { id: &p.id, title: &p.title, parent_id: p.parent_id.as_deref() })
        .collect();
    let note_paths = breadcrumbs(&note_nodes);
    for page in &snapshot.vault_pages {
        docs.push(SearchDoc {
            title: page.title.clone(),
            headings: extract_headings(Some(&page.body)),
            // Notes carry their tags as #hashtags in the body.
            tags: extract_hashtags(Some(&page.body)),
            path: note_paths.get(&page.id).cloned().unwrap_or_default(),
            body: bounded_body(&page.body),
            updated_at: first_present(&[&page.updated_at, &page.created_at]),
            href: href(SearchKind::Note, &page.id),
            degree: degree(format!("note:{}", page.id)),
            ..blank_doc(SearchKind::Note, &page.id)
        });
    }

    for paper in &snapshot.papers {
        let mut aliases = paper.authors.clone();
        aliases.extend(present_aliases([
            paper.venue.clone(),
            paper.doi.clone(),
            paper.arxiv_id.clone(),
        ]));
        aliases.extend(acronyms_for_title(&paper.title));
        aliases.retain(|v| !v.is_empty());
        let mut tags = paper.tags.clone();
        tags.extend(extract_hashtags(paper.summary.as_deref()));
        docs.push(SearchDoc {
            title: paper.title.clone(),
            aliases,
            headings: extract_headings(paper.summary.as_deref()),
            tags,
            path: paper
                .year
                .filter(|y| *y != 0.0 && !y.is_nan())
                .map_or_else(String::new, |y| y.to_string()),
            body: bounded_body(&join_present(&[
                paper.abstract_text.as_deref(),
                paper.summary.as_deref(),
            ])),
            updated_at: first_present(&[&paper.updated_at, &paper.created_at]),
            href: href(SearchKind::Paper, &paper.id),
            degree: degree(format!("paper:{}", paper.id)),
            ..blank_doc(SearchKind::Paper, &paper.id)
        });
    }

    let list_nodes: Vec<TreeNode<'_>> = snapshot
        .reading_lists
        .iter()
        .map(|l| TreeNode { id: &l.id, title: &l.name, parent_id: l.parent_id.as_deref() })
        .collect();
    let list_paths = breadcrumbs(&list_nodes);
    for list in &snapshot.reading_lists {
        docs.push(SearchDoc {
            title: list.name.clone(),
            path: list_paths.get(&list.id).cloned().unwrap_or_default(),
            body: bounded_body(list.description.as_deref().unwrap_or_default()),
            updated_at: list.created_at.clone(),
            href: href(SearchKind::List, &list.id),
            degree: degree(format!("list:{}", list.id)),
            ..blank_doc(SearchKind::List, &list.id)
        });
    }

    let section_nodes: Vec<TreeNode<'_>> = snapshot
        .report_sections
        .iter()
        .map(|s| TreeNode { id: &s.id, title: &s.title, parent_id: s.parent_id.as_deref() })
        .collect();
    let section_paths = breadcrumbs(&section_nodes);
    for section in &snapshot.report_sections {
        docs.push(SearchDoc {
            title: section.title.clone(),
            // "3.2" is how people refer to a section out loud, so it is searchable.
            aliases: present_aliases([section.section_no.clone()]),
            headings: extract_headings(section.notes.as_deref()),
            tags: extract_hashtags(section.notes.as_deref()),
            path: section_paths.get(&section.id).cloned().unwrap_or_default(),
            body: bounded_body(section.notes.as_deref().unwrap_or_default()),
            updated_at: first_present(&[&section.updated_at, &section.created_at]),
            href: href(SearchKind::Section, &section.id),
            degree: degree(format!("section:{}", section.id)),
            ..blank_doc(SearchKind::Section, &section.id)
        });
    }

    for experiment in &snapshot.experiments {
        docs.push(SearchDoc {
            title: experiment.name.clone(),
            aliases: present_aliases([experiment.branch.clone(), experiment.commit_sha.clone()]),
            path: experiment.status.clone().unwrap_or_default(),
            body: bounded_body(&join_present(&[
                experiment.hypothesis.as_deref(),
                experiment.result_note.as_deref(),
                experiment.run_command.as_deref(),
            ])),
            updated_at: first_present(&[
                experiment.finished_at.as_deref().unwrap_or_default(),
                experiment.started_at.as_deref().unwrap_or_default(),
                &experiment.created_at,
            ]),
            href: href(SearchKind::Experiment, &experiment.id),
            degree: degree(format!("experiment:{}", experiment.id)),
            ..blank_doc(SearchKind::Experiment, &experiment.id)
        });
    }

    for milestone in &snapshot.milestones {
        docs.push(SearchDoc {
            title: milestone.title.clone(),
            aliases: present_aliases([milestone.target_date.clone()]),
            path: milestone.status.clone().unwrap_or_default(),
            body: bounded_body(milestone.description.as_deref().unwrap_or_default()),
            updated_at: milestone.created_at.clone(),
            href: href(SearchKind::Milestone, &milestone.id),
            degree: degree(format!("milestone:{}", milestone.id)),
            ..blank_doc(SearchKind::Milestone, &milestone.id)
        });
    }

    for entry in &snapshot.log_entries {
        docs.push(SearchDoc {
            // Log entries have no title; the date is what people scan for.
            title: entry.entry_date.clone(),
            aliases: vec![entry.kind.clone()],
            headings: extract_headings(Some(&entry.body)),
            tags: extract_hashtags(Some(&entry.body)),
            path: utf16_prefix(&entry.entry_date, 7).to_owned(),
            body: bounded_body(&entry.body),
            updated_at: entry.created_at.clone(),
            href: href(SearchKind::Log, &entry.id),
            degree: degree(format!("log:{}", entry.id)),
            ..blank_doc(SearchKind::Log, &entry.id)
        });
    }

    docs
}

/// Fingerprint of the indexed corpus. A persisted index whose revision differs
/// from a freshly computed one is stale and must be rebuilt.
#[must_use]
pub fn search_revision(docs: &[SearchDoc]) -> String {
    // A hash of what is indexed, not count + newest timestamp: swapping a doc
    // for an older one keeps both the count and the newest time.
    let mut sorted: Vec<&SearchDoc> = docs.iter().collect();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    let mut hash = FNV_OFFSET;
    for d in sorted {
        let parts = [
            d.id.as_str(),
            d.updated_at.as_str(),
            d.title.as_str(),
            d.path.as_str(),
            d.href.as_str(),
            d.body.as_str(),
        ]
        .into_iter()
        .chain(d.aliases.iter().map(String::as_str))
        .chain(d.headings.iter().map(String::as_str))
        .chain(d.tags.iter().map(String::as_str));
        for part in parts {
            hash = fnv1a(hash, part);
            hash = fnv1a(hash, "\0");
        }
    }
    format!("{}:{hash:08x}", docs.len())
}

const FNV_OFFSET: u32 = 0x811c_9dc5;

/// FNV-1a over UTF-16 code units, as the TypeScript hashed `charCodeAt`.
fn fnv1a(hash: u32, text: &str) -> u32 {
    text.encode_utf16()
        .fold(hash, |h, unit| (h ^ u32::from(unit)).wrapping_mul(0x0100_0193))
}

/// Id of one PDF page's document.
#[must_use]
pub fn pdf_doc_id(paper_id: &str, page_index: u32) -> String {
    format!("pdf:{paper_id}#{page_index}")
}

/// Deep link to one PDF page in the reader.
#[must_use]
pub fn pdf_page_href(paper_id: &str, page_index: u32) -> String {
    format!("/reader?paper={}&page={page_index}", encode_uri_component(paper_id))
}

/// Ids for every page of one paper, so a re-extraction can replace them wholesale.
#[must_use]
pub fn pdf_doc_ids_for(paper_id: &str, page_count: u32) -> Vec<String> {
    (0..page_count).map(|index| pdf_doc_id(paper_id, index)).collect()
}

/// One document per page. Pages with too little text are skipped. `degrees`
/// is keyed by the paper, since pages have no links of their own.
#[must_use]
pub fn to_pdf_search_docs(sources: &[PdfIndexSource], degrees: &HashMap<String, u32>) -> Vec<SearchDoc> {
    let mut docs = Vec::new();
    for source in sources {
        let degree = degrees.get(&format!("paper:{}", source.paper_id)).copied().unwrap_or(0);
        for page in &source.pages {
            let text = page.text.trim();
            if utf16_len(text) < MIN_PDF_PAGE_CHARS {
                continue;
            }
            docs.push(SearchDoc {
                id: pdf_doc_id(&source.paper_id, page.page_index),
                kind: SearchKind::Pdf,
                entity_id: source.paper_id.clone(),
                title: source.title.clone(),
                // Page number as an alias so "page 12" style queries can land.
                aliases: vec![format!("p{}", page.page_index + 1)],
                headings: Vec::new(),
                tags: Vec::new(),
                path: format!("page {}", page.page_index + 1),
                body: bounded_body(text),
                updated_at: source.extracted_at.clone(),
                href: pdf_page_href(&source.paper_id, page.page_index),
                page: Some(page.page_index),
                degree,
            });
        }
    }
    docs
}

/// Id of an annotation's document.
#[must_use]
pub fn annotation_doc_id(annotation_id: &str) -> String {
    format!("annotation:{annotation_id}")
}

/// Project annotations into search documents. Annotations with neither a quoted
/// passage nor a comment are skipped. The title is the paper's.
#[must_use]
pub fn to_annotation_search_docs(
    annotations: &[AnnotationSource],
    paper_titles: &HashMap<String, String>,
    degrees: &HashMap<String, u32>,
) -> Vec<SearchDoc> {
    let mut docs = Vec::new();
    for annotation in annotations {
        let text = annotation.text.trim();
        let comment = annotation.comment.trim();
        if text.is_empty() && comment.is_empty() {
            continue;
        }
        let body = [text, comment]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        docs.push(SearchDoc {
            id: annotation_doc_id(&annotation.id),
            kind: SearchKind::Annotation,
            entity_id: annotation.paper_id.clone(),
            title: paper_titles
                .get(&annotation.paper_id)
                .cloned()
                .unwrap_or_else(|| "Annotation".to_owned()),
            // The comment doubles as an alias so a short note ranks like a title.
            aliases: if comment.is_empty() {
                Vec::new()
            } else {
                vec![utf16_prefix(comment, 120).to_owned()]
            },
            headings: Vec::new(),
            tags: annotation.tags.clone(),
            path: format!("page {}", annotation.page_index + 1),
            body: bounded_body(&body),
            updated_at: first_present(&[&annotation.updated_at, &annotation.created_at]),
            href: pdf_page_href(&annotation.paper_id, annotation.page_index),
            page: Some(annotation.page_index),
            degree: degrees
                .get(&format!("paper:{}", annotation.paper_id))
                .copied()
                .unwrap_or(0),
        });
    }
    docs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::workspace_snapshot::{SnapshotExperiment, SnapshotPaper, SnapshotVaultPage};

    fn note(id: &str, title: &str, body: &str) -> SnapshotVaultPage {
        SnapshotVaultPage {
            id: id.to_owned(),
            title: title.to_owned(),
            body: body.to_owned(),
            created_at: "2026-01-01".to_owned(),
            ..Default::default()
        }
    }

    fn snapshot_with_notes(notes: Vec<SnapshotVaultPage>) -> WorkspaceSnapshot {
        WorkspaceSnapshot { vault_pages: notes, ..Default::default() }
    }

    #[test]
    fn headings_skip_code_and_trailing_hashes() {
        let body = "# Title\n\n```\n# not a heading\n```\n\n## Sub ##\n### Deep\n#### four\n `# inline`";
        assert_eq!(extract_headings(Some(body)), vec!["Title", "Sub", "Deep"]);
        assert!(extract_headings(None).is_empty());
    }

    #[test]
    fn bounded_body_never_splits_a_surrogate_pair() {
        let text = format!("{}😀", "a".repeat(255_999));
        let bounded = bounded_body(&text);
        assert_eq!(utf16_len(&bounded), 255_999);
        assert_eq!(bounded.len(), 255_999);
    }

    #[test]
    fn note_doc_carries_path_tags_and_degree() {
        let mut parent = note("p", "Method", "");
        parent.parent_id = None;
        let mut child = note("c", "Baselines", "# Results\nsee #Eval");
        child.parent_id = Some("p".to_owned());
        let snapshot = snapshot_with_notes(vec![parent, child]);
        let degrees = HashMap::from([("note:c".to_owned(), 4)]);

        let docs = to_search_docs(&snapshot, &degrees);
        let child_doc = docs.iter().find(|d| d.id == "note:c").expect("child doc");
        assert_eq!(child_doc.path, "Method");
        assert_eq!(child_doc.headings, vec!["Results"]);
        assert_eq!(child_doc.tags, vec!["eval"]);
        assert_eq!(child_doc.href, "/notes?page=c");
        assert_eq!(child_doc.updated_at, "2026-01-01");
        assert_eq!(child_doc.degree, 4);
    }

    #[test]
    fn paper_and_experiment_docs_use_literal_fields() {
        let snapshot = WorkspaceSnapshot {
            papers: vec![SnapshotPaper {
                id: "p1".to_owned(),
                title: "Denoising Diffusion".to_owned(),
                authors: vec!["Ho".to_owned()],
                year: Some(2020.0),
                abstract_text: Some("A".to_owned()),
                ..Default::default()
            }],
            experiments: vec![SnapshotExperiment {
                id: "e1".to_owned(),
                name: "Run".to_owned(),
                run_command: Some("python train.py".to_owned()),
                started_at: Some("2026-02-01".to_owned()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let docs = to_search_docs(&snapshot, &HashMap::new());
        let paper = docs.iter().find(|d| d.id == "paper:p1").expect("paper doc");
        assert_eq!(paper.aliases[0], "Ho");
        assert_eq!(paper.path, "2020");
        assert_eq!(paper.body, "A");
        let experiment = docs.iter().find(|d| d.id == "experiment:e1").expect("experiment doc");
        assert_eq!(experiment.body, "python train.py");
        assert_eq!(experiment.updated_at, "2026-02-01");
    }

    #[test]
    fn revision_is_order_independent_and_sensitive_to_edits() {
        let a = to_search_docs(&snapshot_with_notes(vec![note("a", "A", "x")]), &HashMap::new());
        let b = to_search_docs(&snapshot_with_notes(vec![note("b", "B", "y")]), &HashMap::new());
        let mut ab = a.clone();
        ab.extend(b.clone());
        let mut ba = b.clone();
        ba.extend(a.clone());
        assert_eq!(search_revision(&ab), search_revision(&ba));

        let edited = to_search_docs(&snapshot_with_notes(vec![note("a", "A", "changed")]), &HashMap::new());
        assert_ne!(search_revision(&a), search_revision(&edited));
        assert_eq!(search_revision(&[]), format!("0:{:08x}", FNV_OFFSET));
    }

    #[test]
    fn pdf_pages_skip_short_text_and_carry_page_fields() {
        let source = PdfIndexSource {
            paper_id: "p 1".to_owned(),
            title: "T".to_owned(),
            extracted_at: "2026-03-01".to_owned(),
            pages: vec![
                PdfPageText { page_index: 0, text: "x".repeat(MIN_PDF_PAGE_CHARS - 1) },
                PdfPageText { page_index: 1, text: "x".repeat(MIN_PDF_PAGE_CHARS + 1) },
            ],
        };
        let docs = to_pdf_search_docs(&[source], &HashMap::new());
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].id, "pdf:p 1#1");
        assert_eq!(docs[0].href, "/reader?paper=p%201&page=1");
        assert_eq!(docs[0].aliases, vec!["p2"]);
        assert_eq!(docs[0].page, Some(1));
        assert_eq!(pdf_doc_ids_for("p1", 2), vec!["pdf:p1#0", "pdf:p1#1"]);
    }

    #[test]
    fn annotations_without_text_are_skipped() {
        let annotations = vec![
            AnnotationSource { id: "a1".to_owned(), paper_id: "p1".to_owned(), comment: "key result".to_owned(), ..Default::default() },
            AnnotationSource { id: "a2".to_owned(), paper_id: "p1".to_owned(), ..Default::default() },
        ];
        let titles = HashMap::from([("p1".to_owned(), "Vaswani".to_owned())]);
        let docs = to_annotation_search_docs(&annotations, &titles, &HashMap::new());
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].id, "annotation:a1");
        assert_eq!(docs[0].title, "Vaswani");
        assert_eq!(docs[0].aliases, vec!["key result"]);
        assert_eq!(docs[0].body, "key result");
    }
}

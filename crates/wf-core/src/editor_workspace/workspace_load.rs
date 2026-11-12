//! The editor workspace's load, assembled in one pass: the documents the tabs open, the cite
//! completions, the explorer tree, the reading-lists view and the list membership.
//!
//! The rows come from the screens (TS fetches them; the project root and the list-items fetch
//! stay there). Every rule over them lives here: body and hydration choice, path shapes,
//! completion dedupe and labels, and the reading-list item mapping.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::app_lib::page_text;
use crate::sync::folder_layout::{WorkspaceEntityType, log_path};
use crate::vault::page::normalize_title_key;

use super::kind::{KINDS, member_rank};
use super::workspace_tree::{
    ListEntry, ListItemEntry, ListItemKind, ListsTreeInput, NoteNode, OverleafProject, PaperEntry,
    SectionNode, WorkspaceLogEntry, WorkspaceTreeInput, WorkspaceTreeNode, build_lists_tree,
    build_workspace_tree, list_membership,
};

/// The index cap, in UTF-16 units. Text over it keeps the TS fallback rule, which the caller
/// used before this module existed.
const MAX_TEXT_UTF16: usize = 1 << 24;

/// A vault note from the vault screen: a summary (`body_preview`) or a full page (`body`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultRow {
    /// Note id.
    pub id: String,
    /// Note title.
    pub title: String,
    /// Parent note id.
    pub parent_id: Option<String>,
    /// Whether the note is a folder.
    pub folder: bool,
    /// The full body, when the page is hydrated.
    pub body: Option<String>,
    /// The first characters of the body, on a summary.
    pub body_preview: Option<String>,
}

/// A paper row: its citation fields, its note summary and its tags.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PaperRow {
    /// Paper id.
    pub id: String,
    /// Paper title.
    pub title: String,
    /// The paper's note text, when it has one.
    pub summary: Option<String>,
    /// Keyword tags.
    pub tags: Option<Vec<String>>,
    /// Author names, in order.
    pub authors: Vec<String>,
    /// Publication year.
    pub year: Option<i64>,
    /// DOI.
    pub doi: Option<String>,
    /// arXiv id.
    pub arxiv_id: Option<String>,
    /// BibTeX source.
    pub bibtex: Option<String>,
    /// Free-form metadata, passed through to the citation.
    pub metadata: Option<serde_json::Value>,
}

/// A report section row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SectionRow {
    /// Section id.
    pub id: String,
    /// Section title.
    pub title: String,
    /// The section's text.
    pub notes: Option<String>,
    /// Parent section id.
    pub parent_id: Option<String>,
}

/// A logbook entry row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LogRow {
    /// Entry id.
    pub id: String,
    /// The entry's date, `YYYY-MM-DD`.
    pub entry_date: String,
    /// The entry's markdown body.
    pub body: String,
}

/// An Overleaf project row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OverleafRow {
    /// Project id.
    pub id: String,
    /// Project name.
    pub name: String,
}

/// A reading list row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListRow {
    /// List id.
    pub id: String,
    /// List name.
    pub name: String,
    /// Parent list id.
    pub parent_id: Option<String>,
}

/// One membership row from the list-items fetch: a paper or a vault page in a list.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListItemRow {
    /// The list the row belongs to.
    pub list_id: String,
    /// The paper, when the row is a paper.
    pub paper_id: Option<String>,
    /// The vault page, when the row is a note.
    pub vault_page_id: Option<String>,
    /// The list the membership was inherited from.
    pub inherited_from_list_id: Option<String>,
    /// Set on a duplicate row.
    pub duplicate_of_item_id: Option<String>,
}

/// A full note body fetched so far, by note id.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HydratedBody {
    /// Note id.
    pub id: String,
    /// The full body.
    pub body: String,
}

/// Everything one workspace load is built from.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceLoadInput {
    /// The project's folder; every path is inside it. Empty is the flat layout.
    pub project_root: String,
    /// Vault notes, as summaries or full pages.
    pub vault: Vec<VaultRow>,
    /// Papers.
    pub papers: Vec<PaperRow>,
    /// Report sections.
    pub report_sections: Vec<SectionRow>,
    /// Whether the reading-lists screen loaded. A section that failed leaves the lists out.
    pub lists_loaded: bool,
    /// Reading lists.
    pub lists: Vec<ListRow>,
    /// Memberships for `lists`.
    pub list_items: Vec<ListItemRow>,
    /// Logbook entries.
    pub logs: Vec<LogRow>,
    /// Overleaf projects.
    pub overleaf: Vec<OverleafRow>,
    /// Full bodies fetched so far, which a reload may keep.
    pub hydrated: Vec<HydratedBody>,
}

/// A document a tab can open.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    /// The document kind (`vault_page`, `paper`, `paper_pdf`, `report_section`, `log_entry`, `overleaf`).
    pub kind: String,
    /// The entity id.
    pub id: String,
    /// The title.
    pub title: String,
    /// The body the editor and the index see.
    pub body: String,
    /// Whether `body` is the whole document, so a save cannot truncate it.
    pub hydrated: bool,
    /// Where the document sits, for the breadcrumbs.
    pub path: String,
    /// The note's parent, when it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// A paper's tags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// The paper fields a citation carries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitePaper {
    /// Paper id.
    pub id: String,
    /// Paper title.
    pub title: String,
    /// Author names.
    pub authors: Vec<String>,
    /// Publication year.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    /// DOI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    /// arXiv id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arxiv_id: Option<String>,
    /// BibTeX source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bibtex: Option<String>,
    /// Free-form metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// A row of the `@` and `[[` completion list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiteRow {
    /// The title the row inserts.
    pub title: String,
    /// The label shown in the list.
    pub label: String,
    /// `paper`, `note` or `section`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// The paper fields, for a paper row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper: Option<CitePaper>,
}

/// The assembled workspace. `membership` is a `Map` on the JS side.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLoad {
    /// Documents, in the order the tabs list them.
    pub documents: Vec<LoadedDocument>,
    /// Completion rows.
    pub completions: Vec<CiteRow>,
    /// The notes, papers, report and logbook tree.
    pub tree: Vec<WorkspaceTreeNode>,
    /// The reading-lists tree.
    pub lists_tree: Vec<WorkspaceTreeNode>,
    /// List titles keyed `kind:id`.
    pub membership: BTreeMap<String, Vec<String>>,
}

/// Build the workspace from one load's rows.
#[must_use]
pub fn assemble(input: &WorkspaceLoadInput) -> WorkspaceLoad {
    let previous: HashMap<&str, &str> = input
        .hydrated
        .iter()
        .map(|h| (h.id.as_str(), h.body.as_str()))
        .collect();
    let documents = documents(input, &previous);
    let completions = completions(input);
    let tree = build_workspace_tree(&tree_input(input));
    let (lists_tree, membership) = lists_view(input, &documents);
    WorkspaceLoad {
        documents,
        completions,
        tree,
        lists_tree,
        membership,
    }
}

fn documents(input: &WorkspaceLoadInput, previous: &HashMap<&str, &str>) -> Vec<LoadedDocument> {
    let mut docs: Vec<LoadedDocument> = input
        .vault
        .iter()
        .map(|page| vault_document(page, previous))
        .collect();
    for paper in &input.papers {
        docs.push(paper_document(paper));
        docs.push(paper_pdf_document(paper));
    }
    docs.extend(input.report_sections.iter().map(section_document));
    docs.extend(input.logs.iter().map(|entry| log_document(entry, &input.project_root)));
    docs.extend(input.overleaf.iter().map(overleaf_document));
    docs
}

/// A note. A reload keeps a body already hydrated, while the summary still describes it: the
/// preview is the body's head, so a body that changed underneath shows as a preview that no
/// longer matches and hydrates again.
fn vault_document(page: &VaultRow, previous: &HashMap<&str, &str>) -> LoadedDocument {
    let summary = note_body(page);
    let hydrated_now = is_hydrated(page);
    let kept = previous
        .get(page.id.as_str())
        .copied()
        .filter(|kept| !hydrated_now && kept.starts_with(summary.as_str()));
    let hydrated = kept.is_some() || hydrated_now;
    let body = kept.map_or(summary, str::to_owned);
    LoadedDocument {
        kind: "vault_page".to_owned(),
        id: page.id.clone(),
        title: page.title.clone(),
        body,
        hydrated,
        path: format!("notes/{}.note.md", untitled(&page.title)),
        parent_id: page.parent_id.clone(),
        tags: None,
    }
}

fn paper_document(paper: &PaperRow) -> LoadedDocument {
    LoadedDocument {
        kind: "paper".to_owned(),
        id: paper.id.clone(),
        title: paper.title.clone(),
        body: paper.summary.clone().unwrap_or_default(),
        hydrated: true,
        path: format!("papers/{}.paper.md", untitled(&paper.title)),
        parent_id: None,
        tags: paper.tags.clone(),
    }
}

/// A paper's PDF. It has no body; the reader fetches the file by the paper's id.
fn paper_pdf_document(paper: &PaperRow) -> LoadedDocument {
    LoadedDocument {
        kind: "paper_pdf".to_owned(),
        id: paper.id.clone(),
        title: paper.title.clone(),
        body: String::new(),
        hydrated: true,
        path: format!("papers/{}.pdf", untitled(&paper.title)),
        parent_id: None,
        tags: paper.tags.clone(),
    }
}

fn section_document(section: &SectionRow) -> LoadedDocument {
    LoadedDocument {
        kind: "report_section".to_owned(),
        id: section.id.clone(),
        title: section.title.clone(),
        body: section.notes.clone().unwrap_or_default(),
        hydrated: true,
        path: format!("report/{}.report.md", untitled(&section.title)),
        parent_id: None,
        tags: None,
    }
}

/// A log entry. Its body is whole, so it never waits for a second fetch before it may save.
fn log_document(entry: &LogRow, project_root: &str) -> LoadedDocument {
    LoadedDocument {
        kind: "log_entry".to_owned(),
        id: entry.id.clone(),
        title: entry.entry_date.clone(),
        body: entry.body.clone(),
        hydrated: true,
        path: log_path(&entry.id, &entry.entry_date, project_root),
        parent_id: None,
        tags: None,
    }
}

fn overleaf_document(project: &OverleafRow) -> LoadedDocument {
    LoadedDocument {
        kind: "overleaf".to_owned(),
        id: project.id.clone(),
        title: project.name.clone(),
        body: String::new(),
        hydrated: true,
        path: format!("overleaf/{}", project.name),
        parent_id: None,
        tags: None,
    }
}

/// The `@` and `[[` rows: a paper's row carries its authors and year, a note's and a section's
/// just their title. A title already seen (by its normalised key) collapses to one row.
fn completions(input: &WorkspaceLoadInput) -> Vec<CiteRow> {
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    for paper in &input.papers {
        if claim_title(&mut seen, &paper.title) {
            rows.push(cite_row(paper));
        }
    }
    let titled = input
        .vault
        .iter()
        .map(|page| (page.title.as_str(), "note"))
        .chain(input.report_sections.iter().map(|s| (s.title.as_str(), "section")));
    for (title, detail) in titled {
        if claim_title(&mut seen, title) {
            rows.push(CiteRow {
                title: title.to_owned(),
                label: title.to_owned(),
                detail: Some(detail.to_owned()),
                paper: None,
            });
        }
    }
    rows
}

/// Whether `title` is new: its key is non-empty and unseen. Records the key when it is.
fn claim_title(seen: &mut HashSet<String>, title: &str) -> bool {
    let key = normalize_title_key(title);
    !key.is_empty() && seen.insert(key)
}

/// `Author (year) · Title`: one author as is, more as `First et al.`, the year in parentheses.
fn cite_row(paper: &PaperRow) -> CiteRow {
    let author = match paper.authors.as_slice() {
        [] => String::new(),
        [only] => only.clone(),
        [first, ..] => format!("{first} et al."),
    };
    let year_bit = paper.year.map(|year| format!("({year})")).unwrap_or_default();
    let head = [author, year_bit]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let label = if head.is_empty() {
        paper.title.clone()
    } else {
        format!("{head} · {}", paper.title)
    };
    CiteRow {
        title: paper.title.clone(),
        label,
        detail: Some("paper".to_owned()),
        paper: Some(CitePaper {
            id: paper.id.clone(),
            title: paper.title.clone(),
            authors: paper.authors.clone(),
            year: paper.year,
            doi: paper.doi.clone(),
            arxiv_id: paper.arxiv_id.clone(),
            bibtex: paper.bibtex.clone(),
            metadata: paper.metadata.clone(),
        }),
    }
}

fn tree_input(input: &WorkspaceLoadInput) -> WorkspaceTreeInput {
    WorkspaceTreeInput {
        project_root: input.project_root.clone(),
        notes: input
            .vault
            .iter()
            .map(|page| NoteNode {
                id: page.id.clone(),
                title: page.title.clone(),
                parent_id: page.parent_id.clone(),
                kind: Some(WorkspaceEntityType::VaultPage),
                folder: page.folder,
            })
            .collect(),
        papers: input
            .papers
            .iter()
            .map(|paper| PaperEntry {
                id: paper.id.clone(),
                title: paper.title.clone(),
                has_note: paper.summary.as_deref().is_some_and(|s| !s.trim().is_empty()),
            })
            .collect(),
        report_sections: input
            .report_sections
            .iter()
            .map(|section| SectionNode {
                id: section.id.clone(),
                title: section.title.clone(),
                parent_id: section.parent_id.clone(),
            })
            .collect(),
        log_entries: input
            .logs
            .iter()
            .map(|entry| WorkspaceLogEntry {
                id: entry.id.clone(),
                entry_date: entry.entry_date.clone(),
            })
            .collect(),
        overleaf_projects: input
            .overleaf
            .iter()
            .map(|project| OverleafProject {
                id: project.id.clone(),
                name: project.name.clone(),
            })
            .collect(),
    }
}

/// The reading-lists tree and the membership map. Titles for the members come from the
/// documents; the membership map also carries the list titles.
fn lists_view(
    input: &WorkspaceLoadInput,
    docs: &[LoadedDocument],
) -> (Vec<WorkspaceTreeNode>, BTreeMap<String, Vec<String>>) {
    if !input.lists_loaded {
        return (Vec::new(), BTreeMap::new());
    }
    let mut titles: HashMap<String, String> = HashMap::new();
    for doc in docs {
        let _ = titles.insert(format!("{}:{}", doc.kind, doc.id), doc.title.clone());
    }
    let items: Vec<ListItemEntry> = input.list_items.iter().filter_map(list_item).collect();
    let lists = input
        .lists
        .iter()
        .map(|list| ListEntry {
            id: list.id.clone(),
            title: list.name.clone(),
            parent_id: list.parent_id.clone(),
            slug: None,
            parent_slug: None,
        })
        .collect();
    let member_rank_by_kind: HashMap<String, i32> = KINDS
        .iter()
        .map(|kind| ((*kind).to_owned(), member_rank(kind)))
        .collect();
    let tree = build_lists_tree(&ListsTreeInput {
        lists,
        items: items.clone(),
        titles: titles.clone(),
        member_rank: Some(member_rank_by_kind),
    });
    for list in &input.lists {
        let _ = titles.insert(format!("reading_list:{}", list.id), list.name.clone());
    }
    (tree, list_membership(&items, &titles))
}

/// A membership row as a list item. A paper wins over a vault page when a row has both; a row
/// with neither is not a member.
fn list_item(row: &ListItemRow) -> Option<ListItemEntry> {
    let (kind, id) = match (non_empty(row.paper_id.as_deref()), non_empty(row.vault_page_id.as_deref())) {
        (Some(paper), _) => (ListItemKind::Paper, paper),
        (None, Some(page)) => (ListItemKind::VaultPage, page),
        (None, None) => return None,
    };
    Some(ListItemEntry {
        list_id: row.list_id.clone(),
        kind,
        id: id.to_owned(),
        label: None,
        inherited_from_list_id: row.inherited_from_list_id.clone(),
        duplicate_of_item_id: row.duplicate_of_item_id.clone(),
    })
}

/// Whether a body or preview is within the index cap. `None` counts as within.
fn within_cap(text: Option<&str>) -> bool {
    match text {
        None => true,
        Some(text) => text.len() <= MAX_TEXT_UTF16 || text.encode_utf16().count() <= MAX_TEXT_UTF16,
    }
}

/// The note's text for the index and the label: the full body when there is one, else the
/// preview, else empty. Above the cap the same rule runs without the page-text helper.
fn note_body(page: &VaultRow) -> String {
    let full = page.body.as_deref();
    let preview = page.body_preview.as_deref();
    if within_cap(full) && within_cap(preview) {
        return page_text::body_text(full, preview).to_owned();
    }
    non_empty(full).or(non_empty(preview)).unwrap_or("").to_owned()
}

/// Whether the note carries its full body and no preview stands in for it. A summary has a
/// preview, so it is never hydrated.
fn is_hydrated(page: &VaultRow) -> bool {
    let body = page.body.as_deref();
    let preview = page.body_preview.as_deref();
    if !within_cap(body) || !within_cap(preview) {
        return non_empty(preview).is_none();
    }
    page_text::is_hydrated_page(body, preview)
}

fn untitled(title: &str) -> &str {
    if title.is_empty() { "Untitled" } else { title }
}

fn non_empty(text: Option<&str>) -> Option<&str> {
    text.filter(|t| !t.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, title: &str) -> VaultRow {
        VaultRow {
            id: id.to_owned(),
            title: title.to_owned(),
            ..VaultRow::default()
        }
    }

    fn paper(id: &str, title: &str, authors: &[&str], year: Option<i64>) -> PaperRow {
        PaperRow {
            id: id.to_owned(),
            title: title.to_owned(),
            authors: authors.iter().map(|a| (*a).to_owned()).collect(),
            year,
            ..PaperRow::default()
        }
    }

    #[test]
    fn a_summary_uses_its_preview_and_is_not_hydrated() {
        let mut page = note("n1", "Plan");
        page.body_preview = Some("head".to_owned());
        let doc = vault_document(&page, &HashMap::new());
        assert_eq!(doc.body, "head");
        assert!(!doc.hydrated);
        assert_eq!(doc.path, "notes/Plan.note.md");
    }

    #[test]
    fn a_full_page_is_hydrated_and_its_body_wins() {
        let mut page = note("n1", "Plan");
        page.body = Some("whole body".to_owned());
        page.body_preview = Some(String::new());
        let doc = vault_document(&page, &HashMap::new());
        assert_eq!(doc.body, "whole body");
        assert!(doc.hydrated);
    }

    #[test]
    fn a_reload_keeps_the_hydrated_body_while_the_summary_matches() {
        let mut page = note("n1", "Plan");
        page.body_preview = Some("head".to_owned());
        let previous = HashMap::from([("n1", "head and more")]);
        let doc = vault_document(&page, &previous);
        assert_eq!(doc.body, "head and more");
        assert!(doc.hydrated);
    }

    #[test]
    fn a_reload_drops_a_kept_body_that_changed_underneath() {
        let mut page = note("n1", "Plan");
        page.body_preview = Some("new head".to_owned());
        let previous = HashMap::from([("n1", "old body")]);
        let doc = vault_document(&page, &previous);
        assert_eq!(doc.body, "new head");
        assert!(!doc.hydrated);
    }

    #[test]
    fn an_untitled_document_takes_the_untitled_path() {
        let doc = paper_document(&paper("p1", "", &[], None));
        assert_eq!(doc.path, "papers/Untitled.paper.md");
        assert_eq!(paper_pdf_document(&paper("p1", "", &[], None)).path, "papers/Untitled.pdf");
    }

    #[test]
    fn a_paper_yields_two_documents_with_its_tags() {
        let mut p = paper("p1", "Attention", &[], None);
        p.tags = Some(vec!["nlp".to_owned()]);
        p.summary = Some("notes".to_owned());
        let docs = documents(
            &WorkspaceLoadInput {
                papers: vec![p],
                ..WorkspaceLoadInput::default()
            },
            &HashMap::new(),
        );
        let kinds: Vec<&str> = docs.iter().map(|d| d.kind.as_str()).collect();
        assert_eq!(kinds, ["paper", "paper_pdf"]);
        assert_eq!(docs[0].body, "notes");
        assert_eq!(docs[1].body, "");
        assert_eq!(docs[1].tags, Some(vec!["nlp".to_owned()]));
    }

    #[test]
    fn a_log_entry_is_titled_by_its_date_and_always_hydrated() {
        let doc = log_document(
            &LogRow {
                id: "l1".to_owned(),
                entry_date: "2026-11-12".to_owned(),
                body: "done".to_owned(),
            },
            "",
        );
        assert_eq!(doc.title, "2026-11-12");
        assert!(doc.hydrated);
        assert_eq!(doc.path, log_path("l1", "2026-11-12", ""));
    }

    #[test]
    fn a_cite_label_formats_authors_and_year() {
        let one = cite_row(&paper("p1", "Attention", &["Vaswani"], Some(2017)));
        assert_eq!(one.label, "Vaswani (2017) · Attention");
        let many = cite_row(&paper("p2", "BERT", &["Devlin", "Chang"], Some(2019)));
        assert_eq!(many.label, "Devlin et al. (2019) · BERT");
        let bare = cite_row(&paper("p3", "Untitled work", &[], None));
        assert_eq!(bare.label, "Untitled work");
        assert_eq!(bare.detail.as_deref(), Some("paper"));
    }

    #[test]
    fn completions_collapse_duplicate_titles_to_the_first_row() {
        let input = WorkspaceLoadInput {
            papers: vec![paper("p1", "Plan", &[], None)],
            vault: vec![note("n1", "plan"), note("n2", "  ")],
            ..WorkspaceLoadInput::default()
        };
        let rows = completions(&input);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].detail.as_deref(), Some("paper"));
    }

    #[test]
    fn a_blank_title_is_not_a_completion_row() {
        let input = WorkspaceLoadInput {
            vault: vec![note("n1", "   ")],
            report_sections: vec![SectionRow {
                id: "s1".to_owned(),
                title: "Results".to_owned(),
                ..SectionRow::default()
            }],
            ..WorkspaceLoadInput::default()
        };
        let rows = completions(&input);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].label, "Results");
        assert_eq!(rows[0].detail.as_deref(), Some("section"));
    }

    #[test]
    fn a_blank_summary_is_no_note_in_the_tree() {
        let mut p = paper("p1", "Plan", &[], None);
        p.summary = Some("   ".to_owned());
        assert!(!tree_input(&WorkspaceLoadInput {
            papers: vec![p],
            ..WorkspaceLoadInput::default()
        })
        .papers[0]
            .has_note);
    }

    #[test]
    fn a_membership_row_maps_to_its_member_kind() {
        let paper_row = ListItemRow {
            list_id: "l".to_owned(),
            paper_id: Some("p1".to_owned()),
            vault_page_id: Some("n1".to_owned()),
            ..ListItemRow::default()
        };
        let page_row = ListItemRow {
            list_id: "l".to_owned(),
            vault_page_id: Some("n1".to_owned()),
            ..ListItemRow::default()
        };
        let empty = ListItemRow {
            list_id: "l".to_owned(),
            ..ListItemRow::default()
        };
        assert_eq!(list_item(&paper_row).map(|i| (i.kind, i.id)), Some((ListItemKind::Paper, "p1".to_owned())));
        assert_eq!(list_item(&page_row).map(|i| i.kind), Some(ListItemKind::VaultPage));
        assert!(list_item(&empty).is_none());
    }

    #[test]
    fn membership_carries_list_titles_beside_member_titles() {
        let input = WorkspaceLoadInput {
            lists_loaded: true,
            lists: vec![ListRow {
                id: "L1".to_owned(),
                name: "Reading".to_owned(),
                parent_id: None,
            }],
            list_items: vec![ListItemRow {
                list_id: "L1".to_owned(),
                paper_id: Some("p1".to_owned()),
                ..ListItemRow::default()
            }],
            papers: vec![paper("p1", "Attention", &[], None)],
            ..WorkspaceLoadInput::default()
        };
        let out = assemble(&input);
        assert_eq!(
            out.membership.get("paper:p1"),
            Some(&vec!["Reading".to_owned()])
        );
    }

    #[test]
    fn a_failed_lists_section_leaves_the_lists_empty() {
        let out = assemble(&WorkspaceLoadInput {
            lists: vec![ListRow {
                id: "L1".to_owned(),
                name: "Reading".to_owned(),
                parent_id: None,
            }],
            ..WorkspaceLoadInput::default()
        });
        assert!(out.lists_tree.is_empty());
        assert!(out.membership.is_empty());
    }

    #[test]
    fn a_body_above_the_cap_keeps_the_fallback_rule() {
        let big = "a".repeat(MAX_TEXT_UTF16 + 1);
        let mut page = note("n1", "Big");
        page.body = Some(big.clone());
        page.body_preview = Some("head".to_owned());
        assert_eq!(note_body(&page), big);
        assert!(!is_hydrated(&page));
        page.body = Some(String::new());
        assert_eq!(note_body(&page), "head");
    }
}

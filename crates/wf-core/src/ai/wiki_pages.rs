//! Port of the pure parts of `apps/web/src/features/wiki/application/build-wiki.ts`: which
//! notes are wiki pages, the extraction documents, page refs, taken titles, dead-link page
//! plans and recently written pages. The reads and proposals stay in TS. Pure.

use std::collections::HashSet;

use crate::ai::wiki_lint::WikiPageRef;
use crate::js_collate::locale_compare;
use crate::reader_analysis::lines::js_trim;

/// The note that holds the wiki; generated pages are its children.
const WIKI_ROOT_TITLE: &str = "Wiki";

/// A note, with its body (TS `VaultPage` as the wiki reads it).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiNote {
    /// Note id.
    pub id: String,
    /// Note title.
    pub title: String,
    /// Note body as markdown.
    pub body: String,
    /// The note this one sits under, when it has a parent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub parent_id: Option<String>,
    /// When the note was created, as an ISO timestamp.
    pub created_at: String,
}

/// The paper fields a source document reads: the abstract and the reader's summary.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiPaper {
    /// Paper id.
    pub id: String,
    /// Paper title.
    pub title: String,
    /// The paper's abstract, when known.
    #[serde(default, rename = "abstract", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub abstract_text: Option<String>,
    /// The reader's own summary, when written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub summary: Option<String>,
}

/// One note or paper the concept extractor reads (TS `ExtractionDocument`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiSourceDocument {
    /// Note or paper id.
    pub id: String,
    /// Title shown to the extractor.
    pub title: String,
    /// The text the extractor reads.
    pub text: String,
}

/// A wiki page that was written, when it was approved (TS `recentlyApprovedWikiPages`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RecentWikiPage {
    /// Page id.
    pub id: String,
    /// Page title.
    pub title: String,
    /// When the page was created, as an ISO timestamp.
    pub created_at: String,
}

/// A page queued for a dead link (TS `WikiPagePlan`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiPagePlanRecord {
    /// The page title, as the link wrote it.
    pub title: String,
    /// A placeholder body until someone writes the page.
    pub body: String,
    /// How many links point at it; a dead link is one mention.
    pub mentions: u32,
    /// Documents the concept was found in; none for a dead link.
    pub source_document_ids: Vec<String>,
}

/// The wiki root, the first note titled `Wiki`.
#[must_use]
pub fn find_wiki_root(pages: &[WikiNote]) -> Option<WikiNote> {
    wiki_root(pages).cloned()
}

fn wiki_root(pages: &[WikiNote]) -> Option<&WikiNote> {
    pages.iter().find(|page| page.title == WIKI_ROOT_TITLE)
}

/// The pages under the wiki root, in note order. Empty when there is no root.
fn generated_pages(pages: &[WikiNote]) -> Vec<&WikiNote> {
    let Some(root) = wiki_root(pages) else {
        return Vec::new();
    };
    pages
        .iter()
        .filter(|page| page.parent_id.as_deref() == Some(root.id.as_str()))
        .collect()
}

/// The wiki's pages as `{ id, title, body }`, for dedupe and lint.
#[must_use]
pub fn wiki_page_refs(pages: &[WikiNote]) -> Vec<WikiPageRef> {
    generated_pages(pages)
        .into_iter()
        .map(|page| WikiPageRef {
            id: page.id.clone(),
            title: page.title.clone(),
            body: page.body.clone(),
            aliases: None,
        })
        .collect()
}

/// Notes (not generated pages) and papers as extraction documents. `source_ids` restricts
/// them; `None` means every note and paper.
#[must_use]
pub fn wiki_source_documents(
    pages: &[WikiNote],
    papers: &[WikiPaper],
    source_ids: Option<&[String]>,
) -> Vec<WikiSourceDocument> {
    // Extracting from generated pages would feed the wiki its own output.
    let generated: HashSet<&str> = generated_pages(pages)
        .into_iter()
        .map(|page| page.id.as_str())
        .collect();
    let wanted: Option<HashSet<&str>> =
        source_ids.map(|ids| ids.iter().map(String::as_str).collect());

    let mut documents: Vec<WikiSourceDocument> = pages
        .iter()
        .filter(|page| !generated.contains(page.id.as_str()) && chosen(&wanted, &page.id))
        .map(|page| WikiSourceDocument {
            id: page.id.clone(),
            title: page.title.clone(),
            text: page.body.clone(),
        })
        .collect();

    documents.extend(
        papers
            .iter()
            .filter(|paper| chosen(&wanted, &paper.id))
            .map(|paper| WikiSourceDocument {
                id: paper.id.clone(),
                title: paper.title.clone(),
                text: [paper.abstract_text.as_deref(), paper.summary.as_deref()]
                    .into_iter()
                    .flatten()
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n\n"),
            }),
    );
    documents
}

fn chosen(wanted: &Option<HashSet<&str>>, id: &str) -> bool {
    match wanted {
        None => true,
        Some(ids) => ids.contains(id),
    }
}

/// The dead-link pages as plans: one per distinct trimmed target, first occurrence order.
/// Blank targets are dropped.
#[must_use]
pub fn missing_page_plans(targets: &[String]) -> Vec<WikiPagePlanRecord> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut plans = Vec::new();
    for target in targets {
        let title = js_trim(target);
        if title.is_empty() || !seen.insert(title) {
            continue;
        }
        plans.push(WikiPagePlanRecord {
            title: title.to_owned(),
            body: format!("# {title}\n\n_Not written yet._\n"),
            mentions: 1,
            source_document_ids: Vec::new(),
        });
    }
    plans
}

/// The wiki's pages, newest first, capped at `limit`.
#[must_use]
pub fn recently_approved_wiki_pages(pages: &[WikiNote], limit: usize) -> Vec<RecentWikiPage> {
    let mut recent: Vec<RecentWikiPage> = generated_pages(pages)
        .into_iter()
        .map(|page| RecentWikiPage {
            id: page.id.clone(),
            title: page.title.clone(),
            created_at: page.created_at.clone(),
        })
        .collect();
    recent.sort_by(|a, b| locale_compare(&b.created_at, &a.created_at));
    recent.truncate(limit);
    recent
}

// No TS test on main for this file; cases come from the doc comments.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn note(id: &str, title: &str, parent: Option<&str>, created: &str) -> WikiNote {
        WikiNote {
            id: id.to_owned(),
            title: title.to_owned(),
            body: format!("body {id}"),
            parent_id: parent.map(str::to_owned),
            created_at: created.to_owned(),
        }
    }

    fn sample() -> Vec<WikiNote> {
        vec![
            note("w", "Wiki", None, "2026-01-01T00:00:00Z"),
            note("c1", "Alpha", Some("w"), "2026-01-02T00:00:00Z"),
            note("c2", "Beta", Some("w"), "2026-01-03T00:00:00Z"),
            note("n", "Note", None, "2026-01-04T00:00:00Z"),
        ]
    }

    fn paper() -> WikiPaper {
        WikiPaper {
            id: "p1".to_owned(),
            title: "Paper".to_owned(),
            abstract_text: Some("abs".to_owned()),
            summary: Some("sum".to_owned()),
        }
    }

    #[test]
    fn wiki_root_is_the_note_titled_wiki() {
        let pages = sample();
        let root = find_wiki_root(&pages).map(|n| n.id);
        assert_eq!(root.as_deref(), Some("w"));
    }

    #[test]
    fn no_wiki_root_without_a_note_titled_wiki() {
        let pages = vec![note("n", "Note", None, "2026-01-04T00:00:00Z")];
        assert!(find_wiki_root(&pages).is_none());
    }

    #[test]
    fn wiki_page_refs_are_only_the_generated_children() {
        let refs = wiki_page_refs(&sample());
        let ids: Vec<&str> = refs.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["c1", "c2"]);
    }

    #[test]
    fn wiki_page_refs_are_empty_without_a_root() {
        let pages = vec![note("n", "Note", None, "2026-01-04T00:00:00Z")];
        assert!(wiki_page_refs(&pages).is_empty());
    }

    #[test]
    fn source_documents_skip_generated_pages_and_add_papers() {
        let docs = wiki_source_documents(&sample(), &[paper()], None);
        let ids: Vec<&str> = docs.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["w", "n", "p1"]);
        let paper_text = docs.last().map(|d| d.text.as_str());
        assert_eq!(paper_text, Some("abs\n\nsum"));
    }

    #[test]
    fn source_documents_keep_only_the_listed_ids() {
        let wanted = vec!["p1".to_owned()];
        let docs = wiki_source_documents(&sample(), &[paper()], Some(wanted.as_slice()));
        let ids: Vec<&str> = docs.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["p1"]);
    }

    #[test]
    fn missing_page_plans_trim_dedupe_and_drop_blank_targets() {
        let targets = vec![
            "  Alpha ".to_owned(),
            String::new(),
            "Alpha".to_owned(),
            "Beta".to_owned(),
        ];
        let plans = missing_page_plans(&targets);
        let titles: Vec<&str> = plans.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles, ["Alpha", "Beta"]);
        assert_eq!(plans.first().map(|p| p.mentions), Some(1));
        assert_eq!(
            plans.first().map(|p| p.body.as_str()),
            Some("# Alpha\n\n_Not written yet._\n")
        );
    }

    #[test]
    fn recently_approved_pages_are_newest_first_and_capped() {
        let pages = sample();
        let one = recently_approved_wiki_pages(&pages, 1);
        let ids: Vec<&str> = one.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["c2"]);
        let all = recently_approved_wiki_pages(&pages, 10);
        let ids: Vec<&str> = all.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["c2", "c1"]);
    }
}

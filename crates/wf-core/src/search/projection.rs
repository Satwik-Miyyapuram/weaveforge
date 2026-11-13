//! The search corpus projection (port of `apps/web/src/features/search/application/search-projection.ts`).
//!
//! Order is part of the revision: the snapshot's own documents, then extracted PDF pages, then
//! reader annotations. The worker and the main thread both build through here, so their corpora
//! (and therefore their revisions) cannot drift apart.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;

use crate::search::search_document::{self, AnnotationSource, PdfIndexSource, SearchDoc};
use crate::search::wiki_graph::{self, WikiGraph};
use crate::sync::workspace_snapshot::WorkspaceSnapshot;

/// The worker's build: documents plus per-paper page counts.
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPdfProjection {
    /// Search documents, in revision order.
    pub docs: Vec<SearchDoc>,
    /// `(paperId, pageCount)` for each kept paper, in input order.
    pub pdf_page_counts: Vec<(String, u32)>,
}

/// Link count per node as `kind:id -> count`, the key shape the projections read.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "graph degrees are whole, non-negative counts well inside u32"
)]
fn degree_map(graph: Option<&WikiGraph>) -> HashMap<String, u32> {
    graph.map_or_else(HashMap::new, |graph| {
        wiki_graph::graph_degrees(graph)
            .into_iter()
            .map(|row| (row.node, row.degree as u32))
            .collect()
    })
}

/// Every search document for `snapshot`, in revision order.
///
/// `graph` is a parameter, not rebuilt here, because degrees are a ranking input and the graph
/// refreshes on its own schedule.
///
/// # Errors
///
/// Fails if a reader annotation does not match [`AnnotationSource`].
pub fn project_search_documents(
    snapshot: &WorkspaceSnapshot,
    graph: Option<&WikiGraph>,
    pdf_texts: &[PdfIndexSource],
) -> Result<Vec<SearchDoc>, serde_json::Error> {
    let degrees = degree_map(graph);
    let paper_titles: HashMap<String, String> = snapshot
        .papers
        .iter()
        .map(|paper| (paper.id.clone(), paper.title.clone()))
        .collect();
    let annotations = snapshot
        .reader_annotations
        .iter()
        .cloned()
        .map(|row| serde_json::from_value::<AnnotationSource>(Value::Object(row)))
        .collect::<Result<Vec<_>, _>>()?;

    let mut docs = search_document::to_search_docs(snapshot, &degrees);
    docs.extend(search_document::to_pdf_search_docs(pdf_texts, &degrees));
    docs.extend(search_document::to_annotation_search_docs(
        &annotations,
        &paper_titles,
        &degrees,
    ));
    Ok(docs)
}

/// The worker's build: stored PDF text minus papers the library no longer holds, projected with a
/// graph built from the snapshot.
///
/// # Errors
///
/// Fails if a reader annotation does not match [`AnnotationSource`].
pub fn project_stored_pdf_texts(
    snapshot: &WorkspaceSnapshot,
    stored: &[PdfIndexSource],
) -> Result<StoredPdfProjection, serde_json::Error> {
    // Indexing text of a removed paper would answer searches with hits that open a missing paper.
    let paper_ids: HashSet<&str> = snapshot
        .papers
        .iter()
        .map(|paper| paper.id.as_str())
        .collect();
    let pdf_texts: Vec<PdfIndexSource> = stored
        .iter()
        .filter(|source| paper_ids.contains(source.paper_id.as_str()))
        .cloned()
        .collect();
    let graph = wiki_graph::build_wiki_graph(snapshot);
    let docs = project_search_documents(snapshot, Some(&graph), &pdf_texts)?;
    let pdf_page_counts = pdf_texts
        .iter()
        .map(|source| {
            (
                source.paper_id.clone(),
                u32::try_from(source.pages.len()).unwrap_or(u32::MAX),
            )
        })
        .collect();
    Ok(StoredPdfProjection {
        docs,
        pdf_page_counts,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::search::search_document::{MIN_PDF_PAGE_CHARS, annotation_doc_id, pdf_doc_id};

    fn snapshot() -> WorkspaceSnapshot {
        serde_json::from_value(json!({
            "papers": [{ "id": "pa1", "title": "Alpha" }],
            "readerAnnotations": [{ "id": "an1", "paperId": "pa1", "text": "quoted", "comment": "" }]
        }))
        .expect("snapshot fixture")
    }

    fn pdf(paper_id: &str, text: &str) -> PdfIndexSource {
        serde_json::from_value(json!({
            "paperId": paper_id,
            "title": "T",
            // Long enough to clear MIN_PDF_PAGE_CHARS, so the page is indexed.
            "pages": [{ "pageIndex": 0, "text": text.repeat(MIN_PDF_PAGE_CHARS) }],
            "extractedAt": "2026-01-01T00:00:00Z"
        }))
        .expect("pdf fixture")
    }

    #[test]
    fn documents_come_in_snapshot_pdf_annotation_order() {
        let docs =
            project_search_documents(&snapshot(), None, &[pdf("pa1", "body")]).expect("project");
        let position = |id: &str| docs.iter().position(|doc| doc.id == id);
        let pdf_at = position(&pdf_doc_id("pa1", 0)).expect("pdf page doc");
        let annotation_at = position(&annotation_doc_id("an1")).expect("annotation doc");
        assert!(pdf_at < annotation_at);
        assert!(position("paper:pa1").is_some_and(|at| at < pdf_at));
    }

    #[test]
    fn stored_text_for_removed_papers_is_dropped() {
        let stored = [pdf("pa1", "kept"), pdf("gone", "dropped")];
        let projection = project_stored_pdf_texts(&snapshot(), &stored).expect("project");
        assert_eq!(projection.pdf_page_counts, vec![("pa1".to_owned(), 1)]);
        assert!(
            projection
                .docs
                .iter()
                .all(|doc| doc.id != pdf_doc_id("gone", 0))
        );
        assert!(
            projection
                .docs
                .iter()
                .any(|doc| doc.id == pdf_doc_id("pa1", 0))
        );
    }
}

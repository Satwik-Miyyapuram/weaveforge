//! Which stored PDF texts still belong to a paper in the workspace, and which are orphans to delete.
//! Ports the pure part of `pruneMissingPaperTexts` in
//! `apps/web/src/features/search/application/workspace-search.ts`. The reconcile, load and delete
//! I/O stays in TS.

use std::collections::{BTreeMap, HashSet};

use serde::Serialize;

use super::search_document::PdfIndexSource;

/// The stored texts split by whether their paper still exists.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PdfTextPartition {
    /// Indexes into `stored` of the texts whose paper still exists, in stored order.
    pub kept: Vec<u32>,
    /// Pages held per kept paper, so a re-extraction knows what to retract. A repeated paper keeps its last count.
    pub page_counts: BTreeMap<String, u32>,
    /// Paper id of each orphaned text, in stored order. One entry per orphan, so an id may repeat.
    pub orphan_paper_ids: Vec<String>,
}

/// Splits `stored` by whether each text's paper id is in `paper_ids`.
#[must_use]
pub fn partition_pdf_texts(stored: &[PdfIndexSource], paper_ids: &[String]) -> PdfTextPartition {
    let live: HashSet<&str> = paper_ids.iter().map(String::as_str).collect();
    let mut partition = PdfTextPartition::default();
    for (index, source) in stored.iter().enumerate() {
        if live.contains(source.paper_id.as_str()) {
            partition.kept.push(to_u32(index));
            let _ = partition
                .page_counts
                .insert(source.paper_id.clone(), to_u32(source.pages.len()));
        } else {
            partition.orphan_paper_ids.push(source.paper_id.clone());
        }
    }
    partition
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::search_document::PdfPageText;

    fn source(paper_id: &str, pages: usize) -> PdfIndexSource {
        PdfIndexSource {
            paper_id: paper_id.to_owned(),
            pages: (0..pages)
                .map(|page_index| PdfPageText {
                    page_index: to_u32(page_index),
                    text: "text".to_owned(),
                })
                .collect(),
            ..PdfIndexSource::default()
        }
    }

    #[test]
    fn keeps_texts_of_live_papers_and_lists_orphans() {
        let stored = vec![source("a", 2), source("gone", 1), source("b", 3)];
        let live = vec!["a".to_owned(), "b".to_owned()];
        let partition = partition_pdf_texts(&stored, &live);
        assert_eq!(partition.kept, vec![0, 2]);
        assert_eq!(partition.orphan_paper_ids, vec!["gone".to_owned()]);
        assert_eq!(partition.page_counts.get("a"), Some(&2));
        assert_eq!(partition.page_counts.get("b"), Some(&3));
        assert_eq!(partition.page_counts.get("gone"), None);
    }

    #[test]
    fn orphan_ids_repeat_per_orphan_and_no_papers_orphans_everything() {
        let stored = vec![source("x", 1), source("x", 1)];
        let partition = partition_pdf_texts(&stored, &[]);
        assert!(partition.kept.is_empty());
        assert_eq!(
            partition.orphan_paper_ids,
            vec!["x".to_owned(), "x".to_owned()]
        );
    }
}

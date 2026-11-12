//! Port of `apps/web/src/features/search/application/parts-2.ts`: which search kinds a write to
//! a resource type can change, and the bookkeeping of the search index (`SearchIndexStateCore`).
//! The live index, graph, density and PDF texts stay with the caller, because they are JS handles.

use std::collections::{BTreeMap, BTreeSet};

use super::query::SearchKind;

use SearchKind::{Annotation, Experiment, List, Log, Milestone, Note, Paper, Section};

/// Resource type to the kinds it can change (TS `KINDS_FOR_RESOURCE`).
///
/// `pdf` is in no entry on purpose: page documents come from extracted text, and
/// `indexPdf` refreshes them. A resource type absent here means a full rebuild.
pub const KINDS_FOR_RESOURCE: &[(&str, &[SearchKind])] = &[
    ("paper", &[Paper, Annotation]),
    ("vault_page", &[Note]),
    ("reading_list", &[List]),
    ("reading_list_item", &[]),
    ("report_section", &[Section]),
    ("experiment", &[Experiment]),
    ("milestone", &[Milestone]),
    ("log_entry", &[Log]),
    ("paper_relation", &[Paper, Note]),
    ("tag", &[Paper]),
    ("paper_tag", &[Paper]),
    ("comment", &[]),
    ("share", &[]),
    ("library_pin", &[]),
    ("citation_alert_track", &[]),
    ("dashboard_layout", &[]),
    ("graph_settings", &[]),
];

/// Kinds a write to `resource_type` can change, or `None` when the type is unmapped
/// (the caller then distrusts the whole index).
#[must_use]
pub fn kinds_for_resource(resource_type: &str) -> Option<Vec<SearchKind>> {
    KINDS_FOR_RESOURCE
        .iter()
        .find(|(name, _)| *name == resource_type)
        .map(|(_, kinds)| kinds.to_vec())
}

/// Every mapped resource type, in table order.
#[must_use]
pub fn resource_types() -> Vec<&'static str> {
    KINDS_FOR_RESOURCE.iter().map(|(name, _)| *name).collect()
}

/// The index's bookkeeping without its JS handles: whether an index is held, how many documents
/// it holds, the PDF pages per paper, and which kinds are stale. Port of TS `SearchIndexState`.
///
/// Invariant: a kind stays stale until a refresh that read successfully settles it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchIndexStateCore {
    has_index: bool,
    document_count: u32,
    pdf_page_counts: BTreeMap<String, u32>,
    stale: BTreeSet<SearchKind>,
}

impl SearchIndexStateCore {
    /// Nothing indexed yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether an index has been adopted and not forgotten.
    #[must_use]
    pub fn ready(&self) -> bool {
        self.has_index
    }

    /// Documents the index holds, for the size warning.
    #[must_use]
    pub fn document_count(&self) -> u32 {
        self.document_count
    }

    /// Replaces the document count.
    pub fn set_document_count(&mut self, count: u32) {
        self.document_count = count;
    }

    /// Pages held for `paper_id`; 0 when none are.
    #[must_use]
    pub fn pdf_page_count(&self, paper_id: &str) -> u32 {
        self.pdf_page_counts.get(paper_id).copied().unwrap_or(0)
    }

    /// Records the page count held for `paper_id`.
    pub fn set_pdf_page_count(&mut self, paper_id: &str, count: u32) {
        let _ = self.pdf_page_counts.insert(paper_id.to_owned(), count);
    }

    /// Replaces every paper's page count.
    pub fn replace_pdf_page_counts(&mut self, counts: BTreeMap<String, u32>) {
        self.pdf_page_counts = counts;
    }

    /// Takes the index as built: ready from now, holding `document_count` documents.
    pub fn adopt(&mut self, document_count: u32) {
        self.has_index = true;
        self.document_count = document_count;
    }

    /// Notes the kinds a write to `resource_type` can change. Returns `true` when the whole index
    /// was distrusted (an unmapped type), so the caller has nothing left to refresh selectively.
    /// Marking rather than rebuilding: a burst of writes should cost one refresh, not one each.
    pub fn mark_stale(&mut self, resource_type: &str) -> bool {
        if !self.has_index {
            return false;
        }
        if let Some(kinds) = kinds_for_resource(resource_type) {
            self.stale.extend(kinds);
            false
        } else {
            self.forget();
            true
        }
    }

    /// The kinds waiting to be refreshed, in kind order. Taking does not clear them.
    #[must_use]
    pub fn pending_stale(&self) -> Vec<SearchKind> {
        self.stale.iter().copied().collect()
    }

    /// Forgets the kinds a completed refresh replaced. Other kinds, including any marked during
    /// the refresh, stay stale.
    pub fn settle_stale(&mut self, kinds: &[SearchKind]) {
        for kind in kinds {
            let _ = self.stale.remove(kind);
        }
    }

    /// Nothing is indexed any more; the next build starts from scratch.
    pub fn forget(&mut self) {
        self.has_index = false;
        self.document_count = 0;
        self.pdf_page_counts.clear();
        self.stale.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapped_type_names_its_kinds() {
        assert_eq!(kinds_for_resource("vault_page"), Some(vec![Note]));
        assert_eq!(
            kinds_for_resource("paper_relation"),
            Some(vec![Paper, Note])
        );
    }

    #[test]
    fn unmapped_or_empty_string_has_no_entry() {
        assert_eq!(kinds_for_resource("no_such_type"), None);
        assert_eq!(kinds_for_resource(""), None);
    }

    #[test]
    fn unrelated_writes_map_to_no_kinds() {
        assert_eq!(kinds_for_resource("comment"), Some(vec![]));
        assert_eq!(resource_types().len(), KINDS_FOR_RESOURCE.len());
    }

    #[test]
    fn a_kind_stays_stale_until_settled() {
        let mut state = SearchIndexStateCore::new();
        state.adopt(10);
        assert!(!state.mark_stale("vault_page"));
        assert_eq!(state.pending_stale(), vec![Note]);
        assert_eq!(
            state.pending_stale(),
            vec![Note],
            "asking does not clear the mark"
        );
        state.settle_stale(&[Note]);
        assert!(state.pending_stale().is_empty());
    }

    #[test]
    fn settling_one_kind_leaves_another_marked() {
        let mut state = SearchIndexStateCore::new();
        state.adopt(0);
        let _ = state.mark_stale("vault_page");
        let _ = state.mark_stale("paper");
        state.settle_stale(&[Note]);
        let pending = state.pending_stale();
        assert_eq!(pending.len(), 2);
        assert!(pending.contains(&Paper));
        assert!(pending.contains(&Annotation));
    }

    #[test]
    fn an_unclassified_write_distrusts_the_whole_index() {
        let mut state = SearchIndexStateCore::new();
        state.adopt(10);
        state.set_pdf_page_count("p1", 3);
        assert!(state.mark_stale("something-new"));
        assert!(!state.ready());
        assert_eq!(state.document_count(), 0);
        assert_eq!(state.pdf_page_count("p1"), 0);
    }

    #[test]
    fn nothing_is_stale_before_an_index_exists() {
        let mut state = SearchIndexStateCore::new();
        assert!(!state.mark_stale("vault_page"));
        assert!(state.pending_stale().is_empty());
    }
}

//! Ranking for the semantic index: passage ids, collapsing passage hits to documents, and
//! nearest-neighbour lookups. Port of `SemanticIndex.search`, `nearestTo` and the passage-id
//! helper in `apps/web/src/features/search/application/parts-2.ts`.
//!
//! Order matches the TypeScript exactly: best score first, then ties by `localeCompare` on the
//! document id (not byte order). Documents with equal collation keep first-seen order, as a
//! JavaScript `Map` does.

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::js_collate::locale_compare;
use crate::search::js_text::is_js_whitespace;
use crate::search::semantic_fingerprint::document_id_of;
use crate::search::vector_index::{VectorError, VectorHit, VectorIndex};

/// Hits below this cosine are noise. The floor the TS index applied by default.
pub const MIN_SCORE: f64 = 0.2;

/// Over-fetch factor: several passages of one document can crowd out the runner-up, so the
/// collapse needs more candidates than the caller asked for.
const OVER_FETCH: usize = 4;

/// Neighbour lookups use the opening passages only (indices `0..=3`): they are what a long
/// document is about.
const LAST_NEIGHBOUR_PASSAGE: usize = 3;

/// The id of a document's `index`th passage: `note:n1` becomes `note:n1#2` for its third.
#[must_use]
pub fn passage_id(doc_id: &str, index: usize) -> String {
    format!("{doc_id}#{index}")
}

/// Whether a query has nothing to search for: JavaScript's `query.trim() === ""`.
#[must_use]
pub fn is_blank_query(query: &str) -> bool {
    query.chars().all(is_js_whitespace)
}

/// Passage hits collapsed to one per document: each document keeps its best score, `exclude`
/// drops one document (its own passages), and the result is best first with ties in
/// `localeCompare` order of the id, cut to `limit`.
#[must_use]
pub fn collapse(hits: &[VectorHit], exclude: Option<&str>, limit: usize) -> Vec<VectorHit> {
    let mut out: Vec<VectorHit> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for hit in hits {
        let id = document_id_of(&hit.id);
        if exclude == Some(id.as_str()) {
            continue;
        }
        if let Some(&slot) = at.get(&id) {
            if hit.score > out[slot].score {
                out[slot].score = hit.score;
            }
        } else {
            at.insert(id.clone(), out.len());
            out.push(VectorHit { id, score: hit.score });
        }
    }
    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| locale_compare(&a.id, &b.id))
    });
    out.truncate(limit);
    out
}

/// Nearest documents to a query vector, one hit per document, passage hits collapsed.
///
/// # Errors
///
/// `Dimensions` when `query` is not the index's width.
pub fn search_docs(
    index: &VectorIndex,
    query: &[f32],
    limit: usize,
) -> Result<Vec<VectorHit>, VectorError> {
    let hits = index.search(query, limit.saturating_mul(OVER_FETCH), MIN_SCORE)?;
    Ok(collapse(&hits, None, limit))
}

/// Documents nearest to one already indexed, by its own passages rather than its title. No
/// forward pass: the stored vectors are the query. The document itself is never returned.
///
/// # Errors
///
/// `Dimensions` when a stored passage is not the index's width (cannot happen for a well-formed
/// index; surfaced rather than hidden).
pub fn nearest_docs(
    index: &VectorIndex,
    doc_id: &str,
    limit: usize,
) -> Result<Vec<VectorHit>, VectorError> {
    let mut all: Vec<VectorHit> = Vec::new();
    for passage in 0..=LAST_NEIGHBOUR_PASSAGE {
        // Absent passages end the document.
        let Some(vector) = index.vector_of(&passage_id(doc_id, passage)) else {
            break;
        };
        all.extend(index.search(&vector, limit.saturating_mul(OVER_FETCH), MIN_SCORE)?);
    }
    Ok(collapse(&all, Some(doc_id), limit))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_with(ids: &[&str], vectors: &[[f32; 3]]) -> VectorIndex {
        let mut index = VectorIndex::new(3).expect("three dimensions");
        let owned: Vec<String> = ids.iter().map(|id| (*id).to_owned()).collect();
        let flat: Vec<f32> = vectors.iter().flatten().copied().collect();
        index.add(&owned, &flat).expect("well-formed add");
        index
    }

    #[test]
    fn passage_id_appends_the_index() {
        assert_eq!(passage_id("note:n1", 2), "note:n1#2");
    }

    // it: "a blank query returns nothing instead of a nearest-to-nothing list"
    #[test]
    fn a_blank_query_returns_nothing_instead_of_a_nearest_to_nothing_list() {
        assert!(is_blank_query("   "));
        assert!(is_blank_query("\t\n\u{a0}"));
        assert!(is_blank_query(""));
        assert!(!is_blank_query(" a "));
    }

    // it: "passages collapse back to one hit per document"
    #[test]
    fn passages_collapse_back_to_one_hit_per_document() {
        let index = index_with(
            &["note:long#0", "note:long#1", "note:long#2", "note:other#0"],
            &[[1.0, 0.0, 0.0], [0.99, 0.1, 0.0], [0.98, 0.2, 0.0], [0.0, 1.0, 0.0]],
        );
        let hits = search_docs(&index, &[1.0, 0.0, 0.0], 10).expect("query width");
        assert_eq!(hits.len(), 1, "a document appears once, however many passages matched");
        assert_eq!(hits[0].id, "note:long");
        // The best passage's score is kept, not the last one seen.
        assert!((hits[0].score - 1.0).abs() < 1e-6);
    }

    // it: "nearestTo finds neighbours from the seed's own vectors, without embedding"
    #[test]
    fn nearest_finds_neighbours_from_the_seeds_own_vectors_and_never_itself() {
        let index = index_with(
            &["note:a#0", "note:b#0", "note:c#0", "note:d#0"],
            &[
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [0.9, 0.3, 0.0],
            ],
        );
        let near = nearest_docs(&index, "note:d", 3).expect("stored width");
        assert_eq!(near.first().map(|hit| hit.id.as_str()), Some("note:a"));
        assert!(near.iter().all(|hit| hit.id != "note:d"), "never itself");
    }

    #[test]
    fn nearest_of_an_unknown_document_is_empty() {
        let index = index_with(&["note:a#0"], &[[1.0, 0.0, 0.0]]);
        assert!(nearest_docs(&index, "note:missing", 3).expect("stored width").is_empty());
    }

    #[test]
    fn ties_order_by_locale_not_bytes() {
        // Byte order puts "note:B" first (uppercase sorts before lowercase); localeCompare puts
        // "note:a" first. The TypeScript order is the locale one.
        let hits = vec![
            VectorHit { id: "note:B#0".to_owned(), score: 0.5 },
            VectorHit { id: "note:a#0".to_owned(), score: 0.5 },
        ];
        let ranked = collapse(&hits, None, 10);
        assert_eq!(ranked[0].id, "note:a");
        assert_eq!(ranked[1].id, "note:B");
    }

    #[test]
    fn collapse_is_best_first_then_cut_to_the_limit() {
        let hits = vec![
            VectorHit { id: "note:x#0".to_owned(), score: 0.3 },
            VectorHit { id: "note:y#0".to_owned(), score: 0.9 },
            VectorHit { id: "note:x#1".to_owned(), score: 0.6 },
            VectorHit { id: "note:z#0".to_owned(), score: 0.5 },
        ];
        let ranked = collapse(&hits, None, 2);
        let ids: Vec<&str> = ranked.iter().map(|hit| hit.id.as_str()).collect();
        assert_eq!(ids, ["note:y", "note:x"]);
        assert!((ranked[1].score - 0.6).abs() < 1e-12);
    }
}

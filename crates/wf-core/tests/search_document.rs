//! Ports `packages/core/test/search/{search-document,pdf-search-document,annotation-search-document,search-retry}.test.ts`.
//! Retry cases live here because `search_retry` is public but has no integration file of its own.

use std::collections::{BTreeSet, HashMap};

use wf_core::search::query::SearchKind;
use wf_core::search::search_document::{
    AnnotationSource, MIN_PDF_PAGE_CHARS, PdfIndexSource, PdfPageText, annotation_doc_id,
    extract_headings, pdf_doc_id, pdf_doc_ids_for, pdf_page_href, search_revision,
    to_annotation_search_docs, to_pdf_search_docs, to_search_docs,
};
use wf_core::search::search_retry::{retry_fuzziness_for_term, should_retry};
use wf_core::search::search_tuning::{MAX_INDEXED_BODY_CHARS, fuzziness_for_term};
use wf_core::sync::workspace_snapshot::{
    SnapshotExperiment, SnapshotLogEntry, SnapshotMilestone, SnapshotPaper, SnapshotReadingList,
    SnapshotReportSection, SnapshotVaultPage, WorkspaceSnapshot,
};

const CREATED: &str = "2026-01-01T00:00:00.000Z";

fn note(id: &str, title: &str, body: &str) -> SnapshotVaultPage {
    SnapshotVaultPage {
        id: id.to_owned(),
        title: title.to_owned(),
        body: body.to_owned(),
        created_at: CREATED.to_owned(),
        ..Default::default()
    }
}

fn snapshot_with_notes(notes: Vec<SnapshotVaultPage>) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        vault_pages: notes,
        ..Default::default()
    }
}

fn pdf_source(pages: Vec<PdfPageText>) -> PdfIndexSource {
    PdfIndexSource {
        paper_id: "p1".to_owned(),
        title: "Attention Is All You Need".to_owned(),
        extracted_at: "2026-08-05T00:00:00.000Z".to_owned(),
        pages,
    }
}

fn page(index: u32, text: &str) -> PdfPageText {
    PdfPageText {
        page_index: index,
        text: text.to_owned(),
    }
}

fn annotation() -> AnnotationSource {
    AnnotationSource {
        id: "a1".to_owned(),
        paper_id: "p1".to_owned(),
        page_index: 3,
        text: "Attention allows modeling of dependencies without regard to distance.".to_owned(),
        comment: "This is the claim the whole paper rests on.".to_owned(),
        tags: vec!["key-claim".to_owned()],
        created_at: "2026-05-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-05-02T00:00:00.000Z".to_owned(),
    }
}

fn titles() -> HashMap<String, String> {
    HashMap::from([("p1".to_owned(), "Attention Is All You Need".to_owned())])
}

fn no_degrees() -> HashMap<String, u32> {
    HashMap::new()
}

// ------------------------------------------------------- snapshot documents

#[test]
fn extracts_h1_to_h3_headings_and_ignores_headings_inside_code() {
    let body = "# Title\n## Sub\n#### Too deep\n```\n# not a heading\n```";

    assert_eq!(extract_headings(Some(body)), vec!["Title", "Sub"]);
}

#[test]
fn notes_index_body_headings_and_hashtags_from_the_body() {
    let snapshot = snapshot_with_notes(vec![note(
        "n1",
        "Method",
        "## Baselines\nWe compare #vae and #gan.",
    )]);

    let docs = to_search_docs(&snapshot, &no_degrees());
    let doc = &docs[0];
    let mut tags = doc.tags.clone();
    tags.sort();

    assert_eq!(doc.id, "note:n1");
    assert_eq!(doc.kind, SearchKind::Note);
    assert_eq!(doc.headings, vec!["Baselines"]);
    assert_eq!(tags, vec!["gan", "vae"]);
    assert!(doc.body.contains("We compare"));
    assert_eq!(doc.href, "/notes?page=n1");
}

#[test]
fn tree_entities_carry_an_ancestor_breadcrumb() {
    let mut child = note("child", "Baselines", "");
    child.parent_id = Some("root".to_owned());
    let mut grand = note("grand", "Ablation", "");
    grand.parent_id = Some("child".to_owned());
    let snapshot = snapshot_with_notes(vec![note("root", "Method", ""), child, grand]);

    let docs = to_search_docs(&snapshot, &no_degrees());
    let path_of = |entity: &str| {
        docs.iter()
            .find(|d| d.entity_id == entity)
            .expect("doc for entity")
            .path
            .clone()
    };

    assert_eq!(path_of("root"), "");
    assert_eq!(path_of("child"), "Method");
    assert_eq!(path_of("grand"), "Method/Baselines");
}

#[test]
fn a_cyclic_parent_chain_terminates_instead_of_hanging() {
    let mut a = note("a", "A", "");
    a.parent_id = Some("b".to_owned());
    let mut b = note("b", "B", "");
    b.parent_id = Some("a".to_owned());

    let docs = to_search_docs(&snapshot_with_notes(vec![a, b]), &no_degrees());

    assert_eq!(docs.len(), 2);
}

#[test]
fn papers_index_authors_venue_and_identifiers_as_aliases() {
    let snapshot = WorkspaceSnapshot {
        papers: vec![SnapshotPaper {
            id: "p1".to_owned(),
            title: "Attention Is All You Need".to_owned(),
            authors: vec!["Vaswani".to_owned(), "Shazeer".to_owned()],
            venue: Some("NeurIPS".to_owned()),
            doi: Some("10.1/x".to_owned()),
            arxiv_id: Some("1706.03762".to_owned()),
            year: Some(2017.0),
            abstract_text: Some("The dominant sequence transduction models".to_owned()),
            tags: vec!["transformers".to_owned()],
            created_at: CREATED.to_owned(),
            updated_at: CREATED.to_owned(),
            ..Default::default()
        }],
        ..Default::default()
    };

    let docs = to_search_docs(&snapshot, &no_degrees());
    let doc = docs
        .iter()
        .find(|d| d.kind == SearchKind::Paper)
        .expect("paper doc");

    assert!(
        doc.aliases.contains(&"Vaswani".to_owned()),
        "authors should be searchable as aliases"
    );
    assert!(doc.aliases.contains(&"NeurIPS".to_owned()));
    assert!(doc.aliases.contains(&"1706.03762".to_owned()));
    assert!(doc.body.contains("dominant sequence"));
}

#[test]
fn report_sections_expose_their_outline_number_as_an_alias() {
    let snapshot = WorkspaceSnapshot {
        report_sections: vec![SnapshotReportSection {
            id: "s1".to_owned(),
            title: "Introduction".to_owned(),
            section_no: Some("3.2".to_owned()),
            notes: Some("# Aim\nText.".to_owned()),
            created_at: CREATED.to_owned(),
            ..Default::default()
        }],
        ..Default::default()
    };

    let docs = to_search_docs(&snapshot, &no_degrees());

    assert_eq!(docs[0].aliases, vec!["3.2"]);
    assert_eq!(docs[0].headings, vec!["Aim"]);
    assert_eq!(docs[0].href, "/report?section=s1");
}

#[test]
fn log_entries_are_titled_by_date_so_they_can_be_scanned_for() {
    let snapshot = WorkspaceSnapshot {
        log_entries: vec![SnapshotLogEntry {
            id: "l1".to_owned(),
            entry_date: "2026-03-14".to_owned(),
            kind: "daily".to_owned(),
            body: "Ran the sweep. #baseline".to_owned(),
            created_at: "2026-03-14T09:00:00.000Z".to_owned(),
        }],
        ..Default::default()
    };

    let docs = to_search_docs(&snapshot, &no_degrees());

    assert_eq!(docs[0].title, "2026-03-14");
    assert_eq!(docs[0].path, "2026-03");
    assert_eq!(docs[0].tags, vec!["baseline"]);
}

#[test]
fn oversized_bodies_are_truncated_never_dropped() {
    let limit = MAX_INDEXED_BODY_CHARS as usize;
    let snapshot = snapshot_with_notes(vec![note("n1", "Method", &"x".repeat(limit + 5_000))]);

    let docs = to_search_docs(&snapshot, &no_degrees());

    assert_eq!(docs[0].body.len(), limit);
    assert_eq!(
        docs[0].title, "Method",
        "the document is still indexed by title"
    );
}

#[test]
fn degrees_are_applied_when_supplied_and_default_to_zero() {
    let snapshot = snapshot_with_notes(vec![note("n1", "Method", "")]);
    let degrees = HashMap::from([("note:n1".to_owned(), 7_u32)]);

    assert_eq!(to_search_docs(&snapshot, &degrees)[0].degree, 7);
    assert_eq!(to_search_docs(&snapshot, &no_degrees())[0].degree, 0);
}

#[test]
fn ids_are_unique_across_kinds_that_share_an_id_space() {
    let snapshot = WorkspaceSnapshot {
        vault_pages: vec![note("shared", "Method", "")],
        milestones: vec![SnapshotMilestone {
            id: "shared".to_owned(),
            title: "Draft".to_owned(),
            created_at: CREATED.to_owned(),
            ..Default::default()
        }],
        ..Default::default()
    };

    let docs = to_search_docs(&snapshot, &no_degrees());
    let ids: BTreeSet<&str> = docs.iter().map(|d| d.id.as_str()).collect();

    assert_eq!(ids.len(), 2);
}

#[test]
fn every_declared_kind_has_a_route() {
    // Snapshot covers workspace entities; PDF pages and highlights come from the
    // reader. Together they must cover every declared kind.
    let snapshot = WorkspaceSnapshot {
        vault_pages: vec![note("n1", "Method", "")],
        papers: vec![SnapshotPaper {
            id: "p1".to_owned(),
            title: "P".to_owned(),
            created_at: CREATED.to_owned(),
            updated_at: CREATED.to_owned(),
            ..Default::default()
        }],
        reading_lists: vec![SnapshotReadingList {
            id: "r1".to_owned(),
            ..Default::default()
        }],
        report_sections: vec![SnapshotReportSection {
            id: "s1".to_owned(),
            title: "S".to_owned(),
            created_at: CREATED.to_owned(),
            ..Default::default()
        }],
        experiments: vec![SnapshotExperiment {
            id: "e1".to_owned(),
            name: "E".to_owned(),
            created_at: CREATED.to_owned(),
            ..Default::default()
        }],
        milestones: vec![SnapshotMilestone {
            id: "m1".to_owned(),
            title: "M".to_owned(),
            created_at: CREATED.to_owned(),
            ..Default::default()
        }],
        log_entries: vec![SnapshotLogEntry {
            id: "l1".to_owned(),
            entry_date: "2026-01-01".to_owned(),
            kind: "daily".to_owned(),
            created_at: CREATED.to_owned(),
            ..Default::default()
        }],
        ..Default::default()
    };
    let pdf = to_pdf_search_docs(
        &[pdf_source(vec![page(
            0,
            "Enough page text to clear the minimum length bar.",
        )])],
        &no_degrees(),
    );
    let annotations = to_annotation_search_docs(
        &[AnnotationSource {
            text: "A highlighted passage.".to_owned(),
            ..annotation()
        }],
        &titles(),
        &no_degrees(),
    );

    let mut every_doc = to_search_docs(&snapshot, &no_degrees());
    every_doc.extend(pdf);
    every_doc.extend(annotations);

    let kinds: BTreeSet<&str> = every_doc.iter().map(|d| d.kind.as_str()).collect();
    let declared: BTreeSet<&str> = SearchKind::ALL.iter().map(|k| k.as_str()).collect();
    assert_eq!(kinds, declared);
    for doc in &every_doc {
        assert!(
            doc.href.starts_with('/'),
            "{} has no route",
            doc.kind.as_str()
        );
    }
}

#[test]
fn revision_changes_when_content_is_edited_or_removed() {
    let base = to_search_docs(
        &snapshot_with_notes(vec![note("n1", "Method", "")]),
        &no_degrees(),
    );
    let mut edited_note = note("n1", "Method", "");
    edited_note.updated_at = "2026-03-01T00:00:00.000Z".to_owned();
    let edited = to_search_docs(&snapshot_with_notes(vec![edited_note]), &no_degrees());
    let removed = to_search_docs(&WorkspaceSnapshot::default(), &no_degrees());

    assert_ne!(
        search_revision(&base),
        search_revision(&edited),
        "an edit must invalidate the cache"
    );
    assert_ne!(
        search_revision(&base),
        search_revision(&removed),
        "a deletion must invalidate it"
    );
    assert_eq!(
        search_revision(&base),
        search_revision(&to_search_docs(
            &snapshot_with_notes(vec![note("n1", "Method", "")]),
            &no_degrees()
        ))
    );
}

// ----------------------------------------------------------------- PDF pages

#[test]
fn one_document_per_page_so_a_hit_can_say_which_page() {
    let docs = to_pdf_search_docs(
        &[pdf_source(vec![
            page(
                0,
                "The dominant sequence transduction models use recurrence.",
            ),
            page(
                1,
                "We propose a new simple network architecture, the Transformer.",
            ),
        ])],
        &no_degrees(),
    );

    assert_eq!(docs.len(), 2);
    assert_eq!(
        docs.iter().map(|d| d.page).collect::<Vec<_>>(),
        vec![Some(0), Some(1)]
    );
}

#[test]
fn hits_deep_link_to_the_page_the_match_is_on() {
    let docs = to_pdf_search_docs(
        &[pdf_source(vec![
            page(
                0,
                "The dominant sequence transduction models use recurrence.",
            ),
            page(
                1,
                "We propose a new simple network architecture, the Transformer.",
            ),
        ])],
        &no_degrees(),
    );

    assert_eq!(docs[1].href, "/reader?paper=p1&page=1");
    assert_eq!(pdf_page_href("p 1", 3), "/reader?paper=p%201&page=3");
}

#[test]
fn pdf_ids_are_stable_and_unique_per_page() {
    let docs = to_pdf_search_docs(
        &[pdf_source(vec![
            page(
                0,
                "The dominant sequence transduction models use recurrence.",
            ),
            page(
                1,
                "We propose a new simple network architecture, the Transformer.",
            ),
        ])],
        &no_degrees(),
    );
    let ids: BTreeSet<&str> = docs.iter().map(|d| d.id.as_str()).collect();

    assert_eq!(docs[0].id, pdf_doc_id("p1", 0));
    assert_eq!(ids.len(), 2);
}

#[test]
fn entity_id_is_the_paper_so_kind_filters_and_dedupe_behave() {
    let docs = to_pdf_search_docs(
        &[pdf_source(vec![
            page(
                0,
                "The dominant sequence transduction models use recurrence.",
            ),
            page(
                1,
                "We propose a new simple network architecture, the Transformer.",
            ),
        ])],
        &no_degrees(),
    );

    assert!(docs.iter().all(|d| d.entity_id == "p1"));
    assert!(docs.iter().all(|d| d.kind == SearchKind::Pdf));
}

#[test]
fn near_empty_pages_are_skipped_as_figures_or_scan_artefacts() {
    let docs = to_pdf_search_docs(
        &[pdf_source(vec![
            page(0, "   "),
            page(1, &"x".repeat(MIN_PDF_PAGE_CHARS - 1)),
            page(2, &"x".repeat(MIN_PDF_PAGE_CHARS + 1)),
        ])],
        &no_degrees(),
    );

    assert_eq!(docs.len(), 1);
    assert_eq!(docs[0].page, Some(2));
}

#[test]
fn a_page_inherits_its_papers_link_degree() {
    let degrees = HashMap::from([("paper:p1".to_owned(), 9_u32)]);
    let docs = to_pdf_search_docs(
        &[pdf_source(vec![
            page(
                0,
                "The dominant sequence transduction models use recurrence.",
            ),
            page(
                1,
                "We propose a new simple network architecture, the Transformer.",
            ),
        ])],
        &degrees,
    );

    assert!(
        docs.iter().all(|d| d.degree == 9),
        "pages have no links of their own"
    );
}

#[test]
fn the_page_number_is_searchable_as_an_alias_and_shown_in_the_path() {
    let docs = to_pdf_search_docs(
        &[pdf_source(vec![
            page(
                0,
                "The dominant sequence transduction models use recurrence.",
            ),
            page(
                1,
                "We propose a new simple network architecture, the Transformer.",
            ),
        ])],
        &no_degrees(),
    );

    assert_eq!(docs[0].aliases, vec!["p1"]);
    assert_eq!(docs[1].path, "page 2", "paths are 1-based for humans");
}

#[test]
fn page_ids_can_be_enumerated_to_replace_a_re_extracted_document() {
    assert_eq!(
        pdf_doc_ids_for("p1", 3),
        vec![
            pdf_doc_id("p1", 0),
            pdf_doc_id("p1", 1),
            pdf_doc_id("p1", 2)
        ]
    );
}

#[test]
fn no_sources_yields_no_documents() {
    assert!(to_pdf_search_docs(&[], &no_degrees()).is_empty());
    assert!(to_pdf_search_docs(&[pdf_source(Vec::new())], &no_degrees()).is_empty());
}

// --------------------------------------------------------------- annotations

#[test]
fn both_the_quoted_passage_and_the_comment_are_searchable() {
    let docs = to_annotation_search_docs(&[annotation()], &titles(), &no_degrees());

    assert!(
        docs[0]
            .body
            .contains("dependencies without regard to distance")
    );
    assert!(docs[0].body.contains("the claim the whole paper rests on"));
}

#[test]
fn a_hit_opens_the_reader_at_the_page_the_highlight_is_on() {
    let docs = to_annotation_search_docs(&[annotation()], &titles(), &no_degrees());

    assert_eq!(docs[0].href, "/reader?paper=p1&page=3");
    assert_eq!(docs[0].page, Some(3));
    assert_eq!(
        docs[0].path, "page 4",
        "the path reads as a human page number"
    );
}

#[test]
fn the_papers_title_is_how_a_highlight_is_recognised() {
    let docs = to_annotation_search_docs(&[annotation()], &titles(), &no_degrees());

    assert_eq!(docs[0].title, "Attention Is All You Need");
    assert_eq!(
        docs[0].entity_id, "p1",
        "grouped under the paper, like a PDF page"
    );
}

#[test]
fn a_short_comment_ranks_like_a_title_rather_than_competing_with_the_quote() {
    let docs = to_annotation_search_docs(
        &[AnnotationSource {
            comment: "key result".to_owned(),
            ..annotation()
        }],
        &titles(),
        &no_degrees(),
    );

    assert_eq!(docs[0].aliases, vec!["key result"]);
}

#[test]
fn an_ink_stroke_or_crop_with_no_text_is_not_indexed() {
    let docs = to_annotation_search_docs(
        &[AnnotationSource {
            id: "a2".to_owned(),
            text: String::new(),
            comment: String::new(),
            ..annotation()
        }],
        &titles(),
        &no_degrees(),
    );

    assert!(
        docs.is_empty(),
        "an empty document would surface on title-only matches"
    );
}

#[test]
fn a_highlight_with_no_comment_still_indexes_its_passage() {
    let docs = to_annotation_search_docs(
        &[AnnotationSource {
            comment: String::new(),
            ..annotation()
        }],
        &titles(),
        &no_degrees(),
    );

    assert!(docs[0].aliases.is_empty());
    assert!(docs[0].body.contains("dependencies"));
}

#[test]
fn a_comment_with_no_highlighted_text_still_indexes() {
    let docs = to_annotation_search_docs(
        &[AnnotationSource {
            text: String::new(),
            comment: "Check this against the VAE paper.".to_owned(),
            ..annotation()
        }],
        &titles(),
        &no_degrees(),
    );

    assert!(docs[0].body.contains("Check this against the VAE paper"));
}

#[test]
fn a_paper_missing_from_the_title_map_does_not_lose_its_annotation() {
    let docs = to_annotation_search_docs(
        &[AnnotationSource {
            paper_id: "gone".to_owned(),
            ..annotation()
        }],
        &titles(),
        &no_degrees(),
    );

    assert_eq!(docs[0].title, "Annotation");
    assert!(docs[0].body.contains("dependencies"));
}

#[test]
fn tags_on_a_highlight_are_searchable() {
    let docs = to_annotation_search_docs(&[annotation()], &titles(), &no_degrees());

    assert_eq!(docs[0].tags, vec!["key-claim"]);
}

#[test]
fn annotation_ids_are_stable_and_namespaced() {
    let docs = to_annotation_search_docs(&[annotation()], &titles(), &no_degrees());

    assert_eq!(docs[0].id, annotation_doc_id("a1"));
    assert_eq!(docs[0].id, "annotation:a1");
}

#[test]
fn the_papers_link_degree_carries_to_its_highlights() {
    let degrees = HashMap::from([("paper:p1".to_owned(), 7_u32)]);
    let docs = to_annotation_search_docs(&[annotation()], &titles(), &degrees);

    assert_eq!(docs[0].degree, 7);
}

// --------------------------------------------------------------------- retry

#[test]
fn retry_a_query_with_results_is_never_retried() {
    assert!(!should_retry(1, 1));
    assert!(!should_retry(50, 3));
}

#[test]
fn retry_an_empty_result_on_a_short_query_is_retried() {
    assert!(should_retry(0, 1));
    assert!(should_retry(0, 4));
}

#[test]
fn retry_a_long_query_that_found_nothing_is_left_alone() {
    assert!(!should_retry(0, 5));
}

#[test]
fn retry_an_empty_query_is_not_retried() {
    assert!(!should_retry(0, 0));
}

#[test]
fn retry_the_escalation_is_exactly_one_more_edit() {
    for term in ["neural", "attention", "diffusion", "variational"] {
        let first_pass = (fuzziness_for_term(term) * term.len() as f64).round();
        assert_eq!(
            retry_fuzziness_for_term(term, should_retry(0, 1)),
            first_pass + 1.0,
            "{term}: expected one edit beyond the first pass"
        );
    }
}

#[test]
fn retry_a_six_letter_term_can_reach_its_own_transposition() {
    // "nerual" is a swap of "neural"; a swap is two Levenshtein edits.
    assert!(retry_fuzziness_for_term("nerual", should_retry(0, 1)) >= 2.0);
}

#[test]
fn retry_very_short_terms_stay_exact_even_on_a_retry() {
    assert_eq!(retry_fuzziness_for_term("gan", should_retry(0, 1)), 0.0);
    assert_eq!(retry_fuzziness_for_term("vae", should_retry(0, 1)), 0.0);
}

#[test]
fn retry_a_plan_that_is_not_retrying_loosens_nothing() {
    assert_eq!(retry_fuzziness_for_term("neural", should_retry(3, 1)), 0.0);
}

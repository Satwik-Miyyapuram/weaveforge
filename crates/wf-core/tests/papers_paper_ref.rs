#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]
//! Port of `packages/core/test/features/papers/parse-paper-ref.test.ts`.

use wf_core::papers::paper_ref::{
    PaperRef, PaperRefKind, extract_doi, normalize_arxiv_id, parse_paper_ref,
};

fn arxiv(value: &str) -> PaperRef {
    PaperRef {
        kind: PaperRefKind::Arxiv,
        value: value.to_owned(),
    }
}

fn doi(value: &str) -> PaperRef {
    PaperRef {
        kind: PaperRefKind::Doi,
        value: value.to_owned(),
    }
}

fn url(value: &str) -> PaperRef {
    PaperRef {
        kind: PaperRefKind::Url,
        value: value.to_owned(),
    }
}

#[test]
fn normalize_arxiv_id_reads_abs_pdf_urls_prefixed_forms_and_bare_ids() {
    let id = "2305.12345";
    assert_eq!(
        normalize_arxiv_id("https://arxiv.org/abs/2305.12345").as_deref(),
        Some(id)
    );
    assert_eq!(
        normalize_arxiv_id("http://arxiv.org/abs/2305.12345v3").as_deref(),
        Some(id)
    );
    assert_eq!(
        normalize_arxiv_id("https://arxiv.org/pdf/2305.12345v2.pdf").as_deref(),
        Some(id)
    );
    assert_eq!(
        normalize_arxiv_id("https://arxiv.org/abs/2305.12345?context=cs").as_deref(),
        Some(id)
    );
    assert_eq!(normalize_arxiv_id("arXiv:2305.12345").as_deref(), Some(id));
    assert_eq!(
        normalize_arxiv_id("arXiv: 2305.12345v1").as_deref(),
        Some(id)
    );
    assert_eq!(normalize_arxiv_id("  2305.12345  ").as_deref(), Some(id));
    assert_eq!(normalize_arxiv_id("2305.12345v2").as_deref(), Some(id));
}

#[test]
fn normalize_arxiv_id_handles_legacy_ids_and_rejects_non_ids() {
    assert_eq!(
        normalize_arxiv_id("https://arxiv.org/abs/cs.LG/0501001").as_deref(),
        Some("cs.LG/0501001")
    );
    assert_eq!(
        normalize_arxiv_id("hep-th/9901001").as_deref(),
        Some("hep-th/9901001")
    );
    assert_eq!(
        normalize_arxiv_id("https://example.com/papers/2305.12345.html"),
        None
    );
    assert_eq!(normalize_arxiv_id("not an id"), None);
    assert_eq!(normalize_arxiv_id("https://arxiv.org/list/cs.LG/recent"), None);
    assert_eq!(normalize_arxiv_id(""), None);
    assert_eq!(normalize_arxiv_id("   "), None);
}

#[test]
fn extract_doi_pulls_a_doi_out_of_urls_prefixes_and_prose() {
    let d = "10.1145/3592979";
    assert_eq!(extract_doi(d).as_deref(), Some(d));
    assert_eq!(
        extract_doi("https://doi.org/10.1145/3592979").as_deref(),
        Some(d)
    );
    assert_eq!(
        extract_doi("https://dx.doi.org/10.1145/3592979").as_deref(),
        Some(d)
    );
    assert_eq!(
        extract_doi("https://dl.acm.org/doi/10.1145/3592979").as_deref(),
        Some(d)
    );
    assert_eq!(extract_doi("doi:10.1145/3592979").as_deref(), Some(d));
    assert_eq!(extract_doi("see (10.1145/3592979).").as_deref(), Some(d));
    assert_eq!(extract_doi("10.1145/3592979").as_deref(), Some(d));
    assert_eq!(extract_doi("https://example.com/paper"), None);
}

#[test]
fn extract_doi_percent_decodes_and_keeps_raw_text_on_bad_escapes() {
    assert_eq!(
        extract_doi("10.1145%2F3592979").as_deref(),
        Some("10.1145/3592979")
    );
    // A stray '%' is not worth failing over: the raw text is matched instead.
    assert_eq!(
        extract_doi("10.1145/abc%zz").as_deref(),
        Some("10.1145/abc%zz")
    );
}

#[test]
fn extract_doi_lowercases_dois_are_case_insensitive_dedupe_is_not() {
    assert_eq!(
        extract_doi("10.1145/ABC.Def").as_deref(),
        Some("10.1145/abc.def")
    );
}

#[test]
fn parse_paper_ref_routes_a_pasted_value_to_the_source_that_can_answer_it() {
    assert_eq!(
        parse_paper_ref(PaperRefKind::Url, "https://arxiv.org/abs/2305.12345"),
        arxiv("2305.12345")
    );
    // A DOI dropped in the arXiv box still resolves.
    assert_eq!(
        parse_paper_ref(PaperRefKind::Arxiv, "https://doi.org/10.1145/3592979"),
        doi("10.1145/3592979")
    );
    // An arXiv link dropped in the DOI box, likewise.
    assert_eq!(
        parse_paper_ref(PaperRefKind::Doi, "arXiv:2305.12345"),
        arxiv("2305.12345")
    );
    // arXiv wins over a DOI in the same string: it also carries the abstract.
    assert_eq!(
        parse_paper_ref(
            PaperRefKind::Url,
            "https://arxiv.org/abs/2305.12345 (10.1145/3592979)"
        ),
        arxiv("2305.12345")
    );
}

#[test]
fn parse_paper_ref_leaves_opaque_and_plain_values_alone() {
    // Zotero keys have no structure to detect — never re-classify them.
    assert_eq!(
        parse_paper_ref(PaperRefKind::Zotero, "ABCD1234"),
        PaperRef {
            kind: PaperRefKind::Zotero,
            value: "ABCD1234".to_owned()
        }
    );
    assert_eq!(
        parse_paper_ref(PaperRefKind::Url, "https://example.com/paper"),
        url("https://example.com/paper")
    );
    // A scheme-less URL is still a URL — in any box, with or without a path.
    assert_eq!(
        parse_paper_ref(PaperRefKind::Url, "example.com/papers/x"),
        url("https://example.com/papers/x")
    );
    assert_eq!(
        parse_paper_ref(
            PaperRefKind::Doi,
            "www.nature.com/articles/s41586-021-03819-2"
        ),
        url("https://www.nature.com/articles/s41586-021-03819-2")
    );
    assert_eq!(
        parse_paper_ref(PaperRefKind::Url, "openreview.net"),
        url("https://openreview.net")
    );
    assert_eq!(
        parse_paper_ref(PaperRefKind::Arxiv, "  2305.12345 "),
        arxiv("2305.12345")
    );
}

#[test]
fn parse_paper_ref_accepts_http_and_https_alike_and_both_scheme_less_forms() {
    // Explicit http is preserved — never silently rewritten to https.
    assert_eq!(
        parse_paper_ref(PaperRefKind::Url, "http://example.com/paper"),
        url("http://example.com/paper")
    );
    assert_eq!(
        parse_paper_ref(PaperRefKind::Url, "HTTPS://Example.com/Paper"),
        url("HTTPS://Example.com/Paper")
    );
    // arXiv and DOI detection is scheme-agnostic.
    for v in [
        "http://arxiv.org/abs/2305.12345",
        "https://arxiv.org/abs/2305.12345",
        "arxiv.org/abs/2305.12345",
        "www.arxiv.org/abs/2305.12345",
    ] {
        assert_eq!(
            parse_paper_ref(PaperRefKind::Url, v),
            arxiv("2305.12345"),
            "{v}"
        );
    }
    for v in ["http://doi.org/10.1145/3592979", "doi.org/10.1145/3592979"] {
        assert_eq!(
            parse_paper_ref(PaperRefKind::Url, v),
            doi("10.1145/3592979"),
            "{v}"
        );
    }
}

#[test]
fn parse_paper_ref_does_not_mistake_a_bare_id_for_a_hostname() {
    assert_eq!(
        parse_paper_ref(PaperRefKind::Arxiv, "2306.09643"),
        arxiv("2306.09643")
    );
    // Nonsense stays with the declared kind rather than becoming a URL.
    assert_eq!(
        parse_paper_ref(PaperRefKind::Arxiv, "some paper title"),
        arxiv("some paper title")
    );
}

#[test]
fn parsing_stays_linear_on_hostile_input() {
    let tabs = "\t".repeat(50_000);
    assert_eq!(normalize_arxiv_id(&format!("arxiv{tabs}x")), None);
    let parens = ")".repeat(50_000);
    assert_eq!(
        extract_doi(&format!("10.1234/a{parens}x")),
        Some(format!("10.1234/a{parens}x"))
    );
    assert_eq!(
        normalize_arxiv_id("arxiv \t: 2305.12345").as_deref(),
        Some("2305.12345")
    );
    assert_eq!(
        extract_doi("doi:10.1145/3592979).").as_deref(),
        Some("10.1145/3592979")
    );
}

#[test]
fn arxiv_html_pages_and_arxiv_minted_dois_are_arxiv_refs() {
    // arXiv's HTML render of a paper is the same paper as its abs page.
    assert_eq!(
        parse_paper_ref(PaperRefKind::Url, "https://arxiv.org/html/2401.04088v1"),
        arxiv("2401.04088")
    );
    // The DOI arXiv mints through DataCite carries the id; Crossref does not know it.
    for v in [
        "10.48550/arXiv.2401.04088",
        "https://doi.org/10.48550/arXiv.2401.04088",
        "doi:10.48550/ARXIV.2401.04088",
    ] {
        assert_eq!(parse_paper_ref(PaperRefKind::Doi, v), arxiv("2401.04088"), "{v}");
    }
    assert_eq!(
        normalize_arxiv_id("10.48550/arXiv.hep-th/9901001").as_deref(),
        Some("hep-th/9901001")
    );
}

#[test]
fn paper_ref_serializes_with_lowercase_kind() {
    let json = serde_json::to_value(parse_paper_ref(
        PaperRefKind::Url,
        "https://arxiv.org/abs/2305.12345",
    ))
    .expect("serialize");
    assert_eq!(
        json,
        serde_json::json!({ "kind": "arxiv", "value": "2305.12345" })
    );
    let zotero =
        serde_json::to_value(parse_paper_ref(PaperRefKind::Zotero, "ABCD1234")).expect("serialize");
    assert_eq!(
        zotero,
        serde_json::json!({ "kind": "zotero", "value": "ABCD1234" })
    );
}

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::time::Instant;

use wf_core::papers::page_metadata::{decode_html_entities, extract_page_metadata, page_import_refusal};

const URL: &str = "https://example.org/post";

#[test]
fn citation_tags_win_and_mark_the_page_as_a_paper() {
    let meta = extract_page_metadata(
        r#"<meta name="citation_title" content="Real &amp; True">
     <meta name="citation_author" content="Ada Lovelace"><meta name="citation_author" content="Alan Turing">
     <meta name="citation_publication_date" content="2021/05/01">
     <meta name="citation_doi" content="https://doi.org/10.1234/ABC">
     <meta property="og:title" content="Something else">"#,
        URL,
    );
    assert_eq!(meta.title.as_deref(), Some("Real & True"));
    assert_eq!(meta.authors, ["Ada Lovelace", "Alan Turing"]);
    assert_eq!(meta.year, Some(2021));
    assert_eq!(meta.doi.as_deref(), Some("10.1234/ABC"));
    assert!(meta.has_citation_meta);
    assert_eq!(page_import_refusal(&meta), None);
}

#[test]
fn a_blog_post_json_ld_gives_its_title_authors_date_and_site() {
    let meta = extract_page_metadata(
        r#"<title>Toy Models of Superposition — Transformer Circuits</title>
     <meta property="og:site_name" content="Transformer Circuits">
     <script type="application/ld+json">
       {"@context":"https://schema.org","@graph":[
         {"@type":"WebSite","name":"Transformer Circuits"},
         {"@type":["Article"],"headline":"Toy Models of Superposition",
          "author":[{"@type":"Person","name":"Nelson Elhage"},"Chris Olah"],
          "datePublished":"2022-09-14","publisher":{"name":"Anthropic"}}]}
     </script>"#,
        URL,
    );
    assert_eq!(meta.title.as_deref(), Some("Toy Models of Superposition"));
    assert_eq!(meta.authors, ["Nelson Elhage", "Chris Olah"]);
    assert_eq!(meta.year, Some(2022));
    assert_eq!(meta.venue.as_deref(), Some("Transformer Circuits"));
    assert!(meta.is_article);
    assert!(!meta.has_citation_meta);
    assert_eq!(page_import_refusal(&meta), None);
}

#[test]
fn opengraph_article_tags_alone_are_enough_and_the_site_suffix_is_dropped() {
    let meta = extract_page_metadata(
        r#"<meta property="og:type" content="article">
     <meta property="og:site_name" content="Lil'Log">
     <meta property="og:title" content="Prompt Engineering | Lil'Log">
     <meta name="author" content="Lilian Weng">
     <meta property="article:author" content="https://twitter.com/lilianweng">
     <meta property="article:published_time" content="2023-03-15T00:00:00+00:00">"#,
        URL,
    );
    assert_eq!(meta.title.as_deref(), Some("Prompt Engineering"));
    assert_eq!(meta.authors, ["Lilian Weng"]);
    assert_eq!(meta.year, Some(2023));
    assert!(meta.is_article);
}

#[test]
fn a_title_that_only_looks_like_it_has_a_suffix_keeps_it() {
    let meta = extract_page_metadata(
        r#"<meta property="og:type" content="article"><meta property="og:site_name" content="Blog">
     <title>Attention - is all you need</title>"#,
        URL,
    );
    assert_eq!(meta.title.as_deref(), Some("Attention - is all you need"));
}

#[test]
fn a_broken_json_ld_block_is_ignored_not_thrown() {
    let meta = extract_page_metadata(
        r#"<script type="application/ld+json">{not json</script><title>Home</title>"#,
        URL,
    );
    assert!(!meta.is_article);
    let refusal = page_import_refusal(&meta).unwrap_or_default();
    assert!(refusal.contains("does not look like a paper or an article"), "{refusal}");
}

#[test]
fn a_bot_wall_is_refused_by_name_even_when_it_says_it_is_an_article() {
    let meta = extract_page_metadata(
        r#"<meta property="og:type" content="article"><title>Just a moment...</title>"#,
        URL,
    );
    let refusal = page_import_refusal(&meta).unwrap_or_default();
    assert!(refusal.contains("blocked automated access"), "{refusal}");
}

#[test]
fn an_arxiv_id_is_read_from_the_page_address() {
    let meta = extract_page_metadata("<title>x</title>", "https://arxiv.org/abs/2101.00001v2");
    assert_eq!(meta.arxiv_id.as_deref(), Some("2101.00001"));
}

#[test]
fn arxiv_id_from_url_handles_versions_pdf_and_old_style_ids_in_linear_time() {
    let page = "<html></html>";
    assert_eq!(
        extract_page_metadata(page, "https://arxiv.org/abs/2305.12345v2").arxiv_id.as_deref(),
        Some("2305.12345")
    );
    assert_eq!(
        extract_page_metadata(page, "https://arxiv.org/pdf/2305.12345.pdf").arxiv_id.as_deref(),
        Some("2305.12345")
    );
    assert_eq!(
        extract_page_metadata(page, "https://arxiv.org/abs/cs/0501001").arxiv_id.as_deref(),
        Some("cs/0501001")
    );
    let started = Instant::now();
    let hostile = format!("arxiv.org/abs/{}?", "arxiv.org/abs/-".repeat(20_000));
    let _ = extract_page_metadata(page, &hostile);
    assert!(started.elapsed().as_millis() < 500, "parsing took too long");
}

#[test]
fn decode_html_entities_decodes_ampersand_last_and_drops_bad_code_points() {
    assert_eq!(decode_html_entities("&amp;lt;"), "&lt;");
    assert_eq!(decode_html_entities("&#x2014;"), "—");
    assert_eq!(decode_html_entities("&#999999999;"), "");
    assert_eq!(decode_html_entities("Tom &amp; Jerry &#8212; a study"), "Tom & Jerry — a study");
}

#[test]
fn a_title_element_has_its_entities_decoded_and_whitespace_collapsed() {
    let meta = extract_page_metadata("<title>Tom &amp; Jerry &#8212; a study</title>", URL);
    assert_eq!(meta.title.as_deref(), Some("Tom & Jerry — a study"));
    let wrapped = extract_page_metadata("<title>\n  A  wrapped\n  title\n</title>", URL);
    assert_eq!(wrapped.title.as_deref(), Some("A wrapped title"));
}

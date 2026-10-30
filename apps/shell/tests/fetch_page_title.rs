//! Tests for page titles (ported from packages/core/test/net/page-title.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use weaveforge_shell::fetch::page_title::{
    MAX_TITLE, PAGE_TITLE_SCAN_CHARS, decode_html_entities, extract_page_title,
    looks_like_image_url,
};

fn title(html: &str) -> Option<String> {
    extract_page_title(html).map(|p| p.title)
}

fn suspect(html: &str) -> Option<bool> {
    extract_page_title(html).map(|p| p.suspect)
}

#[test]
fn og_wins_because_it_is_the_site_saying_what_to_call_this_link() {
    assert_eq!(
        title(r#"<head><title>Site — Page</title><meta property="og:title" content="The Real Title"></head>"#).as_deref(),
        Some("The Real Title")
    );
}

#[test]
fn title_element_is_the_fallback() {
    assert_eq!(
        title("<html><head><title>Obsidian - Sharpen your thinking</title></head>").as_deref(),
        Some("Obsidian - Sharpen your thinking")
    );
    assert_eq!(title("<html><head></head><body>no title</body>"), None);
    assert_eq!(title("<title>   </title>"), None);
}

#[test]
fn entities_are_decoded_ampersand_last() {
    assert_eq!(
        title("<title>Tom &amp; Jerry &#8212; a study</title>").as_deref(),
        Some("Tom & Jerry — a study")
    );
    assert_eq!(decode_html_entities("&amp;lt;"), "&lt;");
    assert_eq!(decode_html_entities("&#x2014;"), "—");
    assert_eq!(decode_html_entities("&#999999999;"), "");
}

#[test]
fn whitespace_across_lines_collapses() {
    assert_eq!(
        title("<title>\n  A  wrapped\n  title\n</title>").as_deref(),
        Some("A wrapped title")
    );
}

#[test]
fn challenge_page_is_flagged_rather_than_used_silently() {
    for wall in [
        "Just a moment...",
        "Attention Required! | Cloudflare",
        "Access denied",
        "403 Forbidden",
    ] {
        assert_eq!(
            suspect(&format!("<title>{wall}</title>")),
            Some(true),
            "{wall}"
        );
    }
    assert_eq!(suspect("<title>A real article</title>"), Some(false));
}

#[test]
fn unclosed_title_element_does_not_swallow_the_document() {
    assert_eq!(title("<title>opened but never closed"), None);
}

#[test]
fn very_long_title_is_cut_rather_than_pasted_whole() {
    let long = "x".repeat(1000);
    assert_eq!(
        title(&format!("<title>{long}</title>")).map(|t| t.len()),
        Some(300)
    );
}

#[test]
fn attributes_in_any_quoting_style_are_read() {
    assert_eq!(
        title("<meta property='og:title' content='Single quoted'>").as_deref(),
        Some("Single quoted")
    );
    assert_eq!(
        title("<meta property=og:title content=Bare>").as_deref(),
        Some("Bare")
    );
}

#[test]
fn image_url_is_recognised_by_its_path_and_nothing_else_is_guessed() {
    assert!(looks_like_image_url("https://a.example/figure.png"));
    assert!(looks_like_image_url(
        "https://a.example/figure.JPEG?width=200"
    ));
    assert!(!looks_like_image_url("https://a.example/article"));
    assert!(!looks_like_image_url("https://a.example/a.png.html"));
    assert!(!looks_like_image_url("not a url"));
}

#[test]
fn an_entitys_output_is_not_decoded_again() {
    assert_eq!(decode_html_entities("&#38;lt;"), "&lt;");
    assert_eq!(decode_html_entities("&#x26;amp;"), "&amp;");
    assert_eq!(decode_html_entities("&#x26;#65;"), "&#65;");
    assert_eq!(decode_html_entities("&amp;#8212;"), "&#8212;");
    assert_eq!(decode_html_entities("&amp;amp;"), "&amp;");
    assert_eq!(decode_html_entities("&amp;lt;"), "&lt;");
    assert_eq!(
        decode_html_entities("&LT;b&GT; &Amp; &#39;x&#039; &apos;"),
        "<b> & 'x' '"
    );
    assert_eq!(
        decode_html_entities("&unknown; & alone"),
        "&unknown; & alone"
    );
}

#[test]
fn og_chain_order() {
    assert_eq!(
        title(r#"<meta name="twitter:title" content="TW">"#).as_deref(),
        Some("TW")
    );
    assert_eq!(
        title(
            r#"<meta name="twitter:title" content="TW"><meta name="citation_title" content="CT">"#
        )
        .as_deref(),
        Some("TW")
    );
    assert_eq!(
        title(r#"<meta name="citation_title" content="CT">"#).as_deref(),
        Some("CT")
    );
    assert_eq!(
        title(r#"<meta name="DC.Title" content="DC">"#).as_deref(),
        Some("DC")
    );
    assert_eq!(
        title(r#"<meta itemprop="og:title" content="IP">"#).as_deref(),
        Some("IP")
    );
    assert_eq!(
        title(
            r#"<meta property="og:title" content=""><meta property="og:title" content="Second">"#
        )
        .as_deref(),
        Some("Second")
    );
    assert_eq!(
        title(r#"<meta property="og:title" content=""><meta name="twitter:title" content="TW">"#)
            .as_deref(),
        Some("TW")
    );
}

#[test]
fn empty_property_stops_the_chain() {
    assert_eq!(
        title(r#"<meta property="" name="og:title" content="X"><title>T</title>"#).as_deref(),
        Some("T")
    );
}

#[test]
fn data_content_counts_as_content() {
    assert_eq!(
        title(r#"<meta property="og:title" data-content="D">"#).as_deref(),
        Some("D")
    );
}

#[test]
fn entities_table() {
    assert_eq!(decode_html_entities("&AMP;"), "&");
    assert_eq!(decode_html_entities("&NbSp;"), " ");
    assert_eq!(decode_html_entities("&unknown;"), "&unknown;");
    assert_eq!(decode_html_entities("&#xD800;"), "");
    assert_eq!(decode_html_entities("&#99999999999;"), "");
    assert_eq!(decode_html_entities("&#x110000;"), "");
    assert_eq!(decode_html_entities("&#65;"), "A");
    assert_eq!(decode_html_entities("&#X41;"), "A");
    assert_eq!(decode_html_entities("&#039;"), "'");
}

#[test]
fn whitespace_is_js_whitespace() {
    assert_eq!(
        title("<title>\u{FEFF}A\u{3000}B\u{85}</title>").as_deref(),
        Some("A B\u{85}")
    );
}

#[test]
fn bot_wall_is_ascii_only() {
    assert_eq!(
        suspect("<title>chec\u{212A}ing your browser</title>"),
        Some(false)
    );
    assert_eq!(suspect("<title>CHECKING YOUR BROWSER</title>"), Some(true));
    assert_eq!(suspect("<title>Error 404</title>"), Some(true));
    assert_eq!(suspect("<title>error 40</title>"), Some(false));
    assert_eq!(suspect("<title>Just a momentous day</title>"), Some(false));
    assert_eq!(suspect("<title>  please wait</title>"), Some(true));
    assert_eq!(suspect("<title>\u{FEFF}Access denied</title>"), Some(true));
}

#[test]
fn scan_limit_is_200000_utf16_units() {
    assert_eq!(PAGE_TITLE_SCAN_CHARS, 200_000);
    let far = format!("{}<title>A</title>", "x".repeat(200_000));
    assert_eq!(title(&far), None);
    let near = format!("{}<title>A</title>", "x".repeat(199_980));
    assert_eq!(title(&near).as_deref(), Some("A"));
}

#[test]
fn cut_counts_utf16_units() {
    assert_eq!(MAX_TITLE, 300);
    let emoji_over = format!("{}😀y", "x".repeat(299));
    assert_eq!(
        title(&format!("<title>{emoji_over}</title>")).as_deref(),
        Some("x".repeat(299).as_str())
    );
    let exact = format!("{}😀", "x".repeat(298));
    assert_eq!(
        title(&format!("<title>{exact}</title>")).as_deref(),
        Some(exact.as_str())
    );
}

#[test]
fn title_tag_variants() {
    assert_eq!(title(r#"<TITLE lang="en">A</TITLE>"#).as_deref(), Some("A"));
    assert_eq!(
        title("<title>a</title><title>b</title>").as_deref(),
        Some("a")
    );
    assert_eq!(title("<title>open"), None);
}

#[test]
fn image_urls() {
    assert!(looks_like_image_url("https://a.example/x.TIF"));
    assert!(looks_like_image_url("https://a.example/x.jpg"));
    assert!(looks_like_image_url("https://a.example/x.png#frag"));
    assert!(looks_like_image_url("https://a.example/x.png?y=1"));
    assert!(!looks_like_image_url("https://a.example/x.png/"));
    assert!(!looks_like_image_url("/x.png"));
}

//! Reading a page's title out of its HTML (`PageTitleFns` in `packages/core/src/shared/core-contract.ts`
//! `extractPageTitle` and `decodeHtmlEntities`). Pure string work.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::Serialize;

use crate::papers::js_regex::{compile, space_class};

/// Titles a site shows a robot rather than a reader.
const BOT_WALL_PATTERN: &str = r"(?i)^\s*(?:just a moment|attention required|access denied|client challenge|verifying your browser|are you a robot|checking your browser|please wait|security check|redirecting|error \d{3}|\d{3} (?:forbidden|not found))\b";

/// Longer than this is a page dumping its description into the title (UTF-16 units).
const MAX_TITLE: usize = 300;

/// How much of a document is scanned for a title (UTF-16 units).
pub const PAGE_TITLE_SCAN_CHARS: usize = 200_000;

// Each pattern is a literal; `None` (never reached) means no match, not a panic.
static BOT_WALL: LazyLock<Option<Regex>> = LazyLock::new(|| compile(BOT_WALL_PATTERN).ok());
static META_TAG: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)<meta\b[^>]*>").ok());
static HTML_TITLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)<title[^>]*>([\s\S]*?)</title>").ok());
static WHITESPACE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\s+").ok());
static ENTITY: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));").ok());

/// The named entities a title contains, plus numeric escapes, decoded in one
/// pass: `&amp;lt;` and `&#38;lt;` both stay `&lt;`. Unknown names stay as written.
#[must_use]
pub fn decode_html_entities(value: &str) -> String {
    let Some(re) = ENTITY.as_ref() else {
        return value.to_owned();
    };
    re.replace_all(value, |caps: &regex_lite::Captures<'_>| {
        if let Some(hex) = caps.get(1) {
            return code_point(u32::from_str_radix(hex.as_str(), 16).ok());
        }
        if let Some(digits) = caps.get(2) {
            return code_point(digits.as_str().parse::<u32>().ok());
        }
        let whole = caps.get(0).map_or("", |m| m.as_str());
        let name = caps
            .get(3)
            .map_or(String::new(), |m| m.as_str().to_ascii_lowercase());
        match name.as_str() {
            "nbsp" => " ",
            "lt" => "<",
            "gt" => ">",
            "quot" => "\"",
            "apos" => "'",
            "amp" => "&",
            _ => whole,
        }
        .to_owned()
    })
    .into_owned()
}

/// A malformed or out-of-range escape becomes nothing. A lone surrogate also
/// becomes nothing, where JS would keep it.
fn code_point(value: Option<u32>) -> String {
    value
        .and_then(char::from_u32)
        .map(String::from)
        .unwrap_or_default()
}
/// The title and whether it looks like a challenge page.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageTitle {
    /// The title, whitespace collapsed and trimmed.
    pub title: String,
    /// True when the title looks like a challenge page rather than the article.
    pub suspect: bool,
}

/// The best title the HTML offers: OpenGraph-style meta first, then `<title>`.
#[must_use]
pub fn extract_page_title(html: &str) -> Option<PageTitle> {
    let head = utf16_prefix(html, PAGE_TITLE_SCAN_CHARS);

    let og = meta_content(head, "og:title")
        .or_else(|| meta_content(head, "twitter:title"))
        .or_else(|| meta_content(head, "citation_title"))
        .or_else(|| meta_content(head, "dc.title"));

    let raw = match og {
        Some(value) => value,
        None => HTML_TITLE
            .as_ref()?
            .captures(head)?
            .get(1)?
            .as_str()
            .to_owned(),
    };

    let decoded = decode_html_entities(&raw);
    let collapsed = match WHITESPACE.as_ref() {
        Some(re) => re.replace_all(&decoded, " ").into_owned(),
        None => decoded,
    };
    let title = utf16_prefix(collapsed.trim(), MAX_TITLE);
    if title.is_empty() {
        return None;
    }

    let suspect = BOT_WALL.as_ref().is_some_and(|re| re.is_match(title));
    Some(PageTitle {
        title: title.to_owned(),
        suspect,
    })
}

/// The longest prefix of `text` within `units` UTF-16 code units. A character that
/// would straddle the limit is dropped whole, where JS would keep half a pair.
fn utf16_prefix(text: &str, units: usize) -> &str {
    let mut used = 0usize;
    for (index, ch) in text.char_indices() {
        used = used.saturating_add(ch.len_utf16());
        if used > units {
            return text.get(..index).unwrap_or(text);
        }
    }
    text
}

/// The content of a `<meta>` tag by property, name or itemprop, first non-empty wins.
fn meta_content(head: &str, wanted: &str) -> Option<String> {
    let re = META_TAG.as_ref()?;
    for found in re.find_iter(head) {
        let tag = found.as_str();
        let Some(name) = attribute(tag, "property")
            .or_else(|| attribute(tag, "name"))
            .or_else(|| attribute(tag, "itemprop"))
        else {
            continue;
        };
        if name.is_empty() || name.to_lowercase() != wanted {
            continue;
        }
        if let Some(content) = attribute(tag, "content").filter(|c| !c.is_empty()) {
            return Some(content);
        }
    }
    None
}

/// An attribute's value in any quoting style, or the bare token.
fn attribute(tag: &str, name: &str) -> Option<String> {
    capture(&format!(r#"(?i)\b{name}\s*=\s*"([^"]*)""#), tag)
        .or_else(|| capture(&format!(r"(?i)\b{name}\s*=\s*'([^']*)'"), tag))
        .or_else(|| {
            let space = space_class();
            capture(&format!(r"(?i)\b{name}\s*=\s*([^{space}>]+)"), tag)
        })
}

fn capture(pattern: &str, text: &str) -> Option<String> {
    let re = compile(pattern).ok()?;
    re.captures(text)?.get(1).map(|m| m.as_str().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn title(html: &str) -> Option<String> {
        extract_page_title(html).map(|t| t.title)
    }

    #[test]
    fn opengraph_wins_over_the_title_element() {
        assert_eq!(
            title(r#"<head><title>Site — Page</title><meta property="og:title" content="The Real Title"></head>"#)
                .as_deref(),
            Some("The Real Title")
        );
    }

    #[test]
    fn the_title_element_is_the_fallback() {
        assert_eq!(
            title("<html><head><title>Obsidian - Sharpen your thinking</title></head>").as_deref(),
            Some("Obsidian - Sharpen your thinking")
        );
        assert_eq!(title("<html><head></head><body>no title</body>"), None);
        assert_eq!(title("<title>   </title>"), None);
    }

    #[test]
    fn entities_are_decoded() {
        assert_eq!(
            title("<title>Tom &amp; Jerry &#8212; a study</title>").as_deref(),
            Some("Tom & Jerry — a study")
        );
    }

    #[test]
    fn whitespace_across_lines_collapses() {
        assert_eq!(
            title("<title>\n  A  wrapped\n  title\n</title>").as_deref(),
            Some("A wrapped title")
        );
    }

    #[test]
    fn a_challenge_page_is_flagged() {
        for wall in [
            "Just a moment...",
            "Attention Required! | Cloudflare",
            "Access denied",
            "403 Forbidden",
        ] {
            let found = extract_page_title(&format!("<title>{wall}</title>"));
            assert_eq!(found.map(|t| t.suspect), Some(true), "{wall}");
        }
        assert_eq!(
            extract_page_title("<title>A real article</title>").map(|t| t.suspect),
            Some(false)
        );
    }

    #[test]
    fn an_unclosed_title_does_not_swallow_the_document() {
        assert_eq!(title("<title>opened but never closed"), None);
    }

    #[test]
    fn a_very_long_title_is_cut_to_300_units() {
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
    fn an_entity_output_is_not_decoded_again() {
        assert_eq!(title("<title>&amp;lt;</title>").as_deref(), Some("&lt;"));
    }

    #[test]
    fn a_numeric_entity_output_is_not_decoded_again() {
        assert_eq!(decode_html_entities("&#38;lt;"), "&lt;");
        assert_eq!(decode_html_entities("&#x26;amp;"), "&amp;");
        assert_eq!(
            decode_html_entities("&unknown; &#xFFFFFFFFF; &LT;"),
            "&unknown;  <"
        );
    }

    #[test]
    fn utf16_prefix_counts_astral_characters_as_two_units() {
        assert_eq!(utf16_prefix("a😀b", 2), "a");
        assert_eq!(utf16_prefix("a😀b", 3), "a😀");
        assert_eq!(utf16_prefix("abc", 10), "abc");
    }
}

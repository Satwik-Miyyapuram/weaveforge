//! A paper on paper: every page with its marks, and (when asked) the comments beside each page.
//!
//! With comments the sheet is A4 landscape: the page on the left, its cards on the right, each
//! level with the mark it belongs to. Without, the page is A4 portrait and fitted to the sheet.
//! A paper with no comments at all prints portrait either way.
//!
//! A port of `apps/web/src/features/reader/application/reader-print.ts`. The page rasters are
//! drawn in the browser (PDF.js), so they arrive here as data URLs.

use std::sync::OnceLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use crate::text::escape_html;

/// Ink colour for the page and cards when a mark's colour is not a plain colour.
const INK: &str = "#1f2a44";

/// Longest quote kept on a card; the page itself carries the rest.
const QUOTE_LIMIT: usize = 160;

/// The print stylesheet. `@ORIENTATION@`, `@SHEET_WIDTH@` and `@SHEET_HEIGHT@` are filled in.
const STYLE: &str = "@page { size: A4 @ORIENTATION@; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #1f2a44; font-family: Rubik, system-ui, sans-serif; }
.sheet { width: @SHEET_WIDTH@mm; height: @SHEET_HEIGHT@mm; display: flex; gap: 0; align-items: flex-start; justify-content: center; break-after: page; page-break-after: always; overflow: hidden; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
.sheet > img { display: block; width: 100%; height: 100%; object-fit: contain; }
.page { height: 100%; flex: none; }
.page img { display: block; width: 100%; height: 100%; }
.margin { position: relative; height: 100%; flex: 1; min-width: 0; margin: 0 8mm 0 4mm; }
.note { position: absolute; left: 0; right: 0; border-left: 1.6mm solid; background: #fff; padding: 1mm 2mm; font-size: 8pt; line-height: 1.3; }
.note p { margin: 0; }
.note .quote { color: #5b6275; font-style: italic; margin-bottom: 1mm; }
@media screen { body { background: #e8e4da; padding: 12px; } .sheet { background: #fff; margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(0,0,0,.25); } }";

/// One comment card beside a printed page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderPrintNote {
    /// Offset from the top of the page, in the page image's own pixels.
    pub top: f64,
    pub colour: String,
    /// The marked text, when the mark was on text.
    pub quote: String,
    pub comment: String,
}

/// One printed page: its raster (marks drawn in) and its comments.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderPrintPage {
    pub image: String,
    /// The raster's size in pixels; the notes' `top` is in the same units.
    pub width: f64,
    pub height: f64,
    pub notes: Vec<ReaderPrintNote>,
}

/// The whole print: the title, the pages and whether the comments are printed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderPrintDocument {
    pub title: String,
    pub pages: Vec<ReaderPrintPage>,
    pub with_comments: bool,
}

/// What the orientation rule reads: the pages and whether comments are printed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderPrintLayoutInput {
    pub with_comments: bool,
    pub pages: Vec<ReaderPrintPage>,
}

/// The sheet's orientation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderPrintOrientation {
    Portrait,
    Landscape,
}

impl ReaderPrintOrientation {
    /// The CSS keyword for the page size.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Portrait => "portrait",
            Self::Landscape => "landscape",
        }
    }
}

/// Landscape only when there is a margin to print.
#[must_use]
pub fn reader_print_orientation(with_comments: bool, pages: &[ReaderPrintPage]) -> ReaderPrintOrientation {
    if with_comments && pages.iter().any(|page| !page.notes.is_empty()) {
        ReaderPrintOrientation::Landscape
    } else {
        ReaderPrintOrientation::Portrait
    }
}

/// A colour safe to put in a style attribute, or the ink colour.
fn safe_colour(colour: &str) -> &str {
    static COLOUR: OnceLock<Regex> = OnceLock::new();
    let re = COLOUR.get_or_init(|| {
        Regex::new(r"(?i)^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$").expect("static pattern")
    });
    if re.is_match(colour) { colour } else { INK }
}

fn note_card(note: &ReaderPrintNote, page_height: f64) -> String {
    let top = if page_height > 0.0 { note.top / page_height * 100.0 } else { 0.0 };
    let quote = note.quote.trim();
    let clipped = if quote.chars().count() > QUOTE_LIMIT {
        format!("{}\u{2026}", quote.chars().take(QUOTE_LIMIT - 1).collect::<String>())
    } else {
        quote.to_owned()
    };
    let mut card = format!(
        r#"<div class="note" style="top:{top:.3}%;border-left-color:{}">"#,
        safe_colour(&note.colour)
    );
    if !clipped.is_empty() {
        card.push_str(&format!(r#"<p class="quote">{}</p>"#, escape_html(&clipped)));
    }
    card.push_str(&format!(r#"<p class="comment">{}</p>"#, escape_html(note.comment.trim())));
    card.push_str("</div>");
    card
}

/// The whole print document, ready for a frame's `srcdoc`.
#[must_use]
pub fn reader_print_document(input: &ReaderPrintDocument) -> String {
    let orientation = reader_print_orientation(input.with_comments, &input.pages);
    let margin = orientation == ReaderPrintOrientation::Landscape;
    // No page margin and no frame: the page prints at the sheet's own size, a plain A4 to write on.
    let sheet_height = if margin { 210 } else { 297 };
    let sheet_width = if margin { 297 } else { 210 };

    let mut sheets = String::new();
    for (index, page) in input.pages.iter().enumerate() {
        let img = format!(r#"<img src="{}" alt="Page {}" />"#, page.image, index + 1);
        if !margin {
            sheets.push_str(&format!(r#"<section class="sheet">{img}</section>"#));
            continue;
        }
        let notes: String = page.notes.iter().map(|note| note_card(note, page.height)).collect();
        sheets.push_str(&format!(
            r#"<section class="sheet"><div class="page" style="aspect-ratio:{} / {}">{img}</div><div class="margin">{notes}</div></section>"#,
            page.width, page.height
        ));
    }

    let style = STYLE
        .replace("@ORIENTATION@", orientation.as_str())
        .replace("@SHEET_WIDTH@", &sheet_width.to_string())
        .replace("@SHEET_HEIGHT@", &sheet_height.to_string());
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\" /><title>{}</title>\n<style>\n{style}\n</style></head><body>{sheets}</body></html>",
        escape_html(&input.title)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(colour: &str) -> ReaderPrintNote {
        ReaderPrintNote { top: 50.0, colour: colour.into(), quote: "a line".into(), comment: "why <this>?".into() }
    }

    fn page(notes: Vec<ReaderPrintNote>) -> ReaderPrintPage {
        ReaderPrintPage { image: "data:image/jpeg;base64,AA".into(), width: 100.0, height: 200.0, notes }
    }

    fn doc(pages: Vec<ReaderPrintPage>, with_comments: bool) -> ReaderPrintDocument {
        ReaderPrintDocument { title: "Paper".into(), pages, with_comments }
    }

    #[test]
    fn comments_print_landscape_and_only_when_there_are_any() {
        assert_eq!(reader_print_orientation(true, &[page(vec![note("#ffd400")])]).as_str(), "landscape");
        assert_eq!(reader_print_orientation(true, &[page(vec![])]).as_str(), "portrait");
        assert_eq!(reader_print_orientation(false, &[page(vec![note("#ffd400")])]).as_str(), "portrait");
    }

    #[test]
    fn cards_sit_beside_the_page_level_with_their_mark() {
        let html = reader_print_document(&doc(vec![page(vec![note("#ffd400")])], true));
        assert!(html.contains("size: A4 landscape"));
        assert!(html.contains(r#"class="note" style="top:25.000%"#));
        assert!(html.contains("why &lt;this&gt;?"));
    }

    #[test]
    fn without_comments_the_page_fits_a_portrait_sheet_and_no_card_is_drawn() {
        let html = reader_print_document(&doc(vec![page(vec![note("#ffd400")]), page(vec![])], false));
        assert!(html.contains("size: A4 portrait"));
        assert!(!html.contains(r#"class="note""#));
        assert_eq!(html.matches(r#"class="sheet""#).count(), 2);
    }

    #[test]
    fn a_colour_that_is_not_a_colour_does_not_reach_the_style_attribute() {
        let html = reader_print_document(&doc(vec![page(vec![note(r#"red;background:url("x")"#)])], true));
        assert!(!html.contains("url("));
        assert!(html.contains("border-left-color:#1f2a44"));
    }

    #[test]
    fn a_sheet_is_a_bare_a4_with_no_page_margin_or_frame() {
        let html = reader_print_document(&doc(vec![page(vec![note("#ffd400")])], true));
        assert!(html.contains("margin: 0; }"));
        assert!(!html.contains("img { display: block; width: 100%; height: 100%; object-fit: contain; border"));
    }

    #[test]
    fn title_and_comment_are_escaped() {
        let nasty = r#"a & b <i>"x"</i>"#;
        let input = ReaderPrintDocument {
            title: nasty.into(),
            pages: vec![page(vec![ReaderPrintNote { top: 0.0, colour: "#000".into(), quote: nasty.into(), comment: nasty.into() }])],
            with_comments: true,
        };
        let html = reader_print_document(&input);
        assert!(html.contains("<title>a &amp; b &lt;i&gt;&quot;x&quot;&lt;/i&gt;</title>"));
        assert!(!html.contains("<i>"));
    }
}

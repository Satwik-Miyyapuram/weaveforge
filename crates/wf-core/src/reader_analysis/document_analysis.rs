//! The full analysis pass over a PDF's text layer and links: lines, columns,
//! sections, the bibliography, every citation and figure mention, and a text
//! fingerprint. A faithful port of
//! packages/core/src/features/reader/analysis/document-analysis.ts.
//!
//! The stages run in the order the signals depend on each other: items into
//! lines, columns and reading order, furniture removal, headings, the
//! bibliography span and its entries, then citations and figure mentions.

#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

use serde::{Deserialize, Serialize};

use super::bibliography::parse_bibliography;
use super::citation_matcher::{PageCitationInput, match_page_citations};
use super::figure_mentions::{FigureMention, FigurePage, find_figure_mentions};
use super::headings::{find_heading_lines, heading_outline};
use super::lines::{
    AnalysisPageTextItem, AnalysisTaggedLine, AnalysisTextLine, AnalysisTextRun, detect_columns,
    page_text_from_items, reconstruct_lines, sort_by_reading_order_indices,
};
use super::outline::{
    OutlinePageRef, OutlineReaderItem, OutlineTextItem, body_font_size, is_rotated_text,
    outline_is_plausible,
};
use super::reference_section::find_reference_section;
use super::running_heads::furniture_lines;
use super::text::{AnalysisPdfItem, text_fingerprint};
use super::types::{
    AnalysisCitationMention, AnalysisPageTextRange, AnalysisParsedReference, AnalysisPdfPage,
};
use crate::ink::js_math;

/// Per-page facts the rest of the app may want (`PageAnalysis`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PageAnalysis {
    /// 1-based page number.
    pub page_number: f64,
    /// The page text, items concatenated with `\n` after each `hasEOL` item.
    pub text: String,
    /// Columns detected on the page; 1 for a single-column page.
    pub columns: f64,
}

/// Everything one analysis pass yields (`DocumentAnalysis`). Plain data only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct DocumentAnalysis {
    /// One entry per input page.
    pub pages: Vec<PageAnalysis>,
    /// The PDF's own outline, or the inferred one when it has none.
    pub sections: Vec<OutlineReaderItem>,
    /// Parsed bibliography entries.
    pub references: Vec<AnalysisParsedReference>,
    /// Every citation mention, page by page.
    pub citations: Vec<AnalysisCitationMention>,
    /// Every figure, table, equation, section and algorithm mention.
    pub figures: Vec<FigureMention>,
    /// Fingerprint of the page texts.
    pub fingerprint: String,
}

/// A count as the `f64` JS numbers use; counts stay far below 2^32.
fn count_f64(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}

/// The span of the page text each page's bibliography lines cover (`rangesOf`),
/// in first-seen page order as the TS `Map` keeps it.
fn ranges_of(lines: &[AnalysisTextLine]) -> Vec<AnalysisPageTextRange> {
    let mut ranges: Vec<AnalysisPageTextRange> = Vec::new();
    for line in lines {
        match ranges.iter_mut().find(|range| range.page == line.page) {
            Some(range) => {
                range.start = js_math::min(range.start, line.start);
                range.end = js_math::max(range.end, line.end);
            }
            None => ranges.push(AnalysisPageTextRange {
                page: line.page,
                start: js_math::min(f64::INFINITY, line.start),
                end: js_math::max(0.0, line.end),
            }),
        }
    }
    ranges
}

/// pdf.js transform to the outline parsers' item, font size from the matrix (`outlineItemOf`).
#[must_use]
pub fn outline_item_of(item: &AnalysisPdfItem, page: f64) -> OutlineTextItem {
    let at = |i: usize| item.transform.get(i).copied().unwrap_or(0.0);
    OutlineTextItem {
        str: item.str.clone(),
        font_size: at(2).hypot(at(3)),
        font_name: item.font_name.clone().filter(|name| !name.is_empty()),
        x: at(4),
        y: at(5),
        page,
        rotated: is_rotated_text(&item.transform).then_some(true),
    }
}

/// The item as line reconstruction reads it.
fn line_item_of(item: &AnalysisPdfItem) -> AnalysisPageTextItem {
    AnalysisPageTextItem {
        str: item.str.clone(),
        transform: item.transform.clone(),
        width: item.width,
        has_eol: Some(item.has_eol),
        font_name: item.font_name.clone(),
    }
}

/// The page text, items joined with `\n` after each `hasEOL` item.
fn page_text(items: &[AnalysisPdfItem]) -> String {
    let runs: Vec<AnalysisTextRun> = items
        .iter()
        .map(|item| AnalysisTextRun {
            str: item.str.clone(),
            has_eol: Some(item.has_eol),
        })
        .collect();
    page_text_from_items(&runs)
}

/// Every page's lines in reading order, and each page's column count.
fn ordered_lines(pages: &[AnalysisPdfPage]) -> (Vec<AnalysisTextLine>, Vec<f64>) {
    let mut tagged: Vec<AnalysisTaggedLine> = Vec::new();
    let mut columns_by_page: Vec<f64> = Vec::with_capacity(pages.len());
    for page in pages {
        let items: Vec<AnalysisPageTextItem> = page.items.iter().map(line_item_of).collect();
        // Rotated runs (arXiv's side stamp) are never body or headings. Kept out
        // by predicate, not filtered, so line offsets still index the page text.
        let keep: Vec<bool> = page
            .items
            .iter()
            .map(|item| !is_rotated_text(&item.transform))
            .collect();
        let lines = reconstruct_lines(page.page_number, &items, Some(keep.as_slice()));
        let columns = detect_columns(&lines);
        columns_by_page.push(
            columns
                .iter()
                .fold(1.0, |most, c| js_math::max(most, c + 1.0)),
        );
        for (j, line) in lines.into_iter().enumerate() {
            let column = columns.get(j).copied().unwrap_or(0.0);
            tagged.push(AnalysisTaggedLine { line, column });
        }
    }
    let ordered = sort_by_reading_order_indices(&tagged)
        .into_iter()
        .filter_map(|i| tagged.get(i).map(|t| t.line.clone()))
        .collect();
    (ordered, columns_by_page)
}

/// Sections: the PDF's own outline, else the heading outline when it is plausible.
fn sections_of(
    ordered: &[AnalysisTextLine],
    furniture: &[bool],
    body: f64,
    page_count: f64,
    outline: &[OutlineReaderItem],
) -> Vec<OutlineReaderItem> {
    if !outline.is_empty() {
        return outline.to_vec();
    }
    let furniture_refs: Vec<&AnalysisTextLine> = ordered
        .iter()
        .zip(furniture)
        .filter_map(|(line, &is_furniture)| is_furniture.then_some(line))
        .collect();
    let headings = find_heading_lines(ordered, body, &furniture_refs);
    let refs: Vec<OutlinePageRef> = headings
        .iter()
        .map(|line| OutlinePageRef { page: line.page })
        .collect();
    if outline_is_plausible(&refs, page_count) {
        heading_outline(&headings)
    } else {
        Vec::new()
    }
}

/// The analysis of a document with no pages (TS `EMPTY`).
fn empty_analysis() -> DocumentAnalysis {
    DocumentAnalysis {
        pages: Vec::new(),
        sections: Vec::new(),
        references: Vec::new(),
        citations: Vec::new(),
        figures: Vec::new(),
        fingerprint: text_fingerprint(&[]),
    }
}

/// Analyzes a document's pages (`analyzePdfDocument`). `outline` is the PDF's own
/// bookmarks when it has them; empty means sections come from the heading analysis.
#[must_use]
pub fn analyze_pdf_document(
    pages: &[AnalysisPdfPage],
    outline: &[OutlineReaderItem],
) -> DocumentAnalysis {
    if pages.is_empty() {
        return empty_analysis();
    }
    let texts: Vec<String> = pages.iter().map(|page| page_text(&page.items)).collect();
    let outline_pages: Vec<Vec<OutlineTextItem>> = pages
        .iter()
        .map(|page| {
            page.items
                .iter()
                .map(|item| outline_item_of(item, page.page_number))
                .collect()
        })
        .collect();
    let body = body_font_size(&outline_pages);
    let page_count = count_f64(pages.len());
    let (ordered, columns_by_page) = ordered_lines(pages);
    let furniture = furniture_lines(&ordered);
    let sections = sections_of(&ordered, &furniture, body, page_count, outline);

    let span = find_reference_section(&ordered, body, page_count, Some(furniture.as_slice()));
    let reference_lines: &[AnalysisTextLine] = span
        .and_then(|s| index_range(&ordered, s.start, s.end))
        .unwrap_or(&[]);
    let references = parse_bibliography(reference_lines, true);
    let reference_ranges = ranges_of(reference_lines);

    let mut citations: Vec<AnalysisCitationMention> = Vec::new();
    let mut page_analyses: Vec<PageAnalysis> = Vec::with_capacity(pages.len());
    for (((page, text), items), columns) in pages
        .iter()
        .zip(&texts)
        .zip(&outline_pages)
        .zip(&columns_by_page)
    {
        let input = PageCitationInput {
            number: page.page_number,
            text: text.clone(),
            items: page.items.clone(),
            outline_items: items.clone(),
            links: Some(page.links.clone().unwrap_or_default()),
        };
        citations.extend(match_page_citations(&input, &references, &reference_ranges));
        page_analyses.push(PageAnalysis {
            page_number: page.page_number,
            text: text.clone(),
            columns: *columns,
        });
    }

    // One document-wide call: a caption is usually on a different page from the mention.
    let figure_pages: Vec<FigurePage> = pages
        .iter()
        .zip(&texts)
        .zip(&outline_pages)
        .map(|((page, text), items)| FigurePage {
            number: page.page_number,
            text: text.clone(),
            items: items.clone(),
        })
        .collect();
    let figures = find_figure_mentions(&figure_pages, Some(sections.as_slice()));

    DocumentAnalysis {
        pages: page_analyses,
        sections,
        references,
        citations,
        figures,
        fingerprint: text_fingerprint(&texts),
    }
}

/// `lines.slice(start, end)` for the span's JS-number indices.
fn index_range(lines: &[AnalysisTextLine], start: f64, end: f64) -> Option<&[AnalysisTextLine]> {
    let to_index = |v: f64| usize::try_from(js_math::max(0.0, v).trunc() as u64).ok();
    let from = to_index(start)?.min(lines.len());
    let to = to_index(end)?.min(lines.len());
    lines.get(from..to.max(from))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str, x: f64, y: f64, eol: bool) -> AnalysisPdfItem {
        AnalysisPdfItem {
            str: text.to_string(),
            transform: vec![10.0, 0.0, 0.0, 10.0, x, y],
            width: 50.0,
            height: 10.0,
            has_eol: eol,
            font_ascent: None,
            font_descent: None,
            font_name: None,
        }
    }

    fn line(page: f64, start: f64, end: f64) -> AnalysisTextLine {
        AnalysisTextLine {
            page,
            text: String::new(),
            x: 0.0,
            y: 0.0,
            right: 0.0,
            font_size: 10.0,
            bold: false,
            start,
            end,
        }
    }

    #[test]
    fn no_pages_gives_the_empty_analysis() {
        let result = analyze_pdf_document(&[], &[]);
        assert!(result.pages.is_empty());
        assert_eq!(result.fingerprint, text_fingerprint(&[]));
    }

    #[test]
    fn single_page_reports_text_and_one_column() {
        let page = AnalysisPdfPage {
            page_number: 1.0,
            items: vec![
                item("Hello world", 72.0, 700.0, true),
                item("Second line", 72.0, 686.0, false),
            ],
            links: None,
        };
        let result = analyze_pdf_document(&[page], &[]);
        assert_eq!(result.pages.len(), 1);
        assert_eq!(result.pages[0].text, "Hello world\nSecond line");
        assert_eq!(result.pages[0].columns, 1.0);
        assert_eq!(
            result.fingerprint,
            text_fingerprint(&["Hello world\nSecond line".to_string()])
        );
    }

    #[test]
    fn given_outline_wins_over_headings() {
        let outline = vec![OutlineReaderItem {
            title: "Intro".to_string(),
            page_number: Some(1.0),
            y: None,
            items: None,
        }];
        let page = AnalysisPdfPage {
            page_number: 1.0,
            items: vec![item("Body", 72.0, 700.0, false)],
            links: None,
        };
        assert_eq!(analyze_pdf_document(&[page], &outline).sections, outline);
    }

    #[test]
    fn ranges_keep_first_seen_page_order() {
        let ranges = ranges_of(&[
            line(3.0, 10.0, 20.0),
            line(2.0, 5.0, 9.0),
            line(3.0, 4.0, 30.0),
        ]);
        assert_eq!(ranges.len(), 2);
        assert_eq!(
            (ranges[0].page, ranges[0].start, ranges[0].end),
            (3.0, 4.0, 30.0)
        );
        assert_eq!(
            (ranges[1].page, ranges[1].start, ranges[1].end),
            (2.0, 5.0, 9.0)
        );
    }

    #[test]
    fn outline_item_takes_size_from_the_matrix() {
        let mut raw = item("x", 5.0, 6.0, false);
        raw.transform = vec![3.0, 4.0, 3.0, 4.0, 5.0, 6.0];
        let out = outline_item_of(&raw, 2.0);
        assert_eq!(
            (out.font_size, out.x, out.y, out.page),
            (5.0, 5.0, 6.0, 2.0)
        );
    }
}

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
    use crate::reader_analysis::figure_mentions::FigureMentionKind;
    use crate::reader_analysis::types::{AnalysisLinkDest, AnalysisPdfLink, AnalysisTextSpan};

    struct Row {
        text: String,
        x: f64,
        bold: bool,
        size: f64,
    }

    fn row(text: &str) -> Row {
        Row {
            text: text.to_string(),
            x: 40.0,
            bold: false,
            size: 10.0,
        }
    }

    fn heading(text: &str) -> Row {
        Row {
            text: text.to_string(),
            x: 40.0,
            bold: true,
            size: 12.0,
        }
    }

    fn glyph(text: &str, x: f64, y: f64, size: f64, bold: bool, has_eol: bool) -> AnalysisPdfItem {
        AnalysisPdfItem {
            str: text.to_string(),
            transform: vec![size, 0.0, 0.0, size, x, y],
            width: count_f64(text.chars().count()) * size * 0.5,
            height: size,
            has_eol,
            font_ascent: None,
            font_descent: None,
            font_name: bold.then(|| "ABCDEF+Title-Bold".to_string()),
        }
    }

    fn run(text: &str, x: f64, y: f64, has_eol: bool) -> AnalysisPdfItem {
        glyph(text, x, y, 10.0, false, has_eol)
    }

    /// Rows top to bottom from y 720 in steps of 15 (`textPage`).
    fn text_page(page_number: f64, rows: &[Row]) -> AnalysisPdfPage {
        let mut y = 720.0;
        let items = rows
            .iter()
            .map(|r| {
                y -= 15.0;
                glyph(&r.text, r.x, y, r.size, r.bold, true)
            })
            .collect();
        AnalysisPdfPage {
            page_number,
            items,
            links: None,
        }
    }

    fn body(page_number: f64) -> AnalysisPdfPage {
        let rows: Vec<Row> = (0..8)
            .map(|i| row(&format!("Body prose {i} about the method.")))
            .collect();
        text_page(page_number, &rows)
    }

    const SURNAMES: [&str; 20] = [
        "Anderson", "Baker", "Clarke", "Davis", "Evans", "Freeman", "Gupta", "Harris", "Ivanov",
        "Jones", "Kim", "Lee", "Miller", "Nakamura", "Olsen", "Patel", "Quinn", "Rossi",
        "Schmidt", "Tanaka",
    ];

    /// A numbered bibliography, one entry per line (`numberedReferences`).
    fn numbered_refs(count: usize, heading_text: &str) -> Vec<Row> {
        let mut rows = vec![heading(heading_text)];
        rows.extend((0..count).map(|i| {
            row(&format!(
                "[{}] {}, A. {}. A useful method {}. In Proceedings of Test {}.",
                i + 1,
                SURNAMES[i % SURNAMES.len()],
                1990 + i,
                i + 1,
                i + 1
            ))
        }));
        rows
    }

    /// An APA-shaped bibliography (`authorYearReferences`).
    fn author_year_refs(entries: &[(&str, u32, Option<&str>)]) -> Vec<Row> {
        let mut rows = vec![heading("References")];
        rows.extend(entries.iter().map(|(surname, year, title)| {
            let title = match *title {
                Some(t) => t.to_string(),
                None => format!("{surname} work {year}"),
            };
            row(&format!("{surname}, A. ({year}). {title}. Journal of Tests."))
        }));
        rows
    }

    fn rect_over(text: &str, x: f64, y: f64) -> [f64; 4] {
        let width = count_f64(text.chars().count()) * 5.0;
        [x - 1.0, y - 2.0, x + width + 1.0, y + 12.0]
    }

    fn link(rect: [f64; 4]) -> AnalysisPdfLink {
        AnalysisPdfLink {
            rect,
            url: None,
            dest: None,
            text_ranges: None,
            dest_name: None,
        }
    }

    fn dest(page: f64, y: f64) -> Option<AnalysisLinkDest> {
        Some(AnalysisLinkDest {
            page,
            x: Some(40.0),
            y: Some(y),
        })
    }

    fn cites_on(analysis: &DocumentAnalysis, page: f64) -> Vec<&AnalysisCitationMention> {
        analysis.citations.iter().filter(|c| c.page == page).collect()
    }

    #[test]
    fn ieee_numeric_citations_resolve_to_the_numbered_list() {
        let pages = vec![
            text_page(
                1.0,
                &[
                    row("As shown in [1] and [2, 3], the method works."),
                    row("Others disagree [4-5]."),
                ],
            ),
            body(2.0),
            text_page(3.0, &numbered_refs(6, "References")),
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        assert_eq!(analysis.references.len(), 6);
        assert_eq!(analysis.references[0].authors, vec!["Anderson".to_string()]);
        assert_eq!(
            analysis.references[0].venue.as_deref(),
            Some("Proceedings of Test 1")
        );
        let cites = cites_on(&analysis, 1.0);
        let got: Vec<(&str, Vec<f64>, &str)> = cites
            .iter()
            .map(|c| (c.text.as_str(), c.reference_indexes.clone(), c.source.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("[1]", vec![1.0], "numeric"),
                ("[2, 3]", vec![2.0, 3.0], "numeric"),
                ("[4-5]", vec![4.0, 5.0], "numeric"),
            ]
        );
        // A bracket naming several entries is less certain than one naming one.
        assert!(cites.iter().all(|c| c.confidence >= 0.72));
        assert!(cites.iter().all(|c| c.rects.first().is_some_and(|r| r.len() == 4)));
    }

    #[test]
    fn apa_harvard_author_year_citations_groups_and_narrative_forms() {
        let pages = vec![
            text_page(
                1.0,
                &[
                    row("The effect replicates (Smith 2020; Jones 2021)."),
                    row("Smith et al. (2020) agree, and Jones (2021) extends it."),
                ],
            ),
            body(2.0),
            text_page(
                3.0,
                &author_year_refs(&[("Smith", 2020, None), ("Jones", 2021, None), ("Lee", 2019, None)]),
            ),
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        assert_eq!(analysis.references.len(), 3);
        let cites = cites_on(&analysis, 1.0);
        // A group is one mention per work, as the Scholar reader paints it.
        let got: Vec<(&str, Vec<f64>)> = cites
            .iter()
            .map(|c| (c.text.as_str(), c.reference_indexes.clone()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("Smith 2020", vec![1.0]),
                ("Jones 2021)", vec![2.0]),
                ("Smith et al. (2020)", vec![1.0]),
                ("Jones (2021)", vec![2.0]),
            ]
        );
        assert!(cites.iter().all(|c| c.source == "author-year"));
    }

    #[test]
    fn year_2020a_2020b_pairs_both_match_a_suffix_less_citation() {
        let pages = vec![
            text_page(
                1.0,
                &[
                    row("As Smith (2020) shows, the effect is real."),
                    row("Jones (2021) replicates the finding."),
                ],
            ),
            body(2.0),
            text_page(
                3.0,
                &author_year_refs(&[
                    ("Smith", 2020, Some("First study")),
                    ("Smith", 2020, Some("Second study")),
                    ("Jones", 2021, Some("Another study")),
                ]),
            ),
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        assert_eq!(analysis.references.len(), 3);
        let smith = cites_on(&analysis, 1.0)
            .into_iter()
            .find(|c| c.text.starts_with("Smith"));
        assert_eq!(smith.map(|c| c.reference_indexes.clone()), Some(vec![1.0, 2.0]));
    }

    #[test]
    fn citations_split_across_pdf_text_items_and_over_line_breaks() {
        let split = AnalysisPdfPage {
            page_number: 1.0,
            items: vec![
                run("Result in [", 40.0, 700.0, false),
                run("5", 95.0, 700.0, false),
                run("] holds, and [6,", 100.0, 700.0, true),
                run("7] holds too.", 40.0, 685.0, true),
            ],
            links: None,
        };
        let pages = vec![split, body(2.0), text_page(3.0, &numbered_refs(8, "References"))];
        let analysis = analyze_pdf_document(&pages, &[]);
        let got: Vec<Vec<f64>> = cites_on(&analysis, 1.0)
            .iter()
            .map(|c| c.reference_indexes.clone())
            .collect();
        assert_eq!(got, vec![vec![5.0], vec![6.0, 7.0]]);
    }

    #[test]
    fn two_column_pages_are_read_in_column_order_and_cite_from_both_columns() {
        let mut items = Vec::new();
        for i in 0..4 {
            let text = if i == 2 {
                "Left column cites [1] here.".to_string()
            } else {
                format!("Left column prose line {i}.")
            };
            items.push(run(&text, 40.0, 700.0 - 15.0 * count_f64(i), true));
        }
        for i in 0..4 {
            let text = if i == 1 {
                "Right column cites [2] here.".to_string()
            } else {
                format!("Right column prose line {i}.")
            };
            items.push(run(&text, 320.0, 700.0 - 15.0 * count_f64(i), true));
        }
        let pages = vec![
            AnalysisPdfPage {
                page_number: 1.0,
                items,
                links: None,
            },
            body(2.0),
            text_page(3.0, &numbered_refs(3, "References")),
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        assert_eq!(analysis.pages[0].columns, 2.0);
        let got: Vec<Vec<f64>> = cites_on(&analysis, 1.0)
            .iter()
            .map(|c| c.reference_indexes.clone())
            .collect();
        assert_eq!(got, vec![vec![1.0], vec![2.0]]);
    }

    #[test]
    fn references_split_across_pages_still_resolve() {
        let pages = vec![
            text_page(1.0, &[row("Prior work [5] motivates this.")]),
            body(2.0),
            text_page(3.0, &numbered_refs(3, "References")),
            text_page(
                4.0,
                &[
                    row("[4] Evans, A. 2000. Later work. Venue."),
                    row("[5] Freeman, A. 2001. Later work. Venue."),
                    row("[6] Gupta, A. 2002. Later work. Venue."),
                ],
            ),
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        assert_eq!(analysis.references.len(), 6);
        let pages_of: Vec<f64> = analysis.references.iter().map(|r| r.page).collect();
        assert_eq!(pages_of, vec![3.0, 3.0, 3.0, 4.0, 4.0, 4.0]);
        let cite = cites_on(&analysis, 1.0).into_iter().next();
        assert_eq!(cite.map(|c| c.reference_indexes.clone()), Some(vec![5.0]));
    }

    #[test]
    fn internal_pdf_dest_links_are_authoritative_over_regex_parsing() {
        // The text layer splits `[16]` into `[`, `16`, zero-width space, `]` — the
        // regex cannot read it back; only the document's own link can.
        let mut zero_width = run("\u{200b}", 150.0, 500.0, false);
        zero_width.width = 0.0;
        let refs = text_page(3.0, &numbered_refs(20, "References"));
        let page = AnalysisPdfPage {
            page_number: 1.0,
            items: vec![
                run("memory [", 100.0, 500.0, false),
                run("16", 140.0, 500.0, false),
                zero_width,
                run("] and more", 150.0, 500.0, true),
            ],
            links: Some(vec![
                // hyperref names its destination; the box alone says nothing about the text.
                AnalysisPdfLink {
                    dest: dest(3.0, refs.items[16].transform[5] + 1.0),
                    dest_name: Some("cite.entry16".to_string()),
                    ..link([139.0, 498.0, 151.0, 510.0])
                },
                AnalysisPdfLink {
                    url: Some("https://example.org".to_string()),
                    ..link([300.0, 498.0, 310.0, 510.0])
                },
            ]),
        };
        let analysis = analyze_pdf_document(&[page, body(2.0), refs], &[]);
        let cites = cites_on(&analysis, 1.0);
        assert_eq!(cites.len(), 1);
        assert_eq!(cites[0].reference_indexes, vec![16.0]);
        assert_eq!(cites[0].source, "internal-pdf-link");
        assert_eq!(cites[0].confidence, 1.0);
        assert!(!cites[0].rects.is_empty());
    }

    #[test]
    fn an_internal_link_whose_destination_is_unknown_falls_back_to_its_printed_label() {
        let page = AnalysisPdfPage {
            page_number: 1.0,
            items: vec![run("See [3] for details.", 40.0, 600.0, true)],
            links: Some(vec![AnalysisPdfLink {
                dest: Some(AnalysisLinkDest {
                    page: 9.0,
                    x: Some(40.0),
                    y: Some(700.0),
                }),
                text_ranges: Some(vec![AnalysisTextSpan {
                    start: 4.0,
                    end: 7.0,
                }]),
                ..link(rect_over("[3]", 60.0, 600.0))
            }]),
        };
        let analysis = analyze_pdf_document(
            &[page, body(2.0), text_page(3.0, &numbered_refs(5, "References"))],
            &[],
        );
        let cites = cites_on(&analysis, 1.0);
        assert_eq!(cites.len(), 1);
        assert_eq!(cites[0].reference_indexes, vec![3.0]);
        assert_eq!(cites[0].source, "internal-pdf-link");
        assert_eq!(cites[0].text, "[3]");
    }

    #[test]
    fn an_author_year_citation_hyperref_splits_into_two_links_is_one_mention() {
        // natbib draws one box over `Kingma & Welling` and another over `2014`;
        // both name the same entry, and the reader shows one citation.
        let text = "(VAE; Kingma & Welling (2014)) is a top-down generative network with";
        let page = AnalysisPdfPage {
            page_number: 1.0,
            items: vec![run(text, 40.0, 600.0, true)],
            links: Some(vec![
                AnalysisPdfLink {
                    dest: dest(3.0, 705.0),
                    dest_name: Some("cite.kingma2014".to_string()),
                    text_ranges: Some(vec![AnalysisTextSpan {
                        start: 6.0,
                        end: 22.0,
                    }]),
                    ..link(rect_over("Kingma & Welling", 70.0, 600.0))
                },
                AnalysisPdfLink {
                    dest: dest(3.0, 705.0),
                    dest_name: Some("cite.kingma2014".to_string()),
                    text_ranges: Some(vec![AnalysisTextSpan {
                        start: 24.0,
                        end: 28.0,
                    }]),
                    ..link(rect_over("2014", 160.0, 600.0))
                },
            ]),
        };
        let refs = text_page(
            3.0,
            &author_year_refs(&[
                ("Kingma", 2014, Some("Auto-encoding variational bayes")),
                ("Rezende", 2014, None),
                ("Higgins", 2017, None),
            ]),
        );
        let analysis = analyze_pdf_document(&[page, body(2.0), refs], &[]);
        let cites = cites_on(&analysis, 1.0);
        assert_eq!(cites.len(), 1);
        assert_eq!(cites[0].text, "Kingma & Welling (2014)");
        assert_eq!(cites[0].source, "internal-pdf-link");
        assert_eq!(cites[0].native_rects.as_ref().map(Vec::len), Some(2));
    }

    #[test]
    fn figure_table_and_equation_mentions_resolve_to_their_captions() {
        let pages = vec![
            text_page(1.0, &[row("As Fig. 2 shows, and Table 1 lists, Eq. (3) holds.")]),
            AnalysisPdfPage {
                page_number: 2.0,
                items: vec![
                    run("Figure 2: The result.", 40.0, 700.0, true),
                    run("Table 1: The numbers.", 40.0, 500.0, true),
                    run("some math", 40.0, 300.0, false),
                    run("(3)", 500.0, 300.0, true),
                ],
                links: None,
            },
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        let kinds: Vec<(FigureMentionKind, f64)> = analysis
            .figures
            .iter()
            .map(|f| (f.kind, f.target.page))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (FigureMentionKind::Figure, 2.0),
                (FigureMentionKind::Table, 2.0),
                (FigureMentionKind::Equation, 2.0),
            ]
        );
    }

    #[test]
    fn non_english_reference_headings_are_found() {
        for heading_text in ["Referencias", "Literaturverzeichnis", "Références", "Referências"] {
            let pages = vec![
                text_page(1.0, &[row("Como se muestra en [1].")]),
                body(2.0),
                text_page(3.0, &numbered_refs(3, heading_text)),
            ];
            let analysis = analyze_pdf_document(&pages, &[]);
            assert_eq!(analysis.references.len(), 3, "{heading_text}");
            let got: Vec<Vec<f64>> = cites_on(&analysis, 1.0)
                .iter()
                .map(|c| c.reference_indexes.clone())
                .collect();
            assert_eq!(got, vec![vec![1.0]], "{heading_text}");
        }
    }

    #[test]
    fn a_paper_without_any_references_heading_is_parsed_by_its_numbered_run() {
        let pages = vec![
            text_page(1.0, &[row("Prior work [2] suggests this.")]),
            body(2.0),
            body(3.0),
            body(4.0),
            text_page(
                5.0,
                &[
                    row("1 Smith, A. 1999. Work 1. Venue."),
                    row("2 Baker, A. 2000. Work 2. Venue."),
                    row("3 Clarke, A. 2001. Work 3. Venue."),
                    row("4 Davis, A. 2002. Work 4. Venue."),
                ],
            ),
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        assert_eq!(analysis.references.len(), 4);
        let got: Vec<Vec<f64>> = cites_on(&analysis, 1.0)
            .iter()
            .map(|c| c.reference_indexes.clone())
            .collect();
        assert_eq!(got, vec![vec![2.0]]);
    }

    #[test]
    fn equations_dates_and_measurements_are_never_citations() {
        let pages = vec![
            text_page(
                1.0,
                &[
                    row("The unit interval [0, 1] and [10 mm] of margin."),
                    row("In (2019) it was summer; Eq. (2) defines h with h1 exponents."),
                    row("A 5% gain on [3]."), // the only real citation
                ],
            ),
            body(2.0),
            text_page(3.0, &numbered_refs(4, "References")),
        ];
        let analysis = analyze_pdf_document(&pages, &[]);
        let got: Vec<(&str, Vec<f64>)> = cites_on(&analysis, 1.0)
            .iter()
            .map(|c| (c.text.as_str(), c.reference_indexes.clone()))
            .collect();
        assert_eq!(got, vec![("[3]", vec![3.0])]);
    }

    #[test]
    fn sections_come_from_the_supplied_outline_or_from_headings_when_absent() {
        let pages = vec![
            text_page(
                1.0,
                &[
                    heading("1 Introduction"),
                    row("Intro prose."),
                    heading("2 Method"),
                    row("Method prose."),
                    heading("3 Results"),
                    row("Results prose."),
                ],
            ),
            body(2.0),
            text_page(3.0, &numbered_refs(3, "References")),
        ];
        let inferred = analyze_pdf_document(&pages, &[]);
        // The References heading closes the outline, as in `outlineFromText`.
        let titles: Vec<&str> = inferred.sections.iter().take(3).map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["1 Introduction", "2 Method", "3 Results"]);
        let outline = vec![OutlineReaderItem {
            title: "Bookmark".to_string(),
            page_number: Some(1.0),
            y: None,
            items: None,
        }];
        assert_eq!(analyze_pdf_document(&pages, &outline).sections, outline);
    }

    #[test]
    fn running_heads_are_not_mistaken_for_sections_or_entries() {
        let head = "Smith et al. · Preprint";
        let mut pages: Vec<AnalysisPdfPage> = (1..=4)
            .map(|i| {
                let mut rows = vec![Row {
                    text: format!("{head} {i}"),
                    x: 40.0,
                    bold: false,
                    size: 10.0,
                }];
                if i == 1 {
                    rows.extend([
                        heading("1 Introduction"),
                        row("Prose [1]."),
                        heading("2 Method"),
                        row("Prose."),
                        heading("3 Results"),
                        row("Prose."),
                    ]);
                } else {
                    rows.push(row("More prose."));
                }
                text_page(f64::from(i), &rows)
            })
            .collect();
        pages.push(text_page(5.0, &numbered_refs(3, "References")));
        let analysis = analyze_pdf_document(&pages, &[]);
        assert!(!analysis.sections.iter().any(|s| s.title.contains("Preprint")));
        let got: Vec<Vec<f64>> = cites_on(&analysis, 1.0)
            .iter()
            .map(|c| c.reference_indexes.clone())
            .collect();
        assert_eq!(got, vec![vec![1.0]]);
    }

    #[test]
    fn the_fingerprint_is_stable_and_text_survives_on_every_page() {
        let pages = vec![
            text_page(1.0, &[row("Hello [1].")]),
            body(2.0),
            text_page(3.0, &numbered_refs(2, "References")),
        ];
        let a = analyze_pdf_document(&pages, &[]);
        let b = analyze_pdf_document(&pages, &[]);
        assert_eq!(a.fingerprint, b.fingerprint);
        assert_eq!(a.fingerprint.len(), 16);
        assert!(a.fingerprint.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        assert!(a.pages[0].text.contains("[1]"));
        assert!(a.pages[1].text.contains("Body prose"));
        assert!(a.pages[2].text.contains("References"));
    }

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

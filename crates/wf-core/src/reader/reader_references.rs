//! The reader's join between document analysis and the overlay's flat hit list. Port of
//! `buildReferenceIndex`, `indexFromAnalysis`, `outlineItemsFor` and the helpers in
//! `apps/web/src/features/reader/application/reader-references.ts`. The analysis itself stays in
//! `reader_analysis`; the `Map` shapes the overlay reads are rebuilt in TS from the lists returned.

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::link_citations::{LinkCitationPage, covered_text_spans};
use super::selection::SelectionPageTextItem;
use super::text_units::{as_f64, collapse_whitespace, utf16_slice};
use crate::reader_analysis::citation_assembly::page_text;
use crate::reader_analysis::document_analysis::DocumentAnalysis;
use crate::reader_analysis::document_analysis::{analyze_pdf_document, outline_item_of};
use crate::reader_analysis::figure_mentions::FigureTarget;
use crate::reader_analysis::outline::{OutlineReaderItem, OutlineTextItem, body_font_size};
use crate::reader_analysis::text::{AnalysisPdfItem, mention_rects};
use crate::reader_analysis::types::{
    AnalysisCitationMention, AnalysisParsedReference, AnalysisPdfPage,
};
use crate::search::js_text::utf16_len;

/// What a hit points at (TS `MentionHit.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum MentionKind {
    /// A bibliography reference, found in the text or a link.
    Citation,
    /// A figure, table, equation or section, or an internal link's destination.
    Figure,
    /// An external web URL from a link annotation.
    Url,
}

/// A clickable thing found in the page text (TS `MentionHit`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MentionHit {
    /// Stable across re-renders, and unique within the document.
    pub key: String,
    /// What the hit points at.
    pub kind: MentionKind,
    /// UTF-16 offset into the page text where the mention starts.
    pub start: f64,
    /// UTF-16 offset just past the end of the mention.
    pub end: f64,
    /// Text used for the tooltip and the accessible name.
    pub label: String,
    /// External web URL, when the kind is `url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub url: Option<String>,
    /// Reference-list indexes this mention points at, for citations.
    pub ref_indexes: Vec<f64>,
    /// `[x1, y1, x2, y2]` PDF user-space rects the analysis resolved, one per run covered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub rects: Option<Vec<Vec<f64>>>,
    /// Where a figure, table, equation or destination mention jumps to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub target: Option<FigureTarget>,
    /// How a citation was found; set on citation hits only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub source: Option<String>,
    /// How much to trust a citation; set on citation hits only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub confidence: Option<f64>,
}

/// One page's mentions, in reading order (one entry of TS `mentionsByPage`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PageMentions {
    /// 1-based page number.
    pub page_number: f64,
    /// The page's hits, sorted by start.
    pub mentions: Vec<MentionHit>,
}

/// The overlay's index for a document (TS `ReaderReferenceIndex`). The TS adapter builds the
/// `byIndex` lookup and the `mentionsByPage` map from these lists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReaderReferenceIndex {
    /// The reference list, when the document has a parseable one.
    pub references: Vec<AnalysisParsedReference>,
    /// Each page's mentions, in the order the pages were first seen.
    pub mentions_by_page: Vec<PageMentions>,
    /// Body font size, for callers that reason about superscripts.
    pub body_font_size: f64,
    /// Key for the document's text layer, shared by copies with the same text.
    pub fingerprint: String,
}

/// The index of a document with no pages (TS `EMPTY_INDEX`).
fn empty_index() -> ReaderReferenceIndex {
    ReaderReferenceIndex {
        references: Vec::new(),
        mentions_by_page: Vec::new(),
        body_font_size: 0.0,
        fingerprint: String::new(),
    }
}

/// The pages' runs as outline items, one list per page: what the analysis reasons with.
#[must_use]
pub fn outline_items_for(pages: &[AnalysisPdfPage]) -> Vec<Vec<OutlineTextItem>> {
    pages
        .iter()
        .map(|page| {
            page.items
                .iter()
                .map(|item| outline_item_of(item, page.page_number))
                .collect()
        })
        .collect()
}

/// Formats a JS number the way string interpolation does, for keys and labels.
fn js_number(value: f64) -> String {
    format!("{value}")
}

/// The mention as it is printed, collapsed to one line and clipped to 57 units plus an ellipsis
/// when longer than 60, so a mention spanning a line break still reads as one phrase.
fn mention_label(text: &str, start: f64, end: f64) -> String {
    let raw = collapse_whitespace(&utf16_slice(text, start, end));
    if utf16_len(&raw) > 60 {
        format!("{}…", utf16_slice(&raw, 0.0, 57.0))
    } else {
        raw
    }
}

/// One citation hit to emit: a whole citation, or one number of a split numeric cluster.
struct CitationPart {
    id: String,
    start: f64,
    end: f64,
    reference_indexes: Vec<f64>,
    rects: Vec<Vec<f64>>,
}

impl CitationPart {
    fn whole(citation: &AnalysisCitationMention) -> Self {
        Self {
            id: citation.id.clone(),
            start: citation.start,
            end: citation.end,
            reference_indexes: citation.reference_indexes.clone(),
            rects: citation.rects.clone(),
        }
    }
}

/// `[2, 3, 4]` is one printed span but three papers. When every entry the cluster cites is printed
/// as its own number, the mention is cut into one part per number. A range (`2–4`) prints only its
/// ends, so it stays one mention listing all its entries.
fn split_numeric_cluster(
    citation: &AnalysisCitationMention,
    text: &str,
    items: &[AnalysisPdfItem],
) -> Vec<CitationPart> {
    let indexes = &citation.reference_indexes;
    if indexes.len() < 2 {
        return vec![CitationPart::whole(citation)];
    }
    let span = utf16_slice(text, citation.start, citation.end);
    let is_range =
        Regex::new(r"[0-9]\s*[-–—]\s*[0-9]").is_ok_and(|pattern| pattern.is_match(&span));
    if is_range {
        return vec![CitationPart::whole(citation)];
    }
    // Each number in the span: its value, and its UTF-16 offset and length within the span.
    let numbers: Vec<(f64, f64, f64)> = Regex::new(r"[0-9]+").map_or_else(
        |_| Vec::new(),
        |pattern| {
            pattern
                .find_iter(&span)
                .filter_map(|found| {
                    let value = found.as_str().parse::<f64>().ok()?;
                    let offset = as_f64(utf16_len(&span[..found.start()]));
                    let length = as_f64(utf16_len(found.as_str()));
                    Some((value, offset, length))
                })
                .collect()
        },
    );
    let mut parts = Vec::with_capacity(indexes.len());
    for &index in indexes {
        let Some(&(_, offset, length)) = numbers.iter().find(|(value, _, _)| *value == index)
        else {
            return vec![CitationPart::whole(citation)];
        };
        let start = citation.start + offset;
        let end = start + length;
        parts.push(CitationPart {
            id: format!("{}:{}", citation.id, js_number(index)),
            start,
            end,
            reference_indexes: vec![index],
            rects: mention_rects(items, start, end),
        });
    }
    parts
}

/// The page text of the last page with this number (TS `Map` keeps the last entry).
fn text_of(texts: &[(f64, String)], page: f64) -> String {
    texts
        .iter()
        .rev()
        .find(|(number, _)| *number == page)
        .map_or_else(String::new, |(_, text)| text.clone())
}

/// The items of the first page with this number (TS `pages.find`).
fn items_of(pages: &[AnalysisPdfPage], page: f64) -> &[AnalysisPdfItem] {
    pages
        .iter()
        .find(|candidate| candidate.page_number == page)
        .map_or(&[][..], |found| found.items.as_slice())
}

/// The mention hit list for one page, created on first use (TS `hitsFor`).
fn hits_for(by_page: &mut Vec<PageMentions>, page: f64) -> &mut Vec<MentionHit> {
    let index = match by_page.iter().position(|entry| entry.page_number == page) {
        Some(index) => index,
        None => {
            by_page.push(PageMentions {
                page_number: page,
                mentions: Vec::new(),
            });
            by_page.len() - 1
        }
    };
    &mut by_page[index].mentions
}

/// The printed label of a bibliography entry, if it has a non-empty one.
fn label_of(references: &[AnalysisParsedReference], index: f64) -> Option<&str> {
    references
        .iter()
        .rev()
        .find(|reference| reference.index == index)
        .and_then(|reference| reference.label.as_deref())
        .filter(|label| !label.is_empty())
}

/// Converts an analysis item to the selection item shape `covered_text_spans` reads.
fn selection_item_of(item: &AnalysisPdfItem) -> SelectionPageTextItem {
    SelectionPageTextItem {
        str: item.str.clone(),
        transform: item.transform.clone(),
        width: Some(item.width),
        height: Some(item.height),
        has_eol: Some(item.has_eol),
        font_name: None,
    }
}

/// Whether a hit overlaps the half-open span `[start, end)`.
fn overlaps(hit: &MentionHit, start: f64, end: f64) -> bool {
    hit.start < end && hit.end > start
}

/// Shapes a completed analysis into the overlay's index. Pure: the worker path (which returns the
/// analysis) and the in-thread path share it.
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn index_from_analysis(
    analysis: &DocumentAnalysis,
    pages: &[AnalysisPdfPage],
) -> ReaderReferenceIndex {
    let texts: Vec<(f64, String)> = pages
        .iter()
        .map(|page| (page.page_number, page_text(&page.items)))
        .collect();
    let mut by_page: Vec<PageMentions> = Vec::new();

    for citation in &analysis.citations {
        let text = text_of(&texts, citation.page);
        let items = items_of(pages, citation.page);
        for part in split_numeric_cluster(citation, &text, items) {
            // The list's own labels (`[12]`, `12.`) are how the bibliography prints them. An
            // author-year list has none, and there the printed mention is the only honest label.
            let labels: Vec<&str> = part
                .reference_indexes
                .iter()
                .filter_map(|&index| label_of(&analysis.references, index))
                .collect();
            let label = if labels.is_empty() {
                mention_label(&text, part.start, part.end)
            } else {
                labels.join(", ")
            };
            hits_for(&mut by_page, citation.page).push(MentionHit {
                key: part.id,
                kind: MentionKind::Citation,
                start: part.start,
                end: part.end,
                label,
                url: None,
                ref_indexes: part.reference_indexes,
                rects: (!part.rects.is_empty()).then_some(part.rects),
                target: None,
                source: Some(citation.source.clone()),
                confidence: Some(citation.confidence),
            });
        }
    }

    for figure in &analysis.figures {
        let text = text_of(&texts, figure.page);
        let hits = hits_for(&mut by_page, figure.page);
        // A citation and a figure mention can overlap in a caption. The citation wins, since it is
        // the one with a record to show.
        if hits
            .iter()
            .any(|hit| overlaps(hit, figure.start, figure.end))
        {
            continue;
        }
        hits.push(MentionHit {
            key: format!(
                "f:{}:{}-{}",
                js_number(figure.page),
                js_number(figure.start),
                js_number(figure.end)
            ),
            kind: MentionKind::Figure,
            start: figure.start,
            end: figure.end,
            label: mention_label(&text, figure.start, figure.end),
            url: None,
            ref_indexes: Vec::new(),
            rects: None,
            target: Some(figure.target.clone()),
            source: None,
            confidence: None,
        });
    }

    // External web URLs and non-citation document links, from the page's own annotations.
    for page in pages {
        let links = match &page.links {
            Some(links) if !links.is_empty() => links,
            _ => continue,
        };
        let text = text_of(&texts, page.page_number);
        let covered = covered_text_spans(
            &LinkCitationPage {
                number: page.page_number,
                items: page.items.iter().map(selection_item_of).collect(),
            },
            links,
        );
        let hits = hits_for(&mut by_page, page.page_number);
        for span in covered.spans {
            if span.end <= span.start {
                continue;
            }
            // Existing citations and figure detections take precedence.
            if hits.iter().any(|hit| overlaps(hit, span.start, span.end)) {
                continue;
            }
            let key_range = format!("{}-{}", js_number(span.start), js_number(span.end));
            if let Some(url) = span.link.url.as_deref().filter(|url| !url.is_empty()) {
                hits.push(MentionHit {
                    key: format!("u:{}:{key_range}", js_number(page.page_number)),
                    kind: MentionKind::Url,
                    start: span.start,
                    end: span.end,
                    label: url.to_owned(),
                    url: Some(url.to_owned()),
                    ref_indexes: Vec::new(),
                    rects: None,
                    target: None,
                    source: None,
                    confidence: None,
                });
            } else if let Some(dest) = &span.link.dest {
                let dest_label = mention_label(&text, span.start, span.end);
                let label = if dest_label.is_empty() {
                    format!("Page {}", js_number(dest.page))
                } else {
                    dest_label.clone()
                };
                hits.push(MentionHit {
                    key: format!("d:{}:{key_range}", js_number(page.page_number)),
                    kind: MentionKind::Figure,
                    start: span.start,
                    end: span.end,
                    label,
                    url: None,
                    ref_indexes: Vec::new(),
                    rects: None,
                    target: Some(FigureTarget {
                        page: dest.page,
                        y: dest.y.unwrap_or(0.0),
                        x: dest.x,
                        height: None,
                        label: (!dest_label.is_empty()).then_some(dest_label),
                        kind: Some("dest".to_owned()),
                    }),
                    source: None,
                    confidence: None,
                });
            }
        }
    }

    for entry in &mut by_page {
        entry.mentions.sort_by(|a, b| a.start.total_cmp(&b.start));
    }

    let outline = outline_items_for(pages);
    ReaderReferenceIndex {
        references: analysis.references.clone(),
        mentions_by_page: by_page,
        body_font_size: body_font_size(&outline),
        fingerprint: analysis.fingerprint.clone(),
    }
}

/// Analyzes the pages and shapes the result in one step: the in-thread path, which the worker
/// mirrors by calling the analysis itself.
#[must_use]
pub fn build_reference_index(
    pages: &[AnalysisPdfPage],
    outline: &[OutlineReaderItem],
) -> ReaderReferenceIndex {
    if pages.is_empty() {
        return empty_index();
    }
    let analysis = analyze_pdf_document(pages, outline);
    index_from_analysis(&analysis, pages)
}

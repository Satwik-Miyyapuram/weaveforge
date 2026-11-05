//! Match one page's citations and map them back to real PDF rectangles. A faithful port of
//! packages/core/src/features/reader/analysis/citation-matcher.ts.
//!
//! The text candidates (`[12]`, "Smith et al. 2019") are the mentions, the document's own
//! internal links only support them, and what the links name that no candidate claims is
//! coalesced with its neighbours. That keeps an author-year citation hyperref set as two
//! boxes one citation rather than two.

use crate::reader_analysis::citation_assembly::assemble_page_citations;
use crate::reader_analysis::citations::{
    CitationPage, find_citation_candidates, find_pattern_citation_mentions,
};
use crate::reader_analysis::outline::OutlineTextItem;
use crate::reader_analysis::pdf_links::native_citation_mentions;
use crate::reader_analysis::text::AnalysisPdfItem;
use crate::reader_analysis::types::{
    AnalysisCitationMention, AnalysisPageTextRange, AnalysisParsedReference, AnalysisPdfLink,
    AnalysisPdfPage,
};

/// One page as the matcher reads it. Twin of `PageCitationInput`.
pub struct PageCitationInput {
    /// Page number, 1-based.
    pub number: f64,
    /// Page text, the items concatenated.
    pub text: String,
    /// Raw PDF text items: geometry and superscript sizes.
    pub items: Vec<AnalysisPdfItem>,
    /// The same runs as outline items. Kept for parity; `match_page_citations` does not read it.
    pub outline_items: Vec<OutlineTextItem>,
    /// The page's `/Link` annotations, `None` when the page has none.
    pub links: Option<Vec<AnalysisPdfLink>>,
}

/// One page's citations, as the reference reader assembles them: the native links read as
/// support, the pattern finder's mentions, and the two combined over the text candidates.
/// `reference_ranges` are the bibliography's own spans, where nothing is a citation. Twin of
/// `matchPageCitations`.
#[must_use]
pub fn match_page_citations(
    page: &PageCitationInput,
    references: &[AnalysisParsedReference],
    reference_ranges: &[AnalysisPageTextRange],
) -> Vec<AnalysisCitationMention> {
    let analyze_page = AnalysisPdfPage {
        page_number: page.number,
        items: page.items.clone(),
        links: Some(page.links.clone().unwrap_or_default()),
    };
    let native = native_citation_mentions(&analyze_page, references, reference_ranges);
    // Both steps walk the same text candidates; find them once per page.
    let candidates = find_citation_candidates(&page.items);
    let cite_page = CitationPage {
        number: page.number,
        text: page.text.clone(),
        items: page.items.clone(),
    };
    let patterns = find_pattern_citation_mentions(
        &cite_page,
        references,
        reference_ranges,
        Some(candidates.as_slice()),
    );
    assemble_page_citations(
        &analyze_page,
        &native,
        &patterns,
        reference_ranges,
        Some(candidates.as_slice()),
    )
}

#[cfg(test)]
mod tests {
    use super::{PageCitationInput, match_page_citations};
    use crate::reader_analysis::text::AnalysisPdfItem;
    use crate::reader_analysis::types::AnalysisPageTextRange;

    fn item(text: &str, x: f64, width: f64) -> AnalysisPdfItem {
        AnalysisPdfItem {
            str: text.to_string(),
            transform: vec![10.0, 0.0, 0.0, 10.0, x, 700.0],
            width,
            height: 10.0,
            has_eol: false,
            font_ascent: None,
            font_descent: None,
            font_name: None,
        }
    }

    fn page() -> PageCitationInput {
        let items = vec![
            item("see [1] and ", 0.0, 60.0),
            item("Smith et al. 2019 here", 60.0, 110.0),
        ];
        let text: String = items.iter().map(|i| i.str.as_str()).collect();
        PageCitationInput {
            number: 3.0,
            text,
            items,
            outline_items: Vec::new(),
            links: None,
        }
    }

    #[test]
    fn finds_both_citations() {
        let out = match_page_citations(&page(), &[], &[]);
        let texts: Vec<&str> = out.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, ["[1]", "Smith et al. 2019"]);
    }

    #[test]
    fn a_reference_range_hides_the_author_year_citation() {
        // "Smith" starts at 12; the text is 34 units long.
        let hidden = [AnalysisPageTextRange {
            page: 3.0,
            start: 12.0,
            end: 34.0,
        }];
        let out = match_page_citations(&page(), &[], &hidden);
        let texts: Vec<&str> = out.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, ["[1]"]);
    }
}

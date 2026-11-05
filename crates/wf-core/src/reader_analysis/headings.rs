//! Heading detection and outline building from reconstructed lines. A faithful
//! port of packages/core/src/features/reader/analysis/heading-analysis.ts.
//!
//! The TS re-export `outlineIsPlausible` is not repeated here; it lives in `outline.rs`.

use std::cmp::Ordering;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::lines::AnalysisTextLine;
use super::outline::{OutlineReaderItem, REFERENCES_HEADING, has_word, re_matches};
use crate::papers::js_regex::compile;
use crate::search::js_text::utf16_len;

/// Section words worth trusting when bold, in English and the languages papers are submitted in.
/// Duplicate TS alternatives are dropped. regex-lite folds case for ASCII only, so an all-caps
/// accented word ("INTRODUCCIÓN") misses where the TS `iu` regex matches; same caveat as outline.
static SECTION_WORDS: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(concat!(
        r"(?i)^(?:",
        "Abstract|Introduction|Related Work|Background|Motivation|Method|Methods|",
        "Methodology|Approach|Model|Experiments|Experimental Setup|Evaluation|Results|",
        "Analysis|Discussion|Conclusion|Conclusions|Future Work|Acknowledg(?:e?)ments?|",
        "References|Appendix|",
        "Resumen|Introducci[oó]n|Trabajos relacionados|Marco te[oó]rico|M[eé]todo|",
        "Metodolog[ií]a|Experimentos|Resultados|Discusi[oó]n|Conclusiones|Referencias|",
        "Bibliograf[ií]a|Ap[eé]ndice|Anexo|Agradecimientos|",
        "R[eé]sum[eé]|Travaux connexes|[ÉE]tat de l'art|M[eé]thode|M[eé]thodologie|",
        "Exp[eé]riences|Annexe|Remerciements|",
        "Zusammenfassung|Einleitung|Verwandte Arbeiten|Grundlagen|Methodik|",
        "Implementierung|Experimente|Ergebnisse|Resultate|Fazit|Schlussfolgerung|",
        "Literatur|Literaturverzeichnis|Anhang|Danksagung|",
        "Conclus[aã]o|Conclus[oõ]es|Ap[eê]ndice|",
        "Sommario|Riassunto|Lavori correlati|Esperimenti|Risultati|Riferimenti|",
        "Ringraziamenti|",
        "Samenvatting|Inleiding|Resultaten|Conclusie|Referenties|Bijlage",
        r")\b",
    ))
    .ok()
});

/// "3.1 Retrieval", "IV. Experiments", "A. Proof" — numbering that fixes depth.
pub(crate) static HEADING_NUMBER: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(?:(\d+(?:\.\d+)*)|([IVXLC]+)|([A-Z]))\.?\s+\S").ok());

/// A table-of-contents entry: title, a run of dots, a page number.
static DOTTED_LEADER: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(\.\s*){5,}\d*$").ok());

/// A heading line with its outline depth (`HeadingLine`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct HeadingLine {
    /// The heading line.
    pub line: AnalysisTextLine,
    /// 1 for top-level, growing with the numbering depth or shrinking size.
    pub level: f64,
}

/// A count as the `f64` JS numbers use; counts stay far below 2^32.
fn count_f64(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}

/// The numbering depth of a line, or `None` when it is unnumbered (`numberOf`).
fn numbered_depth(text: &str) -> Option<f64> {
    let captures = HEADING_NUMBER.as_ref()?.captures(text)?;
    Some(match captures.get(1) {
        Some(group) => count_f64(group.as_str().split('.').count()),
        None => 1.0,
    })
}

/// Whether `line` is a heading under the rules of `findHeadingLines`.
fn is_heading(line: &AnalysisTextLine, body: f64, furniture: &[&AnalysisTextLine]) -> bool {
    if furniture.iter().any(|known| std::ptr::eq(*known, line)) {
        return false;
    }
    let numbered = numbered_depth(&line.text).is_some();
    if utf16_len(&line.text) > 120 || (!numbered && line.text.ends_with('.')) {
        return false;
    }
    if re_matches(&DOTTED_LEADER, &line.text) || !has_word(&line.text) {
        return false;
    }
    if line.font_size >= 1.12 * body {
        return true;
    }
    line.bold && (numbered || re_matches(&SECTION_WORDS, &line.text))
}

/// Which of the (furniture-free) lines are headings (`findHeadingLines`). `body` is the
/// modal font size; a heading is at least 12% larger, or bold and numbered or a known
/// section word. `furniture` holds lines by identity, as the TS `Set` does.
#[must_use]
pub fn find_heading_lines(
    lines: &[AnalysisTextLine],
    body: f64,
    furniture: &[&AnalysisTextLine],
) -> Vec<AnalysisTextLine> {
    if body == 0.0 || body.is_nan() {
        return Vec::new();
    }
    lines
        .iter()
        .filter(|line| is_heading(line, body, furniture))
        .cloned()
        .collect()
}

/// Distinct font sizes of the unnumbered headings, largest first.
fn unnumbered_sizes(decorated: &[HeadingLine]) -> Vec<f64> {
    let mut sizes: Vec<f64> = Vec::new();
    for heading in decorated.iter().filter(|h| h.level == 0.0) {
        let size = heading.line.font_size;
        let known = sizes
            .iter()
            .any(|seen| *seen == size || (seen.is_nan() && size.is_nan()));
        if !known {
            sizes.push(size);
        }
    }
    sizes.sort_by(|a, b| b.partial_cmp(a).unwrap_or(Ordering::Equal));
    sizes
}

/// Pops the innermost open heading and attaches it to its parent, or to the roots.
fn close_top(stack: &mut Vec<(f64, OutlineReaderItem)>, roots: &mut Vec<OutlineReaderItem>) {
    let Some((_, node)) = stack.pop() else {
        return;
    };
    match stack.last_mut() {
        Some((_, parent)) => parent.items.get_or_insert_with(Vec::new).push(node),
        None => roots.push(node),
    }
}

/// Outline items from heading lines (`headingOutline`). Numbered headings take their depth
/// from the number; the rest rank by font size, largest first. The list is cut at the
/// references heading, which is kept as the last node.
#[must_use]
pub fn heading_outline(headings: &[AnalysisTextLine]) -> Vec<OutlineReaderItem> {
    let mut decorated: Vec<HeadingLine> = headings
        .iter()
        .map(|line| HeadingLine {
            line: line.clone(),
            level: numbered_depth(&line.text).unwrap_or(0.0),
        })
        .collect();
    let sizes = unnumbered_sizes(&decorated);
    for heading in &mut decorated {
        if heading.level == 0.0 {
            heading.level = sizes
                .iter()
                .position(|size| *size == heading.line.font_size)
                .map_or(0.0, |index| count_f64(index + 1));
        }
    }
    let mut roots: Vec<OutlineReaderItem> = Vec::new();
    let mut stack: Vec<(f64, OutlineReaderItem)> = Vec::new();
    for heading in &decorated {
        let node = OutlineReaderItem {
            title: heading.line.text.clone(),
            page_number: Some(heading.line.page),
            y: Some(heading.line.y),
            items: None,
        };
        while stack
            .last()
            .is_some_and(|(level, _)| *level >= heading.level)
        {
            close_top(&mut stack, &mut roots);
        }
        stack.push((heading.level, node));
        if re_matches(&REFERENCES_HEADING, &heading.line.text) {
            break;
        }
    }
    while !stack.is_empty() {
        close_top(&mut stack, &mut roots);
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_line(text: &str, font_size: f64, bold: bool, y: f64) -> AnalysisTextLine {
        AnalysisTextLine {
            page: 1.0,
            text: text.to_string(),
            x: 72.0,
            y,
            right: 300.0,
            font_size,
            bold,
            start: 0.0,
            end: 0.0,
        }
    }

    fn node(title: &str, y: f64, items: Option<Vec<OutlineReaderItem>>) -> OutlineReaderItem {
        OutlineReaderItem {
            title: title.to_string(),
            page_number: Some(1.0),
            y: Some(y),
            items,
        }
    }

    #[test]
    fn larger_face_is_heading_from_twelve_percent_up() {
        let lines = [
            text_line("Big Title", 14.0, false, 700.0),
            text_line("Body text here", 10.0, false, 680.0),
            text_line("Almost there", 11.1, false, 660.0),
        ];
        assert_eq!(
            find_heading_lines(&lines, 10.0, &[]),
            vec![lines[0].clone()]
        );
    }

    #[test]
    fn bold_needs_numbering_or_a_section_word() {
        let lines = [
            text_line("2 Methods", 10.0, true, 700.0),
            text_line("Methods", 10.0, true, 680.0),
            text_line("Methods", 10.0, false, 660.0),
            text_line("Random Words", 10.0, true, 640.0),
        ];
        assert_eq!(
            find_heading_lines(&lines, 10.0, &[]),
            vec![lines[0].clone(), lines[1].clone()]
        );
    }

    #[test]
    fn prose_and_leaders_are_not_headings() {
        let lines = [
            text_line(
                "This is a sentence that ends with a period.",
                14.0,
                true,
                700.0,
            ),
            text_line("Contents . . . . . . . 3", 14.0, true, 680.0),
            text_line(&"A".repeat(121), 14.0, true, 660.0),
            text_line("12 34", 14.0, true, 640.0),
        ];
        assert_eq!(find_heading_lines(&lines, 10.0, &[]), Vec::new());
    }

    #[test]
    fn empty_body_and_furniture_exclude_lines() {
        let lines = [text_line("Big Title", 14.0, false, 700.0)];
        assert_eq!(find_heading_lines(&lines, 0.0, &[]), Vec::new());
        let furniture = [&lines[0]];
        assert_eq!(find_heading_lines(&lines, 10.0, &furniture), Vec::new());
        assert_eq!(find_heading_lines(&lines, 10.0, &[]).len(), 1);
    }

    #[test]
    fn numbering_depth_nests_the_outline() {
        let lines = [
            text_line("1 Introduction", 10.0, true, 700.0),
            text_line("1.1 Background", 10.0, true, 680.0),
            text_line("2 Method", 10.0, true, 660.0),
        ];
        assert_eq!(
            heading_outline(&lines),
            vec![
                node(
                    "1 Introduction",
                    700.0,
                    Some(vec![node("1.1 Background", 680.0, None)]),
                ),
                node("2 Method", 660.0, None),
            ]
        );
    }

    #[test]
    fn unnumbered_sizes_rank_and_references_cut_the_list() {
        let lines = [
            text_line("Title", 16.0, false, 700.0),
            text_line("Sub", 12.0, false, 680.0),
            text_line("Sub two", 12.0, false, 660.0),
            text_line("Title two", 16.0, false, 640.0),
            text_line("References", 12.0, false, 620.0),
            text_line("Appendix A", 12.0, false, 600.0),
        ];
        assert_eq!(
            heading_outline(&lines),
            vec![
                node(
                    "Title",
                    700.0,
                    Some(vec![node("Sub", 680.0, None), node("Sub two", 660.0, None),]),
                ),
                node(
                    "Title two",
                    640.0,
                    Some(vec![node("References", 620.0, None)]),
                ),
            ]
        );
    }
}

//! Bibliography section finder: heading scoring, appendix and section ends, and
//! the numbered-run fallback. A faithful port of
//! packages/core/src/features/reader/analysis/reference-section.ts.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::bibliography::{label_number, match_label};
use super::lines::AnalysisTextLine;
use super::outline::re_matches;
use crate::ink::js_math;
use crate::papers::js_regex::compile;
use crate::search::js_text::utf16_len;

/// Bibliography heading words, in the languages papers are set in.
const REFERENCES_WORDS: &[&str] = &[
    "References?",
    "Bibliography",
    "Bibliographie",
    "Works Cited",
    "Literature Cited",
    "Literatur(?:verzeichnis)?",
    "Referencias",
    "Références",
    "Riferimenti",
    "Referências",
    "Bibliografia",
    "Bibliografía",
    "Cited Literature",
    "Sources",
    "Notes and References",
    "References and Notes",
    "Referenser",
    "Referenselista",
    "Lähdeluettelo",
    "Viitteet",
    "Litteratur",
    "Källor",
    "Kaynaklar",
    "KAYNAKLAR",
    "Список литературы",
    "Литература",
    "参考文献",
    "引用文献",
];

/// Headings that structure the document; the furniture pass must never drop one.
const STRUCTURAL_WORDS: &[&str] = &[
    "Abstract",
    "Introduction",
    "Background",
    "Related Work",
    "Preliminaries",
    "Method",
    "Methods",
    "Methodology",
    "Model Architecture",
    "Experiments",
    "Experimental Setup",
    "Evaluation",
    "Results",
    "Discussion",
    "Limitations",
    "Conclusion",
    "Conclusions",
    "Acknowledgments",
    "Acknowledgements",
    "References",
    "Bibliography",
    "Appendix",
    "Appendices",
];

/// Labelled lines counted under a heading.
const HEADING_EVIDENCE_WINDOW: usize = 30;
/// Labelled lines per point of evidence.
const EVIDENCE_PER_ENTRY: f64 = 6.0;
/// Most evidence points one heading can earn, however long its list.
const EVIDENCE_MAX: f64 = 3.0;
/// A heading with a few entries under it scores at least 4; prose never does.
const SCORE_THRESHOLD: f64 = 4.0;

/// A line index as the JS number a span carries.
fn index_f64(index: usize) -> f64 {
    f64::from(u32::try_from(index).unwrap_or(u32::MAX))
}

/// A word a PDF may set in small caps, as a pattern matching it either solid or
/// with the space the text layer puts after the initial.
///
/// Each letter becomes its own case class with an optional gap after it, so one
/// pattern covers "References" and "R EFERENCES". The caller's spaces become
/// `\s*` too. The TS replacement order is kept so the output pattern is identical.
fn small_caps(word: &str) -> String {
    let chars: Vec<char> = word.chars().collect();
    let mut letters = String::new();
    let mut i = 0;
    while let Some(&c) = chars.get(i) {
        i += 1;
        if !c.is_ascii_alphabetic() {
            letters.push(c);
            continue;
        }
        letters.push('[');
        letters.push(c.to_ascii_lowercase());
        letters.push(c.to_ascii_uppercase());
        letters.push(']');
        // The TS `(s?\?)?` suffix, kept as written.
        let suffix = match (chars.get(i).copied(), chars.get(i + 1).copied()) {
            (Some('s'), Some('?')) => "s?",
            (Some('?'), _) => "?",
            _ => "",
        };
        letters.push_str(suffix);
        i += suffix.chars().count();
    }
    let mut out = String::new();
    let mut rest = letters.chars().peekable();
    while let Some(c) = rest.next() {
        out.push(c);
        if c == ']' && rest.peek().is_some() {
            out.push_str(r"\s*");
        }
    }
    out.replace(' ', r"\s*")
}

/// `small_caps` over each word, joined as an alternation.
fn small_caps_alternation(words: &[&str]) -> String {
    words
        .iter()
        .copied()
        .map(small_caps)
        .collect::<Vec<_>>()
        .join("|")
}

/// Bibliography headings. Case-insensitive, as the TS `iu` flags are. The
/// non-ASCII words (é, Cyrillic, CJK) match only where regex-lite's case
/// folding agrees with JS `u` case folding.
pub(crate) static REFERENCES_HEADING: LazyLock<Option<Regex>> = LazyLock::new(|| {
    let words = small_caps_alternation(REFERENCES_WORDS);
    let notes = small_caps("Notes");
    let further = small_caps("Further Reading");
    let bibliography = small_caps("Bibliography");
    compile(&format!(
        r"(?i)^(?:\d+\.?\s+|[IVX]+\.?\s+)?(?:{words})(?:\s+(?:and|&|y|und|et)\s+(?:{notes}|{further}|{bibliography}|notas))?\s*:?\s*$"
    ))
    .ok()
});

/// Appendix headings that end a bibliography, in the common languages.
pub(crate) static APPENDIX_HEADING: LazyLock<Option<Regex>> = LazyLock::new(|| {
    let appendix = small_caps("Appendix");
    let appendices = small_caps("Appendices");
    let anhang = small_caps("Anhang");
    let annexe = small_caps("Annexe");
    let apendice = small_caps("Apéndice");
    let anexo = small_caps("Anexo");
    let bijlage = small_caps("Bijlage");
    let prilozhenie = small_caps("Приложение");
    compile(&format!(
        r"(?i)^(?:[A-Z\d]+\.?\s+)?(?:{appendix}|{appendices}|{anhang}|{annexe}s?|{apendice}|{anexo}s?|{bijlage}n?|{prilozhenie})\b"
    ))
    .ok()
});

/// A section heading that structures the document, whatever else is true of it.
pub(crate) static STRUCTURAL_HEADING: LazyLock<Option<Regex>> = LazyLock::new(|| {
    let words = small_caps_alternation(STRUCTURAL_WORDS);
    compile(&format!(
        r"(?i)^(?:\d+(?:\.\d+)*\.?\s+|[A-Z]\.?\s+)?(?:{words})\b"
    ))
    .ok()
});

/// A bibliography span (`ReferenceSectionSpan`). Indices are JS numbers, so
/// `heading_index` is `-1` for the numbered-run fallback.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReferenceSectionSpan {
    /// Index of the first entry line (the heading itself is excluded).
    pub start: f64,
    /// Exclusive index of the first line after the section.
    pub end: f64,
    /// The heading line's index, or `-1` when no heading was found.
    pub heading_index: f64,
    /// Heading score; the fallback reports 3.
    pub score: f64,
}

/// Best heading candidate so far.
struct Candidate {
    index: usize,
    score: f64,
    labelled: usize,
}

/// Whether the line opens with a numbered label (`LABEL.test`).
fn is_label(text: &str) -> bool {
    match_label(text).is_some()
}

/// Labelled lines in the heading's evidence window (capped by its length).
fn labelled_near(lines: &[AnalysisTextLine], from: usize) -> usize {
    lines
        .iter()
        .skip(from)
        .take(HEADING_EVIDENCE_WINDOW)
        .filter(|line| is_label(&line.text))
        .count()
}

/// How strongly the lines under a heading look like a bibliography: how many
/// entries there are, capped. Windows shorter than three lines score 0.
fn evidence_score(lines: &[AnalysisTextLine], from: usize) -> f64 {
    if lines
        .iter()
        .skip(from)
        .take(HEADING_EVIDENCE_WINDOW)
        .count()
        < 3
    {
        return 0.0;
    }
    let entries = index_f64(labelled_near(lines, from)) / EVIDENCE_PER_ENTRY;
    js_math::min(EVIDENCE_MAX, entries.floor())
}

/// Builds a span from the usize positions the scan works in.
fn make_span(start: usize, end: usize, heading_index: f64, score: f64) -> ReferenceSectionSpan {
    ReferenceSectionSpan {
        start: index_f64(start),
        end: index_f64(end),
        heading_index,
        score,
    }
}

/// The bibliography's line span within `lines` (already in reading order), or
/// `None` when the document has no detectable one. `furniture` is aligned with
/// `lines` (`true` = furniture, never a heading candidate); `None` means none.
#[must_use]
pub fn find_reference_section(
    lines: &[AnalysisTextLine],
    body_font_size: f64,
    page_count: f64,
    furniture: Option<&[bool]>,
) -> Option<ReferenceSectionSpan> {
    let last_third_page = page_count - js_math::max(1.0, (page_count / 3.0).ceil()) + 1.0;

    let mut best: Option<Candidate> = None;
    for (index, line) in lines.iter().enumerate() {
        if furniture.is_some_and(|flags| flags.get(index) == Some(&true)) {
            continue;
        }
        if !re_matches(&REFERENCES_HEADING, &line.text) {
            continue;
        }
        let mut score = 3.0;
        if line.page >= last_third_page {
            score += 1.0;
        }
        if line.bold || (body_font_size > 0.0 && line.font_size >= 1.12 * body_font_size) {
            score += 1.0;
        }
        score += evidence_score(lines, index + 1);
        // Equal scores go to the heading with more entries under it.
        let labelled = labelled_near(lines, index + 1);
        let better = match &best {
            None => true,
            Some(b) => score > b.score || (score == b.score && labelled > b.labelled),
        };
        if better {
            best = Some(Candidate {
                index,
                score,
                labelled,
            });
        }
    }

    match best {
        Some(chosen) if chosen.score >= SCORE_THRESHOLD => Some(make_span(
            chosen.index + 1,
            section_end(lines, chosen.index),
            index_f64(chosen.index),
            chosen.score,
        )),
        _ => fallback_numbered_run(lines, page_count),
    }
}

/// The section ends at the next appendix or an equally prominent heading.
fn section_end(lines: &[AnalysisTextLine], heading_index: usize) -> usize {
    let Some(heading) = lines.get(heading_index) else {
        return lines.len();
    };
    for (i, line) in lines.iter().enumerate().skip(heading_index + 1) {
        if re_matches(&APPENDIX_HEADING, &line.text) {
            return i;
        }
        if line.font_size >= heading.font_size
            && utf16_len(&line.text) <= 80
            && !is_label(&line.text)
            && (line.bold || line.font_size > heading.font_size)
        {
            return i;
        }
    }
    lines.len()
}

/// The entry number of a line's label (`labelNumber(LABEL.exec(text))`), when it has one.
fn label_of(text: &str) -> Option<f64> {
    match_label(text).map(|m| label_number(&m.groups))
}

/// No heading: scan the last third of the document (two to twenty pages) for
/// a numbered run that starts at 1 and counts up without gaps; that is a
/// bibliography whatever it is called. Gives up when more than two thirds of
/// the lines in that run carry no label, as a numbered list in prose does.
#[must_use]
pub fn fallback_numbered_run(
    lines: &[AnalysisTextLine],
    page_count: f64,
) -> Option<ReferenceSectionSpan> {
    let span = js_math::min(20.0, js_math::max(2.0, (page_count / 3.0).ceil()));
    let first_page = js_math::max(1.0, page_count - span + 1.0);
    let tail_start = lines.iter().position(|line| line.page >= first_page)?;
    let tail = lines.get(tail_start..)?;
    let one = tail
        .iter()
        .position(|line| label_of(&line.text) == Some(1.0))?;
    let candidate = tail.get(one..)?;

    let mut expected = 1.0;
    let mut end = candidate.len();
    for (i, line) in candidate.iter().enumerate() {
        let Some(n) = label_of(&line.text) else {
            continue;
        };
        if n == expected + 1.0 {
            expected = n;
            continue;
        }
        if n == expected {
            continue;
        }
        end = i;
        break;
    }
    let run = candidate.get(..end)?;
    if expected < 3.0 {
        return None;
    }
    let unlabelled = run.iter().filter(|line| !is_label(&line.text)).count();
    if index_f64(unlabelled) > index_f64(run.len()) * 2.0 / 3.0 {
        return None;
    }
    Some(make_span(
        tail_start + one,
        tail_start + one + end,
        -1.0,
        3.0,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader_analysis::running_heads::furniture_lines;

    /// A line at the default 10-point body size, not bold.
    fn line(text: &str, page: f64, x: f64, y: f64) -> AnalysisTextLine {
        AnalysisTextLine {
            page,
            text: text.to_string(),
            x,
            y,
            right: x + index_f64(utf16_len(text)) * 5.0,
            font_size: 10.0,
            bold: false,
            start: 0.0,
            end: 0.0,
        }
    }

    #[test]
    fn small_caps_heading_is_bibliography_heading() {
        // pdf.js reports a small-caps heading as two runs, so "R EFERENCES" must match.
        assert!(re_matches(&REFERENCES_HEADING, "R EFERENCES"));
        assert!(re_matches(&REFERENCES_HEADING, "References"));
        assert!(re_matches(&REFERENCES_HEADING, "R E F E R E N C E S"));
        assert!(re_matches(&REFERENCES_HEADING, "B IBLIOGRAPHY"));
        assert!(re_matches(&REFERENCES_HEADING, "1 R EFERENCES"));
    }

    #[test]
    fn single_letter_is_never_bibliography_heading() {
        // Display-equation fragments, such as the bolded index `k`, must not match.
        for text in [
            "k",
            "m",
            "i =1",
            "L k = E h 1 ,..., h k",
            "p ( x | θ ) =",
            "(17)",
        ] {
            assert!(!re_matches(&REFERENCES_HEADING, text), "{text}");
        }
    }

    #[test]
    fn heading_recurring_in_margin_band_is_not_furniture() {
        let mut lines = Vec::new();
        for page in [1.0, 2.0, 8.0, 13.0] {
            lines.push(line("References", page, 105.0, 200.0));
        }
        for page in [1.0, 2.0, 13.0] {
            lines.push(line(
                "Under review as a conference paper at ICLR 2016",
                page,
                108.0,
                756.0,
            ));
        }
        let furniture = furniture_lines(&lines);

        for (i, l) in lines.iter().enumerate() {
            if l.text == "References" {
                assert_eq!(furniture.get(i), Some(&false), "page {}", l.page);
            }
        }
        // The banner is still furniture: the guard is for headings only.
        let banner = lines
            .iter()
            .position(|l| l.text.starts_with("Under review"))
            .unwrap_or(usize::MAX);
        assert_eq!(furniture.get(banner), Some(&true));
    }

    #[test]
    fn heading_followed_by_real_list_wins_over_later_one() {
        let mut lines = vec![line("8 Conclusion", 7.0, 100.0, 700.0)];
        lines.push(line("References", 8.0, 105.0, 200.0));
        for n in 1..=30_u32 {
            let text = format!("[{n}] Author {n}. 20{}. A title.", 10 + n % 10);
            lines.push(line(&text, 8.0, 100.0, 190.0 - f64::from(n)));
        }
        lines.push(line("B I NTRODUCTION TO C OMPARISON", 12.0, 100.0, 700.0));
        lines.push(line("References", 13.0, 105.0, 200.0));
        for n in 1..=6_u32 {
            let text = format!("[{n}] Author {n}. 1995. Another title.");
            lines.push(line(&text, 13.0, 100.0, 190.0 - f64::from(n)));
        }

        let span = find_reference_section(&lines, 10.0, 14.0, None);
        assert!(span.is_some(), "a reference section was found");
        assert_eq!(span.as_ref().map(|s| s.heading_index), Some(1.0));
        assert_eq!(span.as_ref().map(|s| s.start), Some(2.0));
    }

    #[test]
    fn document_with_one_heading_still_picks_it() {
        let mut lines = vec![line("5 E XPERIMENTAL RESULTS", 6.0, 100.0, 700.0)];
        lines.push(line("R EFERENCES", 8.0, 116.0, 141.0));
        for n in 1..=8_u32 {
            let text = format!("[{n}] Author{n}, A. 2015. A title of some length.");
            lines.push(line(&text, 8.0, 100.0, 130.0 - f64::from(n) * 11.0));
        }
        let span = find_reference_section(&lines, 10.0, 14.0, None);
        assert!(span.is_some(), "the small-caps heading is found");
        assert_eq!(span.as_ref().map(|s| s.heading_index), Some(1.0));
    }

    #[test]
    fn numbered_run_still_falls_back_when_no_heading_is_present() {
        let mut lines = Vec::new();
        for n in 1..=6_u32 {
            let text = format!("{n}. Author {n}. 2019. A title.");
            lines.push(line(&text, 7.0, 100.0, 700.0 - f64::from(n) * 12.0));
        }
        let span = find_reference_section(&lines, 10.0, 8.0, None);
        assert!(
            span.is_some(),
            "the numbered run is found without a heading"
        );
        assert_eq!(span.as_ref().map(|s| s.heading_index), Some(-1.0));
    }
}

//! Figure, table, equation, section and algorithm mentions in page text, each resolved to the
//! first caption or heading that names it. A faithful port of
//! packages/core/src/features/reader/find-figure-mentions.ts.
//!
//! Stays in TS: nothing here. Every function is pure data in, data out.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::lines::js_trim;
use super::outline::{OutlineReaderItem, OutlineTextItem, outline_from_text, outline_text_lines};
use crate::ink::js_math;
use crate::papers::js_regex::compile;
use crate::search::js_text::utf16_len;

static CAPTION_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)^(Figure|Fig\.|Table|Algorithm)\s+(\d+[a-z]?)\b").ok());
static EQUATION_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"^\((\d+[a-z]?)\)$").ok());
static SECTION_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(\d+(?:\.\d+)*)\.?\s").ok());
static MENTION_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(
        r"(?i)\b(Fig(?:ure)?s?|Tab(?:le)?s?|Eq(?:uation)?s?|Sec(?:tion)?s?|Alg(?:orithm)?s?)\.?\s*\(?(\d+(?:\.\d+)*[a-z]?)\)?",
    )
    .ok()
});

/// A page as `findFigureMentions` reads it: its number, its text and its text runs.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FigurePage {
    /// 1-based page number.
    pub number: f64,
    /// The page text that mentions are searched in.
    pub text: String,
    /// The page's pdf.js text runs, used for caption and equation lines.
    pub items: Vec<OutlineTextItem>,
}

/// Where a mention points: the caption, equation or heading it names (`FigureTarget`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FigureTarget {
    /// 1-based page number of the target.
    pub page: f64,
    /// Baseline y of the target line.
    pub y: f64,
    /// Left edge of the target line, when it is a caption or equation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub x: Option<f64>,
    /// Font size of the target line, when it is a caption or equation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub height: Option<f64>,
    /// Display label, such as `Figure 2` or `Equation (3)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<String>))]
    pub label: Option<String>,
    /// Kind of the target, as the mention kind names it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<String>))]
    pub kind: Option<String>,
}

/// What a mention refers to (`FigureMention["kind"]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum FigureMentionKind {
    /// `Figure`, `Fig.`, and their plurals.
    Figure,
    /// `Table` and its plurals.
    Table,
    /// `Equation` or `Eq.`, and their plurals.
    Equation,
    /// `Section` or `Sec.`, and their plurals.
    Section,
    /// `Algorithm` or `Alg.`, and their plurals.
    Algorithm,
}

impl FigureMentionKind {
    /// The lowercase name used in target keys and `FigureTarget.kind`.
    #[must_use]
    const fn as_str(self) -> &'static str {
        match self {
            Self::Figure => "figure",
            Self::Table => "table",
            Self::Equation => "equation",
            Self::Section => "section",
            Self::Algorithm => "algorithm",
        }
    }
}

/// One mention of a figure, table, equation, section or algorithm (`FigureMention`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FigureMention {
    /// 1-based page number the mention is on.
    pub page: f64,
    /// UTF-16 offset where the mention starts in the page text.
    pub start: f64,
    /// UTF-16 offset just past the end of the mention in the page text.
    pub end: f64,
    /// What the mention refers to.
    pub kind: FigureMentionKind,
    /// The caption, equation or heading the mention resolves to.
    pub target: FigureTarget,
}

/// A JS-style count as a number. Offsets in a page of text never reach `u32::MAX`.
fn units(count: usize) -> f64 {
    f64::from(u32::try_from(count).unwrap_or(u32::MAX))
}

/// `/^fig/i`-style prefix test. ASCII case only, as the non-unicode JS regex is.
fn starts_with_ignore_case(value: &str, prefix: &str) -> bool {
    value
        .get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
}

/// The kind a caption or reference word names (`kindOf`). Anything else is an algorithm.
fn kind_of(value: &str) -> FigureMentionKind {
    if starts_with_ignore_case(value, "fig") {
        FigureMentionKind::Figure
    } else if starts_with_ignore_case(value, "tab") {
        FigureMentionKind::Table
    } else if starts_with_ignore_case(value, "eq") {
        FigureMentionKind::Equation
    } else if starts_with_ignore_case(value, "sec") {
        FigureMentionKind::Section
    } else {
        FigureMentionKind::Algorithm
    }
}

/// Records `target` under `key` unless the key already has one, so the first target wins.
fn put(targets: &mut HashMap<String, FigureTarget>, key: String, target: FigureTarget) {
    let _: &mut FigureTarget = targets.entry(key).or_insert(target);
}

/// The right-most x of a page's runs; `Math.max(...items.map(x))`, so `-Infinity` when empty.
fn rightmost_x(items: &[OutlineTextItem]) -> f64 {
    items
        .iter()
        .fold(f64::NEG_INFINITY, |acc, item| js_math::max(acc, item.x))
}

/// Caption lines (`Figure 2`, `Table 1a`, ...) as targets.
fn put_captions(targets: &mut HashMap<String, FigureTarget>, page: &FigurePage, re: &Regex) {
    for line in outline_text_lines(std::slice::from_ref(&page.items)) {
        let Some(caption) = re.captures(&line.str) else {
            continue;
        };
        let (Some(word), Some(number)) = (caption.get(1), caption.get(2)) else {
            continue;
        };
        let kind = kind_of(word.as_str());
        let key = format!("{}:{}", kind.as_str(), number.as_str().to_lowercase());
        let label = format!("{} {}", word.as_str(), number.as_str());
        put(
            targets,
            key,
            FigureTarget {
                page: page.number,
                y: line.y,
                x: Some(line.x),
                height: Some(line.font_size),
                label: Some(label),
                kind: Some(kind.as_str().to_owned()),
            },
        );
    }
}

/// Equation labels `(n)` at the right margin of a page as targets.
fn put_equations(targets: &mut HashMap<String, FigureTarget>, page: &FigurePage, re: &Regex) {
    let right = rightmost_x(&page.items);
    for item in &page.items {
        let Some(equation) = re.captures(js_trim(&item.str)) else {
            continue;
        };
        let Some(number) = equation.get(1) else {
            continue;
        };
        if item.x >= right - 20.0 {
            let n = number.as_str();
            put(
                targets,
                format!("equation:{n}"),
                FigureTarget {
                    page: page.number,
                    y: item.y,
                    x: Some(item.x),
                    height: Some(item.font_size),
                    label: Some(format!("Equation ({n})")),
                    kind: Some(FigureMentionKind::Equation.as_str().to_owned()),
                },
            );
        }
    }
}

/// Numbered headings of the outline, depth first, as targets.
fn put_sections(
    targets: &mut HashMap<String, FigureTarget>,
    nodes: &[OutlineReaderItem],
    re: &Regex,
) {
    for node in nodes {
        let number = re.captures(&node.title).and_then(|caps| caps.get(1));
        if let (Some(number), Some(page_number), Some(y)) = (number, node.page_number, node.y) {
            put(
                targets,
                format!("section:{}", number.as_str()),
                FigureTarget {
                    page: page_number,
                    y,
                    x: None,
                    height: None,
                    label: Some(node.title.clone()),
                    kind: Some(FigureMentionKind::Section.as_str().to_owned()),
                },
            );
        }
        if let Some(children) = &node.items {
            put_sections(targets, children, re);
        }
    }
}

/// The mentions on one page whose target exists, in text order.
fn mentions_in_page(
    page: &FigurePage,
    targets: &HashMap<String, FigureTarget>,
    re: &Regex,
) -> Vec<FigureMention> {
    let mut out = Vec::new();
    // Last match's byte and UTF-16 offsets, so each offset counts from the one before it.
    let mut cursor = (0_usize, 0_usize);
    for caps in re.captures_iter(&page.text) {
        let (Some(whole), Some(word), Some(number)) = (caps.get(0), caps.get(1), caps.get(2))
        else {
            continue;
        };
        let kind = kind_of(word.as_str());
        let key = format!("{}:{}", kind.as_str(), number.as_str().to_lowercase());
        let gap = page.text.get(cursor.0..whole.start()).unwrap_or_default();
        let start = cursor.1 + utf16_len(gap);
        cursor = (whole.start(), start);
        let Some(target) = targets.get(&key) else {
            continue;
        };
        // The caption itself, "Figure 2: ..." at the head of a line, is the target, not a link.
        let at_line_start = whole.start() == 0
            || page
                .text
                .get(..whole.start())
                .is_some_and(|before| before.ends_with('\n'));
        let after = page.text.get(whole.end()..).unwrap_or_default();
        if at_line_start && (after.starts_with(':') || after.starts_with('.')) {
            continue;
        }
        out.push(FigureMention {
            page: page.number,
            start: units(start),
            end: units(start + utf16_len(whole.as_str())),
            kind,
            target: target.clone(),
        });
    }
    out
}

/// Every figure, table, equation, section and algorithm mention in `pages`, each resolved to its
/// first caption, equation or heading. `outline` defaults to the outline inferred from the text
/// runs. Twin of `findFigureMentions`.
#[must_use]
pub fn find_figure_mentions(
    pages: &[FigurePage],
    outline: Option<&[OutlineReaderItem]>,
) -> Vec<FigureMention> {
    let (Some(caption_re), Some(equation_re), Some(section_re), Some(mention_re)) = (
        CAPTION_RE.as_ref(),
        EQUATION_RE.as_ref(),
        SECTION_RE.as_ref(),
        MENTION_RE.as_ref(),
    ) else {
        return Vec::new();
    };
    let inferred = match outline {
        Some(_) => Vec::new(),
        None => {
            let page_items: Vec<Vec<OutlineTextItem>> =
                pages.iter().map(|page| page.items.clone()).collect();
            outline_from_text(&page_items)
        }
    };
    let outline = outline.unwrap_or(inferred.as_slice());
    let mut targets = HashMap::new();
    for page in pages {
        put_captions(&mut targets, page, caption_re);
        put_equations(&mut targets, page, equation_re);
    }
    put_sections(&mut targets, outline, section_re);
    pages
        .iter()
        .flat_map(|page| mentions_in_page(page, &targets, mention_re))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(text: &str, x: f64, y: f64) -> OutlineTextItem {
        OutlineTextItem {
            str: text.to_owned(),
            font_size: 10.0,
            font_name: None,
            x,
            y,
            page: 1.0,
            rotated: None,
        }
    }

    fn page(number: f64, text: &str, items: Vec<OutlineTextItem>) -> FigurePage {
        FigurePage {
            number,
            text: text.to_owned(),
            items,
        }
    }

    fn spans(mentions: &[FigureMention]) -> Vec<(f64, f64, f64, FigureMentionKind)> {
        mentions
            .iter()
            .map(|m| (m.page, m.start, m.end, m.kind))
            .collect()
    }

    #[test]
    fn figure_and_equation_mentions_resolve_to_first_targets() {
        let pages = [
            page(
                1.0,
                "See Fig. 2 and Eq. (3)",
                vec![run("See Fig. 2 and Eq. (3)", 40.0, 700.0)],
            ),
            page(
                2.0,
                "Figure 2 A caption",
                vec![
                    run("Figure 2 A caption", 40.0, 700.0),
                    run("(3)", 500.0, 300.0),
                ],
            ),
        ];
        let mentions = find_figure_mentions(&pages, None);
        assert_eq!(mentions.len(), 3);
        assert_eq!(
            spans(&mentions),
            [
                (1.0, 4.0, 10.0, FigureMentionKind::Figure),
                (1.0, 15.0, 22.0, FigureMentionKind::Equation),
                (2.0, 0.0, 8.0, FigureMentionKind::Figure),
            ]
        );
        assert_eq!(
            mentions[0].target,
            FigureTarget {
                page: 2.0,
                y: 700.0,
                x: Some(40.0),
                height: Some(10.0),
                label: Some("Figure 2".to_owned()),
                kind: Some("figure".to_owned()),
            }
        );
        assert_eq!(
            mentions[1].target,
            FigureTarget {
                page: 2.0,
                y: 300.0,
                x: Some(500.0),
                height: Some(10.0),
                label: Some("Equation (3)".to_owned()),
                kind: Some("equation".to_owned()),
            }
        );
        // Short documents have no inferred outline, so the default and an empty one agree.
        assert_eq!(mentions, find_figure_mentions(&pages, Some(&[])));
    }

    #[test]
    fn caption_line_is_a_target_not_a_mention_of_itself() {
        let pages = [
            page(
                1.0,
                "As Figure 1 shows.",
                vec![run("As Figure 1 shows.", 40.0, 700.0)],
            ),
            page(
                2.0,
                "Figure 1: The thing.\nFigure 1 is above.",
                vec![
                    run("Figure 1: The thing.", 40.0, 700.0),
                    run("Figure 1 is above.", 40.0, 680.0),
                ],
            ),
        ];
        let mentions = find_figure_mentions(&pages, Some(&[]));
        assert_eq!(
            spans(&mentions),
            [
                (1.0, 3.0, 11.0, FigureMentionKind::Figure),
                (2.0, 21.0, 29.0, FigureMentionKind::Figure)
            ]
        );
    }

    #[test]
    fn section_mention_resolves_to_numbered_outline_heading() {
        let outline = [OutlineReaderItem {
            title: "2 Method".to_owned(),
            page_number: Some(3.0),
            y: Some(600.0),
            items: None,
        }];
        let pages = [page(1.0, "See Section 2 for details.", Vec::new())];
        let mentions = find_figure_mentions(&pages, Some(&outline));
        assert_eq!(
            spans(&mentions),
            [(1.0, 4.0, 13.0, FigureMentionKind::Section)]
        );
        assert_eq!(
            mentions[0].target,
            FigureTarget {
                page: 3.0,
                y: 600.0,
                x: None,
                height: None,
                label: Some("2 Method".to_owned()),
                kind: Some("section".to_owned()),
            }
        );
    }

    #[test]
    fn offsets_are_utf16_units_after_astral_characters() {
        let pages = [page(
            1.0,
            "\u{1F600} Fig. 2",
            vec![run("Figure 2 caption", 40.0, 700.0)],
        )];
        let mentions = find_figure_mentions(&pages, Some(&[]));
        assert_eq!(
            spans(&mentions),
            [(1.0, 3.0, 9.0, FigureMentionKind::Figure)]
        );
    }

    #[test]
    fn mention_without_a_target_is_dropped() {
        let pages = [page(1.0, "Table 9 and Figure 4.", Vec::new())];
        assert!(find_figure_mentions(&pages, Some(&[])).is_empty());
    }
}

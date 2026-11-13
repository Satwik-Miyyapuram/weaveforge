//! Ink page model and text-layer helpers. Ports the page, stroke and text-layer
//! functions of `packages/core/src/ink/parts-2.ts`; the frontmatter, body header and
//! frontmatter-level helpers live in `crate::sync::ink_note`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::ink::width::{INK_PEN_WIDTH, clamp_ink_note_width};
use crate::search::js_text::is_js_whitespace;
use crate::sync::ink_note::{INK_NOTE_MAX_PAGES, InkPaper, is_ink_chunk_id};

/// A4 width in 0.1 mm.
pub const INK_A4_WIDTH: f64 = 2100.0;
/// A4 height in 0.1 mm.
pub const INK_A4_HEIGHT: f64 = 2970.0;
/// Largest coordinate an `Int16` container slot can hold.
pub const INK_COORD_LIMIT: u16 = 32_767;
/// Strokes per page before the ink bar warns.
pub const INK_PAGE_STROKE_BUDGET: usize = 5_000;
/// Alt text that marks an image ref as a page's background.
pub const INK_BACKGROUND_ALT: &str = "page background";

/// Tool a stroke was drawn with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum InkTool {
    /// Freehand pen.
    Pen,
    /// Translucent highlighter.
    Highlighter,
    /// Snapped or rough figure.
    Shape,
}

/// Palette colour a stroke indexes into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum InkColour {
    /// Theme text.
    Text,
    /// Theme accent.
    Accent,
    /// Theme warning.
    Warn,
    /// Theme success.
    Good,
    /// Theme information.
    Info,
    /// Theme danger.
    Danger,
    /// Marker yellow.
    Yellow,
    /// Marker red.
    Red,
    /// Marker green.
    Green,
    /// Marker blue.
    Blue,
    /// Marker purple.
    Purple,
    /// Marker pink.
    Pink,
    /// Marker orange.
    Orange,
    /// Marker grey.
    Grey,
}

/// Optional snapped shape replacing a stroke's freehand path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum InkShape {
    /// Freehand path kept as drawn.
    None,
    /// Snapped straight line.
    Line,
    /// Snapped rectangle.
    Rect,
    /// Snapped ellipse.
    Ellipse,
    /// Snapped arrow.
    Arrow,
}

/// One stroke: absolute points and names, no deltas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkStroke {
    /// Absolute positions in 0.1 mm as `[x0, y0, x1, y1, ...]`.
    pub points: Vec<f64>,
    /// Pressure per point, 0 to 255, or empty when the device reports none.
    pub pressures: Vec<f64>,
    /// Base nib width in 0.1 mm.
    pub width: f64,
    /// Tool the stroke was drawn with.
    pub tool: InkTool,
    /// Palette colour.
    pub colour: InkColour,
    /// Stroke start, ms from page creation.
    pub t0: f64,
    /// Snapped shape, or `none` for the freehand path.
    pub shape: InkShape,
    /// Line this stroke was segmented into, `-1` when never.
    pub line_index: f64,
}

/// The fields a caller gives `make_ink_stroke`; every field but `points` defaults.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkStrokeInput {
    /// Absolute positions in 0.1 mm.
    pub points: Vec<f64>,
    /// Pressure per point, defaults to none.
    pub pressures: Option<Vec<f64>>,
    /// Base nib width, defaults to the default pen.
    pub width: Option<f64>,
    /// Tool, defaults to the pen.
    pub tool: Option<InkTool>,
    /// Colour, defaults to the theme text colour.
    pub colour: Option<InkColour>,
    /// Stroke start, defaults to `0`.
    pub t0: Option<f64>,
    /// Shape, defaults to `none`.
    pub shape: Option<InkShape>,
    /// Segmented line, defaults to `-1`.
    pub line_index: Option<f64>,
}

/// One recognised line of a page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
// Exported type name differs from `segment::InkLineRecord`; the container name never reaches JSON.
#[serde(rename = "InkPageLineRecord", rename_all = "camelCase")]
pub struct InkLineRecord {
    /// Index of the first stroke of the line.
    pub stroke_start: f64,
    /// Number of strokes in the line.
    pub stroke_count: f64,
    /// Top of the line in 0.1 mm.
    pub y_min: f64,
    /// Bottom of the line in 0.1 mm.
    pub y_max: f64,
    /// The recognised text.
    pub text: String,
    /// Confidence, `0` to `1`.
    pub confidence: f64,
}

/// A page: absolute geometry plus its strokes and recognised lines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkPage {
    /// Page width in 0.1 mm.
    pub width: f64,
    /// Page height in 0.1 mm.
    pub height: f64,
    /// Page background.
    pub paper: InkPaper,
    /// Attachment index for a page image, `0` for none.
    pub background: f64,
    /// Strokes in drawing order.
    pub strokes: Vec<InkStroke>,
    /// Recognised lines.
    pub lines: Vec<InkLineRecord>,
}

/// A page's width and height, clamped to what an `Int16` coordinate can hold.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkPageSize {
    /// Width in 0.1 mm.
    pub width: f64,
    /// Height in 0.1 mm.
    pub height: f64,
}

/// Index of `value` in `values`, or `0` where it is not in the vocabulary.
#[must_use]
pub fn ink_enum_index<S: AsRef<str>>(values: &[S], value: &str) -> usize {
    values
        .iter()
        .position(|candidate| candidate.as_ref() == value)
        .unwrap_or(0)
}

/// The name at `index`, or the vocabulary's first entry where out of range; `None` when empty.
#[must_use]
pub fn ink_enum_value<S: AsRef<str>>(values: &[S], index: f64) -> Option<&str> {
    whole_index(index)
        .and_then(|at| values.get(at))
        .or_else(|| values.first())
        .map(AsRef::as_ref)
}

/// `index` as a position when it is a non-negative whole number.
fn whole_index(index: f64) -> Option<usize> {
    let whole = index.fract().abs() < f64::MIN_POSITIVE;
    (whole && index >= 0.0).then_some(index as usize)
}

/// A stroke with the defaults filled in.
#[must_use]
pub fn make_ink_stroke(input: InkStrokeInput) -> InkStroke {
    InkStroke {
        points: input.points,
        pressures: input.pressures.unwrap_or_default(),
        width: clamp_ink_note_width(input.width.unwrap_or(INK_PEN_WIDTH), INK_PEN_WIDTH),
        tool: input.tool.unwrap_or(InkTool::Pen),
        colour: input.colour.unwrap_or(InkColour::Text),
        t0: input.t0.unwrap_or(0.0),
        shape: input.shape.unwrap_or(InkShape::None),
        line_index: input.line_index.unwrap_or(-1.0),
    }
}

/// An empty A4 page on the given paper.
#[must_use]
pub fn blank_ink_page(paper: InkPaper) -> InkPage {
    InkPage {
        width: INK_A4_WIDTH,
        height: INK_A4_HEIGHT,
        paper,
        background: 0.0,
        strokes: Vec::new(),
        lines: Vec::new(),
    }
}

/// Width and height clamped to what an `Int16` coordinate can hold; defaults to A4 per side.
#[must_use]
pub fn clamp_ink_page_size(width: f64, height: f64) -> InkPageSize {
    InkPageSize {
        width: fit_page_side(width, INK_A4_WIDTH),
        height: fit_page_side(height, INK_A4_HEIGHT),
    }
}

fn fit_page_side(value: f64, fallback: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value.round().min(f64::from(INK_COORD_LIMIT))
    } else {
        fallback
    }
}

/// The `<!-- page N -->` line that opens page `page`.
#[must_use]
pub fn ink_page_marker(page: f64) -> String {
    format!("<!-- page {page} -->")
}

/// One text layer per page joined back into a note body, markers included.
#[must_use]
pub fn join_ink_text_layer(pages: &[String]) -> String {
    if pages.is_empty() {
        return String::new();
    }
    let parts: Vec<String> = pages
        .iter()
        .enumerate()
        .map(|(index, text)| {
            let trimmed = text.trim_matches(is_js_whitespace);
            if index == 0 {
                return trimmed.to_owned();
            }
            let marker = ink_page_marker((index + 1) as f64);
            if trimmed.is_empty() {
                marker
            } else {
                format!("{marker}\n\n{trimmed}")
            }
        })
        .collect();
    format!("{}\n", parts.join("\n\n"))
}

/// The attachment path a text layer names as its background line, or `None`.
#[must_use]
pub fn ink_page_background(text: &str) -> Option<&str> {
    let first = text
        .split('\n')
        .next()
        .unwrap_or_default()
        .trim_matches(is_js_whitespace);
    background_path(first)
}

/// The path inside a `![page background](vault:...)` line, or `None` for any other line.
fn background_path(line: &str) -> Option<&str> {
    let inner = line
        .strip_prefix("![page background](vault:")?
        .strip_suffix(')')?;
    let plain = !inner.is_empty() && !inner.chars().any(|c| c == ')' || is_js_whitespace(c));
    plain.then_some(inner)
}

/// A text layer with its background line replaced by `path`, or removed for `None`.
#[must_use]
pub fn with_ink_page_background(text: &str, path: Option<&str>) -> String {
    let lines = text_lines(text);
    let body: &[&str] = match lines.split_first() {
        Some((first, tail)) if background_path(first.trim_matches(is_js_whitespace)).is_some() => {
            tail
        }
        _ => &lines,
    };
    let rest = trim_blank_edges(body).join("\n");
    match path.filter(|p| !p.is_empty()) {
        None => rest,
        Some(path) => {
            let line = format!("![{INK_BACKGROUND_ALT}](vault:{path})");
            if rest.is_empty() {
                line
            } else {
                format!("{line}\n\n{rest}")
            }
        }
    }
}

/// The 1-based position of `path` among the body's `vault:` image refs, or `0`.
#[must_use]
pub fn ink_attachment_index(body: &str, path: Option<&str>) -> u8 {
    let Some(path) = path.filter(|p| !p.is_empty()) else {
        return 0;
    };
    let mut seen: Vec<&str> = Vec::new();
    let mut rest = body;
    while let Some(at) = rest.find("![") {
        let after = rest.get(at + 2..).unwrap_or_default();
        if let Some((target, used)) = vault_image_ref(after) {
            if !seen.contains(&target) {
                seen.push(target);
            }
            rest = after.get(used..).unwrap_or_default();
        } else {
            rest = rest.get(at + 1..).unwrap_or_default();
        }
    }
    seen.iter()
        .position(|candidate| *candidate == path)
        .map_or(0, |index| u8::try_from(index + 1).unwrap_or(u8::MAX))
}

/// The `vault:` target of an image ref whose `![` precedes `after`, and the bytes it spans.
fn vault_image_ref(after: &str) -> Option<(&str, usize)> {
    let close = after.find(']')?;
    let tail = after.get(close + 1..)?.strip_prefix("(vault:")?;
    let run = tail
        .find(|c: char| c == ')' || is_js_whitespace(c))
        .unwrap_or(tail.len());
    if run == 0 || !tail.get(run..)?.starts_with(')') {
        return None;
    }
    let consumed = (after.len() - tail.len()) + run + 1;
    Some((tail.get(..run)?, consumed))
}

/// The page order a note declares, reconciled with the chunks that exist.
///
/// Declared order first, then unrecorded chunks in id order, capped at the note's page limit.
#[must_use]
pub fn resolve_ink_page_order(declared: &[String], present: &[String]) -> Vec<String> {
    let available: HashSet<&str> = present
        .iter()
        .map(String::as_str)
        .filter(|id| is_ink_chunk_id(id))
        .collect();
    let ordered: Vec<&str> = declared
        .iter()
        .map(String::as_str)
        .filter(|id| available.contains(id))
        .collect();
    let seen: HashSet<&str> = ordered.iter().copied().collect();
    let mut extra: Vec<&str> = present
        .iter()
        .map(String::as_str)
        .filter(|id| !seen.contains(id) && is_ink_chunk_id(id))
        .collect();
    extra.sort_unstable();
    let limit = usize::try_from(INK_NOTE_MAX_PAGES).unwrap_or(usize::MAX);
    ordered
        .into_iter()
        .chain(extra)
        .take(limit)
        .map(str::to_owned)
        .collect()
}

/// The pages a note loads, in order: the declared ids that are valid chunk ids,
/// kept even where their chunk is missing so later pages keep their number, then
/// the unrecorded chunks [`resolve_ink_page_order`] appends. Each id appears once.
#[must_use]
pub fn compose_ink_page_order(declared: &[String], present: &[String]) -> Vec<String> {
    let declared: Vec<String> = declared
        .iter()
        .filter(|id| is_ink_chunk_id(id))
        .cloned()
        .collect();
    let mut order: Vec<String> = Vec::with_capacity(declared.len());
    for id in &declared {
        if !order.contains(id) {
            order.push(id.clone());
        }
    }
    for id in resolve_ink_page_order(&declared, present) {
        if !order.contains(&id) {
            order.push(id);
        }
    }
    order
}

/// Whether a page has more strokes than the soft budget it should warn about.
#[must_use]
pub fn ink_page_over_budget(page: &InkPage) -> bool {
    page.strokes.len() > INK_PAGE_STROKE_BUDGET
}

/// Lines as JS `split(/\r?\n/)` gives them: a CR is dropped only when an LF follows it.
fn text_lines(text: &str) -> Vec<&str> {
    let parts: Vec<&str> = text.split('\n').collect();
    let last = parts.len().saturating_sub(1);
    parts
        .into_iter()
        .enumerate()
        .map(|(index, line)| {
            if index < last {
                line.strip_suffix('\r').unwrap_or(line)
            } else {
                line
            }
        })
        .collect()
}

/// Drops blank lines at both ends, by JS whitespace.
fn trim_blank_edges<'a>(lines: &[&'a str]) -> Vec<&'a str> {
    let start = lines
        .iter()
        .position(|line| !is_blank_line(line))
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|line| !is_blank_line(line))
        .map_or(start, |index| index + 1);
    lines.get(start..end).unwrap_or(&[]).to_vec()
}

fn is_blank_line(line: &str) -> bool {
    line.trim_matches(is_js_whitespace).is_empty()
}

#[cfg(test)]
mod tests {
    use super::{
        INK_A4_HEIGHT, INK_A4_WIDTH, INK_PAGE_STROKE_BUDGET, INK_PEN_WIDTH, InkColour, InkPage,
        InkPaper, InkShape, InkStrokeInput, InkTool, blank_ink_page, clamp_ink_page_size,
        compose_ink_page_order, ink_attachment_index, ink_enum_index, ink_enum_value,
        ink_page_background, ink_page_marker, ink_page_over_budget, join_ink_text_layer,
        make_ink_stroke, resolve_ink_page_order, with_ink_page_background,
    };
    use crate::sync::ink_note::{INK_NOTE_MAX_PAGES, split_ink_text_layer};

    const CHUNK_A: &str = "01JABCDEFGHJKMNPQRSTVWXYZ0";
    const CHUNK_B: &str = "01JABCDEFGHJKMNPQRSTVWXYZ1";

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|id| (*id).to_owned()).collect()
    }

    #[test]
    fn blank_page_is_an_empty_a4_page() {
        let page = blank_ink_page(InkPaper::Blank);
        assert!(page.strokes.is_empty());
        assert!((page.width - INK_A4_WIDTH).abs() < f64::EPSILON);
        assert!((page.height - INK_A4_HEIGHT).abs() < f64::EPSILON);
    }

    #[test]
    fn clamp_falls_back_to_a4_for_zero_and_nan() {
        let zero = clamp_ink_page_size(0.0, 0.0);
        assert_eq!((zero.width, zero.height), (INK_A4_WIDTH, INK_A4_HEIGHT));
        let nan = clamp_ink_page_size(f64::NAN, 12.0);
        assert_eq!((nan.width, nan.height), (INK_A4_WIDTH, 12.0));
    }

    #[test]
    fn clamp_caps_at_int16_and_rounds() {
        let capped = clamp_ink_page_size(100_000.0, 100_000.0);
        assert_eq!((capped.width, capped.height), (32_767.0, 32_767.0));
        let rounded = clamp_ink_page_size(2100.4, 2970.6);
        assert_eq!((rounded.width, rounded.height), (2100.0, 2971.0));
    }

    #[test]
    fn marker_numbers_the_page() {
        assert_eq!(ink_page_marker(2.0), "<!-- page 2 -->");
    }

    #[test]
    fn text_layer_splits_and_rejoins_unchanged() {
        let pages = vec![
            "Drop the β sweep for §3.2, see [[Graph-prior module]].".to_owned(),
            "![](vault:papers/kipf-2016/page-3.png)\nCompare against [[VGAE]] table 2.".to_owned(),
        ];
        let joined = join_ink_text_layer(&pages);
        assert_eq!(split_ink_text_layer(&joined).len(), 2);
        assert_eq!(split_ink_text_layer(&joined), pages);
    }

    #[test]
    fn a_text_layer_with_no_text_is_one_empty_page() {
        assert_eq!(join_ink_text_layer(&[String::new()]), "\n");
        assert_eq!(
            split_ink_text_layer(&join_ink_text_layer(&[String::new(), String::new()])),
            vec![String::new(), String::new()]
        );
        assert_eq!(join_ink_text_layer(&[]), "");
    }

    #[test]
    fn background_is_the_first_line_image_ref_only() {
        assert_eq!(ink_page_background(""), None);
        assert_eq!(
            ink_page_background("hello\n![page background](vault:u/p/a.png)"),
            None,
            "not first line"
        );
        assert_eq!(ink_page_background("![figure](vault:u/p/a.png)"), None);
    }

    #[test]
    fn background_survives_a_text_replacement() {
        let with_bg = with_ink_page_background("first line\nsecond", Some("u/p/a.png"));
        assert_eq!(
            with_bg,
            "![page background](vault:u/p/a.png)\n\nfirst line\nsecond"
        );
        assert_eq!(ink_page_background(&with_bg), Some("u/p/a.png"));
        let again = with_ink_page_background(
            &with_ink_page_background(&with_bg, Some("u/p/b.png")),
            Some("u/p/b.png"),
        );
        assert_eq!(
            again
                .split('\n')
                .filter(|line| line.starts_with("![page background]"))
                .count(),
            1
        );
        assert_eq!(ink_page_background(&again), Some("u/p/b.png"));
        assert_eq!(
            with_ink_page_background(&with_bg, None),
            "first line\nsecond"
        );
        assert_eq!(
            with_ink_page_background("", Some("u/p/c.png")),
            "![page background](vault:u/p/c.png)"
        );
    }

    #[test]
    fn attachment_index_is_the_position_among_vault_images() {
        let body = "![x](vault:u/p/a.png)\n\n<!-- page 2 -->\n\n![page background](vault:u/p/b.png)\n![x](vault:u/p/a.png)";
        assert_eq!(ink_attachment_index(body, Some("u/p/a.png")), 1);
        assert_eq!(ink_attachment_index(body, Some("u/p/b.png")), 2);
        assert_eq!(ink_attachment_index(body, Some("u/p/none.png")), 0);
        assert_eq!(ink_attachment_index(body, None), 0);
    }

    #[test]
    fn page_order_declared_first_then_unrecorded_chunks() {
        assert_eq!(
            resolve_ink_page_order(&ids(&[CHUNK_B, CHUNK_A]), &ids(&[CHUNK_A, CHUNK_B])),
            ids(&[CHUNK_B, CHUNK_A])
        );
        assert_eq!(
            resolve_ink_page_order(&ids(&[CHUNK_B]), &ids(&[CHUNK_A, CHUNK_B])),
            ids(&[CHUNK_B, CHUNK_A])
        );
        assert_eq!(
            resolve_ink_page_order(&ids(&[CHUNK_B, CHUNK_A]), &ids(&[CHUNK_B])),
            ids(&[CHUNK_B])
        );
        assert_eq!(
            resolve_ink_page_order(&[], &ids(&["notes.md", CHUNK_A])),
            ids(&[CHUNK_A])
        );
        let many = vec![CHUNK_A.to_owned(); 60];
        assert_eq!(
            resolve_ink_page_order(&[], &many).len(),
            usize::try_from(INK_NOTE_MAX_PAGES).unwrap_or(usize::MAX)
        );
    }

    // it: "loadInkPages keeps declared order, appends orphans, and makes one page from nothing"
    #[test]
    fn load_keeps_declared_order_appends_orphans_and_keeps_missing_pages() {
        const CHUNK_C: &str = "01JABCDEFGHJKMNPQRSTVWXYZ2";
        const CHUNK_GONE: &str = "01JABCDEFGHJKMNPQRSTVWXYZ3";
        assert_eq!(compose_ink_page_order(&[], &[]), Vec::<String>::new());
        assert_eq!(
            compose_ink_page_order(&ids(&[CHUNK_B, CHUNK_A]), &ids(&[CHUNK_A, CHUNK_C])),
            ids(&[CHUNK_B, CHUNK_A, CHUNK_C])
        );
        assert_eq!(
            compose_ink_page_order(&ids(&[CHUNK_B, CHUNK_GONE, CHUNK_A]), &ids(&[CHUNK_A])),
            ids(&[CHUNK_B, CHUNK_GONE, CHUNK_A])
        );
        assert_eq!(
            compose_ink_page_order(&ids(&[CHUNK_A, CHUNK_A, "notes.md"]), &ids(&[CHUNK_A])),
            ids(&[CHUNK_A])
        );
    }

    #[test]
    fn page_over_the_stroke_budget_is_flagged() {
        let stroke = make_ink_stroke(InkStrokeInput {
            points: vec![0.0, 0.0, 10.0, 10.0],
            ..Default::default()
        });
        let mut page: InkPage = blank_ink_page(InkPaper::Blank);
        assert!(!ink_page_over_budget(&page));
        page.strokes = vec![stroke; INK_PAGE_STROKE_BUDGET + 1];
        assert!(ink_page_over_budget(&page));
    }

    #[test]
    fn stroke_defaults_fill_in() {
        let stroke = make_ink_stroke(InkStrokeInput {
            points: vec![10.0, 10.0],
            ..Default::default()
        });
        assert!(stroke.pressures.is_empty());
        assert!((stroke.width - INK_PEN_WIDTH).abs() < f64::EPSILON);
        assert_eq!(stroke.tool, InkTool::Pen);
        assert_eq!(stroke.colour, InkColour::Text);
        assert!(stroke.t0.abs() < f64::EPSILON);
        assert_eq!(stroke.shape, InkShape::None);
        assert!((stroke.line_index + 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn enum_index_is_zero_for_unknown_names() {
        let tools = ["pen", "highlighter", "shape"];
        assert_eq!(ink_enum_index(&tools, "shape"), 2);
        assert_eq!(ink_enum_index(&tools, "laser"), 0);
    }

    #[test]
    fn enum_value_falls_back_to_the_first_entry() {
        let tools = ["pen", "highlighter"];
        assert_eq!(ink_enum_value(&tools, 1.0), Some("highlighter"));
        assert_eq!(ink_enum_value(&tools, 9.0), Some("pen"));
        assert_eq!(ink_enum_value(&tools, -1.0), Some("pen"));
        let none: [&str; 0] = [];
        assert_eq!(ink_enum_value(&none, 0.0), None);
    }
}

//! Figures: images placed on a page, written as image refs in the page's text
//! (`![figure x=… y=… w=… h=… c=…](vault:…)`). Port of `figure.ts`.
//!
//! Boxes are in page units (tenths of a millimetre); `c` is the four crop
//! insets as percentages of the image's own box (left, top, right, bottom).

use std::sync::OnceLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::js_math::{max, min, round};
use crate::papers::js_regex::{compile, space_class};
use crate::reader_analysis::lines::{is_js_space, js_trim, js_trim_end};
use crate::sync::frontmatter::js_number;
use crate::sync::ink_note::js_number_of;

/// The alt text that marks an image ref as a placed figure.
pub const FIGURE_ALT: &str = "figure";

/// The handles a box shows, in reading order.
pub const FIGURE_HANDLES: [&str; 8] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/// A figure's box and crop, without the image it shows.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigureBox {
    /// Top-left corner from the page's top-left, in page units.
    pub x: f64,
    /// Top edge, in page units.
    pub y: f64,
    /// Width, in page units.
    pub w: f64,
    /// Height, in page units.
    pub h: f64,
    /// Crop insets `[left, top, right, bottom]`, each 0–99 percent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub crop: Option<[f64; 4]>,
}

/// An image placement: the attachment it shows and where it sits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigurePlacement {
    /// The attachment path, without the `vault:` scheme.
    pub path: String,
    /// Top-left corner from the page's top-left, in page units.
    pub x: f64,
    /// Top edge, in page units.
    pub y: f64,
    /// Width, in page units.
    pub w: f64,
    /// Height, in page units.
    pub h: f64,
    /// Crop insets `[left, top, right, bottom]`, each 0–99 percent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub crop: Option<[f64; 4]>,
}

impl FigurePlacement {
    fn geometry(&self) -> FigureBox {
        FigureBox {
            x: self.x,
            y: self.y,
            w: self.w,
            h: self.h,
            crop: self.crop,
        }
    }
}

/// A plain rectangle in page units.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigureRect {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
}

/// Where the whole picture sits inside a figure's frame, as percentages of the frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigureImageFrame {
    /// Left offset.
    pub left: f64,
    /// Top offset.
    pub top: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// A handle on a figure's box: a corner or an edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum FigureHandle {
    /// Top-left corner.
    Nw,
    /// Top edge.
    N,
    /// Top-right corner.
    Ne,
    /// Right edge.
    E,
    /// Bottom-right corner.
    Se,
    /// Bottom edge.
    S,
    /// Bottom-left corner.
    Sw,
    /// Left edge.
    W,
}

/// Where a figure moves in the page's stacking order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum FigureOrderStep {
    /// To the top.
    Front,
    /// One up.
    Forward,
    /// One down.
    Backward,
    /// To the bottom.
    Back,
}

fn regex(cell: &'static OnceLock<Regex>, pattern: impl FnOnce() -> String) -> &'static Regex {
    cell.get_or_init(|| match compile(&pattern()) {
        Ok(re) => re,
        Err(err) => unreachable!("static pattern failed to compile: {err}"),
    })
}

fn token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(&RE, || r"\b([a-z])=([0-9.,-]+)".to_owned())
}

/// One figure line: `![figure …](vault:path)` or `paperimg:`.
fn figure_line_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(&RE, || {
        format!(
            r"^!\[\s*figure\b([^\]]*)\]\((?:vault:|paperimg:)([^){}]+)\)$",
            space_class()
        )
    })
}

/// Any image ref, path captured.
fn any_image_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(&RE, || {
        format!(
            r"!\[[^\]]*\]\((?:vault:|paperimg:)([^){}]+)\)",
            space_class()
        )
    })
}

fn background_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(&RE, || {
        format!(r"^!\[page background\]\(vault:([^){}]+)\)$", space_class())
    })
}

/// The geometry tokens in an image alt, or `None` when the box is not complete.
///
/// `x`/`y`/`w`/`h` are the box; `c` is the crop. Unknown tokens are ignored and a
/// junk crop keeps the previous one.
#[must_use]
pub fn parse_figure_tokens(alt: &str) -> Option<FigureBox> {
    let (mut x, mut y, mut w, mut h, mut crop) = (None, None, None, None, None);
    for caps in token_re().captures_iter(alt) {
        let raw = caps.get(2).map_or("", |m| m.as_str());
        match caps.get(1).map_or("", |m| m.as_str()) {
            "x" => x = Some(js_number_of(raw)),
            "y" => y = Some(js_number_of(raw)),
            "w" => w = Some(js_number_of(raw)),
            "h" => h = Some(js_number_of(raw)),
            "c" => crop = parse_figure_crop(raw).or(crop),
            _ => {}
        }
    }
    let (x, y, w, h) = (x?, y?, w?, h?);
    if !(x.is_finite() && y.is_finite() && w.is_finite() && h.is_finite()) || w <= 0.0 || h <= 0.0 {
        return None;
    }
    Some(FigureBox { x, y, w, h, crop })
}

/// A `c=l,t,r,b` value as crop insets clamped to 0..99, or `None` when it is not four numbers.
#[must_use]
pub fn parse_figure_crop(raw: &str) -> Option<[f64; 4]> {
    let parts: Vec<f64> = raw
        .split(',')
        .map(|part| js_number_of(js_trim(part)))
        .collect();
    let [l, t, r, b] = <[f64; 4]>::try_from(parts).ok()?;
    if ![l, t, r, b].iter().all(|n| n.is_finite()) {
        return None;
    }
    Some([l, t, r, b].map(|n| min(99.0, max(0.0, n))))
}

/// A box moved so at least half of it stays on the page; returns the new `(x, y)`.
#[must_use]
pub fn keep_figure_on_page(rect: FigureRect, page_width: f64, page_height: f64) -> (f64, f64) {
    let x = round(min(max(rect.x, -rect.w / 2.0), page_width - rect.w / 2.0));
    let y = round(min(max(rect.y, -rect.h / 2.0), page_height - rect.h / 2.0));
    (x, y)
}

/// How near a corner, in page units at `scale` CSS pixels per unit, a press takes it.
#[must_use]
pub fn figure_corner_hit(scale: f64) -> f64 {
    (12.0 + 18.0) / scale
}

/// A tenth of a page unit is fine enough; finer is noise.
fn round_tenth(value: f64) -> f64 {
    round(value * 10.0) / 10.0
}

/// The geometry tokens as they are written in an alt.
#[must_use]
pub fn format_figure_tokens(geometry: &FigureBox) -> String {
    let mut parts = vec![
        format!("x={}", js_number(round_tenth(geometry.x))),
        format!("y={}", js_number(round_tenth(geometry.y))),
        format!("w={}", js_number(round_tenth(geometry.w))),
        format!("h={}", js_number(round_tenth(geometry.h))),
    ];
    if let Some(crop) = geometry.crop {
        let insets: Vec<String> = crop.iter().map(|&n| js_number(round_tenth(n))).collect();
        parts.push(format!("c={}", insets.join(",")));
    }
    parts.join(" ")
}

/// JS `text.split(/\r?\n/)`.
fn split_lines(text: &str) -> Vec<&str> {
    let pieces: Vec<&str> = text.split('\n').collect();
    let last = pieces.len() - 1;
    pieces
        .into_iter()
        .enumerate()
        .map(|(i, line)| {
            if i < last {
                line.strip_suffix('\r').unwrap_or(line)
            } else {
                line
            }
        })
        .collect()
}

/// The figures a page's text places, in line order.
#[must_use]
pub fn ink_page_figures(text: &str) -> Vec<FigurePlacement> {
    split_lines(text)
        .into_iter()
        .filter_map(|line| {
            let caps = figure_line_re().captures(js_trim(line))?;
            let geometry = parse_figure_tokens(caps.get(1).map_or("", |m| m.as_str()))?;
            let path = caps.get(2)?.as_str().to_owned();
            Some(FigurePlacement {
                path,
                x: geometry.x,
                y: geometry.y,
                w: geometry.w,
                h: geometry.h,
                crop: geometry.crop,
            })
        })
        .collect()
}

/// Drops every fully blank leading line (`^[^\S\n]*\n(?:[^\S\n]*\n)*`).
fn drop_blank_leading_lines(mut text: &str) -> &str {
    while let Some(end) = text.find('\n') {
        if !text[..end].chars().all(is_js_space) {
            break;
        }
        text = &text[end + 1..];
    }
    text
}

/// A page's text with its figure block set: after the background line, before the text.
#[must_use]
pub fn with_ink_page_figures(text: &str, figures: &[FigurePlacement]) -> String {
    let lines = split_lines(text);
    let first = lines.first().map_or("", |line| js_trim(line));
    let background = background_re().is_match(first).then_some(first);
    let kept: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| *i > 0 || background.is_none())
        .map(|(_, line)| *line)
        .filter(|line| !figure_line_re().is_match(js_trim(line)))
        .collect();
    let joined = kept.join("\n");
    let rest0 = drop_blank_leading_lines(&joined);
    let block: Vec<String> = figures
        .iter()
        .filter(|f| f.x.is_finite() && f.y.is_finite() && f.w > 0.0 && f.h > 0.0)
        .map(|f| {
            format!(
                "![{FIGURE_ALT} {}](vault:{})",
                format_figure_tokens(&f.geometry()),
                f.path
            )
        })
        .collect();
    let rest = if block.is_empty() {
        js_trim_end(rest0).to_owned()
    } else {
        let head = block.join("\n");
        let parts: Vec<&str> = [head.as_str(), rest0]
            .into_iter()
            .filter(|p| !p.is_empty())
            .collect();
        js_trim_end(&parts.join("\n\n")).to_owned()
    };
    match background {
        None => rest,
        Some(bg) if rest.is_empty() => bg.to_owned(),
        Some(bg) => format!("{bg}\n\n{rest}"),
    }
}

/// The alt of the first image ref at `path` in `body`, when it is a placed figure.
#[must_use]
pub fn figure_alt_for(body: &str, path: &str) -> Option<String> {
    let caps = any_image_re()
        .captures_iter(body)
        .find(|caps| caps.get(1).is_some_and(|m| m.as_str() == path))?;
    let whole = caps.get(0)?.as_str();
    if !figure_line_re().is_match(js_trim(whole)) {
        return None;
    }
    let alt = whole.strip_prefix("![")?.split(']').next()?;
    Some(js_trim(alt).to_owned())
}

/// The new order of `len` figures, as old indices, with the one at `index`
/// moved by `step`. "front" is the end. An impossible step keeps the order.
#[must_use]
pub fn reorder_figure_indices(len: usize, index: f64, step: FigureOrderStep) -> Vec<usize> {
    let mut order: Vec<usize> = (0..len).collect();
    if !(index >= 0.0) || index.fract() != 0.0 || index >= len as f64 {
        return order;
    }
    let from = index as usize;
    let last = len - 1;
    let to = match step {
        FigureOrderStep::Front => last,
        FigureOrderStep::Back => 0,
        FigureOrderStep::Forward => last.min(from + 1),
        FigureOrderStep::Backward => from.saturating_sub(1),
    };
    if to != from {
        let one = order.remove(from);
        order.insert(to, one);
    }
    order
}

/// A box resized by dragging `handle` by (`dx`, `dy`). The opposite side holds
/// still; a corner keeps the aspect unless `free`; no side gets shorter than `min_side`.
#[must_use]
pub fn resize_figure_box(
    rect: FigureRect,
    handle: FigureHandle,
    dx: f64,
    dy: f64,
    free: bool,
    min_side: f64,
) -> FigureRect {
    use FigureHandle::{E, N, Ne, Nw, S, Sw, W};
    let west = matches!(handle, Nw | Sw | W);
    let north = matches!(handle, Nw | N | Ne);
    let horizontal = !matches!(handle, N | S);
    let vertical = !matches!(handle, E | W);
    let grow_w = if horizontal {
        rect.w + if west { -dx } else { dx }
    } else {
        rect.w
    };
    let grow_h = if vertical {
        rect.h + if north { -dy } else { dy }
    } else {
        rect.h
    };
    let mut w = max(min_side, grow_w);
    let mut h = max(min_side, grow_h);
    if horizontal && vertical && !free {
        let aspect = rect.w / max(1.0, rect.h);
        let moved_w = (grow_w - rect.w).abs() / max(1.0, rect.w);
        let moved_h = (grow_h - rect.h).abs() / max(1.0, rect.h);
        if moved_w >= moved_h {
            h = max(min_side, w / aspect);
        } else {
            w = max(min_side, h * aspect);
        }
    }
    FigureRect {
        x: round(if west { rect.x + rect.w - w } else { rect.x }),
        y: round(if north { rect.y + rect.h - h } else { rect.y }),
        w: round(w),
        h: round(h),
    }
}

/// The rectangle the whole image would occupy with the crop lifted.
#[must_use]
pub fn uncropped_figure_box(figure: &FigureBox) -> FigureRect {
    let [l, t, r, b] = figure.crop.unwrap_or([0.0; 4]);
    let keep_x = max(1.0, 100.0 - l - r) / 100.0;
    let keep_y = max(1.0, 100.0 - t - b) / 100.0;
    let w = figure.w / keep_x;
    let h = figure.h / keep_y;
    FigureRect {
        x: figure.x - w * (l / 100.0),
        y: figure.y - h * (t / 100.0),
        w,
        h,
    }
}

/// Where the whole picture sits inside the figure's frame, in percent of the frame.
#[must_use]
pub fn figure_image_frame(figure: &FigureBox) -> FigureImageFrame {
    let full = uncropped_figure_box(figure);
    FigureImageFrame {
        left: (full.x - figure.x) / figure.w * 100.0,
        top: (full.y - figure.y) / figure.h * 100.0,
        width: full.w / figure.w * 100.0,
        height: full.h / figure.h * 100.0,
    }
}

/// A figure re-cropped to `kept` inside the uncropped image `full`. Keeping
/// everything clears the crop.
#[must_use]
pub fn crop_figure_to(full: FigureRect, kept: FigureRect) -> FigureBox {
    let pct = |part: f64, whole: f64| {
        min(
            99.0,
            max(0.0, round(part / max(1.0, whole) * 1000.0) / 10.0),
        )
    };
    let l = pct(kept.x - full.x, full.w);
    let t = pct(kept.y - full.y, full.h);
    let r = pct(full.x + full.w - (kept.x + kept.w), full.w);
    let b = pct(full.y + full.h - (kept.y + kept.h), full.h);
    let crop = [l, t, r, b];
    FigureBox {
        x: round(kept.x),
        y: round(kept.y),
        w: max(1.0, round(kept.w)),
        h: max(1.0, round(kept.h)),
        crop: (!crop.iter().all(|&n| n == 0.0)).then_some(crop),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> FigureRect {
        FigureRect { x, y, w, h }
    }

    fn placement(
        path: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        crop: Option<[f64; 4]>,
    ) -> FigurePlacement {
        FigurePlacement {
            path: path.to_owned(),
            x,
            y,
            w,
            h,
            crop,
        }
    }

    #[test]
    fn tokens_round_trip() {
        let geometry = FigureBox {
            x: 120.0,
            y: 80.5,
            w: 600.0,
            h: 400.0,
            crop: Some([0.0, 5.0, 0.0, 10.0]),
        };
        let tokens = format_figure_tokens(&geometry);
        assert_eq!(tokens, "x=120 y=80.5 w=600 h=400 c=0,5,0,10");
        assert_eq!(
            parse_figure_tokens(&format!("figure {tokens}")),
            Some(geometry)
        );
    }

    #[test]
    fn a_placement_needs_its_whole_box() {
        assert_eq!(parse_figure_tokens("figure photo w=600"), None);
        assert_eq!(parse_figure_tokens("figure x=0 y=0 w=600 h=0"), None);
        assert_eq!(
            parse_figure_tokens("note the x=1 in prose and y=2 too"),
            None
        );
        assert!(parse_figure_tokens("right margin x=10 y=10 w=50 h=50").is_some());
        assert_eq!(
            parse_figure_tokens("figure x=1 y=2 w=3 h=4 c=oops"),
            Some(FigureBox {
                x: 1.0,
                y: 2.0,
                w: 3.0,
                h: 4.0,
                crop: None
            })
        );
        // `1.2.3` is NaN in JS, so the box is incomplete.
        assert_eq!(parse_figure_tokens("figure x=1.2.3 y=2 w=3 h=4"), None);
    }

    #[test]
    fn crop_insets_are_clamped_and_empty_parts_are_zero() {
        assert_eq!(
            parse_figure_tokens("figure x=1 y=2 w=3 h=4 c=-5,50,150,3").and_then(|g| g.crop),
            Some([0.0, 50.0, 99.0, 3.0])
        );
        assert_eq!(parse_figure_crop("1,,3,4"), Some([1.0, 0.0, 3.0, 4.0]));
        assert_eq!(parse_figure_crop("1,2,3"), None);
    }

    #[test]
    fn page_figures_skip_the_background() {
        let text = "![page background](vault:bg.png)\n\n![figure x=10 y=20 w=100 h=80](vault:a.png)\r\n![figure x=200 y=20 w=100 h=80 c=0,10,0,10](vault:b.png)\n\nthe recognised text";
        let figures = ink_page_figures(text);
        assert_eq!(figures.len(), 2);
        assert_eq!(figures[0].path, "a.png");
        assert_eq!(figures[1].crop, Some([0.0, 10.0, 0.0, 10.0]));
    }

    #[test]
    fn with_figures_replaces_the_block() {
        let start = "![page background](vault:bg.png)\n\n![figure x=10 y=20 w=100 h=80](vault:old.png)\n\nhello\nworld";
        let next = with_ink_page_figures(
            start,
            &[
                placement("new.png", 10.0, 20.0, 100.0, 80.0, None),
                placement("two.png", 10.0, 200.0, 100.0, 80.0, Some([5.0; 4])),
            ],
        );
        assert_eq!(
            next,
            "![page background](vault:bg.png)\n\n![figure x=10 y=20 w=100 h=80](vault:new.png)\n![figure x=10 y=200 w=100 h=80 c=5,5,5,5](vault:two.png)\n\nhello\nworld"
        );
        assert_eq!(
            with_ink_page_figures(&next, &[]),
            "![page background](vault:bg.png)\n\nhello\nworld"
        );
        assert_eq!(
            with_ink_page_figures("", &[placement("a.png", 0.0, 0.0, 10.0, 10.0, None)]),
            "![figure x=0 y=0 w=10 h=10](vault:a.png)"
        );
        let figures = [placement("f.png", 1.0, 2.0, 3.0, 4.0, None)];
        assert_eq!(
            with_ink_page_figures("line one\nline two", &figures),
            "![figure x=1 y=2 w=3 h=4](vault:f.png)\n\nline one\nline two"
        );
        // A box that cannot be drawn is not written.
        assert_eq!(
            with_ink_page_figures("x", &[placement("n.png", f64::NAN, 0.0, 1.0, 1.0, None)]),
            "x"
        );
        assert_eq!(
            with_ink_page_figures("![page background](vault:bg.png)", &[]),
            "![page background](vault:bg.png)"
        );
    }

    #[test]
    fn alt_for_reads_a_figure_alt() {
        let body = "![page background](vault:bg.png)\n![figure x=1 y=2 w=3 h=4](vault:f.png)\n![plain alt](vault:p.png)";
        assert_eq!(
            figure_alt_for(body, "f.png").as_deref(),
            Some("figure x=1 y=2 w=3 h=4")
        );
        assert_eq!(figure_alt_for(body, "p.png"), None);
        assert_eq!(figure_alt_for(body, "missing.png"), None);
    }

    #[test]
    fn reorder_steps_stop_at_the_ends() {
        use FigureOrderStep::{Back, Backward, Forward, Front};
        assert_eq!(reorder_figure_indices(3, 0.0, Front), [1, 2, 0]);
        assert_eq!(reorder_figure_indices(3, 2.0, Back), [2, 0, 1]);
        assert_eq!(reorder_figure_indices(3, 0.0, Forward), [1, 0, 2]);
        assert_eq!(reorder_figure_indices(3, 2.0, Forward), [0, 1, 2]);
        assert_eq!(reorder_figure_indices(3, 0.0, Backward), [0, 1, 2]);
        assert_eq!(reorder_figure_indices(3, 1.0, Backward), [1, 0, 2]);
        assert_eq!(reorder_figure_indices(3, 7.0, Front), [0, 1, 2]);
        assert_eq!(reorder_figure_indices(3, -1.0, Front), [0, 1, 2]);
        assert_eq!(reorder_figure_indices(0, 0.0, Front), Vec::<usize>::new());
    }

    #[test]
    fn resize_moves_one_side_or_keeps_the_aspect() {
        let b = rect(100.0, 100.0, 400.0, 200.0);
        assert_eq!(
            resize_figure_box(b, FigureHandle::E, 50.0, 999.0, false, 30.0),
            rect(100.0, 100.0, 450.0, 200.0)
        );
        assert_eq!(
            resize_figure_box(b, FigureHandle::N, 999.0, -50.0, false, 30.0),
            rect(100.0, 50.0, 400.0, 250.0)
        );
        assert_eq!(
            resize_figure_box(b, FigureHandle::Se, 100.0, 10.0, false, 30.0),
            rect(100.0, 100.0, 500.0, 250.0)
        );
        assert_eq!(
            resize_figure_box(b, FigureHandle::Nw, -100.0, 0.0, false, 30.0),
            rect(0.0, 50.0, 500.0, 250.0)
        );
        assert_eq!(
            resize_figure_box(b, FigureHandle::Se, 100.0, 10.0, true, 30.0),
            rect(100.0, 100.0, 500.0, 210.0)
        );
        assert!(
            (resize_figure_box(b, FigureHandle::W, 1000.0, 0.0, true, 30.0).w - 30.0).abs()
                < f64::EPSILON
        );
    }

    #[test]
    fn uncropped_box_and_crop_round_trip() {
        let figure = FigureBox {
            x: 100.0,
            y: 100.0,
            w: 400.0,
            h: 200.0,
            crop: None,
        };
        assert_eq!(
            uncropped_figure_box(&figure),
            rect(100.0, 100.0, 400.0, 200.0)
        );
        let half = crop_figure_to(
            rect(100.0, 100.0, 400.0, 200.0),
            rect(300.0, 100.0, 200.0, 200.0),
        );
        assert_eq!(
            half,
            FigureBox {
                x: 300.0,
                y: 100.0,
                w: 200.0,
                h: 200.0,
                crop: Some([50.0, 0.0, 0.0, 0.0])
            }
        );
        assert_eq!(
            uncropped_figure_box(&half),
            rect(100.0, 100.0, 400.0, 200.0)
        );
        assert_eq!(
            crop_figure_to(rect(1.0, 2.0, 3.0, 4.0), rect(1.0, 2.0, 3.0, 4.0)).crop,
            None
        );
        let frame = figure_image_frame(&FigureBox {
            crop: Some([10.0, 0.0, 10.0, 0.0]),
            ..figure
        });
        assert!((frame.width - 125.0).abs() < 1e-9 && (frame.left + 12.5).abs() < 1e-9);
    }

    #[test]
    fn keep_on_page_and_corner_hit() {
        assert_eq!(
            keep_figure_on_page(rect(-500.0, 10.0, 200.0, 100.0), 2100.0, 2970.0),
            (-100.0, 10.0)
        );
        assert_eq!(
            keep_figure_on_page(rect(5000.0, 5000.0, 200.0, 100.0), 2100.0, 2970.0),
            (2000.0, 2920.0)
        );
        assert!((figure_corner_hit(2.0) - 15.0).abs() < f64::EPSILON);
    }
}

//! A page as an SVG document (§4.8's page, as vectors).
//!
//! A port of `apps/web/src/features/ink/application/ink-svg.ts`. One path per
//! stroke, in the model's own unit (0.1 mm). Strokes are joined by the same
//! Hermite spline the renderers draw ([`ink_curve_at`], eight sub-segments per
//! span), drawn with a round cap and join. The palette comes from the caller
//! (the live theme is read in the DOM); the light defaults are used otherwise.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::curve::ink_curve_at;
use super::ink_page::{INK_A4_HEIGHT, INK_A4_WIDTH};

/// Sub-segments drawn per span between two samples (the renderers' count).
pub const INK_SEGMENT_SUBDIVISIONS: usize = 8;

/// Opacity of a highlighter stroke (the canvas renderer's alpha).
pub const HIGHLIGHTER_ALPHA: f64 = 0.35;

/// Palette: colour name to `[r, g, b]` in 0 to 1.
pub type InkSvgPalette = BTreeMap<String, [f64; 3]>;

/// The light theme's defaults (`INK_RENDER_COLOURS` in TypeScript).
#[must_use]
pub fn default_ink_svg_palette() -> InkSvgPalette {
    [
        ("text", [0.13, 0.14, 0.16]),
        ("accent", [0.23, 0.42, 0.86]),
        ("warn", [0.85, 0.55, 0.09]),
        ("good", [0.16, 0.6, 0.36]),
        ("info", [0.2, 0.55, 0.72]),
        ("danger", [0.79, 0.24, 0.24]),
        ("yellow", [1.0, 0.83, 0.0]),
        ("red", [1.0, 0.4, 0.4]),
        ("green", [0.37, 0.7, 0.21]),
        ("blue", [0.18, 0.66, 0.9]),
        ("purple", [0.64, 0.54, 0.9]),
        ("pink", [0.9, 0.43, 0.93]),
        ("orange", [0.95, 0.6, 0.22]),
        ("grey", [0.67, 0.67, 0.67]),
    ]
    .into_iter()
    .map(|(name, rgb)| (name.to_owned(), rgb))
    .collect()
}

/// A figure as the SVG export needs it: its placement and its pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkSvgFigure {
    /// Top-left corner, page units.
    pub x: f64,
    /// Top edge, page units.
    pub y: f64,
    /// Width, page units.
    pub w: f64,
    /// Height, page units.
    pub h: f64,
    /// Crop insets `[left, top, right, bottom]`, each 0 to 99 percent.
    #[serde(default)]
    pub crop: Option<[f64; 4]>,
    /// The image as a data URL.
    pub data_url: String,
}

/// The options of [`ink_page_svg`]. Every field may be left out.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkSvgOptions {
    /// Ink colours from the live theme; the light defaults when absent.
    #[serde(default)]
    pub palette: Option<InkSvgPalette>,
    /// The page's background raster as a data URL, or absent.
    #[serde(default)]
    pub background_data_url: Option<String>,
    /// The page's figures, drawn under the strokes.
    #[serde(default)]
    pub figures: Vec<InkSvgFigure>,
    /// What the file is called in a viewer's title bar.
    #[serde(default)]
    pub title: Option<String>,
}

/// One stroke as the SVG export reads it. Tool and colour may be absent.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkSvgStroke {
    /// Flat `[x0, y0, x1, y1, ...]` in 0.1 mm.
    #[serde(default)]
    pub points: Vec<f64>,
    /// Nib width in 0.1 mm.
    #[serde(default)]
    pub width: f64,
    /// `"highlighter"` for a highlighter; anything else is a pen.
    #[serde(default)]
    pub tool: Option<String>,
    /// Colour name; `"text"` when absent.
    #[serde(default)]
    pub colour: Option<String>,
}

/// The page fields the export reads: size and strokes.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkSvgPage {
    /// Width in 0.1 mm; A4 when zero or absent.
    #[serde(default)]
    pub width: f64,
    /// Height in 0.1 mm; A4 when zero or absent.
    #[serde(default)]
    pub height: f64,
    /// Strokes in drawing order.
    #[serde(default)]
    pub strokes: Vec<InkSvgStroke>,
}

/// JavaScript `Math.round`: halves go up, so `-2.5` is `-2`.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// A number as SVG wants it: no exponent, no trailing zeros, `0` when not finite.
fn num(value: f64) -> String {
    if value.is_finite() {
        // `+ 0.0` turns a negative zero into zero, as `String(-0)` does.
        format!("{}", js_round(value * 100.0) / 100.0 + 0.0)
    } else {
        "0".to_owned()
    }
}

/// Text made safe inside markup; the same four characters `escapeHtml` handles.
fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// JavaScript `a || b` for numbers: zero and NaN fall back.
fn or_default(value: f64, fallback: f64) -> f64 {
    if value.is_nan() || value == 0.0 {
        fallback
    } else {
        value
    }
}

/// One stroke's centreline as an SVG path, or `None` for fewer than two numbers.
///
/// Samples are joined by the same Hermite spline the renderers draw, not by
/// straight lines. A single point is a dot: a zero-length line, so the round
/// cap draws it.
#[must_use]
pub fn stroke_path(points: &[f64]) -> Option<String> {
    if points.len() < 2 {
        return None;
    }
    let first = format!("M{} {}", num(points[0]), num(points[1]));
    if points.len() == 2 {
        return Some(format!("{first}l0 0"));
    }
    let count = points.len() / 2;
    let xs: Vec<f64> = (0..count).map(|i| points[i * 2]).collect();
    let ys: Vec<f64> = (0..count).map(|i| points[i * 2 + 1]).collect();
    let mut out = first;
    for i in 0..count - 1 {
        for k in 1..=INK_SEGMENT_SUBDIVISIONS {
            let u = k as f64 / INK_SEGMENT_SUBDIVISIONS as f64;
            let (x, y) = ink_curve_at(&xs, &ys, i, u);
            out.push_str(&format!("L{} {}", num(x), num(y)));
        }
    }
    Some(out)
}

/// `rgb(r, g, b)` for a palette entry, falling back to the text colour.
#[must_use]
pub fn palette_css(palette: &InkSvgPalette, colour: &str) -> String {
    let rgb = palette
        .get(colour)
        .or_else(|| palette.get("text"))
        .copied()
        .unwrap_or([0.13, 0.14, 0.16]);
    let channel = |value: f64| js_round(value.clamp(0.0, 1.0) * 255.0) as i64;
    format!(
        "rgb({}, {}, {})",
        channel(rgb[0]),
        channel(rgb[1]),
        channel(rgb[2])
    )
}

/// The page as an SVG document.
///
/// `width`/`height` are in millimetres and the `viewBox` is in 0.1 mm, so the
/// file prints at A4 whatever its pixel size.
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn ink_page_svg(page: &InkSvgPage, options: &InkSvgOptions) -> String {
    let palette = options
        .palette
        .clone()
        .unwrap_or_else(default_ink_svg_palette);
    let width = or_default(page.width, INK_A4_WIDTH);
    let height = or_default(page.height, INK_A4_HEIGHT);
    let title = options.title.as_deref().unwrap_or("Ink page");

    let mut parts: Vec<String> = Vec::new();
    parts.push(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" \
         width=\"{}mm\" height=\"{}mm\" viewBox=\"0 0 {} {}\">",
        num(width / 10.0),
        num(height / 10.0),
        num(width),
        num(height),
    ));
    parts.push(format!("<title>{}</title>", escape_html(title)));
    // The export is white behind everything, like the paper it stands for.
    parts.push(format!(
        "<rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"#ffffff\"/>",
        num(width),
        num(height),
    ));
    if let Some(background) = options
        .background_data_url
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        parts.push(format!(
            "<image x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" preserveAspectRatio=\"xMidYMid meet\" \
             xlink:href=\"{}\"/>",
            num(width),
            num(height),
            escape_html(background),
        ));
    }

    // Figures under the strokes. A crop is a clip at the figure's box with the
    // image enlarged into it.
    for figure in &options.figures {
        let crop = figure.crop.unwrap_or([0.0, 0.0, 0.0, 0.0]);
        let keep_x = (1.0 - (crop[0] + crop[2]) / 100.0).max(0.01);
        let keep_y = (1.0 - (crop[1] + crop[3]) / 100.0).max(0.01);
        let draw_w = figure.w / keep_x;
        let draw_h = figure.h / keep_y;
        let draw_x = figure.x - (crop[0] / 100.0) * draw_w;
        let draw_y = figure.y - (crop[1] / 100.0) * draw_h;
        let clip_id = format!(
            "figure-clip-{}-{}-{}-{}",
            num(figure.x),
            num(figure.y),
            num(figure.w),
            num(figure.h),
        );
        parts.push(format!(
            "<clipPath id=\"{clip_id}\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/></clipPath>",
            num(figure.x),
            num(figure.y),
            num(figure.w),
            num(figure.h),
        ));
        parts.push(format!(
            "<g clip-path=\"url(#{clip_id})\"><image x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" \
             preserveAspectRatio=\"none\" xlink:href=\"{}\"/></g>",
            num(draw_x),
            num(draw_y),
            num(draw_w),
            num(draw_h),
            escape_html(&figure.data_url),
        ));
    }

    // The pen first, the highlighter over it.
    for highlighter_pass in [false, true] {
        let mut group: Vec<String> = Vec::new();
        for stroke in &page.strokes {
            let highlighter = stroke.tool.as_deref() == Some("highlighter");
            if highlighter != highlighter_pass {
                continue;
            }
            let Some(d) = stroke_path(&stroke.points) else {
                continue;
            };
            let colour = palette_css(&palette, stroke.colour.as_deref().unwrap_or("text"));
            let opacity = if highlighter {
                format!(" stroke-opacity=\"{HIGHLIGHTER_ALPHA}\"")
            } else {
                String::new()
            };
            group.push(format!(
                "<path d=\"{d}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" \
                 stroke-linecap=\"round\" stroke-linejoin=\"round\"{opacity}/>",
                escape_html(&colour),
                num(stroke.width),
            ));
        }
        if !group.is_empty() {
            parts.push(group.join("\n"));
        }
    }

    parts.push("</svg>".to_owned());
    format!("{}\n", parts.join("\n"))
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    /// Every `x,y` a path command names, in order.
    fn path_points(d: &str) -> Vec<(f64, f64)> {
        d.split(['M', 'L'])
            .filter(|s| !s.is_empty())
            .filter_map(|s| {
                let (x, y) = s.split_once(' ')?;
                let x: f64 = x.parse().ok()?;
                let y: f64 = y.parse().ok()?;
                Some((x, y))
            })
            .collect()
    }

    fn at(points: &[(f64, f64)], i: usize) -> (f64, f64) {
        points.get(i).copied().unwrap_or_default()
    }

    fn turn(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
        let angle =
            |u: (f64, f64), v: (f64, f64)| (u.0 * v.1 - u.1 * v.0).atan2(u.0 * v.0 + u.1 * v.1);
        angle((b.0 - a.0, b.1 - a.1), (c.0 - b.0, c.1 - b.1)).abs()
    }

    #[test]
    fn a_page_is_a4_in_millimetres_over_a_viewbox_in_the_models_unit() {
        let svg = ink_page_svg(&InkSvgPage::default(), &InkSvgOptions::default());
        assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.contains("width=\"210mm\" height=\"297mm\""));
        assert!(svg.contains("viewBox=\"0 0 2100 2970\""));
        assert!(
            svg.contains("<rect x=\"0\" y=\"0\" width=\"2100\" height=\"2970\" fill=\"#ffffff\"/>")
        );
    }

    #[test]
    fn a_stroke_is_one_round_capped_path_at_its_own_width_and_colour() {
        let page = InkSvgPage {
            strokes: vec![InkSvgStroke {
                points: vec![100.0, 200.0, 300.0, 400.0],
                width: 5.0,
                ..Default::default()
            }],
            ..Default::default()
        };
        // The stroke's colour is a name; the value comes from the palette.
        let palette: InkSvgPalette = [("text".to_owned(), [1.0, 0.0, 0.0])].into_iter().collect();
        let options = InkSvgOptions {
            palette: Some(palette),
            ..Default::default()
        };
        let svg = ink_page_svg(&page, &options);
        assert!(svg.contains("<path d=\"M100 200L"));
        assert!(svg.contains("stroke-width=\"5\""));
        assert!(svg.contains("stroke-linecap=\"round\""));
        assert!(svg.contains("stroke=\"rgb(255, 0, 0)\""));
    }

    #[test]
    fn a_two_point_stroke_stays_the_straight_line_it_is() {
        let d = stroke_path(&[100.0, 200.0, 300.0, 400.0]).unwrap_or_default();
        let points = path_points(&d);
        assert_eq!(points.len(), 1 + INK_SEGMENT_SUBDIVISIONS);
        for (x, y) in points {
            // The line through (100, 200) and (300, 400) is y = x + 100.
            assert!((y - (x + 100.0)).abs() < 0.01, "{x},{y} is off the line");
        }
    }

    #[test]
    fn a_stroke_through_a_bend_is_drawn_as_a_curve_not_as_corners_at_its_samples() {
        let d = stroke_path(&[0.0, 0.0, 100.0, 0.0, 200.0, 100.0]).unwrap_or_default();
        let points = path_points(&d);
        assert_eq!(points.len(), 1 + 2 * INK_SEGMENT_SUBDIVISIONS);

        let at_sample = at(&points, INK_SEGMENT_SUBDIVISIONS);
        let joint = turn(
            at(&points, INK_SEGMENT_SUBDIVISIONS - 1),
            at_sample,
            at(&points, INK_SEGMENT_SUBDIVISIONS + 1),
        );
        // The corner the samples themselves ask for, which is what a polyline draws.
        let corner = turn((0.0, 0.0), (100.0, 0.0), (200.0, 100.0));
        assert!(
            joint < corner * 0.6,
            "joint {joint} is not a curve against corner {corner}"
        );
        // The drawn path still passes through the sample it was given.
        assert_eq!(at_sample, (100.0, 0.0));
    }

    #[test]
    fn a_highlighter_keeps_its_alpha_and_is_drawn_over_the_pen() {
        let page = InkSvgPage {
            strokes: vec![
                InkSvgStroke {
                    points: vec![10.0, 10.0, 20.0, 20.0],
                    tool: Some("highlighter".to_owned()),
                    ..Default::default()
                },
                InkSvgStroke {
                    points: vec![30.0, 30.0, 40.0, 40.0],
                    tool: Some("pen".to_owned()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let svg = ink_page_svg(&page, &InkSvgOptions::default());
        assert!(svg.contains("stroke-opacity=\"0.35\""));
        let highlighter = svg.find("stroke-opacity=\"0.35\"");
        let pen = svg.find("d=\"M30 30");
        // The pen's path is written first and the tinted band after it.
        match (pen, highlighter) {
            (Some(p), Some(h)) => assert!(p < h, "the highlighter draws over the pen"),
            _ => panic!("pen or highlighter missing from the SVG"),
        }
    }

    #[test]
    fn a_page_with_an_image_embeds_it_and_a_page_without_one_has_none() {
        let options = InkSvgOptions {
            background_data_url: Some("data:image/png;base64,AAAA".to_owned()),
            ..Default::default()
        };
        let with_image = ink_page_svg(&InkSvgPage::default(), &options);
        assert!(with_image.contains("<image x=\"0\" y=\"0\" width=\"2100\" height=\"2970\""));
        // Embedded, not linked: a blob URL would be dead when the file is opened again.
        assert!(with_image.contains("xlink:href=\"data:image/png;base64,AAAA\""));
        assert!(
            !ink_page_svg(&InkSvgPage::default(), &InkSvgOptions::default()).contains("<image")
        );
    }

    #[test]
    fn a_dot_is_a_zero_length_line_and_a_stroke_with_no_points_is_nothing() {
        let page = InkSvgPage {
            strokes: vec![
                InkSvgStroke {
                    points: vec![7.0, 8.0],
                    ..Default::default()
                },
                InkSvgStroke::default(),
            ],
            ..Default::default()
        };
        let svg = ink_page_svg(&page, &InkSvgOptions::default());
        // A round cap draws the dot; an empty path would draw nothing.
        assert!(svg.contains("<path d=\"M7 8l0 0\""));
        assert_eq!(svg.matches("<path ").count(), 1);
    }

    #[test]
    fn a_title_with_markup_cannot_escape_its_element() {
        let options = InkSvgOptions {
            title: Some("a<b & \"c\"".to_owned()),
            ..Default::default()
        };
        let svg = ink_page_svg(&InkSvgPage::default(), &options);
        assert!(svg.contains("<title>a&lt;b &amp; &quot;c&quot;</title>"));
    }

    #[test]
    fn figures_embed_under_the_strokes_and_a_crop_clips_rather_than_stretches() {
        let page = InkSvgPage {
            strokes: vec![InkSvgStroke {
                points: vec![10.0, 10.0, 20.0, 20.0],
                ..Default::default()
            }],
            ..Default::default()
        };
        let options = InkSvgOptions {
            figures: vec![
                InkSvgFigure {
                    x: 100.0,
                    y: 200.0,
                    w: 500.0,
                    h: 400.0,
                    crop: None,
                    data_url: "data:image/webp;base64,AAAA".to_owned(),
                },
                InkSvgFigure {
                    x: 700.0,
                    y: 200.0,
                    w: 500.0,
                    h: 400.0,
                    crop: Some([10.0, 0.0, 10.0, 0.0]),
                    data_url: "data:image/webp;base64,BBBB".to_owned(),
                },
            ],
            ..Default::default()
        };
        let svg = ink_page_svg(&page, &options);
        // Both figures are embedded as data URLs, never links.
        assert!(svg.contains("xlink:href=\"data:image/webp;base64,AAAA\""));
        assert!(svg.contains("xlink:href=\"data:image/webp;base64,BBBB\""));
        // An uncropped figure is drawn at exactly its own box.
        assert!(svg.contains(
            "<image x=\"100\" y=\"200\" width=\"500\" height=\"400\" preserveAspectRatio=\"none\""
        ));
        // A cropped figure is enlarged into a clip: keepX = 0.8, so it draws 625 wide, 62.5 left.
        assert!(svg.contains("<image x=\"637.5\" y=\"200\" width=\"625\" height=\"400\""));
        assert!(svg.contains(
            "<clipPath id=\"figure-clip-700-200-500-400\"><rect x=\"700\" y=\"200\" width=\"500\" height=\"400\""
        ));
        // The writing goes over the pasted photo.
        let figure = svg.find("<image x=");
        let stroke = svg.find("<path ");
        match (figure, stroke) {
            (Some(f), Some(s)) => assert!(s > f, "the strokes are written over the figures"),
            _ => panic!("figure or stroke missing from the SVG"),
        }
    }
}

//! The page as a printable HTML document: the sheet rebuilt out of its layers.
//!
//! The web app calls it as `inkPrintDocument`. The paper, the rendered markdown underlay, each figure in
//! its frame and the ink raster are laid out at the screen's scale, then scaled to
//! the paper's millimetres. The stylesheets are passed in already read from the DOM
//! (`documentStyleSheets` stays in TypeScript).

use std::collections::BTreeMap;
use std::sync::OnceLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::figure::{FigureBox, figure_image_frame};
use crate::text::escape_html;

/// CSS pixels per millimetre, as the CSS spec fixes it.
const PX_PER_MM: f64 = 96.0 / 25.4;

/// A figure with the address of its picture: a data URL, so it needs no vault.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkPrintFigure {
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
    /// The picture's data URL.
    pub url: String,
}

/// The page size in 0.1 mm, the page's own units.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkPrintPageSize {
    /// Width, in 0.1 mm.
    pub width: f64,
    /// Height, in 0.1 mm.
    pub height: f64,
}

/// The underlay's box, in CSS pixels at the sheet's scale.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkPrintUnderlay {
    /// Horizontal padding.
    pub pad_x: f64,
    /// Vertical padding.
    pub pad_y: f64,
    /// Font size.
    pub font_size: f64,
    /// Unitless line height.
    pub line_height: f64,
}

/// One stylesheet: a link by address, or the text of an inline sheet.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkPrintStyleSheet {
    /// The sheet's address, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub href: Option<String>,
    /// The sheet's text, when it is inline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub text: Option<String>,
}

/// Everything the printed page is built from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkPrintDocument {
    /// The document's title.
    pub title: String,
    /// The page size, in 0.1 mm.
    pub page_size: InkPrintPageSize,
    /// Pixels per page unit the sheet was laid out at on screen.
    pub scale: f64,
    /// The paper's name; `paper-{paper}` is the sheet's class.
    pub paper: String,
    /// The underlay's markup (the rendered markdown), already HTML.
    pub underlay_html: String,
    /// The underlay's box.
    pub underlay: InkPrintUnderlay,
    /// The ruling variables the sheet reads (`--ink-rule`, `--ink-rule-offset`).
    pub rule: BTreeMap<String, String>,
    /// Figures, each with its picture.
    pub figures: Vec<InkPrintFigure>,
    /// The ink raster's address; `None` when the page has no raster.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub ink_url: Option<String>,
    /// The app's stylesheets.
    pub style_sheets: Vec<InkPrintStyleSheet>,
}

/// The document, as HTML for a frame's `srcdoc` (Rust port of `inkPrintDocument`).
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn ink_print_document(doc: &InkPrintDocument) -> String {
    let width_mm = doc.page_size.width / 10.0;
    let height_mm = doc.page_size.height / 10.0;
    let width_px = doc.page_size.width * doc.scale;
    let height_px = doc.page_size.height * doc.scale;
    // The sheet at its screen size, shrunk (or grown) onto the paper.
    let fit = (width_mm * PX_PER_MM) / width_px;

    let styles = doc
        .style_sheets
        .iter()
        .map(style_sheet_tag)
        .collect::<Vec<_>>()
        .join("\n");
    let rule = doc
        .rule
        .iter()
        .map(|(name, value)| format!("{name}:{value}"))
        .collect::<Vec<_>>()
        .join(";");
    let figures: String = doc
        .figures
        .iter()
        .map(|figure| figure_element(figure, doc.scale))
        .collect();
    let ink = match doc.ink_url.as_deref().filter(|url| !url.is_empty()) {
        Some(url) => format!(
            r#"<img class="ink-print-ink" src="{}" alt="" style="position:absolute;inset:0;width:100%;height:100%">"#,
            escape_html(url)
        ),
        None => String::new(),
    };
    let underlay = if doc.underlay_html.is_empty() {
        String::new()
    } else {
        let u = &doc.underlay;
        format!(
            r#"<div class="ink-sheet-text-underlay markdown" style="position:absolute;inset:0;padding:{}px {}px;font-size:{}px;line-height:{};--ink-diagram-zoom:{};color:var(--text);overflow:hidden;word-break:break-word;opacity:0.88">{}</div>"#,
            js_number(u.pad_y),
            js_number(u.pad_x),
            js_number(u.font_size),
            js_number(u.line_height),
            js_to_fixed(u.font_size / 16.0, 4),
            doc.underlay_html
        )
    };

    format!(
        r#"<!doctype html>
<html data-mode="light">
<head>
<meta charset="utf-8">
<title>{title}</title>
{styles}
<style>
  @page {{ size: {w_mm}mm {h_mm}mm; margin: 0; }}
  html, body {{ margin: 0; padding: 0; background: #e9e9e9; }}
  body {{ display: flex; justify-content: center; padding: 24px 0; }}
  .ink-print-page {{ position: relative; width: {w_mm}mm; height: {h_mm}mm; overflow: hidden; background: #fff; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); }}
  .ink-print-page .ink-sheet {{ position: absolute; left: 0; top: 0; width: {w_px}px; height: {h_px}px; transform: scale({fit}); transform-origin: 0 0; border-radius: 0; box-shadow: none; background-color: #fff; }}
  .ink-print-page .ink-figure {{ box-shadow: none; background: none; }}
  @media print {{
    html, body {{ width: {w_mm}mm; height: {h_mm}mm; background: #fff; }}
    body {{ display: block; padding: 0; }}
    .ink-print-page {{ box-shadow: none; }}
  }}
</style>
</head>
<body>
<div class="ink-print-page"><div class="ink-sheet paper-{paper}" style="{rule}">{underlay}<div class="ink-figures">{figures}</div>{ink}</div></div>
</body>
</html>"#,
        title = escape_html(&doc.title),
        styles = styles,
        w_mm = js_number(width_mm),
        h_mm = js_number(height_mm),
        w_px = js_number(width_px),
        h_px = js_number(height_px),
        fit = js_number(fit),
        paper = escape_html(&doc.paper),
        rule = rule,
        underlay = underlay,
        figures = figures,
        ink = ink,
    )
}

/// One stylesheet as markup: a link when it has an address, else its text in a `<style>`.
fn style_sheet_tag(sheet: &InkPrintStyleSheet) -> String {
    if let Some(href) = sheet.href.as_deref().filter(|href| !href.is_empty()) {
        format!(r#"<link rel="stylesheet" href="{}">"#, escape_html(href))
    } else if let Some(text) = sheet.text.as_deref().filter(|text| !text.is_empty()) {
        format!("<style>{}</style>", escape_style_close(text))
    } else {
        String::new()
    }
}

/// `</style` in the sheet's text becomes `<\/style`: it reads as `</style` to CSS but
/// does not end the tag in HTML.
fn escape_style_close(text: &str) -> String {
    static STYLE_CLOSE: OnceLock<Regex> = OnceLock::new();
    #[allow(clippy::expect_used, reason = "static regex literal, always valid")]
    let re = STYLE_CLOSE.get_or_init(|| Regex::new(r"(?i)</(style)").expect("static pattern"));
    re.replace_all(text, r"<\/$1").into_owned()
}

/// One figure in its frame: the picture sized to the figure's crop inside an
/// overflow-hidden box, all at the sheet's scale.
fn figure_element(figure: &InkPrintFigure, scale: f64) -> String {
    let frame = figure_image_frame(&FigureBox {
        x: figure.x,
        y: figure.y,
        w: figure.w,
        h: figure.h,
        crop: figure.crop,
    });
    format!(
        r#"<div class="ink-figure" style="position:absolute;left:{}px;top:{}px;width:{}px;height:{}px"><div style="position:absolute;inset:0;overflow:hidden"><img src="{}" alt="" style="position:absolute;width:{}%;height:{}%;left:{}%;top:{}%;object-fit:fill"></div></div>"#,
        js_number(figure.x * scale),
        js_number(figure.y * scale),
        js_number(figure.w * scale),
        js_number(figure.h * scale),
        escape_html(&figure.url),
        js_to_fixed(frame.width, 3),
        js_to_fixed(frame.height, 3),
        js_to_fixed(frame.left, 3),
        js_to_fixed(frame.top, 3),
    )
}

/// A number as JavaScript prints it in a template string: `-0` is `0`, non-finite values by name.
fn js_number(value: f64) -> String {
    if value.is_nan() {
        "NaN".to_owned()
    } else if value > 0.0 && value.is_infinite() {
        "Infinity".to_owned()
    } else if value.is_infinite() {
        "-Infinity".to_owned()
    } else {
        // `+ 0.0` turns a negative zero into zero, as `String(-0)` does.
        format!("{}", value + 0.0)
    }
}

/// JavaScript `Number.prototype.toFixed`: the decimal digits of the exact value, rounded
/// half up in magnitude (a tie goes to the larger magnitude, as the spec says).
fn js_to_fixed(value: f64, digits: usize) -> String {
    if !value.is_finite() {
        return js_number(value);
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // 80 fractional digits: a double's exact expansion decides the rounding digit.
    let exact = format!("{:.80}", value.abs());
    let dot = exact.find('.').unwrap_or(exact.len());
    let int_part = &exact[..dot];
    let frac = exact.get(dot + 1..).unwrap_or("");
    let mut all: Vec<u8> = int_part.bytes().chain(frac.bytes().take(digits)).collect();
    if frac.as_bytes().get(digits).is_some_and(|d| *d >= b'5') {
        let mut carry = true;
        for d in all.iter_mut().rev() {
            if !carry {
                break;
            }
            if *d == b'9' {
                *d = b'0';
            } else {
                *d += 1;
                carry = false;
            }
        }
        if carry {
            all.insert(0, b'1');
        }
    }
    let all = String::from_utf8(all).unwrap_or_default();
    let split = all.len() - digits;
    let (int_out, frac_out) = all.split_at(split);
    if digits == 0 {
        format!("{sign}{int_out}")
    } else {
        format!("{sign}{int_out}.{frac_out}")
    }
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
    use crate::ink::ink_page::{INK_A4_HEIGHT, INK_A4_WIDTH};

    fn base() -> InkPrintDocument {
        InkPrintDocument {
            title: "notes <\"quoted\">".to_owned(),
            page_size: InkPrintPageSize {
                width: INK_A4_WIDTH,
                height: INK_A4_HEIGHT,
            },
            scale: 0.5,
            paper: "ruled".to_owned(),
            underlay_html: "<h3>Heading</h3><p>Body</p>".to_owned(),
            underlay: InkPrintUnderlay {
                pad_x: 28.0,
                pad_y: 24.0,
                font_size: 12.0,
                line_height: 1.6,
            },
            rule: BTreeMap::from([
                ("--ink-rule".to_owned(), "19.2px".to_owned()),
                ("--ink-rule-offset".to_owned(), "24px".to_owned()),
            ]),
            figures: vec![InkPrintFigure {
                x: 100.0,
                y: 200.0,
                w: 400.0,
                h: 300.0,
                crop: None,
                url: "data:image/png;base64,AAAA".to_owned(),
            }],
            ink_url: Some("data:image/png;base64,BBBB".to_owned()),
            style_sheets: vec![
                InkPrintStyleSheet {
                    href: Some("https://app/_next/static/a.css".to_owned()),
                    text: None,
                },
                InkPrintStyleSheet {
                    href: None,
                    text: Some(".x{color:red}".to_owned()),
                },
            ],
        }
    }

    /// Byte offset of `needle`, or `usize::MAX` when absent, so order checks fail on a miss.
    fn pos(html: &str, needle: &str) -> usize {
        html.find(needle).unwrap_or(usize::MAX)
    }

    #[test]
    fn every_layer_of_the_sheet_is_in_the_document_in_order() {
        let html = ink_print_document(&base());
        assert!(
            html.contains("class=\"ink-sheet paper-ruled\""),
            "the paper's class"
        );
        assert!(
            html.contains("--ink-rule:19.2px;--ink-rule-offset:24px"),
            "the ruling"
        );
        // The print's white must not be the background shorthand, or it wipes the ruling.
        let sheet_rule = html.find(".ink-print-page .ink-sheet {");
        assert!(sheet_rule.is_some(), "the sheet rule");
        let block = sheet_rule.map_or("", |i| html[i..].split('}').next().unwrap_or(""));
        assert!(
            !block.contains("background: #fff"),
            "the ruling survives the paper's white"
        );
        assert!(
            html.contains("padding:24px 28px;font-size:12px;line-height:1.6"),
            "the underlay's metrics"
        );
        assert!(
            html.contains("<h3>Heading</h3><p>Body</p>"),
            "the markdown, as is"
        );
        assert!(
            html.contains("left:50px;top:100px;width:200px;height:150px"),
            "the figure at scale"
        );
        assert!(
            html.contains("src=\"data:image/png;base64,AAAA\""),
            "the figure's picture"
        );
        assert!(
            pos(&html, "ink-sheet-text-underlay") < pos(&html, "ink-figures"),
            "text under figures"
        );
        assert!(
            pos(&html, "ink-figures") < pos(&html, "ink-print-ink"),
            "figures under ink"
        );
        assert!(
            html.contains("@page { size: 210mm 297mm; margin: 0; }"),
            "A4 in millimetres"
        );
        assert!(html.contains("<link rel=\"stylesheet\" href=\"https://app/_next/static/a.css\">"));
        assert!(html.contains("<style>.x{color:red}</style>"));
    }

    #[test]
    fn a_page_with_no_ink_and_no_text_prints_its_paper_and_figures_alone() {
        let doc = InkPrintDocument {
            ink_url: None,
            underlay_html: String::new(),
            ..base()
        };
        let html = ink_print_document(&doc);
        assert!(!html.contains("ink-print-ink"));
        assert!(!html.contains("ink-sheet-text-underlay"));
        assert!(html.contains("class=\"ink-figure\""));
    }

    #[test]
    fn the_title_and_the_paper_cannot_break_out_of_the_markup() {
        let doc = InkPrintDocument {
            paper: "x\" onload=\"y".to_owned(),
            ..base()
        };
        let html = ink_print_document(&doc);
        assert!(html.contains("<title>notes &lt;&quot;quoted&quot;&gt;</title>"));
        assert!(!html.contains("onload=\"y"));
    }

    #[test]
    fn sheet_text_holding_style_close_stays_inside_its_tag() {
        let text = r#".a::after{content:"</style><script>x()</script>"} .b{} .c::before{content:"</STYLE"}"#;
        let doc = InkPrintDocument {
            style_sheets: vec![InkPrintStyleSheet {
                href: None,
                text: Some(text.to_owned()),
            }],
            ..base()
        };
        let html = ink_print_document(&doc);
        // The sheet's own `<style>` comes first; its closing tag is the next `</style>`.
        let open = html.find("<style>").unwrap_or(0);
        let close = html[open..].find("</style>").map_or(0, |i| open + i);
        assert!(close > open, "the sheet has a closing tag");
        let sheet = &html[open..close];
        assert!(sheet.contains(".c::before"), "the sheet was cut short");
        assert!(!sheet[7..].to_ascii_lowercase().contains("</style"));
    }
}

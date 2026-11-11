//! The pure colour maths behind the ink renderers: a palette entry as CSS or
//! hex, the palette name a hex came from, the parse of a computed CSS colour,
//! and whether two palettes draw alike.
//!
//! A port of the pure parts of `apps/web/src/features/ink/render/parts-1.ts`.
//! The palette values and the DOM probe that reads them stay in TypeScript. A
//! palette is the ordered `(name, [r, g, b])` list the JS object gave, each
//! channel 0..1, so a name that appears twice resolves as the JS object does.

use std::sync::LazyLock;

use regex_lite::{Captures, Regex};

use super::js_math;
use crate::papers::js_regex::{compile, space_class};

/// One colour as red, green and blue, each 0..1.
pub type Rgb = [f64; 3];

/// The light theme's `text` token: what an unknown colour name draws as.
const FALLBACK_TEXT: Rgb = [0.13, 0.14, 0.16];

/// Tolerance, in 0..1 channel units, under which two palettes draw the same.
const SAME_TOLERANCE: f64 = 1.0 / 512.0;

static RGB_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    let sep = format!("[{},]+", space_class());
    compile(&format!(
        r"(?i)^rgba?\(\s*([0-9.]+){sep}([0-9.]+){sep}([0-9.]+)"
    ))
    .ok()
});

static COLOR_SRGB_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)^color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)").ok());

static HEX_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)^#([0-9a-f]{6})$").ok());

/// The entry for `name`, if the palette has one.
#[must_use]
fn find(palette: &[(String, Rgb)], name: &str) -> Option<Rgb> {
    palette
        .iter()
        .find(|(entry, _)| entry.as_str() == name)
        .map(|(_, rgb)| *rgb)
}

/// The entry for `colour`, falling back to `text`, then the light theme's text.
#[must_use]
fn lookup(palette: &[(String, Rgb)], colour: &str) -> Rgb {
    find(palette, colour)
        .or_else(|| find(palette, "text"))
        .unwrap_or(FALLBACK_TEXT)
}

/// A channel as the renderers see it: clamped to 0..1, scaled to 0..255, and
/// rounded half up as `Math.round` does.
#[must_use]
fn channel(value: f64) -> f64 {
    js_math::round(js_math::max(0.0, js_math::min(1.0, value)) * 255.0)
}

/// A channel as two lowercase hex digits. A `NaN` stays `NaN`, as `toString(16)`
/// leaves it in JS.
#[must_use]
fn hex_channel(value: f64) -> String {
    let scaled = channel(value);
    if scaled.is_nan() {
        "NaN".to_owned()
    } else {
        format!("{:02x}", scaled as u8)
    }
}

/// The three numbers a regex matched, as `Number()` reads them: a bad number is `NaN`.
#[must_use]
fn numbers(caps: &Captures<'_>) -> Rgb {
    [1, 2, 3].map(|i| {
        caps.get(i)
            .and_then(|m| m.as_str().parse::<f64>().ok())
            .unwrap_or(f64::NAN)
    })
}

/// The three byte pairs of a six-digit hex colour, each 0..1.
#[must_use]
fn hex_pairs(hex: &str) -> Option<Rgb> {
    let part = |start: usize| -> Option<f64> {
        u8::from_str_radix(hex.get(start..start + 2)?, 16)
            .ok()
            .map(f64::from)
    };
    Some([part(0)? / 255.0, part(2)? / 255.0, part(4)? / 255.0])
}

/// Whether two colours differ by no more than the tolerance on every channel.
/// A `NaN` channel never counts as a difference, as `Math.abs(NaN) > tol` is false.
#[must_use]
fn close(x: Rgb, y: Rgb) -> bool {
    x.iter()
        .zip(y.iter())
        .all(|(p, q)| !((p - q).abs() > SAME_TOLERANCE))
}

/// One palette entry as a CSS colour, for a trail or a Canvas 2D fill: `rgb(...)`
/// when `alpha` is 1 or more, `rgba(...)` otherwise.
#[must_use]
pub fn palette_css(palette: &[(String, Rgb)], colour: &str, alpha: f64) -> String {
    let [r, g, b] = lookup(palette, colour).map(channel);
    if alpha >= 1.0 {
        format!("rgb({r}, {g}, {b})")
    } else {
        format!("rgba({r}, {g}, {b}, {alpha})")
    }
}

/// One palette entry as `#rrggbb`. A stored reader annotation carries a literal
/// colour, so a paper's ink resolves through the same palette the note draws with.
#[must_use]
pub fn palette_hex(palette: &[(String, Rgb)], colour: &str) -> String {
    let [r, g, b] = lookup(palette, colour).map(hex_channel);
    format!("#{r}{g}{b}")
}

/// The palette name a hex colour was written from, if any: `palette_hex` the
/// other way, so a hex picked off a mark can become the bar's colour again.
#[must_use]
pub fn palette_name(palette: &[(String, Rgb)], hex: &str) -> Option<String> {
    let wanted = hex.trim().to_lowercase();
    palette
        .iter()
        .find(|(name, _)| palette_hex(palette, name) == wanted)
        .map(|(name, _)| name.clone())
}

/// Parse what `getComputedStyle` answers for a colour: `rgb(r, g, b)`,
/// `rgba(r, g, b, a)`, the modern `color(srgb r g b)`, or `#rrggbb`. Anything
/// else is `None`, so the caller keeps its previous value rather than drawing black.
#[must_use]
pub fn parse_css_colour(value: &str) -> Option<Rgb> {
    let text = value.trim();
    if let Some(caps) = RGB_RE.as_ref().and_then(|re| re.captures(text)) {
        return Some(numbers(&caps).map(|n| n / 255.0));
    }
    if let Some(caps) = COLOR_SRGB_RE.as_ref().and_then(|re| re.captures(text)) {
        return Some(numbers(&caps));
    }
    let caps = HEX_RE.as_ref()?.captures(text)?;
    hex_pairs(caps.get(1)?.as_str())
}

/// Whether two palettes draw the same, so a theme poll can skip the post. Every
/// name in one must be in the other, and each channel must be within 1/512.
#[must_use]
pub fn same_palette(a: &[(String, Rgb)], b: &[(String, Rgb)]) -> bool {
    a.iter()
        .all(|(name, x)| find(b, name).is_some_and(|y| close(*x, y)))
        && b.iter().all(|(name, _)| find(a, name).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The light theme's palette, as the TS `INK_RENDER_COLOURS` lists it.
    fn light() -> Vec<(String, Rgb)> {
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
        .iter()
        .map(|(name, rgb)| ((*name).to_owned(), *rgb))
        .collect()
    }

    #[test]
    fn css_is_rgb_when_opaque_and_rgba_below() {
        let p = light();
        assert_eq!(palette_css(&p, "red", 1.0), "rgb(255, 102, 102)");
        assert_eq!(palette_css(&p, "text", 0.5), "rgba(33, 36, 41, 0.5)");
    }

    #[test]
    fn css_clamps_channels_and_rounds_half_up() {
        let p = vec![("text".to_owned(), [2.0, -1.0, 0.5])];
        assert_eq!(palette_css(&p, "text", 1.0), "rgb(255, 0, 128)");
    }

    #[test]
    fn css_falls_back_to_text_for_an_unknown_name() {
        let p = light();
        assert_eq!(palette_css(&p, "nope", 1.0), palette_css(&p, "text", 1.0));
        assert_eq!(palette_css(&[], "red", 1.0), "rgb(33, 36, 41)");
    }

    #[test]
    fn hex_is_six_lowercase_digits() {
        let p = light();
        assert_eq!(palette_hex(&p, "text"), "#212429");
        assert_eq!(palette_hex(&p, "red"), "#ff6666");
    }

    #[test]
    fn hex_keeps_nan_as_js_prints_it() {
        let p = vec![("text".to_owned(), [f64::NAN, 0.0, 0.0])];
        assert_eq!(palette_hex(&p, "text"), "#NaN0000");
    }

    #[test]
    fn name_reverses_hex_and_knows_no_stranger() {
        let p = light();
        for (name, _) in &p {
            let back = palette_name(&p, &palette_hex(&p, name));
            assert!(back.is_some());
            assert_eq!(
                back.map(|b| palette_hex(&p, &b)),
                Some(palette_hex(&p, name))
            );
        }
        assert_eq!(palette_name(&p, "  #FF6666 "), Some("red".to_owned()));
        assert_eq!(palette_name(&p, "#010203"), None);
    }

    #[test]
    fn parses_the_forms_getcomputedstyle_answers() {
        assert_eq!(parse_css_colour("rgb(255, 0, 0)"), Some([1.0, 0.0, 0.0]));
        assert_eq!(parse_css_colour("rgba(0,0,255,0.5)"), Some([0.0, 0.0, 1.0]));
        assert_eq!(
            parse_css_colour("color(srgb 0.5 0.25 1)"),
            Some([0.5, 0.25, 1.0])
        );
        assert_eq!(
            parse_css_colour("#0A0B0C"),
            Some([10.0 / 255.0, 11.0 / 255.0, 12.0 / 255.0])
        );
        assert_eq!(parse_css_colour("  RGB(255 0 0)  "), Some([1.0, 0.0, 0.0]));
        assert_eq!(parse_css_colour("transparent"), None);
        assert_eq!(parse_css_colour("#abc"), None);
    }

    #[test]
    fn same_palette_tolerates_under_a_512th_and_no_more() {
        let a = light();
        assert!(same_palette(&a, &a));
        let mut near = light();
        near[0].1[0] += 0.001;
        assert!(same_palette(&a, &near));
        let mut far = light();
        far[0].1[0] += 0.01;
        assert!(!same_palette(&a, &far));
        let short: Vec<(String, Rgb)> = light().into_iter().filter(|(n, _)| n != "red").collect();
        assert!(!same_palette(&a, &short));
        assert!(!same_palette(&short, &a));
    }
}

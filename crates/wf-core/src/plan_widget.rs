//! Plan desktop widget: palette validation, saved-position parsing, on-screen placement and the
//! `TaskbarCreated` message id. Pure: the window, the timer and the PowerShell helper stay in
//! the desktop shell.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The widget's width in logical pixels.
pub const PLAN_WIDGET_WIDTH: f64 = 320.0;

/// The widget's height in logical pixels.
pub const PLAN_WIDGET_HEIGHT: f64 = 432.0;

/// Margin from the work area's top-right corner for a widget placed without a saved spot.
const PLACEMENT_MARGIN: f64 = 32.0;

/// Work area assumed when the screen list is empty.
const FALLBACK_AREA: WorkArea = WorkArea {
    x: 0.0,
    y: 0.0,
    width: 1280.0,
    height: 800.0,
};

/// The colour keys every palette must carry, each a `#rrggbb` colour.
pub const WIDGET_PALETTE_KEYS: [&str; 11] = [
    "bg",
    "well",
    "line",
    "text",
    "muted",
    "accent",
    "accent-ink",
    "late",
    "late-ink",
    "soon",
    "soon-ink",
];

/// The optional shape keys, checked in this order when present.
const WIDGET_SHAPE_KEYS: [&str; 8] = [
    "radius",
    "radius-sm",
    "bw",
    "sh",
    "sh-sm",
    "font",
    "fs",
    "fs-sm",
];

/// The widget's palette: every colour key and any shape keys the app sent, as plain CSS.
pub type WidgetPalette = BTreeMap<String, String>;

/// Where the widget was left: its top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PlanWidgetBounds"))]
pub struct WidgetBounds {
    /// Left edge, in logical pixels.
    pub x: f64,
    /// Top edge, in logical pixels.
    pub y: f64,
}

/// One screen's work area: the part not covered by the taskbar.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PlanWidgetWorkArea"))]
pub struct WorkArea {
    /// Left edge, in logical pixels.
    pub x: f64,
    /// Top edge, in logical pixels.
    pub y: f64,
    /// Width, in logical pixels.
    pub width: f64,
    /// Height, in logical pixels.
    pub height: f64,
}

/// JavaScript's `\s` class, written out so the Unicode spaces match as they do in JS.
const JS_SPACE: &str = r"\t\n\x{0B}\x{0C}\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}";

/// A computed box-shadow: `none`, or rgb()/rgba() colours and px offsets only.
static SHADOW_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^(?:rgba?\([\d.,{JS_SPACE}]+\)|-?\d+(?:\.\d+)?px|inset|,|[{JS_SPACE}])+$"
    ))
    .ok()
});

/// A font list: letters, digits, `_`, spaces, commas, quotes and hyphens.
static FONT_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!(r#"^[A-Za-z0-9_{JS_SPACE},"'-]+$"#)).ok());

/// A palette from the app: every colour key a `#rrggbb` colour (lowercased on the way out) and
/// every shape key it carries plain CSS of its kind. `None` if anything is off or the value is
/// not an object.
#[must_use]
pub fn clean_widget_palette(value: &Value) -> Option<WidgetPalette> {
    let input = value.as_object()?;
    let mut out = WidgetPalette::new();
    for key in WIDGET_PALETTE_KEYS {
        let colour = input.get(key)?.as_str()?;
        if !is_hex_colour(colour) {
            return None;
        }
        let _ = out.insert(key.to_owned(), colour.to_ascii_lowercase());
    }
    for key in WIDGET_SHAPE_KEYS {
        let Some(present) = input.get(key) else {
            continue;
        };
        let text = present.as_str()?;
        if !shape_accepts(key, text) {
            return None;
        }
        let _ = out.insert(key.to_owned(), text.to_owned());
    }
    Some(out)
}

/// The saved position, read from the preference file's JSON. Only `x` and `y` are kept; each is
/// rounded half up, as JavaScript's `Math.round` does. Anything that is not an object with two
/// numbers reads as `None`, so a hand-edited file costs the position and nothing else.
#[must_use]
pub fn parse_bounds(stored: &str) -> Option<WidgetBounds> {
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(stored) else {
        return None;
    };
    let x = object.get("x")?.as_f64()?;
    let y = object.get("y")?.as_f64()?;
    Some(WidgetBounds {
        x: js_round(x),
        y: js_round(y),
    })
}

/// A position that sits on one of the screens. A saved spot that no work area contains is
/// dropped for the top-right corner of the first one, so a widget left on an unplugged monitor
/// is not lost. With no screens at all the fallback area is used.
#[must_use]
pub fn place_widget(saved: Option<WidgetBounds>, areas: &[WorkArea]) -> WidgetBounds {
    if let Some(spot) = saved
        && areas.iter().any(|area| fits(*area, spot))
    {
        return spot;
    }
    let first = areas.first().copied().unwrap_or(FALLBACK_AREA);
    WidgetBounds {
        x: first.x + first.width - PLAN_WIDGET_WIDTH - PLACEMENT_MARGIN,
        y: first.y + PLACEMENT_MARGIN,
    }
}

/// The `TaskbarCreated` message id that the helper printed, or `None`. Registered message ids
/// are `0xC000` to `0xFFFF`. The id is read as a decimal integer, which is how the helper
/// prints it.
#[must_use]
pub fn parse_taskbar_created(stdout: &str) -> Option<u32> {
    let token = stdout.split_whitespace().next()?;
    let id: u32 = token.parse().ok()?;
    (0xC000..=0xFFFF).contains(&id).then_some(id)
}

/// Whether `text` is a `#` and six hex digits, in either case.
fn is_hex_colour(text: &str) -> bool {
    text.len() == 7 && text.starts_with('#') && text.bytes().skip(1).all(|b| b.is_ascii_hexdigit())
}

/// Whether `value` is acceptable for the shape key `key`. Unknown keys are not accepted.
fn shape_accepts(key: &str, value: &str) -> bool {
    match key {
        "radius" | "radius-sm" => px(value, 0.0, 999.0),
        "bw" => px(value, 0.0, 8.0),
        "sh" | "sh-sm" => shadow(value),
        "font" => value.encode_utf16().count() <= 300 && font(value),
        "fs" | "fs-sm" => px(value, 8.0, 32.0),
        _ => false,
    }
}

/// A length in px, as `getComputedStyle` prints it: one to three integer digits, an optional
/// fraction, `px`, and a value between `min` and `max`.
fn px(value: &str, min: f64, max: f64) -> bool {
    let Some(number) = value.strip_suffix("px") else {
        return false;
    };
    let (whole, fraction) = match number.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (number, None),
    };
    let whole_ok = (1..=3).contains(&whole.len()) && whole.bytes().all(|b| b.is_ascii_digit());
    let fraction_ok = fraction
        .is_none_or(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()));
    whole_ok && fraction_ok && number.parse::<f64>().is_ok_and(|n| n >= min && n <= max)
}

/// A computed box-shadow of at most 300 UTF-16 units, or `none`.
fn shadow(value: &str) -> bool {
    value.encode_utf16().count() <= 300
        && (value == "none" || SHADOW_RE.as_ref().is_some_and(|re| re.is_match(value)))
}

/// A font list of at most 300 UTF-16 units.
fn font(value: &str) -> bool {
    FONT_RE.as_ref().is_some_and(|re| re.is_match(value))
}

/// Whether `spot` (the widget's top-left) and the widget's full size lie inside `area`.
fn fits(area: WorkArea, spot: WidgetBounds) -> bool {
    spot.x >= area.x
        && spot.y >= area.y
        && spot.x + PLAN_WIDGET_WIDTH <= area.x + area.width
        && spot.y + PLAN_WIDGET_HEIGHT <= area.y + area.height
}

/// JavaScript's `Math.round`: the nearest integer, halves going up (towards +infinity).
fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

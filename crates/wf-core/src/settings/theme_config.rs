//! User-uploadable theme config (`config.json`) and its parser. Port of
//! `packages/core/src/features/settings/domain/parts.ts`. Pure.
//!
//! The file is untrusted input. The parser returns CSS custom properties whose
//! names come from the allowlists here and whose values are rebuilt from parsed
//! pieces, so a value cannot carry stylesheet syntax.
//!
//! Known differences from the TS original, none reachable from a real theme
//! file: JSON that serde rejects but `JSON.parse` takes (numbers past f64 such
//! as `1e400`, lone surrogate escapes, nesting deeper than 128) is "not valid
//! JSON" here; a name cut at 60 UTF-16 units drops a split surrogate pair
//! instead of keeping half of it; and `normalize_theme_config` measures the
//! 64 KB cap on serde's number spelling rather than `JSON.stringify`'s.

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::reader_analysis::lines::{is_js_space, js_trim};
use crate::sync::frontmatter::js_number;

/// Hard cap on an uploaded file, in UTF-8 bytes.
pub const THEME_CONFIG_MAX_BYTES: usize = 64 * 1024;

/// Raw palette tokens a config may override (`colors.<key>` sets `--<key>`).
pub const THEME_COLOR_KEYS: [&str; 24] = [
    "bg",
    "surface",
    "surface2",
    "elev",
    "border",
    "border-strong",
    "text",
    "muted",
    "faint",
    "accent",
    "accent-fg",
    "accent-soft",
    "s-neutral",
    "s-neutral-bg",
    "s-info",
    "s-info-bg",
    "s-good",
    "s-good-bg",
    "s-warn",
    "s-warn-bg",
    "s-danger",
    "s-danger-bg",
    "s-mute",
    "s-mute-bg",
];

/// Font slots (`fonts.<key>` sets `--font-<key>`).
pub const THEME_FONT_KEYS: [&str; 3] = ["sans", "serif", "mono"];

/// Geometry slots (`radius.<key>` sets `--radius-<key>`).
pub const THEME_RADIUS_KEYS: [&str; 3] = ["card", "control", "chip"];

const NAMED_COLORS: [&str; 4] = ["transparent", "currentcolor", "white", "black"];

const GENERIC_FONT_FAMILIES: [&str; 10] = [
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
];

/// Substrings that must never survive into a declaration, checked on the
/// lower-cased value before the grammars.
const FORBIDDEN_FRAGMENTS: [&str; 13] = [
    "url(",
    "var(",
    "expression",
    "javascript:",
    "@import",
    "\\",
    ";",
    "{",
    "}",
    "<",
    ">",
    "/*",
    "*/",
];

const TOP_LEVEL_KEYS: [&str; 9] = [
    "version", "name", "mode", "surfaces", "motion", "tilt", "colors", "fonts", "radius",
];

/// Keys that would poison `Object.prototype` in JS if copied onto an object.
const POISON_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

const MAX_VALUE_LENGTH: usize = 120;
const MAX_NAME_LENGTH: usize = 60;
const MAX_ENTRIES_PER_SECTION: usize = 64;
const MAX_PROBLEMS: usize = 50;

/// Which mode the palette is written for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ThemeMode {
    /// Light base.
    Light,
    /// Dark base.
    Dark,
}

/// How surfaces are separated from each other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum SurfaceStyle {
    /// No borders between surfaces.
    Borderless,
    /// Bordered surfaces (high contrast).
    Bordered,
}

/// A validated theme config.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ThemeConfig {
    /// Display name, shown in settings once the file is applied.
    pub name: String,
    /// Which mode the palette is written for.
    pub mode: ThemeMode,
    /// Border treatment the theme prefers.
    pub surfaces: SurfaceStyle,
    /// Whether the pointer-reactive animation layer is on.
    pub reactive_motion: bool,
    /// Global animation duration multiplier, 0.5 to 2.
    pub motion_scale: f64,
    /// Whether paper and note cards lean a little; unset leaves it to the theme.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub card_tilt: Option<bool>,
    /// CSS custom properties to set, keys with the leading `--`; every value is
    /// a string.
    #[cfg_attr(
        feature = "specta",
        specta(type = std::collections::HashMap<String, String>)
    )]
    pub vars: Map<String, Value>,
}

/// The config, or null with every problem found, each prefixed with its path.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ThemeConfigParseResult {
    /// The config when the file had no problems.
    pub config: Option<ThemeConfig>,
    /// Human-readable problems, at most 50.
    pub errors: Vec<String>,
}

impl ThemeConfigParseResult {
    fn failure(errors: Vec<String>) -> Self {
        Self {
            config: None,
            errors,
        }
    }
}

/// Collects problems as `path: message`, keeping the first 50.
#[derive(Default)]
struct Problems(Vec<String>);

impl Problems {
    fn add(&mut self, path: &str, message: &str) {
        if self.0.len() < MAX_PROBLEMS {
            self.0.push(format!("{path}: {message}"));
        }
    }
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// A canonical JS array index ("0", "7", not "07"), which JS lists first.
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) {
        return None;
    }
    if !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|&n| n != u32::MAX)
}

/// Object keys in JS `Object.keys` order: array indexes ascending, then the
/// rest in insertion order.
fn js_keys(map: &Map<String, Value>) -> Vec<&str> {
    let mut indexes: Vec<(u32, &str)> = Vec::new();
    let mut rest: Vec<&str> = Vec::new();
    for key in map.keys() {
        match array_index(key) {
            Some(n) => indexes.push((n, key)),
            None => rest.push(key),
        }
    }
    indexes.sort_by_key(|&(n, _)| n);
    indexes
        .into_iter()
        .map(|(_, key)| key)
        .chain(rest)
        .collect()
}

fn has_poison_key(map: &Map<String, Value>, depth: usize) -> bool {
    if depth > 6 {
        return false;
    }
    map.iter().any(|(key, value)| {
        POISON_KEYS.contains(&key.as_str())
            || matches!(value, Value::Object(child) if has_poison_key(child, depth + 1))
    })
}

fn looks_hostile(value: &str) -> bool {
    let lowered = value.to_lowercase();
    FORBIDDEN_FRAGMENTS
        .iter()
        .any(|fragment| lowered.contains(fragment))
}

/// Trimmed `raw` when it passes the shared length and hostility checks.
fn checked(raw: &str, max_len: usize) -> Option<&str> {
    let value = js_trim(raw);
    (!value.is_empty() && utf16_len(value) <= max_len && !looks_hostile(value)).then_some(value)
}

/// `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, any case.
fn is_hex_color(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|digits| {
        matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

/// `rgb()/rgba()/hsl()/hsla()` whose body is only digits, `.,%/`, the letters
/// of `deg` and whitespace: no nested function can appear.
fn is_functional_color(value: &str) -> bool {
    let Some((name, rest)) = value.split_once('(') else {
        return false;
    };
    let named = ["rgb", "rgba", "hsl", "hsla"]
        .iter()
        .any(|known| name.eq_ignore_ascii_case(known));
    let Some(body) = rest.strip_suffix(')') else {
        return false;
    };
    named
        && !body.is_empty()
        && body.chars().all(|c| {
            c.is_ascii_digit()
                || ".,%/".contains(c)
                || matches!(c.to_ascii_lowercase(), 'd' | 'e' | 'g')
                || is_js_space(c)
        })
}

/// Each run of JS whitespace as one space.
fn collapse_spaces(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut in_space = false;
    for c in value.chars() {
        if is_js_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// Colors: hex, numeric-argument rgb/hsl, or one of four keywords.
#[must_use]
pub fn normalize_color_value(raw: &str) -> Option<String> {
    let value = checked(raw, MAX_VALUE_LENGTH)?;
    if is_hex_color(value) {
        return Some(value.to_ascii_lowercase());
    }
    let lowered = value.to_lowercase();
    if NAMED_COLORS.contains(&lowered.as_str()) {
        return Some(lowered);
    }
    is_functional_color(value).then(|| collapse_spaces(value))
}

/// One unquoted family name: an ASCII letter or digit, then up to 39 of
/// letters, digits, space, `_` and `-`.
fn is_font_family_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.len() <= 40
        && bytes
            .iter()
            .all(|&b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'_' | b'-'))
}

/// Font stacks: up to five families, each a generic keyword or a name matching
/// [`is_font_family_name`]; names with a space are re-quoted.
#[must_use]
pub fn normalize_font_stack(raw: &str) -> Option<String> {
    let value = checked(raw, MAX_VALUE_LENGTH)?;
    let parts: Vec<&str> = value.split(',').collect();
    if parts.len() > 5 {
        return None;
    }
    let mut families = Vec::with_capacity(parts.len());
    for part in parts {
        let part = js_trim(part);
        let part = part.strip_prefix(['\'', '"']).unwrap_or(part);
        let bare = js_trim(part.strip_suffix(['\'', '"']).unwrap_or(part));
        if bare.is_empty() {
            return None;
        }
        let lowered = bare.to_lowercase();
        if GENERIC_FONT_FAMILIES.contains(&lowered.as_str()) {
            families.push(lowered);
        } else if !is_font_family_name(bare) {
            return None;
        } else if bare.contains(' ') {
            families.push(format!("\"{bare}\""));
        } else {
            families.push(bare.to_owned());
        }
    }
    Some(families.join(", "))
}

/// A numeric length (`raw` px) when it is finite and within `0..=max_px`.
#[must_use]
pub fn normalize_length_number(raw: f64, max_px: f64) -> Option<String> {
    (raw.is_finite() && raw >= 0.0 && raw <= max_px).then(|| format!("{}px", js_number(raw)))
}

/// Split `0`..`999.99` plus an optional `px`, `rem` or `em` (default `px`).
fn split_length(value: &str) -> Option<(&str, &str)> {
    let bytes = value.as_bytes();
    let digits_from = |start: usize| {
        bytes.get(start..).map_or(0, |tail| {
            tail.iter().take_while(|b| b.is_ascii_digit()).count()
        })
    };
    let whole = digits_from(0);
    if !(1..=3).contains(&whole) {
        return None;
    }
    let mut end = whole;
    if bytes.get(end) == Some(&b'.') {
        let fraction = digits_from(end + 1);
        if (1..=2).contains(&fraction) {
            end += 1 + fraction;
        }
    }
    let (amount, unit) = value.split_at(end);
    match unit {
        "" => Some((amount, "px")),
        "px" | "rem" | "em" => Some((amount, unit)),
        _ => None,
    }
}

/// A text length such as `12px`, `0.5rem` or `8` (px). `rem` and `em` are
/// limited to `max_px / 16`; zero is always written `0px`.
#[must_use]
pub fn normalize_length_text(raw: &str, max_px: f64) -> Option<String> {
    let value = checked(raw, 16)?;
    let (amount, unit) = split_length(value)?;
    let amount: f64 = amount.parse().ok()?;
    let limit = if unit == "px" { max_px } else { max_px / 16.0 };
    if amount > limit {
        return None;
    }
    let unit = if amount == 0.0 { "px" } else { unit };
    Some(format!("{}{unit}", js_number(amount)))
}

fn normalize_length_value(raw: &Value, max_px: f64) -> Option<String> {
    match raw {
        Value::Number(n) => n.as_f64().and_then(|n| normalize_length_number(n, max_px)),
        Value::String(text) => normalize_length_text(text, max_px),
        _ => None,
    }
}

fn normalize_string(raw: &Value, normalize: fn(&str) -> Option<String>) -> Option<String> {
    raw.as_str().and_then(normalize)
}

/// Control characters stripped, trimmed, cut to 60 UTF-16 units.
fn normalize_name(raw: &Value) -> Option<String> {
    let cleaned: String = raw
        .as_str()?
        .chars()
        .filter(|&c| c > '\u{1f}' && c != '\u{7f}')
        .collect();
    let trimmed = js_trim(&cleaned);
    if trimmed.is_empty() {
        return None;
    }
    let mut units = 0;
    Some(
        trimmed
            .chars()
            .take_while(|c| {
                units += c.len_utf16();
                units <= MAX_NAME_LENGTH
            })
            .collect(),
    )
}

fn parse_section(
    problems: &mut Problems,
    raw: Option<&Value>,
    path: &str,
    allowed: &[&str],
    normalize: &dyn Fn(&Value) -> Option<String>,
    prefix: &str,
    vars: &mut Map<String, Value>,
) {
    let Some(raw) = raw else {
        return;
    };
    let Value::Object(entries) = raw else {
        problems.add(path, "must be an object");
        return;
    };
    if entries.len() > MAX_ENTRIES_PER_SECTION {
        problems.add(
            path,
            &format!("too many entries (max {MAX_ENTRIES_PER_SECTION})"),
        );
        return;
    }
    for key in js_keys(entries) {
        let at = format!("{path}.{key}");
        if !allowed.contains(&key) {
            problems.add(&at, "unknown key");
            continue;
        }
        match entries.get(key).and_then(normalize) {
            Some(value) => {
                let _ = vars.insert(format!("{prefix}{key}"), Value::String(value));
            }
            None => problems.add(&at, "value is not an accepted format"),
        }
    }
}

fn parse_mode(problems: &mut Problems, raw: Option<&Value>) -> Option<ThemeMode> {
    match raw.map(Value::as_str) {
        None | Some(Some("dark")) => Some(ThemeMode::Dark),
        Some(Some("light")) => Some(ThemeMode::Light),
        Some(_) => {
            problems.add("mode", "must be \"light\" or \"dark\"");
            None
        }
    }
}

fn parse_surfaces(problems: &mut Problems, raw: Option<&Value>) -> Option<SurfaceStyle> {
    match raw.map(Value::as_str) {
        None | Some(Some("borderless")) => Some(SurfaceStyle::Borderless),
        Some(Some("bordered")) => Some(SurfaceStyle::Bordered),
        Some(_) => {
            problems.add("surfaces", "must be \"borderless\" or \"bordered\"");
            None
        }
    }
}

/// `(reactiveMotion, motionScale)` from the `motion` section, defaults `(false, 1)`.
fn parse_motion(problems: &mut Problems, raw: Option<&Value>) -> (bool, f64) {
    let mut reactive_motion = false;
    let mut motion_scale = 1.0;
    let Some(raw) = raw else {
        return (reactive_motion, motion_scale);
    };
    let Value::Object(motion) = raw else {
        problems.add("motion", "must be an object");
        return (reactive_motion, motion_scale);
    };
    for key in js_keys(motion) {
        if key != "reactive" && key != "scale" {
            problems.add(&format!("motion.{key}"), "unknown key");
        }
    }
    if let Some(reactive) = motion.get("reactive") {
        match reactive.as_bool() {
            Some(reactive) => reactive_motion = reactive,
            None => problems.add("motion.reactive", "must be a boolean"),
        }
    }
    if let Some(scale) = motion.get("scale") {
        match scale.as_f64().filter(|scale| (0.5..=2.0).contains(scale)) {
            Some(scale) => motion_scale = (scale * 100.0).round() / 100.0,
            None => problems.add("motion.scale", "must be a number between 0.5 and 2"),
        }
    }
    (reactive_motion, motion_scale)
}

/// Turns a section value into its CSS value, or `None` when it is invalid.
type Normalizer<'a> = &'a dyn Fn(&Value) -> Option<String>;

/// The `colors`, `fonts` and `radius` sections as CSS variables, in that order.
fn parse_vars(problems: &mut Problems, raw: &Map<String, Value>) -> Map<String, Value> {
    let mut vars = Map::new();
    let color = |v: &Value| normalize_string(v, normalize_color_value);
    let font = |v: &Value| normalize_string(v, normalize_font_stack);
    let radius = |v: &Value| normalize_length_value(v, 999.0);
    let sections: [(&str, &[&str], Normalizer<'_>, &str); 3] = [
        ("colors", &THEME_COLOR_KEYS, &color, "--"),
        ("fonts", &THEME_FONT_KEYS, &font, "--font-"),
        ("radius", &THEME_RADIUS_KEYS, &radius, "--radius-"),
    ];
    for (path, allowed, normalize, prefix) in sections {
        parse_section(
            problems,
            raw.get(path),
            path,
            allowed,
            normalize,
            prefix,
            &mut vars,
        );
    }
    vars
}

/// Parse and validate an uploaded theme file. Any problem rejects the whole
/// file: half a palette is worse than none.
#[must_use]
pub fn parse_theme_config(text: &str) -> ThemeConfigParseResult {
    if js_trim(text).is_empty() {
        return ThemeConfigParseResult::failure(vec!["file: is empty".to_owned()]);
    }
    if text.len() > THEME_CONFIG_MAX_BYTES {
        return ThemeConfigParseResult::failure(vec![format!(
            "file: larger than {} KB",
            THEME_CONFIG_MAX_BYTES / 1024
        )]);
    }
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return ThemeConfigParseResult::failure(vec!["file: is not valid JSON".to_owned()]);
    };
    let Value::Object(raw) = parsed else {
        return ThemeConfigParseResult::failure(vec!["file: must be a JSON object".to_owned()]);
    };
    if has_poison_key(&raw, 0) {
        return ThemeConfigParseResult::failure(vec!["file: contains a reserved key".to_owned()]);
    }

    let mut problems = Problems::default();
    for key in js_keys(&raw) {
        if !TOP_LEVEL_KEYS.contains(&key) {
            problems.add(key, "unknown key");
        }
    }
    if raw.get("version").and_then(Value::as_f64) != Some(1.0) {
        problems.add("version", "must be 1");
    }
    let name = raw
        .get("name")
        .and_then(normalize_name)
        .unwrap_or_else(|| "Custom theme".to_owned());
    let mode = parse_mode(&mut problems, raw.get("mode"));
    let surfaces = parse_surfaces(&mut problems, raw.get("surfaces"));
    let (reactive_motion, motion_scale) = parse_motion(&mut problems, raw.get("motion"));
    let mut card_tilt = None;
    if let Some(tilt) = raw.get("tilt") {
        match tilt.as_bool() {
            Some(tilt) => card_tilt = Some(tilt),
            None => problems.add("tilt", "must be a boolean"),
        }
    }

    let vars = parse_vars(&mut problems, &raw);

    match (mode, surfaces) {
        (Some(mode), Some(surfaces)) if problems.0.is_empty() => ThemeConfigParseResult {
            config: Some(ThemeConfig {
                name,
                mode,
                surfaces,
                reactive_motion,
                motion_scale,
                card_tilt,
                vars,
            }),
            errors: Vec::new(),
        },
        _ => ThemeConfigParseResult::failure(problems.0),
    }
}

/// Re-validate a config read back from persistence: rebuild the upload shape
/// and parse it again, so a stored row gets the same checks as an upload.
#[must_use]
pub fn normalize_theme_config(raw: &Value) -> Option<ThemeConfig> {
    let Value::Object(raw) = raw else {
        return None;
    };
    let mut rebuilt = Map::new();
    let _ = rebuilt.insert("version".to_owned(), json!(1));
    for key in ["name", "mode", "surfaces"] {
        if let Some(value) = raw.get(key) {
            let _ = rebuilt.insert(key.to_owned(), value.clone());
        }
    }
    let mut motion = Map::new();
    for (from, to) in [("reactiveMotion", "reactive"), ("motionScale", "scale")] {
        if let Some(value) = raw.get(from) {
            let _ = motion.insert(to.to_owned(), value.clone());
        }
    }
    let _ = rebuilt.insert("motion".to_owned(), Value::Object(motion));
    if let Some(tilt) = raw.get("cardTilt") {
        let _ = rebuilt.insert("tilt".to_owned(), tilt.clone());
    }
    let (colors, fonts, radius) = split_vars(raw.get("vars"));
    let _ = rebuilt.insert("colors".to_owned(), Value::Object(colors));
    let _ = rebuilt.insert("fonts".to_owned(), Value::Object(fonts));
    let _ = rebuilt.insert("radius".to_owned(), Value::Object(radius));
    let text = serde_json::to_string(&Value::Object(rebuilt)).ok()?;
    parse_theme_config(&text).config
}

type Sections = (Map<String, Value>, Map<String, Value>, Map<String, Value>);

/// A flat `--token` map back into `(colors, fonts, radius)`. A key that slices
/// to `__proto__` is dropped, as assigning it in JS sets no own key.
fn split_vars(vars: Option<&Value>) -> Sections {
    let (mut colors, mut fonts, mut radius) = (Map::new(), Map::new(), Map::new());
    let Some(Value::Object(vars)) = vars else {
        return (colors, fonts, radius);
    };
    for (key, value) in vars {
        let (section, rest) = if let Some(rest) = key.strip_prefix("--font-") {
            (&mut fonts, rest)
        } else if let Some(rest) = key.strip_prefix("--radius-") {
            (&mut radius, rest)
        } else if let Some(rest) = key.strip_prefix("--") {
            (&mut colors, rest)
        } else {
            continue;
        };
        if rest != "__proto__" {
            let _ = section.insert(rest.to_owned(), value.clone());
        }
    }
    (colors, fonts, radius)
}

/// A documented starter file, offered as a download from settings.
#[must_use]
pub fn theme_config_template() -> String {
    let template = json!({
        "version": 1,
        "name": "My theme",
        "mode": "dark",
        "surfaces": "borderless",
        "motion": { "reactive": true, "scale": 1 },
        "tilt": false,
        "colors": {
            "bg": "#0b0d12",
            "surface": "#12151c",
            "surface2": "#1a1f29",
            "elev": "#161b23",
            "border": "#2a3140",
            "border-strong": "#3d465a",
            "text": "#e8ecf4",
            "muted": "#9aa5b8",
            "faint": "#6b7688",
            "accent": "#6ea8fe",
            "accent-fg": "#0b0d12",
            "accent-soft": "#1b2740"
        },
        "fonts": {
            "sans": "IBM Plex Sans, system-ui, sans-serif",
            "serif": "IBM Plex Serif, serif",
            "mono": "IBM Plex Mono, ui-monospace, monospace"
        },
        "radius": { "card": "14px", "control": "10px", "chip": "999px" }
    });
    serde_json::to_string_pretty(&template).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn errors(text: &str) -> Vec<String> {
        parse_theme_config(text).errors
    }

    #[test]
    fn colors_accept_hex_keywords_and_numeric_functions() {
        assert_eq!(
            normalize_color_value(" #ABCDEF "),
            Some("#abcdef".to_owned())
        );
        assert_eq!(
            normalize_color_value("CurrentColor"),
            Some("currentcolor".to_owned())
        );
        assert_eq!(
            normalize_color_value("RGB(1,\t2,  3)"),
            Some("RGB(1, 2, 3)".to_owned())
        );
        assert!(normalize_color_value("hsl(10deg 50% 50% / .5)").is_some());
        assert_eq!(normalize_color_value("rgb(var(--x))"), None);
        assert_eq!(normalize_color_value("#abcde"), None);
        assert_eq!(normalize_color_value("red"), None);
        assert_eq!(normalize_color_value("rgb()"), None);
    }

    #[test]
    fn font_stacks_requote_and_lowercase_generics() {
        assert_eq!(
            normalize_font_stack("'IBM Plex Sans', SANS-SERIF"),
            Some("\"IBM Plex Sans\", sans-serif".to_owned())
        );
        assert_eq!(normalize_font_stack("a,b,c,d,e,f"), None);
        assert_eq!(normalize_font_stack("a,,b"), None);
        assert_eq!(normalize_font_stack("\"\""), None);
        assert_eq!(normalize_font_stack("Fira;Code"), None);
    }

    #[test]
    fn lengths_are_bounded_and_respelled() {
        assert_eq!(
            normalize_length_text("1.50rem", 64.0),
            Some("1.5rem".to_owned())
        );
        assert_eq!(
            normalize_length_text("0.00em", 64.0),
            Some("0px".to_owned())
        );
        assert_eq!(normalize_length_text("8", 64.0), Some("8px".to_owned()));
        assert_eq!(normalize_length_text("5rem", 64.0), None);
        assert_eq!(normalize_length_text("1.234px", 64.0), None);
        assert_eq!(normalize_length_text("1000", 999.0), None);
        assert_eq!(normalize_length_number(2.5, 64.0), Some("2.5px".to_owned()));
        assert_eq!(normalize_length_number(-1.0, 64.0), None);
    }

    #[test]
    fn rejects_files_before_reading_keys() {
        assert_eq!(errors("  "), ["file: is empty"]);
        assert_eq!(errors("{"), ["file: is not valid JSON"]);
        assert_eq!(errors("[]"), ["file: must be a JSON object"]);
        assert_eq!(
            errors(r#"{"colors":{"a":{"constructor":1}}}"#),
            ["file: contains a reserved key"]
        );
        let big = format!("{{\"name\":\"{}\"}}", "x".repeat(THEME_CONFIG_MAX_BYTES));
        assert_eq!(errors(&big), ["file: larger than 64 KB"]);
    }

    #[test]
    fn reports_every_problem_in_js_key_order() {
        assert_eq!(
            errors(
                r##"{"zz":1,"2":0,"10":0,"version":2,"mode":"x","motion":{"scale":3},"colors":{"bg":"red","nope":"#fff"}}"##
            ),
            [
                "2: unknown key",
                "10: unknown key",
                "zz: unknown key",
                "version: must be 1",
                "mode: must be \"light\" or \"dark\"",
                "motion.scale: must be a number between 0.5 and 2",
                "colors.bg: value is not an accepted format",
                "colors.nope: unknown key",
            ]
        );
    }

    #[test]
    fn builds_a_config_and_round_trips_it() {
        let parsed = parse_theme_config(
            r##"{"version":1,"name":" Mine\u0007 ","mode":"light","motion":{"reactive":true,"scale":1.234},"tilt":true,"colors":{"bg":"#FFF"},"fonts":{"mono":"monospace"},"radius":{"card":12}}"##,
        );
        let config = parsed.config.expect("valid file");
        assert_eq!(config.name, "Mine");
        assert_eq!(config.mode, ThemeMode::Light);
        assert_eq!(config.motion_scale, 1.23);
        assert_eq!(config.card_tilt, Some(true));
        assert_eq!(
            Value::Object(config.vars.clone()),
            json!({"--bg": "#fff", "--font-mono": "monospace", "--radius-card": "12px"})
        );
        let stored = serde_json::to_value(&config).expect("serializable");
        assert_eq!(normalize_theme_config(&stored), Some(config));
        assert_eq!(normalize_theme_config(&json!([])), None);
    }

    #[test]
    fn template_parses_cleanly() {
        let template = theme_config_template();
        assert!(template.starts_with("{\n  \"version\": 1,\n  \"name\": \"My theme\""));
        assert!(parse_theme_config(&template).config.is_some());
    }
}

//! Ink note frontmatter and stored-body header. Ports the frontmatter and
//! body-header subset (lines 1-381) of `packages/core/src/ink/ink-note.ts`; the
//! stroke model, packing, pages and sidecar paths are not ported here.

use serde_json::{Map, Value};

use crate::search::js_text::is_js_whitespace;
use crate::sync::frontmatter::{frontmatter_list, frontmatter_string, value_text};

/// The `weaveforge-type` an ink note carries.
pub const INK_NOTE_TYPE: &str = "ink_page";

/// The first line of an ink note's stored body.
pub const INK_BODY_HEADER: &str = "<!-- weaveforge-ink";

/// Pages per note, unchanged (§4.7).
pub const INK_NOTE_MAX_PAGES: u32 = 50;

/// Flat frontmatter keys the ink metadata is written under.
pub mod ink_keys {
    /// Declared page count.
    pub const PAGES: &str = "ink-pages";
    /// Page background name.
    pub const PAPER: &str = "ink-paper";
    /// Chunk ids in reading order.
    pub const PAGE_ORDER: &str = "ink-page-order";
    /// Mean recognition confidence, `0` to `1`.
    pub const RECOGNISED: &str = "ink-recognised";
    /// Engine that produced the text layer.
    pub const ENGINE: &str = "ink-engine";
    /// Writing hand.
    pub const HAND: &str = "ink-hand";
}

/// Page backgrounds, in the binary enum's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InkPaper {
    /// Plain page.
    Blank,
    /// Dot grid.
    Dotted,
    /// Ruled lines.
    Ruled,
    /// Square grid.
    Grid,
    /// Wide ruled.
    Wide,
}

impl InkPaper {
    /// The stored name of this paper.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Blank => "blank",
            Self::Dotted => "dotted",
            Self::Ruled => "ruled",
            Self::Grid => "grid",
            Self::Wide => "wide",
        }
    }

    /// The paper with this stored name; exact and case-sensitive.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "blank" => Some(Self::Blank),
            "dotted" => Some(Self::Dotted),
            "ruled" => Some(Self::Ruled),
            "grid" => Some(Self::Grid),
            "wide" => Some(Self::Wide),
            _ => None,
        }
    }
}

/// Which hand the writer uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InkHand {
    /// Right hand.
    Right,
    /// Left hand.
    Left,
}

impl InkHand {
    /// The stored name of this hand.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Right => "right",
            Self::Left => "left",
        }
    }

    /// The hand with this stored name; exact and case-sensitive.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "right" => Some(Self::Right),
            "left" => Some(Self::Left),
            _ => None,
        }
    }
}

/// The ink metadata a note carries, as its frontmatter or body header holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct InkNoteMeta {
    /// Page count as declared.
    pub pages: u32,
    /// Page background.
    pub paper: InkPaper,
    /// Chunk ids, in reading order.
    pub page_order: Vec<String>,
    /// Mean recognition confidence, `0` when never recognised.
    pub recognised: f64,
    /// The engine that produced the text layer, if any.
    pub engine: Option<String>,
    /// Writing hand.
    pub hand: InkHand,
}

/// The metadata a note with no `ink-*` keys gets: one blank page.
#[must_use]
pub fn default_ink_note_meta() -> InkNoteMeta {
    InkNoteMeta {
        pages: 1,
        paper: InkPaper::Blank,
        page_order: Vec::new(),
        recognised: 0.0,
        engine: None,
        hand: InkHand::Right,
    }
}

/// Whether `text` is shaped like a chunk id: 26 uppercase Crockford characters.
#[must_use]
pub fn is_ink_chunk_id(text: &str) -> bool {
    text.len() == 26 && text.bytes().all(is_crockford_upper)
}

fn is_crockford_upper(byte: u8) -> bool {
    matches!(
        byte,
        b'0'..=b'9' | b'A'..=b'H' | b'J' | b'K' | b'M' | b'N' | b'P'..=b'T' | b'V'..=b'Z'
    )
}

/// Whether a frontmatter block is an ink note's, by the type it declares.
#[must_use]
pub fn is_ink_note_frontmatter(fm: &Map<String, Value>) -> bool {
    frontmatter_string(fm, "weaveforge-type").as_deref() == Some(INK_NOTE_TYPE)
}

/// Reads the ink metadata out of a note's frontmatter, falling back to the defaults.
#[must_use]
pub fn read_ink_note_meta(fm: &Map<String, Value>) -> InkNoteMeta {
    let fallback = default_ink_note_meta();
    let pages = js_number_of(&frontmatter_string(fm, ink_keys::PAGES).unwrap_or_default());
    let recognised =
        js_number_of(&frontmatter_string(fm, ink_keys::RECOGNISED).unwrap_or_default());
    InkNoteMeta {
        pages: if pages.is_finite() && pages > 0.0 {
            page_count(pages)
        } else {
            fallback.pages
        },
        paper: frontmatter_string(fm, ink_keys::PAPER)
            .as_deref()
            .and_then(InkPaper::parse)
            .unwrap_or(fallback.paper),
        page_order: frontmatter_list(fm, ink_keys::PAGE_ORDER)
            .into_iter()
            .filter(|id| is_ink_chunk_id(id))
            .collect(),
        recognised: if recognised.is_finite() && (0.0..=1.0).contains(&recognised) {
            recognised
        } else {
            fallback.recognised
        },
        engine: frontmatter_string(fm, ink_keys::ENGINE),
        hand: frontmatter_string(fm, ink_keys::HAND)
            .as_deref()
            .and_then(InkHand::parse)
            .unwrap_or(fallback.hand),
    }
}

/// `min(INK_NOTE_MAX_PAGES, floor(pages))` for a positive finite count.
fn page_count(pages: f64) -> u32 {
    let count = (1..=INK_NOTE_MAX_PAGES)
        .take_while(|n| f64::from(*n) <= pages)
        .count();
    u32::try_from(count).unwrap_or(0)
}

/// The frontmatter fields a note's ink metadata is written as, in TS key order.
#[must_use]
pub fn write_ink_note_meta(meta: &InkNoteMeta) -> Vec<(String, Value)> {
    let page_order = if meta.page_order.is_empty() {
        Value::Null
    } else {
        Value::Array(
            meta.page_order
                .iter()
                .map(|id| Value::from(id.as_str()))
                .collect(),
        )
    };
    vec![
        (ink_keys::PAGES.to_owned(), Value::from(meta.pages)),
        (ink_keys::PAPER.to_owned(), Value::from(meta.paper.as_str())),
        (ink_keys::PAGE_ORDER.to_owned(), page_order),
        (
            ink_keys::RECOGNISED.to_owned(),
            Value::from(to_fixed_2(meta.recognised)),
        ),
        (
            ink_keys::ENGINE.to_owned(),
            meta.engine.as_deref().map_or(Value::Null, Value::from),
        ),
        (ink_keys::HAND.to_owned(), Value::from(meta.hand.as_str())),
    ]
}

/// Whether a stored body is an ink note's: it looks at the first line only.
#[must_use]
pub fn is_ink_note_body(body: &str) -> bool {
    body.starts_with(INK_BODY_HEADER)
}

/// Splits a stored body into its ink metadata and its text layer.
///
/// A body with no header is a plain note, read as an empty ink note.
#[must_use]
pub fn read_ink_note_body(body: &str) -> (InkNoteMeta, String) {
    let Some((inner, rest)) = split_header(body) else {
        return (default_ink_note_meta(), body.to_owned());
    };
    let mut record = Map::new();
    for token in inner.split(is_js_whitespace).filter(|t| !t.is_empty()) {
        let Some((key, value)) = token.split_once('=') else {
            continue;
        };
        if key.is_empty() {
            continue;
        }
        let value = if key == ink_keys::PAGE_ORDER {
            Value::Array(
                value
                    .split(',')
                    .filter(|part| !part.is_empty())
                    .map(Value::from)
                    .collect(),
            )
        } else {
            Value::String(value.to_owned())
        };
        let _ = record.insert(key.to_owned(), value);
    }
    (
        read_ink_note_meta(&record),
        strip_stray_headers(rest).to_owned(),
    )
}

/// Joins ink metadata and a text layer into the body a note is stored as.
#[must_use]
pub fn write_ink_note_body(meta: &InkNoteMeta, text: &str) -> String {
    let tokens: Vec<String> = write_ink_note_meta(meta)
        .iter()
        .filter(|(_, value)| !value.is_null())
        .map(|(key, value)| format!("{key}={}", token_value(value)))
        .collect();
    let rest = text
        .strip_prefix("\r\n")
        .or_else(|| text.strip_prefix('\n'))
        .unwrap_or(text);
    format!("{INK_BODY_HEADER} {} -->\n{rest}", tokens.join(" "))
}

/// A header token's value: arrays join with commas, everything else is `String(value)`.
fn token_value(value: &Value) -> String {
    match value {
        Value::Array(items) => items.iter().map(value_text).collect::<Vec<_>>().join(","),
        other => value_text(other),
    }
}

/// JS `Number(text)` for an already-trimmed string; `NaN` wherever JS gives `NaN`.
fn js_number_of(text: &str) -> f64 {
    match text {
        "" => return 0.0,
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if let Some((radix, digits)) = radix_literal(text) {
        return parse_radix_digits(digits, radix);
    }
    // Rust accepts `inf` and `nan`, which JS does not.
    if text
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '.' | 'e' | 'E'))
    {
        text.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// The radix and digits of an unsigned `0x`, `0o` or `0b` literal.
fn radix_literal(text: &str) -> Option<(u32, &str)> {
    let radix = match text.get(..2) {
        Some("0x" | "0X") => 16,
        Some("0o" | "0O") => 8,
        Some("0b" | "0B") => 2,
        _ => return None,
    };
    text.get(2..).map(|digits| (radix, digits))
}

fn parse_radix_digits(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    let mut value = 0.0;
    for c in digits.chars() {
        match c.to_digit(radix) {
            Some(digit) => value = value * f64::from(radix) + f64::from(digit),
            None => return f64::NAN,
        }
    }
    value
}

/// JS `Number(x.toFixed(2))`: exact ties round away from zero, not to even.
fn to_fixed_2(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let is_tie = is_whole(x * 8.0) && !is_whole(x * 100.0);
    let nudged = if is_tie { x + x.signum() * 0.001 } else { x };
    format!("{nudged:.2}").parse::<f64>().unwrap_or(x)
}

/// Exact-integer test without `==` on floats; `fract` is exactly zero for whole values.
fn is_whole(x: f64) -> bool {
    x.fract().abs() < f64::MIN_POSITIVE
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// The text after `<!--`, optional whitespace, `weaveforge-ink` and a word boundary.
fn header_tail(text: &str) -> Option<&str> {
    let after_open = text
        .strip_prefix("<!--")?
        .trim_start_matches(is_js_whitespace);
    let after_word = after_open.strip_prefix("weaveforge-ink")?;
    (!after_word.starts_with(is_word_char)).then_some(after_word)
}

/// The header's inner text and the text after its line, or `None` when there is no header.
fn split_header(body: &str) -> Option<(&str, &str)> {
    let after_word = header_tail(body)?;
    let close = after_word.find("-->")?;
    let inner = after_word.get(..close)?;
    let rest = after_word.get(close + 3..)?;
    let rest = rest.trim_start_matches([' ', '\t']);
    let rest = rest.strip_prefix('\r').unwrap_or(rest);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    Some((inner, rest))
}

/// Drops leading stray header lines: a second header is damage, not metadata.
fn strip_stray_headers(text: &str) -> &str {
    let mut out = text;
    while let Some(next) = stray_header_rest(out) {
        out = next;
    }
    out
}

/// The text after a leading header line, or `None` when the text does not start with one.
fn stray_header_rest(text: &str) -> Option<&str> {
    let after_word = header_tail(text)?;
    Some(
        after_word
            .find('\n')
            .and_then(|i| after_word.get(i + 1..))
            .unwrap_or(""),
    )
}

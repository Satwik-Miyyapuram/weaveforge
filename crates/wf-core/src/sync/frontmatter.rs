//! Frontmatter writer and reader. Ports `packages/core/src/workspace/parts.ts`.

use std::num::FpCategory;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::search::js_text::is_js_whitespace;

const LINE_TERMINATORS: [char; 4] = ['\n', '\r', '\u{2028}', '\u{2029}'];

/// A note split into its frontmatter map and the text after the fence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ParsedDocument {
    /// Parsed `key: value` fields, in file order.
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub frontmatter: Map<String, Value>,
    /// Everything after the closing fence, or the whole input when there is no fence.
    pub body: String,
}

/// Writes `fields` as a `---` fenced block followed by `body`.
/// Skips null (TS `undefined`) and empty-list fields.
#[must_use]
pub fn write_frontmatter(fields: &[(String, Value)], body: &str) -> String {
    let mut lines = vec!["---".to_owned()];
    for (key, value) in fields {
        if value.is_null() || matches!(value, Value::Array(items) if items.is_empty()) {
            continue;
        }
        lines.push(format!("{key}: {}", render_value(value)));
    }
    lines.push("---".to_owned());
    lines.push(String::new());
    format!("{}{body}", lines.join("\n"))
}

/// Splits a fenced note into its frontmatter map and body.
#[must_use]
pub fn read_frontmatter(content: &str) -> ParsedDocument {
    match split_fences(content) {
        Some((block, body)) => ParsedDocument {
            frontmatter: parse_block(block),
            body: body.to_owned(),
        },
        None => ParsedDocument {
            frontmatter: Map::new(),
            body: content.to_owned(),
        },
    }
}

/// Trimmed text of a field, or `None` when absent, a list, or blank.
#[must_use]
pub fn frontmatter_string(fm: &Map<String, Value>, key: &str) -> Option<String> {
    let value = fm.get(key)?;
    if value.is_null() || value.is_array() {
        return None;
    }
    let text = trim_js(&value_text(value)).to_owned();
    (!text.is_empty()).then_some(text)
}

/// Items of a list field; a non-blank string counts as one item.
#[must_use]
pub fn frontmatter_list(fm: &Map<String, Value>, key: &str) -> Vec<String> {
    match fm.get(key) {
        Some(Value::Array(items)) => items.iter().map(value_text).collect(),
        Some(Value::String(text)) => {
            let text = trim_js(text);
            if text.is_empty() {
                Vec::new()
            } else {
                vec![text.to_owned()]
            }
        }
        _ => Vec::new(),
    }
}

/// Returns the text of a `---` fenced block and the body after it, if fenced.
/// Mirrors the TS regex `^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?`.
pub(crate) fn split_fences(content: &str) -> Option<(&str, &str)> {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let after_open = text.strip_prefix("---")?;
    let after_open = after_open
        .strip_prefix("\r\n")
        .or_else(|| after_open.strip_prefix('\n'))?;
    let close = after_open.find("\n---")?;
    let block = after_open.get(..close)?;
    let block = block.strip_suffix('\r').unwrap_or(block);
    let rest = after_open.get(close + 4..)?;
    let rest = rest.strip_prefix('\r').unwrap_or(rest);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    Some((block, rest))
}

fn render_value(value: &Value) -> String {
    match value {
        Value::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .map(|item| quote_scalar(&value_text(item)))
                .collect();
            format!("[{}]", parts.join(", "))
        }
        Value::Number(_) | Value::Bool(_) => value_text(value),
        other => quote_scalar(&value_text(other)),
    }
}

fn quote_scalar(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_owned();
    }
    if is_bare(value) {
        return value.to_owned();
    }
    // Line terminators are escaped too: raw, they end the key line and the field is lost.
    let mut escaped = String::with_capacity(value.len() + 2);
    for c in value.chars() {
        match c {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\u{2028}' => escaped.push_str("\\u2028"),
            '\u{2029}' => escaped.push_str("\\u2029"),
            other => escaped.push(other),
        }
    }
    format!("\"{escaped}\"")
}

/// Reverses `quote_scalar` in one pass; an unknown escape stays as written.
fn unescape_double(inner: &str) -> String {
    let mut out = String::with_capacity(inner.len());
    let mut rest = inner;
    while let Some((head, tail)) = rest.split_once('\\') {
        out.push_str(head);
        let escape = [
            ("\\", "\\"),
            ("\"", "\""),
            ("n", "\n"),
            ("r", "\r"),
            ("u2028", "\u{2028}"),
            ("u2029", "\u{2029}"),
        ]
        .iter()
        .find_map(|(code, text)| tail.strip_prefix(code).map(|after| (*text, after)));
        let (text, after) = escape.unwrap_or(("\\", tail));
        out.push_str(text);
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Plain enough to write unquoted and read back as the same string.
fn is_bare(value: &str) -> bool {
    let plain = value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '@' | '+' | '-'));
    let keyword = ["true", "false", "null", "~"]
        .iter()
        .any(|word| value.eq_ignore_ascii_case(word));
    let numeric = value
        .strip_prefix('-')
        .unwrap_or(value)
        .starts_with(|c: char| c.is_ascii_digit());
    plain && !keyword && !numeric
}

/// JS `String(value)` for a frontmatter value; numbers print as JS prints them.
#[must_use]
pub fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number_text(number),
        Value::Bool(flag) => flag.to_string(),
        other => other.to_string(),
    }
}

fn number_text(number: &serde_json::Number) -> String {
    if let Some(int) = number.as_i64() {
        int.to_string()
    } else if let Some(uint) = number.as_u64() {
        uint.to_string()
    } else {
        number.as_f64().map_or_else(String::new, js_number)
    }
}

/// JS `String(n)` for finite and non-finite doubles.
pub(crate) fn js_number(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_owned();
    }
    if n.is_infinite() {
        return if n.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .to_owned();
    }
    if n.classify() == FpCategory::Zero {
        return "0".to_owned();
    }
    if (1e-6..1e21).contains(&n.abs()) {
        return format!("{n}");
    }
    let text = format!("{n:e}");
    match text.split_once('e') {
        Some((mantissa, exponent)) if !exponent.starts_with('-') => {
            format!("{mantissa}e+{exponent}")
        }
        _ => text,
    }
}

fn parse_block(block: &str) -> Map<String, Value> {
    let lines = block_lines(block);
    let mut fm = Map::new();
    let mut i = 0;
    while let Some(&line) = lines.get(i) {
        let key_index = i;
        i += 1;
        if line.starts_with(is_js_whitespace) {
            continue;
        }
        let Some((key, inline)) = key_line(line) else {
            continue;
        };
        if !trim_js(inline).is_empty() {
            let _ = fm.insert(key.to_owned(), parse_value(inline));
            continue;
        }
        let (cursor, value) = block_value(&lines, key_index);
        if let Some(value) = value {
            let _ = fm.insert(key.to_owned(), value);
        }
        // Resume after the last consumed block line.
        i = cursor + 1;
    }
    fm
}

/// Splits on `\n`; each line but the last loses one trailing `\r`, as the TS `\r?\n` split does.
fn block_lines(block: &str) -> Vec<&str> {
    let parts: Vec<&str> = block.split('\n').collect();
    let last = parts.len().saturating_sub(1);
    parts
        .iter()
        .enumerate()
        .map(|(i, &part)| {
            if i < last {
                part.strip_suffix('\r').unwrap_or(part)
            } else {
                part
            }
        })
        .collect()
}

/// Reads the indented lines under an empty key. Returns the last consumed line index and the value.
fn block_value(lines: &[&str], key_index: usize) -> (usize, Option<Value>) {
    let mut cursor = key_index;
    let mut nested = false;
    let mut items = Vec::new();
    for (j, &line) in lines.iter().enumerate().skip(key_index + 1) {
        if trim_js(line).is_empty() {
            continue;
        }
        if !line.starts_with(is_js_whitespace) {
            break;
        }
        cursor = j;
        match block_item(line) {
            Some(item) => {
                let value = unquote(item);
                if !value.is_empty() {
                    items.push(Value::String(value));
                }
            }
            None => nested = true,
        }
    }
    let value = if nested {
        None
    } else if cursor > key_index {
        Some(Value::Array(items))
    } else {
        Some(Value::String(String::new()))
    };
    (cursor, value)
}

/// `key: rest` with a key of `[A-Za-z0-9_-]`; `None` when the rest holds a line terminator.
fn key_line(line: &str) -> Option<(&str, &str)> {
    let key_end = line.find(|c: char| !is_key_char(c)).unwrap_or(line.len());
    let key = line.get(..key_end)?;
    let rest = line.get(key_end..)?.strip_prefix(':')?;
    let value = trim_start_js(rest);
    if key.is_empty() || value.contains(LINE_TERMINATORS) {
        return None;
    }
    Some((key, value))
}

fn is_key_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// `  - item` under a key; returns the raw item text.
fn block_item(line: &str) -> Option<&str> {
    if !line.starts_with(is_js_whitespace) {
        return None;
    }
    let rest = trim_start_js(line).strip_prefix('-')?;
    let item = trim_start_js(rest);
    (!item.contains(LINE_TERMINATORS)).then_some(item)
}

fn parse_value(raw: &str) -> Value {
    let trimmed = trim_js(raw);
    if let Some(inner) = trimmed
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        let items = parse_flow_list(inner);
        return Value::Array(items.into_iter().map(Value::String).collect());
    }
    if let Some(number) = parse_number(trimmed) {
        return number;
    }
    if trimmed.eq_ignore_ascii_case("true") || trimmed.eq_ignore_ascii_case("false") {
        return Value::Bool(trimmed.eq_ignore_ascii_case("true"));
    }
    Value::String(unquote(trimmed))
}

/// Splits `a, "b, c"` on commas outside double quotes; drops empty items.
fn parse_flow_list(inner: &str) -> Vec<String> {
    let inner = trim_js(inner);
    let mut items = Vec::new();
    let mut buffer = String::new();
    let mut quoted = false;
    let mut prev = None;
    for c in inner.chars() {
        // A `"` right after `\` does not toggle, matching the TS scan.
        if c == '"' && prev != Some('\\') {
            quoted = !quoted;
        }
        if c == ',' && !quoted {
            items.push(unquote(&buffer));
            buffer.clear();
        } else {
            buffer.push(c);
        }
        prev = Some(c);
    }
    if !trim_js(&buffer).is_empty() {
        items.push(unquote(&buffer));
    }
    items.retain(|item| !item.is_empty());
    items
}

fn parse_number(text: &str) -> Option<Value> {
    if !is_decimal(text) {
        return None;
    }
    if !text.contains('.')
        && let Ok(int) = text.parse::<i64>()
    {
        return Some(Value::from(int));
    }
    text.parse::<f64>().ok().map(Value::from)
}

/// Matches `^-?\d+(\.\d+)?$`.
fn is_decimal(text: &str) -> bool {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (whole, fraction) = match unsigned.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (unsigned, None),
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    digits(whole) && fraction.is_none_or(digits)
}

fn unquote(raw: &str) -> String {
    let trimmed = trim_js(raw);
    if let Some(inner) = trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    {
        return unescape_double(inner);
    }
    if let Some(inner) = trimmed
        .strip_prefix('\'')
        .and_then(|rest| rest.strip_suffix('\''))
    {
        return inner.replace("''", "'");
    }
    trimmed.to_owned()
}

fn trim_js(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

fn trim_start_js(text: &str) -> &str {
    text.trim_start_matches(is_js_whitespace)
}

/// The workspace file format this build writes (`wf: 3`). A file that says a
/// newer version opens read-only.
pub const FORMAT_VERSION: u64 = 3;

/// The canonical form two copies of a text file are compared in: Unicode NFC,
/// and every CRLF or lone CR turned into LF.
#[must_use]
pub fn canonical_text(text: &str) -> String {
    use unicode_normalization::UnicodeNormalization as _;
    let lf = text.replace("\r\n", "\n").replace('\r', "\n");
    lf.nfc().collect()
}

/// Lowercase hex SHA-256 of `bytes`: the version name of a binary file.
#[must_use]
pub fn bytes_digest(bytes: &[u8]) -> String {
    use sha2::Digest as _;
    let hash = sha2::Sha256::digest(bytes);
    hash.iter()
        .fold(String::with_capacity(64), |mut out, byte| {
            out.push_str(&format!("{byte:02x}"));
            out
        })
}

/// Lowercase hex SHA-256 of [`canonical_text`]: the version name of a text
/// file, used for bases, the digest log and a checked write's expected hash.
#[must_use]
pub fn canonical_digest(text: &str) -> String {
    bytes_digest(canonical_text(text).as_bytes())
}

/// True when the two texts are the same once both are in canonical form.
#[must_use]
pub fn canonical_eq(a: &str, b: &str) -> bool {
    a == b || canonical_text(a) == canonical_text(b)
}

/// Which kind of workspace file a path names; decides where its version and id live.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// A note (`.md`).
    Markdown,
    /// A freeform page (`.canvas`).
    Canvas,
    /// An Overleaf project link (`.overleaf.json`).
    Overleaf,
    /// Paper annotations (`.annotations.json`).
    Annotations,
    /// Item comments (`.comments.json`).
    Comments,
    /// A metrics chunk CSV under an experiment's `metrics/` folder.
    MetricsChunk,
    /// An AI audit chunk (`.weaveforge/ai/audit/*.jsonl`).
    AiAudit,
    /// An ink stroke file (`<note>.ink/*.inkb`, or the legacy `.ink/<id>/*.inkb`).
    Ink,
    /// Root-level workspace JSON under `.weaveforge/`.
    WorkspaceMeta,
    /// Anything else.
    Other,
}

/// Classifies `path` (workspace-relative, `/` separated) by its name and folders.
#[must_use]
pub fn file_kind(path: &str) -> FileKind {
    let name = path.rsplit('/').next().unwrap_or(path);
    if path.ends_with(".annotations.json") {
        FileKind::Annotations
    } else if path.ends_with(".comments.json") {
        FileKind::Comments
    } else if name == ".overleaf.json" {
        FileKind::Overleaf
    } else if path.ends_with(".inkb")
        && (path
            .rsplit('/')
            .nth(1)
            .is_some_and(crate::ink::ink_paths::is_ink_strokes_segment)
            || path.split('/').any(|segment| segment == ".ink"))
    {
        FileKind::Ink
    } else if path.ends_with(".jsonl") && path.starts_with(".weaveforge/ai/audit/") {
        FileKind::AiAudit
    } else if path.ends_with(".csv") && (path.contains("/metrics/") || path.starts_with("metrics/"))
    {
        FileKind::MetricsChunk
    } else if path
        .strip_prefix(".weaveforge/")
        .is_some_and(|rest| path.ends_with(".json") && !rest.contains('/'))
    {
        FileKind::WorkspaceMeta
    } else if path.ends_with(".md") {
        FileKind::Markdown
    } else if path.ends_with(".canvas") {
        FileKind::Canvas
    } else {
        FileKind::Other
    }
}

/// Version, id and conflict origin read from a file's own header.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileHeader {
    /// Format version the file declares (`wf`), if any.
    pub wf: Option<u64>,
    /// Stable id: `weaveforge-id` in a note, top-level `id` in JSON; none for workspace meta.
    pub id: Option<String>,
    /// Path of the file this copy was split from (`conflict_of`), if any.
    pub conflict_of: Option<String>,
    /// True when `wf` is newer than [`FORMAT_VERSION`], so the file must not be written.
    pub read_only: bool,
}

/// Reads the version, id and conflict origin of `text`, a file at `path`.
#[must_use]
pub fn file_header(path: &str, text: &str) -> FileHeader {
    let mut header = match file_kind(path) {
        FileKind::Markdown => markdown_header(text),
        FileKind::Canvas | FileKind::Overleaf => json_header(text),
        FileKind::WorkspaceMeta => {
            let mut meta = json_header(text);
            meta.id = None;
            meta
        }
        _ => FileHeader::default(),
    };
    header.read_only = header.wf.is_some_and(|v| v > FORMAT_VERSION);
    header
}

/// Header fields of a note's frontmatter.
fn markdown_header(text: &str) -> FileHeader {
    let fm = read_frontmatter(text).frontmatter;
    FileHeader {
        wf: fm.get("wf").and_then(|value| match value {
            Value::String(s) => s.parse().ok(),
            other => other.as_u64(),
        }),
        id: frontmatter_string(&fm, "weaveforge-id"),
        conflict_of: frontmatter_string(&fm, "conflict_of"),
        read_only: false,
    }
}

/// Header fields of a JSON object; invalid JSON or a non-object gives no fields.
fn json_header(text: &str) -> FileHeader {
    let map = match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(map)) => map,
        _ => return FileHeader::default(),
    };
    FileHeader {
        wf: map.get("wf").and_then(Value::as_u64),
        id: map.get("id").and_then(Value::as_str).map(str::to_owned),
        conflict_of: map
            .get("conflict_of")
            .and_then(Value::as_str)
            .map(str::to_owned),
        read_only: false,
    }
}

/// True when `path` is a conflict or migration copy (`*.conflict-<ts>.<ext>` or
/// `*.migrated-0.9.4.<ext>`), which never counts as a duplicate id.
#[must_use]
pub fn is_conflict_copy(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.contains(".conflict-") || name.contains(".migrated-0.9.4.")
}

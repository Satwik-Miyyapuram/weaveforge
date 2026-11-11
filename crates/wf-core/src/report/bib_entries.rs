//! Reading a `.bib` well enough to ask questions about it. Port of
//! `packages/core/src/features/report/domain/parts.ts`: no BibTeX
//! re-rendering and no macro resolution; anything unreadable becomes a warning.

use std::sync::LazyLock;

use regex_lite::Regex;

use crate::latex_section_tree::LatexSourceFile;
use crate::papers::js_regex::compile;
use crate::reader_analysis::lines::js_trim;

/// Entry types that declare no reference and are skipped without comment.
const NOT_REFERENCES: &[&str] = &["comment", "preamble", "string"];

/// `^@\s*([A-Za-z]+)\s*$`: the `@type` head of an entry.
static TYPE_LINE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"^@\s*([A-Za-z]+)\s*$").ok());

/// `^[a-z][a-z0-9_:.-]*$`: a field name once lower-cased.
static FIELD_NAME: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^[a-z][a-z0-9_:.-]*$").ok());

/// `\s+`: runs collapsed to one space in field values.
static WS_RUN: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\s+").ok());

/// One `@type{key, ...}` entry.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BibEntry {
    /// Lower-cased entry type: `article`, `inproceedings`, `misc`.
    #[serde(rename = "type")]
    pub entry_type: String,
    /// Citation key, trimmed.
    pub key: String,
    /// Fields in source order. Names are lower-cased; values are the literal text, braces stripped.
    pub fields: Vec<BibField>,
    /// Path of the `.bib` file.
    pub file: String,
    /// 1-based line of the `@`.
    pub line: u32,
}

/// One field of an entry. The TS wrapper rebuilds these into a record.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BibField {
    /// Lower-cased field name.
    pub name: String,
    /// Literal value, braces and quotes stripped, whitespace collapsed.
    pub value: String,
}

/// A problem found while reading a `.bib`, reported instead of thrown.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BibWarning {
    /// Path of the `.bib` file.
    pub file: String,
    /// 1-based line of the `@` the warning is about.
    pub line: u32,
    /// Human-readable message.
    pub message: String,
}

/// Entries and warnings read from a set of files.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BibParseResult {
    /// Every reference entry, in file then source order.
    pub entries: Vec<BibEntry>,
    /// Every problem found, in the order it was found.
    pub warnings: Vec<BibWarning>,
}

/// A position in one file that knows which line it is on.
struct Cursor<'a> {
    text: &'a str,
    /// Byte offset; always on a char boundary.
    pos: usize,
    line: u32,
}

impl<'a> Cursor<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            pos: 0,
            line: 1,
        }
    }

    /// Move to `next`, counting the lines crossed on the way.
    fn move_to(&mut self, next: usize) {
        let from = self.pos.min(next);
        let to = self.pos.max(next);
        let newlines = self.text.as_bytes()[from..to]
            .iter()
            .fold(0_u32, |n, &b| n + u32::from(b == b'\n'));
        if next >= self.pos {
            self.line += newlines;
        } else {
            self.line -= newlines;
        }
        self.pos = next;
    }
}

/// Index just past the `}` closing the brace at `open`, or `None` when the text ends first.
/// Quoted strings are not special: an entry whose braces do not balance is broken either way.
fn match_brace(text: &str, open: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth: i64 = 0;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            // A backslash escapes the next byte; it never counts as a brace.
            b'\\' => i += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Strip one layer of `{}` or `""` from a field value and collapse whitespace.
fn unwrap_value(value: &str) -> String {
    let mut text = js_trim(value);
    loop {
        let wrapped = (text.starts_with('{') && text.ends_with('}'))
            || (text.starts_with('"') && text.ends_with('"'));
        if !wrapped {
            break;
        }
        // Only strip when the wrapper is a single pair: `{a} and {b}` is not wrapped.
        if text.starts_with('{') && match_brace(text, 0) != Some(text.len()) {
            break;
        }
        let inner = if text.len() >= 2 {
            &text[1..text.len() - 1]
        } else {
            ""
        };
        text = js_trim(inner);
    }
    match WS_RUN.as_ref() {
        Some(re) => js_trim(&re.replace_all(text, " ")).to_owned(),
        None => js_trim(text).to_owned(),
    }
}

/// Split an entry body into `name = value` fields. Commas inside braces or quotes do not
/// separate fields, which is the only reason this is not a plain split on `,`.
fn split_fields(body: &str) -> Vec<BibField> {
    let bytes = body.as_bytes();
    let mut parts: Vec<&str> = Vec::new();
    let mut depth: i64 = 0;
    let mut quoted = false;
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            b'"' if depth == 0 => quoted = !quoted,
            b'{' => depth += 1,
            b'}' => depth -= 1,
            b',' if depth == 0 && !quoted => {
                parts.push(&body[start..i]);
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    parts.push(&body[start..]);

    let mut fields = Vec::new();
    for part in parts {
        let Some(eq) = part.find('=') else {
            continue;
        };
        let name = js_trim(&part[..eq]).to_lowercase();
        if name.is_empty() || !FIELD_NAME.as_ref().is_some_and(|re| re.is_match(&name)) {
            continue;
        }
        fields.push(BibField {
            name,
            value: unwrap_value(&part[eq + 1..]),
        });
    }
    fields
}

/// Read one entry at or after the cursor. Returns `false` when nothing is left to read.
fn parse_one(file: &str, cursor: &mut Cursor<'_>, result: &mut BibParseResult) -> bool {
    let text = cursor.text;
    let from = cursor.pos;
    let Some(at) = text[from..].find('@').map(|rel| from + rel) else {
        cursor.move_to(text.len());
        return false;
    };
    cursor.move_to(at);
    let line = cursor.line;

    let open = text[at..].find('{').map(|rel| at + rel);
    let type_name = open
        .and_then(|open| TYPE_LINE.as_ref()?.captures(&text[at..open]))
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_lowercase());
    let (Some(open), Some(type_name)) = (open, type_name) else {
        cursor.move_to(at + 1);
        return true;
    };

    let Some(close) = match_brace(text, open) else {
        result.warnings.push(BibWarning {
            file: file.to_owned(),
            line,
            message: format!("@{type_name} is never closed — a '}}' is missing."),
        });
        cursor.move_to(text.len());
        return false;
    };
    cursor.move_to(close);
    if NOT_REFERENCES.contains(&type_name.as_str()) {
        return true;
    }

    let inner = &text[open + 1..close - 1];
    let comma = inner.find(',');
    let key = js_trim(comma.map_or(inner, |c| &inner[..c])).to_owned();
    if key.is_empty() {
        result.warnings.push(BibWarning {
            file: file.to_owned(),
            line,
            message: format!("@{type_name} has no citation key."),
        });
        return true;
    }

    let mut fields: Vec<BibField> = Vec::new();
    let body = comma.map_or("", |c| &inner[c + 1..]);
    for field in split_fields(body) {
        // The TS `in` check also sees Object.prototype's `constructor`, so it counts as a repeat.
        let repeat = field.name == "constructor" || fields.iter().any(|f| f.name == field.name);
        if repeat {
            result.warnings.push(BibWarning {
                file: file.to_owned(),
                line,
                message: format!("{key} names '{}' twice; the later one is used.", field.name),
            });
        }
        // A repeated name keeps its first position and takes the later value.
        match fields.iter().position(|f| f.name == field.name) {
            Some(index) => fields[index].value = field.value,
            None => fields.push(field),
        }
    }

    result.entries.push(BibEntry {
        entry_type: type_name,
        key,
        fields,
        file: file.to_owned(),
        line,
    });
    true
}

/// Read every `.bib` among these files. Non-`.bib` files are ignored.
#[must_use]
pub fn parse_bib_entries(files: &[LatexSourceFile]) -> BibParseResult {
    let mut result = BibParseResult {
        entries: Vec::new(),
        warnings: Vec::new(),
    };
    for file in files {
        if !file.path.to_lowercase().ends_with(".bib") {
            continue;
        }
        let mut cursor = Cursor::new(&file.content);
        while parse_one(&file.path, &mut cursor, &mut result) {
            // until the file runs out
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bib(path: &str, content: &str) -> LatexSourceFile {
        LatexSourceFile {
            path: path.to_owned(),
            content: content.to_owned(),
        }
    }

    fn field(name: &str, value: &str) -> BibField {
        BibField {
            name: name.to_owned(),
            value: value.to_owned(),
        }
    }

    #[test]
    fn reads_type_key_fields_and_line() {
        let src = "% note\n\n@Article{smith2020,\n  title = {  A   Study },\n  year = 2020,\n}\n";
        let result = parse_bib_entries(&[bib("refs.bib", src)]);
        assert!(result.warnings.is_empty());
        assert_eq!(result.entries.len(), 1);
        let entry = &result.entries[0];
        assert_eq!(entry.entry_type, "article");
        assert_eq!(entry.key, "smith2020");
        assert_eq!(entry.file, "refs.bib");
        assert_eq!(entry.line, 3);
        assert_eq!(
            entry.fields,
            vec![field("title", "A Study"), field("year", "2020")]
        );
    }

    #[test]
    fn skips_comment_preamble_and_string_silently() {
        let src = "@comment{x}\n@preamble{\"y\"}\n@string{z = \"w\"}\n";
        let result = parse_bib_entries(&[bib("a.bib", src)]);
        assert!(result.entries.is_empty());
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn unclosed_entry_warns_and_ends_the_file() {
        let src = "@misc{a,\n  title = {x}\n";
        let result = parse_bib_entries(&[bib("b.bib", src)]);
        assert!(result.entries.is_empty());
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].line, 1);
        assert_eq!(
            result.warnings[0].message,
            "@misc is never closed — a '}' is missing."
        );
    }

    #[test]
    fn repeated_field_keeps_first_position_and_later_value() {
        let src = "@misc{k, title={a}, year={1}, title={b}}";
        let result = parse_bib_entries(&[bib("c.bib", src)]);
        assert_eq!(
            result.entries[0].fields,
            vec![field("title", "b"), field("year", "1")]
        );
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(
            result.warnings[0].message,
            "k names 'title' twice; the later one is used."
        );
    }

    #[test]
    fn ignores_non_bib_files() {
        let result = parse_bib_entries(&[bib("main.tex", "@misc{k, title={a}}")]);
        assert!(result.entries.is_empty());
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn constructor_field_warns_like_the_js_in_operator() {
        let result = parse_bib_entries(&[bib("d.bib", "@misc{k, constructor={a}}")]);
        assert_eq!(result.entries[0].fields, vec![field("constructor", "a")]);
        assert_eq!(result.warnings.len(), 1);
    }
}

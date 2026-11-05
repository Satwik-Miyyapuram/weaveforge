//! Vault page text rules (`packages/core/src/features/vault/domain/vault-page.ts`). The
//! markdown image helpers come from [`crate::sync::markdown_image`].
//!
//! Offsets and lengths are UTF-16 code units, as JS counts them. Code masking keeps the
//! input's offsets by replacing each match with spaces of the same UTF-16 length.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use crate::papers::js_regex::compile;
use crate::search::js_text::{is_js_whitespace, utf16_len};
use crate::sync::markdown_image::{
    image_paths_in_body, markdown_image, normalize_markdown_image_syntax,
};

/// Fenced code blocks, lazily to the next fence.
static FENCE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"```[\s\S]*?```").ok());
/// Inline code on one line.
static INLINE_CODE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"`[^`\n]*`").ok());
/// One `[[...]]` on one line; group 1 is the inside.
pub(crate) static WIKILINK_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"\[\[([^\[\]\n]+?)\]\]").ok());
/// Leading `---` frontmatter block, after an optional BOM.
static FRONTMATTER_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(concat!("^\u{FEFF}?", r"---\r?\n([\s\S]*?)\r?\n---\r?\n?")).ok());

pub use crate::sync::markdown_image::VAULT_IMAGE_PREFIX;

/// Max UTF-16 units kept for note-card previews.
pub const VAULT_BODY_PREVIEW_CHARS: usize = 320;

/// One `[[...]]` link read from a note body (`WikilinkRef`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikilinkRef {
    /// Link target, trimmed. Empty for `[[|alias]]`.
    pub target: String,
    /// Text after `|`, when non-empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub alias: Option<String>,
    /// Text after `#`, when it is a heading.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub heading: Option<String>,
    /// Text after `#^`, when it is a block id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub block: Option<String>,
    /// The full matched text, e.g. `[[Note#Heading|alias]]`.
    pub raw: String,
    /// UTF-16 offset of `raw` in the body it was read from. Absent on refs built by hand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub index: Option<f64>,
    /// UTF-16 length of `raw`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub length: Option<f64>,
}

/// Frontmatter split from a note body (`ParsedFrontmatter`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ParsedFrontmatter {
    /// The body after the frontmatter block, or the whole input when there is none.
    pub body: String,
    /// `tags:` values in first-seen order; spaces become `-`.
    pub tags: Vec<String>,
    /// `aliases:` values, whole (multi-word names stay one entry).
    pub aliases: Vec<String>,
}

/// JS `String.prototype.trim`: trims the ECMAScript whitespace set, not Rust's.
#[must_use]
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// Splits on JS whitespace and joins with one space: JS `trim()` plus `replace(/\s+/g, " ")`.
#[must_use]
fn collapse_spaces(s: &str) -> String {
    s.split(is_js_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `Some(owned)` when `s` is non-empty, else `None` (the TS `|| undefined`).
#[must_use]
fn owned_non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_owned())
}

/// Replaces every match of `re` with spaces of the same UTF-16 length.
#[must_use]
fn blank_matches(s: &str, re: &Regex) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for m in re.find_iter(s) {
        out.push_str(s.get(last..m.start()).unwrap_or_default());
        out.push_str(&" ".repeat(utf16_len(m.as_str())));
        last = m.end();
    }
    out.push_str(s.get(last..).unwrap_or_default());
    out
}

/// Blanks fenced and inline code so links inside code are not parsed (`maskCode`).
#[must_use]
fn mask_code(body: &str) -> String {
    let (Some(fence), Some(inline)) = (FENCE_RE.as_ref(), INLINE_CODE_RE.as_ref()) else {
        return body.to_owned();
    };
    blank_matches(&blank_matches(body, fence), inline)
}

/// Units `a..b`, or empty when the range is out of bounds.
#[must_use]
fn units_between(units: &[u16], a: usize, b: usize) -> &[u16] {
    units.get(a..b).unwrap_or_default()
}

/// Reads `Target`, `Target|alias`, `Target#Heading` or `Target#^block`: the inside of one `[[...]]`
/// (`parseWikilinkInner`). Never fails; a link with nothing after `|` has no alias.
#[must_use]
pub fn parse_wikilink_inner(inner: &str, raw: &str) -> WikilinkRef {
    let (link, alias) = match inner.split_once('|') {
        None => (js_trim(inner), None),
        Some((link, alias)) => (js_trim(link), owned_non_empty(js_trim(alias))),
    };
    let mut parsed = WikilinkRef {
        target: link.to_owned(),
        alias,
        heading: None,
        block: None,
        raw: raw.to_owned(),
        index: None,
        length: None,
    };
    if let Some((target, rest)) = link.split_once('#') {
        parsed.target = js_trim(target).to_owned();
        if let Some(block) = rest.strip_prefix('^') {
            parsed.block = owned_non_empty(js_trim(block));
        } else {
            parsed.heading = owned_non_empty(js_trim(rest));
        }
    }
    parsed
}

/// Extracts `[[wikilinks]]` from a note body, skipping code (`extractWikilinks`). `index` and
/// `length` are UTF-16 offsets into `body`.
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    reason = "offsets are far below 2^53, so the f64 is exact"
)]
pub fn extract_wikilinks(body: &str) -> Vec<WikilinkRef> {
    let Some(re) = WIKILINK_RE.as_ref() else {
        return Vec::new();
    };
    let masked = mask_code(body);
    let mut out = Vec::new();
    // Last match's byte and UTF-16 offsets, so each offset counts from the one before it.
    let mut cursor = (0_usize, 0_usize);
    for caps in re.captures_iter(&masked) {
        let (Some(whole), Some(inner)) = (caps.get(0), caps.get(1)) else {
            continue;
        };
        let gap = masked.get(cursor.0..whole.start()).unwrap_or_default();
        let index = cursor.1 + utf16_len(gap);
        cursor = (whole.start(), index);
        let mut link = parse_wikilink_inner(inner.as_str(), whole.as_str());
        link.index = Some(index as f64);
        link.length = Some(utf16_len(whole.as_str()) as f64);
        out.push(link);
    }
    out
}

/// Normalizes a title for case-insensitive wikilink resolution (`normalizeTitleKey`).
#[must_use]
pub fn normalize_title_key(title: &str) -> String {
    collapse_spaces(&title.to_lowercase())
}

/// True if a note body links to `target_key` (already normalized) via `[[wikilink]]` (`bodyLinksTo`).
#[must_use]
pub fn body_links_to(body: &str, target_key: &str) -> bool {
    extract_wikilinks(body)
        .iter()
        .any(|link| normalize_title_key(&link.target) == target_key)
}

/// `frontmatter_key` in `stripFrontmatter`: `tags:` or `aliases:` in any case, then the rest of the line.
/// The tuple is `(is_alias, rest)`.
#[must_use]
fn frontmatter_key(line: &str) -> Option<(bool, &str)> {
    let (is_alias, rest) = match strip_key(line, "tags:") {
        Some(rest) => (false, rest),
        None => (true, strip_key(line, "aliases:")?),
    };
    // JS `.` stops at `\r`, U+2028 and U+2029, so a line holding one is not a key line.
    if rest.contains(['\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some((is_alias, rest))
}

/// `line` minus a leading ASCII-case-insensitive `key`.
#[must_use]
fn strip_key<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let head = line.get(..key.len())?;
    if head.eq_ignore_ascii_case(key) {
        line.get(key.len()..)
    } else {
        None
    }
}

/// The text of a `- item` line, or `None` unless it matches `/^\s*-\s+/`.
#[must_use]
fn list_item(line: &str) -> Option<&str> {
    let after_dash = line
        .trim_start_matches(is_js_whitespace)
        .strip_prefix('-')?;
    after_dash
        .starts_with(is_js_whitespace)
        .then(|| after_dash.trim_start_matches(is_js_whitespace))
}

/// One `tags:`/`aliases:` value, cleaned (`clean` in `stripFrontmatter`).
#[must_use]
fn clean_value(raw: &str) -> String {
    let unprefixed = js_trim(raw).trim_start_matches(['"', '\'', '#']);
    collapse_spaces(js_trim(unprefixed.trim_end_matches(['"', '\''])))
}

/// Adds `value` to `list` unless it is already there (a JS `Set` keeps first-seen order).
fn push_unique(list: &mut Vec<String>, value: String) {
    if !list.contains(&value) {
        list.push(value);
    }
}

/// Splits one value into entries. Tags split on commas and spaces; aliases on commas only. An alias
/// also becomes a tag, hyphenated so it stays one word.
fn collect_values(raw: &str, is_alias: bool, tags: &mut Vec<String>, aliases: &mut Vec<String>) {
    let pieces: Vec<&str> = if is_alias {
        raw.split(',').collect()
    } else {
        raw.split(|c: char| c == ',' || is_js_whitespace(c))
            .collect()
    };
    for piece in pieces {
        let value = clean_value(piece);
        if value.is_empty() {
            continue;
        }
        let tag = value.replace(' ', "-");
        if is_alias {
            push_unique(aliases, value);
        }
        push_unique(tags, tag);
    }
}

/// The `tags` and `aliases` values in a frontmatter block (the inside of `---`).
#[must_use]
fn frontmatter_values(block: &str) -> (Vec<String>, Vec<String>) {
    let mut tags = Vec::new();
    let mut aliases = Vec::new();
    let pieces: Vec<&str> = block.split('\n').collect();
    // `/\r?\n/` drops a `\r` only before a `\n`, and the last piece has none after it.
    let last = pieces.len().saturating_sub(1);
    let mut lines = pieces
        .into_iter()
        .enumerate()
        .map(|(k, line)| {
            if k < last {
                line.strip_suffix('\r').unwrap_or(line)
            } else {
                line
            }
        })
        .peekable();
    while let Some(line) = lines.next() {
        let Some((is_alias, rest)) = frontmatter_key(line) else {
            continue;
        };
        let value = js_trim(rest);
        let value = match value.strip_prefix('[') {
            Some(inner) => inner.strip_suffix(']').unwrap_or(inner),
            None => value,
        };
        if !value.is_empty() {
            collect_values(value, is_alias, &mut tags, &mut aliases);
        }
        while let Some(item) = lines.peek().copied().and_then(list_item) {
            collect_values(item, is_alias, &mut tags, &mut aliases);
            let _ = lines.next();
        }
    }
    (tags, aliases)
}

/// Strips a leading `--- … ---` frontmatter block and reads its `tags`/`aliases` (`stripFrontmatter`).
/// Not a YAML parser: inline `[a, b]`, csv, or a `- item` block.
#[must_use]
pub fn strip_frontmatter(md: &str) -> ParsedFrontmatter {
    let matched = FRONTMATTER_RE
        .as_ref()
        .and_then(|re| re.captures(md))
        .and_then(|caps| Some((caps.get(0)?.end(), caps.get(1)?.as_str())));
    let Some((end, block)) = matched else {
        return ParsedFrontmatter {
            body: md.to_owned(),
            tags: Vec::new(),
            aliases: Vec::new(),
        };
    };
    let (tags, aliases) = frontmatter_values(block);
    ParsedFrontmatter {
        body: md.get(end..).unwrap_or_default().to_owned(),
        tags,
        aliases,
    }
}

/// A title unique (case-insensitive) against `used`, suffixed ` (2)`, ` (3)`, … on collision
/// (`uniqueTitle`). `used` holds normalized keys and is not changed; the caller records the key.
#[must_use]
pub fn unique_title(base: &str, used: &[String]) -> String {
    let trimmed = match js_trim(base) {
        "" => "Untitled",
        t => t,
    };
    let mut title = trimmed.to_owned();
    let mut n = 2;
    while used.contains(&normalize_title_key(&title)) {
        title = format!("{trimmed} ({n})");
        n += 1;
    }
    title
}

/// `![alt](vault:path)` for a vault asset (`vaultImageMarkdown`).
#[must_use]
pub fn vault_image_markdown(path: &str, alt: &str) -> String {
    markdown_image(&format!("{VAULT_IMAGE_PREFIX}{path}"), alt)
}

/// Unique vault asset paths referenced in a markdown body (`vaultAssetPathsInBody`).
#[must_use]
pub fn vault_asset_paths_in_body(body: &str) -> Vec<String> {
    image_paths_in_body(body, VAULT_IMAGE_PREFIX, normalize_markdown_image_syntax)
}

/// Truncates a note body for card excerpts (`vaultBodyPreview`). `max` counts UTF-16 units. A cut
/// that splits a surrogate pair becomes U+FFFD, where JS keeps the lone surrogate.
#[must_use]
pub fn vault_body_preview(body: &str, max: usize) -> String {
    // UTF-16 length never exceeds the UTF-8 byte length, so this skips the encode.
    if body.len() <= max {
        return body.to_owned();
    }
    let units: Vec<u16> = body.encode_utf16().collect();
    if units.len() > max {
        String::from_utf16_lossy(units_between(&units, 0, max))
    } else {
        body.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wikilink_forms_read_alias_heading_and_block() {
        let refs = extract_wikilinks("[[Target]] [[T|al]] [[T#Head]] [[T#^blk]]");
        assert_eq!(refs.len(), 4);
        assert_eq!(refs.first().map(|r| r.target.as_str()), Some("Target"));
        assert_eq!(refs.get(1).and_then(|r| r.alias.as_deref()), Some("al"));
        assert_eq!(refs.get(2).and_then(|r| r.heading.as_deref()), Some("Head"));
        assert_eq!(refs.get(3).and_then(|r| r.block.as_deref()), Some("blk"));
    }

    #[test]
    fn parse_wikilink_inner_drops_empty_parts() {
        let parsed = parse_wikilink_inner("T#^ | ", "[[T#^ | ]]");
        assert_eq!(parsed.target, "T");
        assert_eq!(parsed.alias, None);
        assert_eq!(parsed.block, None);
        assert_eq!(parsed.heading, None);
    }

    #[test]
    fn links_in_fences_and_inline_code_are_ignored() {
        let refs = extract_wikilinks("```\n[[X]]\n```\n`[[Y]]` [[Z]]");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs.first().map(|r| r.target.as_str()), Some("Z"));
    }

    #[test]
    fn index_counts_utf16_units_after_non_ascii() {
        let refs = extract_wikilinks("é [[A]]");
        assert_eq!(refs.first().and_then(|r| r.index), Some(2.0));
        assert_eq!(refs.first().and_then(|r| r.length), Some(5.0));
        assert_eq!(refs.first().map(|r| r.raw.as_str()), Some("[[A]]"));
    }

    #[test]
    fn index_counts_surrogate_pairs_and_masked_code() {
        let emoji = extract_wikilinks("😀[[A|b]]");
        assert_eq!(emoji.first().and_then(|r| r.index), Some(2.0));
        assert_eq!(emoji.first().and_then(|r| r.length), Some(7.0));
        let code = extract_wikilinks("`x` [[A]]");
        assert_eq!(code.first().and_then(|r| r.index), Some(4.0));
    }

    #[test]
    fn frontmatter_inline_list_and_csv() {
        let inline = strip_frontmatter("---\ntags: [a, b]\n---\nBody");
        assert_eq!(inline.body, "Body");
        assert_eq!(inline.tags, vec!["a", "b"]);
        let csv = strip_frontmatter("---\ntags: x, y z\n---\nB");
        assert_eq!(csv.tags, vec!["x", "y", "z"]);
    }

    #[test]
    fn frontmatter_dash_item_block() {
        let parsed = strip_frontmatter("---\ntags:\n  - one\n- two\n---\nB");
        assert_eq!(parsed.tags, vec!["one", "two"]);
        assert_eq!(parsed.body, "B");
    }

    #[test]
    fn aliases_keep_multi_word_names_and_hyphenate_tags() {
        let parsed = strip_frontmatter("---\naliases: New York, NY\n---\n");
        assert_eq!(parsed.aliases, vec!["New York", "NY"]);
        assert_eq!(parsed.tags, vec!["New-York", "NY"]);
    }

    #[test]
    fn frontmatter_after_bom_is_stripped() {
        let parsed = strip_frontmatter("\u{FEFF}---\ntags: [a]\n---\nX");
        assert_eq!(parsed.body, "X");
        assert_eq!(parsed.tags, vec!["a"]);
        let plain = strip_frontmatter("# hi");
        assert_eq!(plain.body, "# hi");
        assert!(plain.tags.is_empty());
    }

    #[test]
    fn unique_title_suffixes_on_collision() {
        assert_eq!(unique_title("Note", &["note".to_owned()]), "Note (2)");
        let used = vec!["note".to_owned(), "note (2)".to_owned()];
        assert_eq!(unique_title("Note", &used), "Note (3)");
        assert_eq!(unique_title("  ", &[]), "Untitled");
        assert_eq!(unique_title(" A ", &[]), "A");
    }

    #[test]
    fn asset_paths_are_unique_vault_refs_only() {
        let body = "![x](vault:u/p/f.png) and ![y](vault:u/p/f.png) ![z](https://e.com/a.png)";
        assert_eq!(vault_asset_paths_in_body(body), vec!["u/p/f.png"]);
    }

    #[test]
    fn vault_image_markdown_prefixes_the_path() {
        assert_eq!(
            vault_image_markdown("a/b.png", "image"),
            "![image](vault:a/b.png)"
        );
    }

    #[test]
    fn body_preview_cuts_at_max_units() {
        assert_eq!(vault_body_preview("abcdef", 3), "abc");
        assert_eq!(vault_body_preview("abc", 320), "abc");
        assert_eq!(vault_body_preview("ééé", 2), "éé");
        assert_eq!(vault_body_preview("", 3), "");
    }

    #[test]
    fn title_key_and_body_links() {
        assert_eq!(normalize_title_key("  Foo   BAR "), "foo bar");
        assert!(body_links_to("see [[ Foo |x]]", "foo"));
        assert!(!body_links_to("see [[Bar]]", "foo"));
    }
}

//! Port of `packages/core/src/shared/markdown-image.ts` (minus the async
//! `materializeBlobImages`), plus `normalizeMarkdownImageSyntax` and
//! `VAULT_IMAGE_PREFIX` from `packages/core/src/features/vault/domain/vault-page.ts`.
//!
//! No regex crate: every TS regex is hand-scanned. Each scanner lists the regex it mirrors.

use std::collections::HashSet;

use crate::search::js_text::is_js_whitespace;

/// Prefix embedded vault images use in markdown: `![](vault:userId/pageId/file.png)`.
pub const VAULT_IMAGE_PREFIX: &str = "vault:";

/// One matched `![alt](head rest)` ref handed to the replacer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageRef<'a> {
    /// The alt text as written, before any unescaping.
    pub alt: &'a str,
    /// The head that matched at the start of the target.
    pub head: &'a str,
    /// The target after `head`; never empty.
    pub rest: &'a str,
    /// The whole `![alt](target)`.
    pub text: &'a str,
}

/// Makes a string safe to sit inside `[…]`.
///
/// Mirrors `/[\r\n]+/g` and `/\s+/g` (collapsed to one space, then `.trim()`),
/// then `/\\/g`, `/\[/g`, `/\]/g` escaped in that order. Empty becomes "image".
#[must_use]
pub fn escape_markdown_alt_text(alt: &str) -> String {
    let collapsed = join_words(alt, is_js_whitespace);
    if collapsed.is_empty() {
        return "image".to_owned();
    }
    collapsed
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

/// `![alt](target)`, with the alt text escaped. The TS default alt is "image"; callers pass it.
#[must_use]
pub fn markdown_image(target: &str, alt: &str) -> String {
    format!("![{}]({target})", escape_markdown_alt_text(alt))
}

/// A readable alt text from a file name.
///
/// Mirrors `name.replace(/\.[A-Za-z0-9]{1,8}$/, "")` (see `strip_extension`), then
/// `/[_-]+/g` and `/\s+/g` to single spaces with `.trim()`. Missing, empty or
/// `/^image$/i` results become "image".
#[must_use]
pub fn image_alt_from_filename(name: Option<&str>) -> String {
    let Some(name) = name.filter(|n| !n.is_empty()) else {
        return "image".to_owned();
    };
    let words = join_words(strip_extension(name), |c| {
        c == '_' || c == '-' || is_js_whitespace(c)
    });
    if words.is_empty() || words.eq_ignore_ascii_case("image") {
        "image".to_owned()
    } else {
        words
    }
}

/// File extension for a blob's MIME type, defaulting to png.
#[must_use]
pub fn image_extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpeg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/svg+xml" => "svg",
        "image/avif" => "avif",
        _ => "png",
    }
}

/// Unique targets of `prefix` refs in the body, in first-seen order.
///
/// `prefix` is literal, so the TS regex escape is not needed. `normalize` is the
/// caller's `normalizeMarkdownImageSyntax`-style pass, run first.
#[must_use]
pub fn image_paths_in_body(
    body: &str,
    prefix: &str,
    normalize: impl Fn(&str) -> String,
) -> Vec<String> {
    let normalized = normalize(body);
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    let _ = replace_image_refs(
        &normalized,
        &[prefix],
        |r| {
            let rest = r.rest.to_owned();
            if seen.insert(rest.clone()) {
                paths.push(rest);
            }
            None
        },
        false,
    );
    paths
}

/// Replaces `![alt](HEAD rest)` refs, where HEAD is one of `heads`.
///
/// Mirrors `replaceImageRefs`, whose regex is
/// `/!\[([^\]]*)\]\((HEAD)([^)\s]+)\)/g` (`[^)]+` when `allow_space`); `heads`
/// stands in for the `HEAD` alternation, tried in order as a regex would.
/// `replacer` returns `None` to keep the ref as written. Linear: a target run
/// is scanned once and shared by every "![" that reaches it.
#[must_use]
pub fn replace_image_refs(
    body: &str,
    heads: &[&str],
    replacer: impl FnMut(ImageRef<'_>) -> Option<String>,
    allow_space: bool,
) -> String {
    let head_len = |tail: &str| {
        heads
            .iter()
            .find(|h| tail.starts_with(**h))
            .map(|h| h.len())
    };
    replace_image_refs_by(body, head_len, replacer, allow_space)
}

/// Like [`replace_image_refs`], for a `HEAD` that is not a literal list.
///
/// `head_len` gets the text from the target's start to the end of the body and
/// returns the length of the `HEAD` match there, or `None` when `HEAD` does not
/// match, in which case the ref is not a match at all (as with the TS regex).
#[must_use]
pub fn replace_image_refs_by(
    body: &str,
    head_len: impl Fn(&str) -> Option<usize>,
    mut replacer: impl FnMut(ImageRef<'_>) -> Option<String>,
    allow_space: bool,
) -> String {
    let bytes = body.as_bytes();
    let mut run = None;
    let mut out = String::new();
    let mut copied = 0;
    let mut from = 0;
    while let Some(start) = find_from(body, "![", from) {
        let Some(close) = find_from(body, "]", start + 2) else {
            break;
        };
        // Every "![" before `close` shares this "]" and what follows, so one try covers them all.
        from = close + 1;
        if bytes.get(close + 1) != Some(&b'(') {
            continue;
        }
        let s = close + 2;
        let end = target_end(body, s, allow_space, &mut run);
        if bytes.get(end) != Some(&b')') {
            continue;
        }
        let Some(rest_start) = body.get(s..).and_then(&head_len).map(|len| s + len) else {
            continue;
        };
        let head = slice(body, s, rest_start);
        if rest_start >= end {
            continue;
        }
        let replaced = replacer(ImageRef {
            alt: slice(body, start + 2, close),
            head,
            rest: slice(body, rest_start, end),
            text: slice(body, start, end + 1),
        });
        from = end + 1;
        if let Some(replaced) = replaced {
            out.push_str(slice(body, copied, start));
            out.push_str(&replaced);
            copied = from;
        }
    }
    out.push_str(slice(body, copied, body.len()));
    out
}

/// Collapses whitespace inside image syntax so wrapped refs still match.
///
/// Mirrors `normalizeMarkdownImageSyntax` in `vault-page.ts`. Regexes it mirrors:
/// `\s` (`is_js_whitespace`) around `](` and `(`/`)`; the head is
/// `/^(?:blob:|vault:|paperimg:|reportimg:|https?:\/\/)/` (`url_head_len`); the
/// path is `[^)\s]+` (`scan_path`).
#[must_use]
pub fn normalize_markdown_image_syntax(body: &str) -> String {
    let mut out = String::new();
    let mut copied = 0;
    let mut from = 0;
    while let Some(start) = find_from(body, "![", from) {
        let Some(close) = find_from(body, "]", start + 2) else {
            break;
        };
        // Every "![" before `close` shares this "]" and what follows, so one try covers them all.
        from = close + 1;
        let mut i = skip_space(body, close + 1);
        if byte_at(body, i) != Some(b'(') {
            continue;
        }
        i = skip_space(body, i + 1);
        let Some(head_len) = url_head_len(body, i) else {
            continue;
        };
        let url_start = i;
        let path_start = i + head_len;
        i = scan_path(body, path_start);
        if i == path_start {
            continue;
        }
        let url_end = i;
        i = skip_space(body, i);
        from = from.max(i);
        if byte_at(body, i) != Some(b')') {
            continue;
        }
        out.push_str(slice(body, copied, start));
        out.push_str("![");
        out.push_str(slice(body, start + 2, close));
        out.push_str("](");
        out.push_str(slice(body, url_start, url_end));
        out.push(')');
        copied = i + 1;
        from = copied;
    }
    out.push_str(slice(body, copied, body.len()));
    out
}

/// Joins the non-empty words split on `is_sep` with single spaces.
fn join_words(s: &str, is_sep: impl Fn(char) -> bool) -> String {
    s.split(is_sep)
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Removes `/\.[A-Za-z0-9]{1,8}$/`. Only the last `.` can start that match.
fn strip_extension(name: &str) -> &str {
    let Some(dot) = name.rfind('.') else {
        return name;
    };
    let ext = slice(name, dot + 1, name.len());
    let valid = (1..=8).contains(&ext.len()) && ext.bytes().all(|b| b.is_ascii_alphanumeric());
    if valid { slice(name, 0, dot) } else { name }
}

/// First `)`, or whitespace unless `allow_space`, at or after `s`; the end if none.
/// Reuses `run` when `s` falls inside the last scanned run of target characters.
fn target_end(body: &str, s: usize, allow_space: bool, run: &mut Option<(usize, usize)>) -> usize {
    let cached = run.filter(|&(from, end)| from <= s && s <= end);
    if let Some((_, end)) = cached {
        return end;
    }
    let end = body
        .get(s..)
        .and_then(|t| {
            t.char_indices()
                .find(|&(_, ch)| ch == ')' || (!allow_space && is_js_whitespace(ch)))
        })
        .map_or(body.len(), |(off, _)| s + off);
    *run = Some((s, end));
    end
}

/// Length of the URL head at `i`, for `/^(?:blob:|vault:|paperimg:|reportimg:|https?:\/\/)/`.
fn url_head_len(body: &str, i: usize) -> Option<usize> {
    const HEADS: [&str; 6] = [
        "blob:",
        "vault:",
        "paperimg:",
        "reportimg:",
        "https://",
        "http://",
    ];
    let tail = body.get(i..)?;
    HEADS
        .iter()
        .copied()
        .find(|h| tail.starts_with(*h))
        .map(str::len)
}

/// Skips `\s` characters from `i`; returns the first index after them.
fn skip_space(body: &str, mut i: usize) -> usize {
    while let Some(ch) = char_at(body, i).filter(|&c| is_js_whitespace(c)) {
        i += ch.len_utf8();
    }
    i
}

/// Scans `[^)\s]*` from `i`; returns the index where the path stops.
fn scan_path(body: &str, mut i: usize) -> usize {
    while let Some(ch) = char_at(body, i).filter(|&c| c != ')' && !is_js_whitespace(c)) {
        i += ch.len_utf8();
    }
    i
}

/// The character starting at byte `i`, if `i` is a char boundary inside `body`.
fn char_at(body: &str, i: usize) -> Option<char> {
    body.get(i..).and_then(|t| t.chars().next())
}

/// The byte at `i`, if any.
fn byte_at(body: &str, i: usize) -> Option<u8> {
    body.as_bytes().get(i).copied()
}

/// Byte index of the first `pat` at or after `from`.
fn find_from(body: &str, pat: &str, from: usize) -> Option<usize> {
    body.get(from..)?.find(pat).map(|i| i + from)
}

/// `body[from..to]`, or empty when the range is not valid.
fn slice(body: &str, from: usize, to: usize) -> &str {
    body.get(from..to).unwrap_or("")
}

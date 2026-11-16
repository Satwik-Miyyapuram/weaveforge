//! URL detection inside free text. Port of the TypeScript deleted in P1.8b, `urlParts` in
//! `packages/core/src/search/search-tokenizer.ts`.

use crate::search::js_text::{is_js_whitespace, is_letter_or_number, utf16_len};
use crate::search::tokenizer::MIN_TOKEN_UTF16_LEN;

/// TLDs that mark a bare domain such as `arxiv.org`.
pub const URL_TLDS: [&str; 8] = ["com", "org", "net", "edu", "io", "ai", "dev", "gov"];

/// `https://arxiv.org/abs/2305.12345` → https, arxiv, org, abs, 2305, 12345.
#[must_use]
pub fn url_parts(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    for run in text.split(is_js_whitespace).filter(|run| !run.is_empty()) {
        if !run.contains(['.', ':']) {
            continue;
        }
        if let Some(url) = find_url(run) {
            push_url_pieces(url, &mut parts);
        }
    }
    debug_assert!(parts.iter().all(|part| !part.is_empty()));
    debug_assert!(
        parts
            .iter()
            .all(|part| utf16_len(part) >= MIN_TOKEN_UTF16_LEN)
    );
    parts
}

/// The URL inside a whitespace-free run: the whole run for a bare domain, else
/// the suffix from the leftmost `http://` or `https://`.
fn find_url(run: &str) -> Option<&str> {
    debug_assert!(!run.is_empty());
    debug_assert!(URL_TLDS.iter().all(|tld| tld.is_ascii()));
    if has_domain(run) {
        return Some(run);
    }
    run.char_indices()
        .map(|(i, _)| i)
        .find(|&i| run.get(i..).is_some_and(scheme_with_body))
        .and_then(|start| run.get(start..))
}

/// True if some `.` after the first char is followed by a TLD and a non-word boundary.
fn has_domain(run: &str) -> bool {
    debug_assert!(!URL_TLDS.is_empty());
    debug_assert!(run.contains(['.', ':']));
    run.char_indices()
        .any(|(i, ch)| ch == '.' && i > 0 && run.get(i + 1..).is_some_and(tld_follows))
}

/// True if `rest` starts with a TLD (ASCII case-insensitive) ending at a non-word char.
fn tld_follows(rest: &str) -> bool {
    debug_assert!(!URL_TLDS.is_empty());
    debug_assert!(URL_TLDS.iter().all(|tld| tld.len() <= 4));
    URL_TLDS.iter().any(|tld| {
        rest.get(..tld.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(tld))
            && rest.get(tld.len()..).is_some_and(|after| {
                after
                    .chars()
                    .next()
                    .is_none_or(|ch| !(ch.is_ascii_alphanumeric() || ch == '_'))
            })
    })
}

/// True if `rest` starts with `http://` or `https://` followed by at least one char.
fn scheme_with_body(rest: &str) -> bool {
    debug_assert!("http://".len() < "https://".len());
    let prefix_len = if has_ascii_prefix(rest, "http://") {
        "http://".len()
    } else if has_ascii_prefix(rest, "https://") {
        "https://".len()
    } else {
        return false;
    };
    debug_assert!(prefix_len <= rest.len());
    rest.get(prefix_len..).is_some_and(|body| !body.is_empty())
}

/// ASCII case-insensitive `str::starts_with`, without panicking on char boundaries.
fn has_ascii_prefix(text: &str, prefix: &str) -> bool {
    debug_assert!(prefix.is_ascii());
    let matched = text
        .get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix));
    debug_assert!(!matched || text.len() >= prefix.len());
    matched
}

/// Appends the lowercased pieces of `url` that are at least `MIN_TOKEN_UTF16_LEN` long.
fn push_url_pieces(url: &str, parts: &mut Vec<String>) {
    debug_assert!(!url.is_empty());
    let before = parts.len();
    for piece in url.split(|ch: char| !is_letter_or_number(ch)) {
        if !piece.is_empty() && utf16_len(piece) >= MIN_TOKEN_UTF16_LEN {
            parts.push(piece.to_lowercase());
        }
    }
    debug_assert!(parts.len() >= before);
}

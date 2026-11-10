//! Markdown link helpers for pasted URLs: the TS `BARE_URL` test, the link label
//! escaping, and `[label](url)` building (`apps/web/src/components/markdown`).
//!
//! Pure string in, string out. Whitespace follows JavaScript (`\S`, `trim`), so
//! the checks use [`crate::search::js_text::is_js_whitespace`].

use crate::search::js_text::is_js_whitespace;

/// Whether `text` is one http(s) address and nothing else (TS `BARE_URL`,
/// `/^https?:\/\/\S+$/`): the scheme, then at least one non-whitespace character.
#[must_use]
pub fn is_bare_url(text: &str) -> bool {
    let rest = text
        .strip_prefix("https://")
        .or_else(|| text.strip_prefix("http://"));
    match rest {
        Some(rest) => !rest.is_empty() && !rest.chars().any(is_js_whitespace),
        None => false,
    }
}

/// Escapes the characters that would end a Markdown link label early: `\`, `[`
/// and `]` each get a backslash in front (TS `escapeLinkLabel`).
#[must_use]
pub fn escape_link_label(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    for ch in label.chars() {
        if matches!(ch, '\\' | '[' | ']') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// `[label](url)`, with the label folded onto one line, escaped and trimmed
/// (TS `markdownLink`). Each run of CR/LF becomes one space before escaping.
#[must_use]
pub fn markdown_link(label: &str, url: &str) -> String {
    let folded = fold_line_breaks(label);
    format!("[{}]({url})", js_trim(&escape_link_label(&folded)))
}

/// The label for a selection being turned into a link, or `None` when the
/// selection cannot be a label: empty, or spanning lines (TS `linkLabel`).
#[must_use]
pub fn link_label(selected: &str) -> Option<String> {
    if selected.is_empty() || selected.contains(['\r', '\n']) {
        return None;
    }
    Some(escape_link_label(selected))
}

/// Replaces each run of CR/LF with a single space (`/[\r\n]+/g` to `" "`).
fn fold_line_breaks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_break = false;
    for ch in text.chars() {
        if ch == '\r' || ch == '\n' {
            if !in_break {
                out.push(' ');
            }
            in_break = true;
        } else {
            out.push(ch);
            in_break = false;
        }
    }
    out
}

/// JavaScript `String.prototype.trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

#[cfg(test)]
mod tests {
    use super::{escape_link_label, is_bare_url, link_label, markdown_link};

    #[test]
    fn bare_url_takes_one_http_or_https_address() {
        assert!(is_bare_url("https://example.org/a?b=c"));
        assert!(is_bare_url("http://x"));
        // A scheme with nothing after it is not an address.
        assert!(!is_bare_url("https://"));
        assert!(!is_bare_url("http://"));
        // Whitespace anywhere, including at the end, rules it out (no `m` flag).
        assert!(!is_bare_url("https://a b"));
        assert!(!is_bare_url("https://a\n"));
        assert!(!is_bare_url(" https://a"));
        assert!(!is_bare_url("https://a\u{00a0}b"));
        // Other schemes and surrounding text are not bare URLs.
        assert!(!is_bare_url("ftp://a"));
        assert!(!is_bare_url("see https://a"));
        assert!(!is_bare_url("HTTPS://a"));
        assert!(!is_bare_url(""));
    }

    #[test]
    fn escape_backslash_then_brackets() {
        assert_eq!(escape_link_label("a[b]c"), "a\\[b\\]c");
        assert_eq!(escape_link_label("a\\b"), "a\\\\b");
        // A backslash already before a bracket is doubled, then the bracket escaped.
        assert_eq!(escape_link_label("\\["), "\\\\\\[");
        assert_eq!(escape_link_label("plain"), "plain");
    }

    #[test]
    fn markdown_link_folds_lines_escapes_and_trims() {
        assert_eq!(
            markdown_link("Title [1]", "https://a.org"),
            "[Title \\[1\\]](https://a.org)"
        );
        // Runs of CR/LF become one space; a run of two still gives one space.
        assert_eq!(markdown_link("a\r\n\nb", "u"), "[a b](u)");
        // Trim runs after folding, so edge breaks leave no spaces.
        assert_eq!(markdown_link("\n a \r", "u"), "[a](u)");
        // Trim is JavaScript's: NBSP and BOM go, as well as ASCII spaces.
        assert_eq!(markdown_link("\u{00a0}x\u{feff}", "u"), "[x](u)");
        assert_eq!(markdown_link("", "u"), "[](u)");
        // The URL is inserted as given.
        assert_eq!(markdown_link("t", "a)b"), "[t](a)b)");
    }

    #[test]
    fn link_label_refuses_empty_and_multiline() {
        assert_eq!(link_label(""), None);
        assert_eq!(link_label("a\nb"), None);
        assert_eq!(link_label("a\rb"), None);
        assert_eq!(link_label("a [b]").as_deref(), Some("a \\[b\\]"));
        // Spaces alone are a valid single-line label, unlike the empty string.
        assert_eq!(link_label("  ").as_deref(), Some("  "));
    }
}

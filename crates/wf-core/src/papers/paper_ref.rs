//! Reference parsing: decides what a pasted paper reference really is.
//! Port of `packages/core/src/features/papers/application/parse-paper-ref.ts`.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

/// Arxiv id core: modern `2305.12345` or legacy `cs.LG/0501001`. Digits are ASCII, as in JS.
const ARXIV_CORE: &str = r"[a-z-]+(?:\.[A-Z]{2})?/[0-9]{7}|[0-9]{4}\.[0-9]{4,5}";

static DOI_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#"10\.[0-9]{4,9}/[^\s"'<>]+"#).ok());

static ARXIV_URL_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?i)arxiv\.org/(?:abs|pdf)/({ARXIV_CORE})(v[0-9]+)?(?:\.pdf)?"
    ))
    .ok()
});

static ARXIV_PREFIXED_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?i)(?-u:\b)arxiv(?:\s*:\s*|\s+)({ARXIV_CORE})(v[0-9]+)?"
    ))
    .ok()
});

static ARXIV_BARE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(r"(?i)^({ARXIV_CORE})(v[0-9]+)?$")).ok()
});

/// Scheme-less URL: dotted host with an alphabetic TLD, optional path, no whitespace.
static HOSTLIKE_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(/\S*)?$").ok());

/// The kind of paper reference a caller declares for a pasted value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PaperRefKind {
    /// A Digital Object Identifier.
    Doi,
    /// An arXiv id.
    Arxiv,
    /// A web page URL.
    Url,
    /// An opaque Zotero item key.
    Zotero,
}

/// A paper reference: what it is and the value that identifies it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PaperRef {
    /// Which source can answer for this reference.
    pub kind: PaperRefKind,
    /// The normalized identifier or URL.
    pub value: String,
}

/// Extract an arXiv id from a URL, an `arXiv:` prefixed string, or a bare id.
/// The version suffix is dropped so `v1` and `v2` dedupe to the same paper.
#[must_use]
pub fn normalize_arxiv_id(value: &str) -> Option<String> {
    let text = js_trim(value);
    if text.is_empty() {
        return None;
    }
    group(&ARXIV_URL_RE, text, 1)
        .or_else(|| group(&ARXIV_PREFIXED_RE, text, 1))
        .or_else(|| group(&ARXIV_BARE_RE, text, 1))
        .map(str::to_owned)
}

/// Extract a DOI from a URL, a `doi:` prefixed string, or a bare DOI.
/// Percent escapes are decoded first; trailing punctuation is trimmed; result is lowercased.
#[must_use]
pub fn extract_doi(value: &str) -> Option<String> {
    let text = js_trim(value);
    if text.is_empty() {
        return None;
    }
    let decoded = decode_uri_component(text);
    let text = decoded.as_deref().unwrap_or(text);
    group(&DOI_RE, text, 0).map(|m| trim_trailing_punctuation(m).to_lowercase())
}

/// Decide what a pasted reference really is. arXiv wins over DOI when both are present.
#[must_use]
pub fn parse_paper_ref(kind: PaperRefKind, value: &str) -> PaperRef {
    let text = js_trim(value);
    if kind == PaperRefKind::Zotero {
        return PaperRef {
            kind,
            value: text.to_owned(),
        };
    }
    if let Some(id) = normalize_arxiv_id(text) {
        return PaperRef {
            kind: PaperRefKind::Arxiv,
            value: id,
        };
    }
    if let Some(doi) = extract_doi(text) {
        return PaperRef {
            kind: PaperRefKind::Doi,
            value: doi,
        };
    }
    if has_http_scheme(text) {
        return PaperRef {
            kind: PaperRefKind::Url,
            value: text.to_owned(),
        };
    }
    // Scheme-less URLs are assumed https; guessing http would downgrade every https site.
    if matches_in(&HOSTLIKE_RE, text) {
        return PaperRef {
            kind: PaperRefKind::Url,
            value: format!("https://{text}"),
        };
    }
    PaperRef {
        kind,
        value: text.to_owned(),
    }
}

/// JS `String.prototype.trim` also strips the byte-order mark.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// Capture group `index` of the first match, or `None` when there is no match.
fn group<'t>(re: &LazyLock<Option<Regex>>, text: &'t str, index: usize) -> Option<&'t str> {
    let compiled: &Option<Regex> = re;
    compiled
        .as_ref()?
        .captures(text)?
        .get(index)
        .map(|m| m.as_str())
}

fn matches_in(re: &LazyLock<Option<Regex>>, text: &str) -> bool {
    let compiled: &Option<Regex> = re;
    compiled.as_ref().is_some_and(|r| r.is_match(text))
}

fn has_http_scheme(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Drop trailing `).,;`. A loop, not a regex: `[).,;]+$` is quadratic on long runs.
fn trim_trailing_punctuation(text: &str) -> &str {
    text.trim_end_matches([')', '.', ',', ';'])
}

/// Percent-decode like JS `decodeURIComponent`. `None` on a bad escape or invalid UTF-8.
fn decode_uri_component(text: &str) -> Option<String> {
    let mut out = Vec::with_capacity(text.len());
    let mut bytes = text.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hi = hex_value(bytes.next()?)?;
            let lo = hex_value(bytes.next()?)?;
            out.push((hi << 4) | lo);
        } else {
            out.push(b);
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

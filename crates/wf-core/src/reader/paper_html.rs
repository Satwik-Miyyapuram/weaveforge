//! A paper kept as a web page: how the stored file is framed for reading, and how it is read back.
//! Port of `isSubstantialPaperText`, `buildPaperHtmlDocument` and `parsePaperHtmlDocument` in
//! `apps/web/src/features/reader/application/paper-html.ts`. Pure: no DOM.
//!
//! The minimum-length constants stay in TS, since callers import them as plain values.

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use super::text_units::{as_f64, collapse_whitespace};
use crate::search::js_text::utf16_len;

/// A paper's own page, as stored and framed (TS `PaperHtmlPage`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperHtmlPage {
    /// The paper this page belongs to.
    pub paper_id: String,
    /// The address the page was fetched from, after redirects.
    pub url: String,
    /// The page title.
    pub title: String,
    /// The sanitised article markup: no scripts, forms, frames or handlers.
    pub html: String,
    /// ISO time it was fetched.
    pub saved_at: String,
}

/// How the framed document is dressed (TS `options` of `buildPaperHtmlDocument`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperHtmlOptions {
    /// Pins the frame to `light` or `dark`; absent follows the system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub scheme: Option<String>,
    /// Adds the print layout (Save as PDF).
    #[serde(default)]
    pub print: bool,
}

/// True when the text carries at least `min_chars` UTF-16 units once whitespace is collapsed.
#[must_use]
pub fn is_substantial_paper_text(text: &str, min_chars: f64) -> bool {
    as_f64(utf16_len(&collapse_whitespace(text))) >= min_chars
}

/// The frame's own policy, on top of the page's. Matches the TS `PAPER_HTML_CSP`.
const PAPER_HTML_CSP: &str =
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; media-src https:";

/// Readable defaults that follow the app's light or dark scheme.
const READER_CSS: &str = r#"
:root { color-scheme: light dark; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: 24px 20px 64px; font: 16px/1.6 Georgia, "Times New Roman", serif; color: CanvasText; background: Canvas; }
.wf-paper { max-width: 46rem; margin: 0 auto; overflow-wrap: anywhere; }
.wf-source { max-width: 46rem; margin: 0 auto 16px; font: 12px/1.4 system-ui, sans-serif; opacity: .7; }
h1, h2, h3, h4 { line-height: 1.25; font-family: system-ui, sans-serif; }
img, svg, video { max-width: 100%; height: auto; }
figure { margin: 1.5em 0; }
figcaption { font-size: .9em; opacity: .85; }
table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; font-size: .9em; }
td, th { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 4px 8px; }
pre, code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
pre { overflow-x: auto; }
math { font-size: 1.05em; }
a { color: LinkText; }
@media (max-width: 600px) { body { padding: 16px 16px 48px; font-size: 15px; } }
"#;

/// Paper layout for Save as PDF: page margins, no screen padding, ink-coloured links.
const PRINT_CSS: &str = r#"
@page { margin: 18mm 16mm; }
body { padding: 0; font-size: 11pt; }
.wf-paper, .wf-source { max-width: none; }
a { color: inherit; }
img, figure, table, pre { break-inside: avoid; }
h1, h2, h3, h4 { break-after: avoid; }
"#;

const ARTICLE_OPEN: &str = r#"<article class="wf-paper">"#;
const ARTICLE_CLOSE: &str = "</article><!--/wf-paper-->";

/// Escapes for a double-quoted attribute value.
fn escape_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Escapes for element text.
fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Reverses [`escape_attr`], in the same order the TS code uses.
fn unescape_attr(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// The host name of a URL, as `new URL(url).hostname` gives it for the usual cases. A string
/// that does not parse as a URL is returned whole, as the TS fallback does.
fn host_of(url: &str) -> String {
    let Some(colon) = scheme_end(url) else {
        return url.to_owned();
    };
    let rest = &url[colon + 1..];
    let Some(after) = rest.strip_prefix("//") else {
        return String::new();
    };
    let authority_end = after.find(['/', '?', '#', '\\']).unwrap_or(after.len());
    let authority = &after[..authority_end];
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = if host_port.starts_with('[') {
        host_port
            .find(']')
            .map_or(host_port, |end| &host_port[..=end])
    } else {
        host_port.split(':').next().unwrap_or("")
    };
    let scheme = url[..colon].to_ascii_lowercase();
    let special = matches!(scheme.as_str(), "http" | "https" | "ws" | "wss" | "ftp");
    if host.is_empty() && special {
        return url.to_owned();
    }
    host.to_ascii_lowercase()
}

/// Byte index of the `:` that ends a URL scheme, when the text starts with a scheme.
fn scheme_end(url: &str) -> Option<usize> {
    let colon = url.find(':')?;
    let scheme = &url[..colon];
    let mut chars = scheme.chars();
    let starts_alpha = chars.next()?.is_ascii_alphabetic();
    let valid = scheme
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'));
    (starts_alpha && valid).then_some(colon)
}

/// The document the frame is given, which is also the file kept in the folder: it opens on its
/// own in any browser, already sanitised, with where it came from written into it.
#[must_use]
pub fn build_paper_html_document(page: &PaperHtmlPage, options: &PaperHtmlOptions) -> String {
    let host = host_of(&page.url);
    let scheme_css = options
        .scheme
        .as_deref()
        .map(|scheme| format!(":root {{ color-scheme: {scheme}; }}"))
        .unwrap_or_default();
    let print_css = if options.print { PRINT_CSS } else { "" };
    [
        "<!doctype html>".to_owned(),
        r#"<html><head><meta charset="utf-8">"#.to_owned(),
        format!(r#"<meta http-equiv="Content-Security-Policy" content="{PAPER_HTML_CSP}">"#),
        r#"<meta name="viewport" content="width=device-width, initial-scale=1">"#.to_owned(),
        r#"<meta name="referrer" content="no-referrer">"#.to_owned(),
        format!(
            r#"<meta name="weaveforge-source" content="{}">"#,
            escape_attr(&page.url)
        ),
        format!(
            r#"<meta name="weaveforge-saved" content="{}">"#,
            escape_attr(&page.saved_at)
        ),
        format!("<title>{}</title>", escape_text(&page.title)),
        format!("<style>{READER_CSS}{scheme_css}{print_css}</style>"),
        "</head><body>".to_owned(),
        format!(
            r#"<p class="wf-source">Full text from <a href="{}" target="_blank" rel="noopener noreferrer">{}</a></p>"#,
            escape_attr(&page.url),
            escape_text(&host)
        ),
        ARTICLE_OPEN.to_owned(),
        page.html.clone(),
        ARTICLE_CLOSE.to_owned(),
        "</body></html>".to_owned(),
    ]
    .join("\n")
}

/// Reads a kept file back. `None` for anything this app did not write: a file the person dropped
/// into the folder by hand is not trusted as sanitised.
#[must_use]
pub fn parse_paper_html_document(paper_id: &str, text: &str) -> Option<PaperHtmlPage> {
    let start = text.find(ARTICLE_OPEN)?;
    let end = text.rfind(ARTICLE_CLOSE)?;
    if end < start {
        return None;
    }
    let url = first_capture(r#"<meta name="weaveforge-source" content="([^"]*)">"#, text)?;
    if url.is_empty() {
        return None;
    }
    let saved_at = first_capture(r#"<meta name="weaveforge-saved" content="([^"]*)">"#, text)
        .unwrap_or_default();
    let title = first_capture(r"(?s)<title>(.*?)</title>", text).unwrap_or_default();
    let body = text.get(start + ARTICLE_OPEN.len()..end).unwrap_or("");
    let body = body.strip_prefix('\n').unwrap_or(body);
    let body = body.strip_suffix('\n').unwrap_or(body);
    Some(PaperHtmlPage {
        paper_id: paper_id.to_owned(),
        url: unescape_attr(&url),
        saved_at: unescape_attr(&saved_at),
        title: unescape_attr(&title),
        html: body.to_owned(),
    })
}

/// The first capture group of `pattern` in `text`, when it matches.
fn first_capture(pattern: &str, text: &str) -> Option<String> {
    let regex = Regex::new(pattern).ok()?;
    regex
        .captures(text)
        .and_then(|captures| captures.get(1))
        .map(|found| found.as_str().to_owned())
}

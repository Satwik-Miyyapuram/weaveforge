//! Reader URL allowlists. Port of the pure parts of
//! `apps/web/src/features/reader/application/sanitize-reader-url.ts`: the PDF proxy host list,
//! https-only PDF URLs, same-origin reader and app hrefs, PDF-looking paths, and paper PDF
//! resolution, the blob-object origin check, and the PDF proxy route. The caller reads `location`
//! and the relay base and passes them in.

use std::sync::OnceLock;

use regex_lite::Regex;
use serde::Deserialize;
use url::Url;

/// Hosts the same-origin PDF proxy will fetch. Shared by the web route and the desktop shell.
///
/// Hosts that serve a PDF **without credentials**. The proxy fetches anonymously, so a paywalled
/// host listed here would still 403 (`journals.sagepub.com`, `pdf.sciencedirectassets.com`).
/// Preprint servers, open-access publishers, and the open-access hosts of a publisher
/// (`link.springer.com`, `springeropen.com`) are listed.
///
/// Big publishers are deliberately absent: `www.nature.com` and `onlinelibrary.wiley.com` are
/// mostly paywalled. A host is a domain, compared exactly, so `evil-arxiv.org` cannot pass and a
/// lookalike subdomain must be named here to be reachable.
const PDF_PROXY_ALLOWED_HOSTS: &[&str] = &[
    // Preprints and repositories.
    "arxiv.org",
    "www.arxiv.org",
    "export.arxiv.org",
    "openreview.net",
    "www.openreview.net",
    "biorxiv.org",
    "www.biorxiv.org",
    "medrxiv.org",
    "www.medrxiv.org",
    "chemrxiv.org",
    "www.chemrxiv.org",
    "ncbi.nlm.nih.gov",
    "www.ncbi.nlm.nih.gov",
    "pmc.ncbi.nlm.nih.gov",
    "europepmc.org",
    "www.europepmc.org",
    "hal.science",
    "hal.archives-ouvertes.fr",
    "zenodo.org",
    // Open-access publishers.
    "journals.plos.org",
    "plos.org",
    "www.plos.org",
    "elifesciences.org",
    "www.elifesciences.org",
    "frontiersin.org",
    "www.frontiersin.org",
    "mdpi.com",
    "www.mdpi.com",
    "copernicus.org",
    "www.copernicus.org",
    "olh.openlibhums.org",
    "openlibhums.org",
    "springeropen.com",
    "www.springeropen.com",
    "link.springer.com",
];

/// JS `\s` and `String.prototype.trim`: Unicode White_Space without U+0085, plus the BOM.
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

fn js_trim(raw: &str) -> &str {
    raw.trim_matches(is_js_space)
}

/// The trimmed value, or `None` when absent or blank (the TS `if (!raw) return null`).
fn non_empty_trimmed(raw: Option<&str>) -> Option<&str> {
    let trimmed = js_trim(raw?);
    (!trimmed.is_empty()).then_some(trimmed)
}

fn has_space_or_backslash(value: &str) -> bool {
    value.chars().any(|c| is_js_space(c) || c == '\\')
}

fn has_credentials(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some_and(|password| !password.is_empty())
}

/// True when `raw` is an https URL on [`PDF_PROXY_ALLOWED_HOSTS`] with no credentials.
#[must_use]
pub fn is_allowed_pdf_proxy_url(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" || has_credentials(&url) {
        return false;
    }
    url.host_str()
        .is_some_and(|host| PDF_PROXY_ALLOWED_HOSTS.contains(&host.to_ascii_lowercase().as_str()))
}

/// Accept only https PDF URLs for pdf.js and "open original" links.
#[must_use]
pub fn sanitize_pdf_url(raw: Option<&str>) -> Option<String> {
    let trimmed = non_empty_trimmed(raw)?;
    let url = Url::parse(trimmed).ok()?;
    // Reject credentials-in-URL (phishing and exfil lookalikes).
    if url.scheme() != "https" || has_credentials(&url) {
        return None;
    }
    Some(url.to_string())
}

/// Only same-origin `/reader` paths may be used as evidence deep links into the reader.
#[must_use]
pub fn sanitize_reader_href(raw: Option<&str>) -> Option<String> {
    let trimmed = non_empty_trimmed(raw)?;
    // Block protocol-relative and scheme smuggling (`/reader@evil`, `/reader\n...`).
    if !trimmed.starts_with("/reader") || has_space_or_backslash(trimmed) {
        return None;
    }
    (trimmed == "/reader" || trimmed.starts_with("/reader?")).then(|| trimmed.to_owned())
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn app_href_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"^/(reader|papers|notes|report|log|vault|lists|graph|experiments|plan|ai-review|dashboard|settings|org|git|link)(/[^?]*)?(\?.*)?$",
        )
        .expect("static pattern is valid")
    })
}

/// Same-origin app paths safe to render as evidence "Open source" links.
#[must_use]
pub fn sanitize_app_href(raw: Option<&str>) -> Option<String> {
    let trimmed = non_empty_trimmed(raw)?;
    if !trimmed.starts_with('/') || trimmed.starts_with("//") {
        return None;
    }
    // Block whitespace, backslash and path traversal before the allowlist runs.
    if has_space_or_backslash(trimmed) || trimmed.contains("..") {
        return None;
    }
    app_href_pattern()
        .is_match(trimmed)
        .then(|| trimmed.to_owned())
}

/// True when a URL's path looks like a direct PDF resource, not an HTML landing page.
#[must_use]
pub fn looks_like_pdf_url(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let path = parsed.path().to_lowercase();
    if path.ends_with(".html") || path.ends_with(".htm") {
        return false;
    }
    if path.ends_with(".pdf") {
        return true;
    }
    // Trailing `/pdf` or `/pdf/` (OpenReview), `/pdf/<id>` OA hosts and `/doi/pdf/10...`.
    if path.ends_with("/pdf") || path.ends_with("/pdf/") {
        return true;
    }
    path.contains("/pdf/")
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn arxiv_abs_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)^https?://(?:www\.)?arxiv\.org/abs/([^?#\s]+)")
            .expect("static pattern is valid")
    })
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn arxiv_pdf_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)^https?://(?:www\.)?arxiv\.org/pdf/([^?#\s]+)")
            .expect("static pattern is valid")
    })
}

/// A stored link as a PDF URL the reader may open, or `None` for a landing page.
fn pdf_url_from_link(link: Option<&str>) -> Option<String> {
    let raw = non_empty_trimmed(link)?;
    // arXiv abs and arXiv pdf links both resolve to the pdf path.
    for pattern in [arxiv_abs_pattern(), arxiv_pdf_pattern()] {
        if let Some(caps) = pattern.captures(raw) {
            return sanitize_pdf_url(Some(&format!("https://arxiv.org/pdf/{}", &caps[1])));
        }
    }
    let sanitized = sanitize_pdf_url(Some(raw))?;
    // An unknown HTML landing page is not handed to pdf.js.
    looks_like_pdf_url(&sanitized).then_some(sanitized)
}

/// What a paper records about where its PDF is. `pdfPath` is not here: nothing writes it.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PaperPdfSource {
    /// The paper's own URL.
    pub url: Option<String>,
    /// The arXiv id, if any.
    pub arxiv_id: Option<String>,
    /// The open-access PDF URL, if any.
    pub open_access_pdf: Option<String>,
}

/// Best-effort map from a paper's links and arXiv id to a PDF URL the reader can open.
/// Returns `None` when no PDF can be derived.
#[must_use]
pub fn resolve_paper_pdf_url(source: &PaperPdfSource) -> Option<String> {
    if let Some(id) = non_empty_trimmed(source.arxiv_id.as_deref()) {
        let id = strip_arxiv_prefix(id);
        return sanitize_pdf_url(Some(&format!("https://arxiv.org/pdf/{id}")));
    }
    pdf_url_from_link(source.open_access_pdf.as_deref())
        .or_else(|| pdf_url_from_link(source.url.as_deref()))
}

fn strip_arxiv_prefix(id: &str) -> &str {
    match id.get(..6) {
        Some(prefix) if prefix.eq_ignore_ascii_case("arxiv:") => &id[6..],
        _ => id,
    }
}

/// The same-origin proxy route for an allowlisted PDF URL, or `None` when the proxy would refuse
/// it. The URL is normalised the way the JS `URL` does before the check and the encoding.
#[must_use]
pub fn pdf_proxy_path(raw: &str) -> Option<String> {
    let normalized = Url::parse(raw).ok()?.to_string();
    if !is_allowed_pdf_proxy_url(&normalized) {
        return None;
    }
    Some(format!(
        "/api/pdf-proxy?url={}",
        crate::overleaf_workshop::encode_uri_component(&normalized)
    ))
}

/// The PDF URL a same-origin proxy request carries. `path` is the relay path of `url` (the caller
/// strips the relay base); the target is the sanitised `url` query parameter. `None` for any
/// other path.
#[must_use]
pub fn original_url_from_proxy(path: &str, url: &str) -> Option<String> {
    if !path.starts_with("/api/pdf-proxy?") {
        return None;
    }
    let parsed = Url::parse("https://local.invalid").ok()?.join(url).ok()?;
    let target = parsed
        .query_pairs()
        .find(|(key, _)| key == "url")
        .map(|(_, value)| value.into_owned());
    sanitize_pdf_url(target.as_deref())
}

/// Whether `raw` is a `blob:` URL minted by `origin`, the page's own origin. Another origin's
/// handle, a non-blob URL, or a missing origin is refused.
#[must_use]
pub fn is_reader_object_url(raw: Option<&str>, origin: Option<&str>) -> bool {
    let (Some(raw), Some(origin)) = (raw, origin) else {
        return false;
    };
    let Some(inner) = raw.strip_prefix("blob:") else {
        return false;
    };
    Url::parse(inner).is_ok_and(|url| url.origin().ascii_serialization() == origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_url(url: &str) -> PaperPdfSource {
        PaperPdfSource {
            url: Some(url.to_owned()),
            ..PaperPdfSource::default()
        }
    }

    #[test]
    fn sanitize_pdf_url_accepts_https_only() {
        assert_eq!(
            sanitize_pdf_url(Some("https://arxiv.org/pdf/1706.03762")).as_deref(),
            Some("https://arxiv.org/pdf/1706.03762")
        );
        assert_eq!(sanitize_pdf_url(Some("http://example.com/a.pdf")), None);
        assert_eq!(sanitize_pdf_url(Some("javascript:alert(1)")), None);
        assert_eq!(sanitize_pdf_url(Some("data:text/html,hi")), None);
        assert_eq!(
            sanitize_pdf_url(Some("https://user:pass@evil.test/a.pdf")),
            None
        );
        assert_eq!(sanitize_pdf_url(Some("not a url")), None);
        assert_eq!(sanitize_pdf_url(Some("")), None);
        assert_eq!(sanitize_pdf_url(None), None);
    }

    #[test]
    fn sanitize_pdf_url_refuses_object_urls() {
        assert_eq!(
            sanitize_pdf_url(Some("blob:https://weaveforge.test/2f1c-4b")),
            None
        );
    }

    #[test]
    fn sanitize_reader_href_allows_only_reader_paths() {
        assert_eq!(
            sanitize_reader_href(Some("/reader?paper=p1")).as_deref(),
            Some("/reader?paper=p1")
        );
        assert_eq!(
            sanitize_reader_href(Some("/reader")).as_deref(),
            Some("/reader")
        );
        assert_eq!(sanitize_reader_href(Some("https://evil.test/reader")), None);
        assert_eq!(sanitize_reader_href(Some("javascript:alert(1)")), None);
        assert_eq!(sanitize_reader_href(Some("//evil.test")), None);
        assert_eq!(sanitize_reader_href(Some("/reader-evil")), None);
        assert_eq!(sanitize_reader_href(Some("/papers")), None);
    }

    #[test]
    fn sanitize_app_href_allows_known_roots_only() {
        assert_eq!(
            sanitize_app_href(Some("/papers?paper=p1")).as_deref(),
            Some("/papers?paper=p1")
        );
        assert_eq!(
            sanitize_app_href(Some("/notes?id=n1")).as_deref(),
            Some("/notes?id=n1")
        );
        assert_eq!(
            sanitize_app_href(Some("/reader?paper=p1")).as_deref(),
            Some("/reader?paper=p1")
        );
        assert_eq!(sanitize_app_href(Some("//evil.test")), None);
        assert_eq!(sanitize_app_href(Some("/evil")), None);
        assert_eq!(sanitize_app_href(Some("https://evil.test/papers")), None);
        assert_eq!(sanitize_app_href(Some("/papers/../api/secret")), None);
        assert_eq!(sanitize_app_href(Some("/link/../settings")), None);
    }

    #[test]
    fn resolve_maps_arxiv_abs_and_ids_to_pdf_urls() {
        assert_eq!(
            resolve_paper_pdf_url(&from_url("https://arxiv.org/abs/1706.03762")).as_deref(),
            Some("https://arxiv.org/pdf/1706.03762")
        );
        let by_id = PaperPdfSource {
            arxiv_id: Some("1706.03762".to_owned()),
            ..PaperPdfSource::default()
        };
        assert_eq!(
            resolve_paper_pdf_url(&by_id).as_deref(),
            Some("https://arxiv.org/pdf/1706.03762")
        );
        assert_eq!(
            resolve_paper_pdf_url(&from_url("https://example.com/paper.pdf")).as_deref(),
            Some("https://example.com/paper.pdf")
        );
        assert_eq!(
            resolve_paper_pdf_url(&from_url("https://openreview.net/pdf?id=abc")).as_deref(),
            Some("https://openreview.net/pdf?id=abc")
        );
        assert_eq!(
            resolve_paper_pdf_url(&from_url("https://example.com/landing")),
            None
        );
        assert_eq!(
            resolve_paper_pdf_url(&from_url("javascript:alert(1)")),
            None
        );
    }

    #[test]
    fn looks_like_pdf_url_rejects_html_paths_that_contain_pdf() {
        assert!(!looks_like_pdf_url(
            "https://example.com/blog/pdf/guide.html"
        ));
        assert!(looks_like_pdf_url("https://openreview.net/pdf?id=abc"));
        assert!(looks_like_pdf_url("https://host.example/pdf/abc123"));
        assert!(looks_like_pdf_url("https://doi.org/doi/pdf/10.1/xyz"));
    }

    #[test]
    fn a_paper_with_only_an_arxiv_id_is_readable() {
        let plain = PaperPdfSource {
            arxiv_id: Some("1706.03762".to_owned()),
            ..PaperPdfSource::default()
        };
        let prefixed = PaperPdfSource {
            arxiv_id: Some("arXiv:1706.03762".to_owned()),
            ..PaperPdfSource::default()
        };
        assert!(resolve_paper_pdf_url(&plain).is_some());
        assert!(resolve_paper_pdf_url(&prefixed).is_some());
    }

    #[test]
    fn a_paper_with_only_a_direct_pdf_url_is_readable() {
        assert!(
            resolve_paper_pdf_url(&from_url("https://example.edu/papers/attention.pdf")).is_some()
        );
    }

    #[test]
    fn a_paper_with_no_url_and_no_identifier_is_not_readable() {
        assert_eq!(resolve_paper_pdf_url(&PaperPdfSource::default()), None);
        assert_eq!(resolve_paper_pdf_url(&from_url("   ")), None);
    }

    #[test]
    fn resolve_falls_back_to_the_open_access_copy_when_the_landing_page_is_html() {
        let s2 = PaperPdfSource {
            url: Some("https://www.semanticscholar.org/paper/abc".to_owned()),
            open_access_pdf: Some("https://arxiv.org/pdf/1207.0580v1".to_owned()),
            ..PaperPdfSource::default()
        };
        assert_eq!(
            resolve_paper_pdf_url(&s2).as_deref(),
            Some("https://arxiv.org/pdf/1207.0580v1")
        );

        let arxiv_wins = PaperPdfSource {
            arxiv_id: Some("1706.03762".to_owned()),
            open_access_pdf: Some("https://example.com/x.pdf".to_owned()),
            ..PaperPdfSource::default()
        };
        assert_eq!(
            resolve_paper_pdf_url(&arxiv_wins).as_deref(),
            Some("https://arxiv.org/pdf/1706.03762")
        );

        let http_oa = PaperPdfSource {
            url: Some("https://example.com/landing".to_owned()),
            open_access_pdf: Some("http://dl.acm.org/ft_gateway.cfm?id=1&type=pdf".to_owned()),
            ..PaperPdfSource::default()
        };
        assert_eq!(resolve_paper_pdf_url(&http_oa), None);
        let blank_oa = PaperPdfSource {
            open_access_pdf: Some(String::new()),
            ..PaperPdfSource::default()
        };
        assert_eq!(resolve_paper_pdf_url(&blank_oa), None);
    }

    #[test]
    fn allowed_proxy_hosts_are_exact_and_https() {
        assert!(is_allowed_pdf_proxy_url("https://arxiv.org/pdf/1706.03762"));
        assert!(is_allowed_pdf_proxy_url("https://ARXIV.org/pdf/1706.03762"));
        assert!(!is_allowed_pdf_proxy_url("http://arxiv.org/pdf/1706.03762"));
        assert!(!is_allowed_pdf_proxy_url("https://evil-arxiv.org/a.pdf"));
        assert!(!is_allowed_pdf_proxy_url("https://user@arxiv.org/a.pdf"));
        assert!(!is_allowed_pdf_proxy_url("not a url"));
    }
}

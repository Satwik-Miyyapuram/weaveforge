//! Scheme rules for the PDF URLs the reader passes around (TS `isCachePdfUrl`,
//! `isStoredPdfUrl` and the remote check in `resolvePaperPdfSourceForReader`, in
//! `apps/web/src/features/reader/application/parts-3.ts`). The `cache://` decoding,
//! blob minting and byte reads stay in TS.

const CACHE_SCHEME: &str = "cache://";

/// Whether `url` is a `cache://` reference to bytes in the reader's PDF cache.
#[must_use]
pub fn is_cache_pdf_url(url: &str) -> bool {
    url.starts_with(CACHE_SCHEME)
}

/// Whether the reader answers `url` from this app's own store, with no network hop:
/// a `blob:` URL or a `cache://` reference.
#[must_use]
pub fn is_stored_pdf_url(url: &str) -> bool {
    url.starts_with("blob:") || is_cache_pdf_url(url)
}

/// Whether `url` is a remote address the cache may seed from: `/^https?:\/\//i`, or a
/// same-origin path starting with `/`.
#[must_use]
pub fn is_remote_pdf_url(url: &str) -> bool {
    let has_prefix_ci = |prefix: &str| {
        url.get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
    };
    has_prefix_ci("http://") || has_prefix_ci("https://") || url.starts_with('/')
}

#[cfg(test)]
mod tests {
    use super::{is_cache_pdf_url, is_remote_pdf_url, is_stored_pdf_url};

    #[test]
    // it: "isCachePdfUrl recognises the ladder cache scheme"
    fn is_cache_pdf_url_recognises_the_ladder_cache_scheme() {
        assert!(is_cache_pdf_url("cache://paper-1"));
        assert!(!is_cache_pdf_url("https://example.com/a.pdf"));
        assert!(!is_cache_pdf_url("/api/pdf-proxy?u=x"));
    }

    #[test]
    fn is_stored_pdf_url_is_blob_or_cache() {
        assert!(is_stored_pdf_url("blob:https://weaveforge.test/2f1c"));
        assert!(is_stored_pdf_url("cache://paper-1"));
        assert!(!is_stored_pdf_url("https://example.com/a.pdf"));
        assert!(!is_stored_pdf_url("/api/pdf-proxy?u=x"));
    }

    #[test]
    fn is_remote_pdf_url_is_http_scheme_ignoring_case_or_a_root_path() {
        assert!(is_remote_pdf_url("https://example.com/a.pdf"));
        assert!(is_remote_pdf_url("HTTP://example.com/a.pdf"));
        assert!(is_remote_pdf_url("/api/pdf-proxy?u=x"));
        assert!(!is_remote_pdf_url("cache://paper-1"));
        assert!(!is_remote_pdf_url("blob:https://weaveforge.test/2f1c"));
        assert!(!is_remote_pdf_url("ftp://example.com/a.pdf"));
        assert!(!is_remote_pdf_url("https"));
    }
}

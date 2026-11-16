//! Same-origin deep link into the read-only reader at a locus (TS `buildLocusLink`).
//! Port of `apps/web/src/features/reader/application/build-locus-link.ts`.
//!
//! Query order is `paper`, `pdf`, `locus`, `page`. Values are encoded like `URLSearchParams`
//! (space becomes `+`), so the link is byte-identical to the TS output.

use serde::Deserialize;
use url::form_urlencoded;

use super::anchor::AnchorPdfLocus;
use super::locus::encode_locus;
use super::sanitize_reader_url::sanitize_pdf_url;

/// Inputs for [`build_locus_link`] (TS `buildLocusLink` parameter).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LocusLinkInput {
    /// Paper id; an empty string is treated as absent.
    #[serde(default)]
    pub paper_id: Option<String>,
    /// Direct PDF URL, allowlisted (https only) before it goes in the query.
    #[serde(default)]
    pub pdf_url: Option<String>,
    /// Locus encoded inline with [`encode_locus`].
    #[serde(default)]
    pub locus: Option<AnchorPdfLocus>,
    /// 0-based page hint; only a non-negative integer is kept.
    #[serde(default)]
    pub page: Option<f64>,
}

/// Build `/reader?...` for the input, or `/reader` when no parameter is set.
#[must_use]
pub fn build_locus_link(input: &LocusLinkInput) -> String {
    let mut params = form_urlencoded::Serializer::new(String::new());
    if let Some(paper) = input.paper_id.as_deref().filter(|id| !id.is_empty()) {
        let _ = params.append_pair("paper", paper);
    }
    if let Some(pdf) = sanitize_pdf_url(input.pdf_url.as_deref()) {
        let _ = params.append_pair("pdf", &pdf);
    }
    if let Some(locus) = &input.locus {
        let _ = params.append_pair("locus", &encode_locus(locus));
    }
    if let Some(page) = input.page.filter(|p| p.fract() == 0.0 && *p >= 0.0) {
        let _ = params.append_pair("page", &js_number_string(page));
    }
    let query = params.finish();
    if query.is_empty() {
        "/reader".to_owned()
    } else {
        format!("/reader?{query}")
    }
}

/// `String(n)` for a non-negative integer `n` (JS `Number#toString`): plain digits below 1e21,
/// exponent form (`1e+21`) from there up.
fn js_number_string(n: f64) -> String {
    // `+ 0.0` turns -0 into +0, which JS prints as "0".
    let n = n + 0.0;
    if n < 1e21 {
        format!("{n}")
    } else {
        format!("{n:e}").replace('e', "e+")
    }
}

#[cfg(test)]
mod tests {
    use super::{LocusLinkInput, build_locus_link, js_number_string};

    #[test]
    fn empty_input_is_bare_reader_path() {
        assert_eq!(build_locus_link(&LocusLinkInput::default()), "/reader");
    }

    #[test]
    fn paper_and_page_are_form_encoded_in_order() {
        let input = LocusLinkInput {
            paper_id: Some("a b".to_owned()),
            page: Some(3.0),
            ..LocusLinkInput::default()
        };
        assert_eq!(build_locus_link(&input), "/reader?paper=a+b&page=3");
    }

    #[test]
    fn negative_and_fractional_pages_are_dropped() {
        for page in [-1.0, 1.5, f64::NAN, f64::INFINITY] {
            let input = LocusLinkInput {
                page: Some(page),
                ..LocusLinkInput::default()
            };
            assert_eq!(build_locus_link(&input), "/reader");
        }
    }

    #[test]
    fn js_number_strings_match_number_to_string() {
        assert_eq!(js_number_string(0.0), "0");
        assert_eq!(js_number_string(-0.0), "0");
        assert_eq!(js_number_string(1e20), "100000000000000000000");
        assert_eq!(js_number_string(1e21), "1e+21");
    }
}

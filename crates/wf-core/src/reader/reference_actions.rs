//! The popover's pure rules for a bibliography entry: which paper reference to
//! resolve, and which fields a manual add can fill without inventing any.
//! Ports of `referenceRef` and `manualInputFromReference` in
//! apps/web/src/features/reader/application/parts-2.ts. The adds
//! themselves stay in TS.

use serde::Serialize;

use crate::reader_analysis::types::AnalysisParsedReference;

/// Extra facts a bibliographic lookup can match on (TS `PaperRef` `hints`).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceHints {
    /// The entry's title as printed, untrimmed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The publication year.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<f64>,
    /// The first listed author.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_author: Option<String>,
}

/// The paper reference a bibliography entry resolves by (TS `PaperRef` for an entry).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReferenceRef {
    /// A DOI from the entry.
    Doi {
        /// The DOI.
        value: String,
    },
    /// An arXiv id from the entry.
    Arxiv {
        /// The arXiv id.
        value: String,
    },
    /// No identifier: a title search, with hints to narrow it.
    Bibliographic {
        /// The trimmed title, or the trimmed raw entry text when there is no title.
        value: String,
        /// Year and first author to narrow the search.
        hints: ReferenceHints,
    },
}

/// The fields a manual add can fill from an entry (TS `NewPaperInput`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ManualPaperInput {
    /// The trimmed title, or the start of the raw entry text (200 UTF-16 units).
    pub title: String,
    /// Always `to_read`: a cited paper goes on the shelf to read.
    pub status: &'static str,
    /// The authors, when the entry lists any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    /// The publication year, when the entry gives one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<f64>,
    /// The DOI, when the entry gives one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    /// The arXiv id, when the entry gives one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arxiv_id: Option<String>,
    /// The URL, when the entry gives one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Trim JavaScript's whitespace set, which includes the BOM (as `String.prototype.trim` does).
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// The first `units` UTF-16 code units of `text`, as `String.prototype.slice(0, n)` cuts them.
/// A cut inside a surrogate pair becomes U+FFFD, where JS would keep a lone surrogate.
fn js_prefix(text: &str, units: usize) -> String {
    let taken: Vec<u16> = text.encode_utf16().take(units).collect();
    String::from_utf16_lossy(&taken)
}

/// Non-empty trimmed text, or `None` (the TS `||` falls through on an empty string).
fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(js_trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// The strongest identifier the entry carries: DOI, then arXiv id, then a title search.
/// Only the title search carries year and first-author hints, so a wrong-year paper of the same name is less likely to be picked.
#[must_use]
pub fn reference_ref(entry: &AnalysisParsedReference) -> ReferenceRef {
    if let Some(value) = entry.doi.as_deref().filter(|doi| !doi.is_empty()) {
        return ReferenceRef::Doi {
            value: value.to_owned(),
        };
    }
    if let Some(value) = entry.arxiv_id.as_deref().filter(|id| !id.is_empty()) {
        return ReferenceRef::Arxiv {
            value: value.to_owned(),
        };
    }
    let value = non_empty(entry.title.as_deref()).unwrap_or_else(|| js_trim(&entry.raw).to_owned());
    let hints = ReferenceHints {
        title: entry.title.clone().filter(|title| !title.is_empty()),
        year: entry.year,
        first_author: entry
            .authors
            .first()
            .filter(|name| !name.is_empty())
            .cloned(),
    };
    ReferenceRef::Bibliographic { value, hints }
}

/// The fields a manual add can fill from an entry, without inventing any.
#[must_use]
pub fn manual_input_from_reference(entry: &AnalysisParsedReference) -> ManualPaperInput {
    let title =
        non_empty(entry.title.as_deref()).unwrap_or_else(|| js_prefix(js_trim(&entry.raw), 200));
    ManualPaperInput {
        title,
        status: "to_read",
        authors: (!entry.authors.is_empty()).then(|| entry.authors.clone()),
        year: entry.year,
        doi: entry.doi.clone().filter(|doi| !doi.is_empty()),
        arxiv_id: entry.arxiv_id.clone().filter(|id| !id.is_empty()),
        url: entry.url.clone().filter(|url| !url.is_empty()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(raw: &str) -> AnalysisParsedReference {
        AnalysisParsedReference {
            index: 1.0,
            raw: raw.to_owned(),
            page: 1.0,
            ..Default::default()
        }
    }

    #[test]
    fn doi_wins_over_everything() {
        let mut e = entry("raw");
        e.doi = Some("10.1/x".to_owned());
        e.arxiv_id = Some("2401.00001".to_owned());
        assert_eq!(
            reference_ref(&e),
            ReferenceRef::Doi {
                value: "10.1/x".to_owned()
            }
        );
    }

    #[test]
    fn arxiv_when_no_doi() {
        let mut e = entry("raw");
        e.arxiv_id = Some("2401.00001".to_owned());
        assert_eq!(
            reference_ref(&e),
            ReferenceRef::Arxiv {
                value: "2401.00001".to_owned()
            }
        );
    }

    #[test]
    fn bibliographic_uses_title_and_hints() {
        let mut e = entry("  Smith 2020. A Title.  ");
        e.title = Some("  A Title  ".to_owned());
        e.year = Some(2020.0);
        e.authors = vec!["Smith".to_owned(), "Jones".to_owned()];
        assert_eq!(
            reference_ref(&e),
            ReferenceRef::Bibliographic {
                value: "A Title".to_owned(),
                hints: ReferenceHints {
                    title: Some("  A Title  ".to_owned()),
                    year: Some(2020.0),
                    first_author: Some("Smith".to_owned()),
                },
            }
        );
    }

    #[test]
    fn bibliographic_falls_back_to_raw_without_title() {
        let e = entry("  Raw entry text  ");
        assert_eq!(
            reference_ref(&e),
            ReferenceRef::Bibliographic {
                value: "Raw entry text".to_owned(),
                hints: ReferenceHints::default(),
            }
        );
    }

    #[test]
    fn whitespace_only_title_falls_back_to_raw() {
        let mut e = entry("Raw");
        e.title = Some("   ".to_owned());
        assert_eq!(manual_input_from_reference(&e).title, "Raw");
    }

    #[test]
    fn manual_input_fills_only_known_fields() {
        let mut e = entry("[3] Raw");
        e.authors = vec!["Smith".to_owned()];
        e.year = Some(1999.0);
        let input = manual_input_from_reference(&e);
        assert_eq!(input.title, "[3] Raw");
        assert_eq!(input.status, "to_read");
        assert_eq!(input.authors, Some(vec!["Smith".to_owned()]));
        assert_eq!(input.year, Some(1999.0));
        assert_eq!(input.doi, None);
        assert_eq!(input.arxiv_id, None);
        assert_eq!(input.url, None);
    }

    #[test]
    fn manual_input_truncates_raw_title_to_200_units() {
        let e = entry(&"a".repeat(300));
        assert_eq!(manual_input_from_reference(&e).title.len(), 200);
    }

    #[test]
    fn manual_input_serialises_camel_case_and_omits_none() {
        let e = entry("Raw");
        let json = serde_json::to_value(manual_input_from_reference(&e)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "title": "Raw", "status": "to_read" })
        );
    }

    #[test]
    fn reference_ref_serialises_with_kind_tag() {
        let mut e = entry("raw");
        e.doi = Some("10.1/x".to_owned());
        let json = serde_json::to_value(reference_ref(&e)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "doi", "value": "10.1/x" })
        );
    }
}

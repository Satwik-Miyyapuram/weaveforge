//! Shared analysis vocabulary (`packages/core/src/features/reader/analysis/analysis-types.ts`).
//! Optional TS fields are `Option`s that are left out when `None`, so a value
//! round-trips to the same JS object, key for key.

use serde::{Deserialize, Serialize};

/// Where an internal `/Link` goes: a 1-based page and, when named, a point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisLinkDest {
    /// 1-based page.
    pub page: f64,
    /// Destination x, when named.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub x: Option<f64>,
    /// Destination y, when named.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub y: Option<f64>,
}

/// A page-text range a link box covers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisTextSpan {
    /// Start offset.
    pub start: f64,
    /// End offset.
    pub end: f64,
}

/// A `/Link` annotation (`PdfLink`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisPdfLink {
    /// `[x1, y1, x2, y2]` in PDF user space.
    pub rect: [f64; 4],
    /// External target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub url: Option<String>,
    /// Internal target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = AnalysisLinkDest))]
    pub dest: Option<AnalysisLinkDest>,
    /// Measured page-text ranges under the box.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Vec<AnalysisTextSpan>))]
    pub text_ranges: Option<Vec<AnalysisTextSpan>>,
    /// Named destination (`cite.kingma2014`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub dest_name: Option<String>,
}

/// One page handed to analysis (`AnalyzePdfPage`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisPdfPage {
    /// 1-based.
    pub page_number: f64,
    /// pdf.js text items.
    pub items: Vec<crate::reader_analysis::text::AnalysisPdfItem>,
    /// The page's own `/Link` annotations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Vec<AnalysisPdfLink>))]
    pub links: Option<Vec<AnalysisPdfLink>>,
}

/// A page range (`PageTextRange`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisPageTextRange {
    /// 1-based page.
    pub page: f64,
    /// Start offset.
    pub start: f64,
    /// End offset.
    pub end: f64,
}

/// One citation found in the text layer (`CitationMention`). Field order is the TS key order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisCitationMention {
    /// Unique within the document.
    pub id: String,
    /// 1-based page.
    pub page: f64,
    /// Start offset in the page text.
    pub start: f64,
    /// End offset in the page text.
    pub end: f64,
    /// The mention text.
    pub text: String,
    /// PDF user-space rects.
    pub rects: Vec<Vec<f64>>,
    /// Cited entries by `ParsedReference.index`.
    pub reference_indexes: Vec<f64>,
    /// `internal-pdf-link`, `numeric`, `superscript` or `author-year`.
    pub source: String,
    /// 1 for a link-named entry, lower for pattern matches.
    pub confidence: f64,
    /// Link destination.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = AnalysisLinkDest))]
    pub target: Option<AnalysisLinkDest>,
    /// Named destination.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub destination_name: Option<String>,
    /// Rects of the native link box.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Vec<Vec<f64>>))]
    pub native_rects: Option<Vec<Vec<f64>>>,
    /// `text` or `annotation`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub span_source: Option<String>,
}

/// One bibliography entry (`ParsedReference`). Field order is the TS key order.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisParsedReference {
    /// Entry number.
    pub index: f64,
    /// Printed label (`[12]`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub label: Option<String>,
    /// Entry text.
    pub raw: String,
    /// 1-based page.
    pub page: f64,
    /// Left edge of the first line.
    pub x: f64,
    /// Baseline of the first line.
    pub y: f64,
    /// Start offset in the page text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub start: Option<f64>,
    /// End offset in the page text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub end: Option<f64>,
    /// Author names.
    pub authors: Vec<String>,
    /// Publication year.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub year: Option<f64>,
    /// `a` in `2020a`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub year_suffix: Option<String>,
    /// Title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub title: Option<String>,
    /// Venue.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub venue: Option<String>,
    /// DOI, normalised.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub doi: Option<String>,
    /// arXiv id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub arxiv_id: Option<String>,
    /// URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub url: Option<String>,
}

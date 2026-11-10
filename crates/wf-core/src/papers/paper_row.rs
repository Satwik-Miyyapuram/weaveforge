//! Paper row mapping (TS `paper-rows.ts`). A row is the `papers` table's columns as the
//! database names them; the domain types are camelCase. Every backend reads and writes the
//! same table, so the mapping lives here once.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::paper::{PaperStatus, normalize_doi};

/// A `papers` row as stored. A summary read selects fewer columns, so the ones it leaves out
/// are absent and read as `None`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperRow {
    /// Primary key.
    pub id: String,
    /// The title.
    pub title: String,
    /// Author names, or `null`.
    pub authors: Option<Vec<String>>,
    /// Publication year.
    pub year: Option<f64>,
    /// Venue (journal or conference).
    pub venue: Option<String>,
    /// DOI, normalized.
    pub doi: Option<String>,
    /// arXiv id.
    pub arxiv_id: Option<String>,
    /// Web address.
    pub url: Option<String>,
    /// Path of the stored PDF.
    pub pdf_path: Option<String>,
    /// Abstract text.
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    /// The reader's own summary.
    pub summary: Option<String>,
    /// Reading status.
    pub status: PaperStatus,
    /// Rating, 1 to 5.
    pub rating: Option<f64>,
    /// ISO date the paper was read.
    pub read_at: Option<String>,
    /// BibTeX entry.
    pub bibtex: Option<String>,
    /// Keyword tags, or `null`.
    pub tags: Option<Vec<String>>,
    /// The extensible metadata bag, or `null`.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub metadata: Option<Value>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
    /// DOI lookup index; always written as `null`.
    pub doi_bidx: Option<String>,
    /// arXiv lookup index; always written as `null`.
    pub arxiv_bidx: Option<String>,
}

/// A paper as the domain holds it. Unset optional fields are absent, not `null`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Paper {
    /// Primary key.
    pub id: String,
    /// The title.
    #[serde(default)]
    pub title: String,
    /// Author names.
    #[serde(default)]
    pub authors: Vec<String>,
    /// Publication year.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub year: Option<f64>,
    /// Venue (journal or conference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub venue: Option<String>,
    /// DOI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub doi: Option<String>,
    /// arXiv id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub arxiv_id: Option<String>,
    /// Web address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub url: Option<String>,
    /// Path of the stored PDF.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub pdf_path: Option<String>,
    /// Abstract text.
    #[serde(default, rename = "abstract", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub abstract_text: Option<String>,
    /// The reader's own summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub summary: Option<String>,
    /// Reading status.
    pub status: PaperStatus,
    /// Rating, 1 to 5.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub rating: Option<f64>,
    /// ISO date the paper was read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub read_at: Option<String>,
    /// BibTeX entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub bibtex: Option<String>,
    /// Keyword tags (normalized, no leading '#').
    #[serde(default)]
    pub tags: Vec<String>,
    /// The extensible metadata bag.
    #[serde(default = "empty_object")]
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub metadata: Value,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

/// The card projection of a paper: the columns a grid card reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperSummary {
    /// Primary key.
    pub id: String,
    /// The title.
    pub title: String,
    /// Author names.
    pub authors: Vec<String>,
    /// Reading status.
    pub status: PaperStatus,
    /// Publication year.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub year: Option<f64>,
    /// ISO date the paper was read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub read_at: Option<String>,
    /// Path of the stored PDF.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub pdf_path: Option<String>,
    /// DOI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub doi: Option<String>,
    /// arXiv id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub arxiv_id: Option<String>,
    /// Web address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub url: Option<String>,
    /// The reader's own summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub summary: Option<String>,
    /// Keyword tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

fn empty_object() -> Value {
    json!({})
}

/// `value` unless it is absent or empty; the column form of an unset text field.
#[must_use]
pub fn empty_to_null(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.is_empty())
}

/// The domain paper for a stored row (`toDomain`).
#[must_use]
pub fn paper_to_domain(row: PaperRow) -> Paper {
    Paper {
        id: row.id,
        title: row.title,
        authors: row.authors.unwrap_or_default(),
        year: row.year,
        venue: row.venue,
        doi: row.doi,
        arxiv_id: row.arxiv_id,
        url: row.url,
        pdf_path: row.pdf_path,
        abstract_text: row.abstract_text,
        summary: row.summary,
        status: row.status,
        rating: row.rating,
        read_at: row.read_at,
        bibtex: row.bibtex,
        tags: row.tags.unwrap_or_default(),
        metadata: row.metadata.unwrap_or_else(empty_object),
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

/// The card projection of a stored row (`toSummary`). Unselected columns stay out of the
/// summary, rather than being filled with placeholders.
#[must_use]
pub fn paper_to_summary(row: PaperRow) -> PaperSummary {
    PaperSummary {
        id: row.id,
        title: row.title,
        authors: row.authors.unwrap_or_default(),
        status: row.status,
        year: row.year,
        read_at: row.read_at,
        pdf_path: row.pdf_path,
        doi: row.doi,
        arxiv_id: row.arxiv_id,
        url: row.url,
        summary: row.summary,
        tags: row.tags.unwrap_or_default(),
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

/// The row a paper is written as (`toRow`). Empty text becomes `null`, the DOI is normalized,
/// and both lookup indexes are written as `null`.
#[must_use]
pub fn paper_to_row(paper: Paper) -> PaperRow {
    PaperRow {
        id: paper.id,
        title: paper.title,
        authors: Some(paper.authors),
        year: paper.year,
        venue: empty_to_null(paper.venue),
        doi: normalize_doi(paper.doi.as_deref()),
        arxiv_id: empty_to_null(paper.arxiv_id),
        url: empty_to_null(paper.url),
        pdf_path: paper.pdf_path,
        abstract_text: empty_to_null(paper.abstract_text),
        summary: empty_to_null(paper.summary),
        status: paper.status,
        rating: paper.rating,
        read_at: paper.read_at,
        bibtex: empty_to_null(paper.bibtex),
        tags: Some(paper.tags),
        metadata: Some(paper.metadata),
        created_at: paper.created_at,
        updated_at: paper.updated_at,
        doi_bidx: None,
        arxiv_bidx: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> PaperRow {
        PaperRow {
            id: "p1".into(),
            title: "T".into(),
            authors: None,
            year: Some(2024.0),
            venue: Some(String::new()),
            doi: None,
            arxiv_id: None,
            url: None,
            pdf_path: None,
            abstract_text: None,
            summary: None,
            status: PaperStatus::ToRead,
            rating: None,
            read_at: None,
            bibtex: None,
            tags: None,
            metadata: None,
            created_at: "c".into(),
            updated_at: "u".into(),
            doi_bidx: None,
            arxiv_bidx: None,
        }
    }

    #[test]
    fn stored_row_reads_missing_lists_and_metadata_as_empty() {
        let paper = paper_to_domain(row());
        assert!(paper.authors.is_empty() && paper.tags.is_empty());
        assert_eq!(paper.metadata, json!({}));
    }

    #[test]
    fn written_row_nulls_empty_text_and_normalizes_doi() {
        let mut paper = paper_to_domain(row());
        paper.doi = Some("https://doi.org/10.1000/ABC".into());
        let written = paper_to_row(paper);
        assert_eq!(written.venue, None);
        assert_eq!(written.doi.as_deref(), Some("10.1000/abc"));
        assert_eq!(written.doi_bidx, None);
    }

    #[test]
    fn summary_leaves_out_unselected_columns() {
        let summary = paper_to_summary(row());
        assert_eq!(summary.id, "p1");
        assert_eq!(summary.year, Some(2024.0));
    }
}

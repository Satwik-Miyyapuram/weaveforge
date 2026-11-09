//! Response mapping for the metadata sources: Crossref, Semantic Scholar, OpenAlex, arXiv and a
//! page's own tags. Each function is the pure half of a source: the JSON (or XML) a provider
//! answered, turned into the paper fields the import needs. Fetching and the choice of which
//! match to take stay in TS. Port of the `toMetadata` helpers in
//! `features/papers/infrastructure/*-metadata-source.ts`.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::Deserialize;
use serde_json::{Map, Value};

use super::js_regex::compile;
use super::paper::normalize_doi;
use super::paper_ref::normalize_arxiv_id;
use super::paper_title::{is_placeholder_title, title_from_file_name};
use super::zotero_mapping::ZoteroPaperInput;
use crate::overleaf_workshop::encode_uri_component;

static WHITESPACE_RUN: LazyLock<Regex> = LazyLock::new(|| compile(r"\s+").expect("valid pattern"));
static TAG: LazyLock<Regex> = LazyLock::new(|| compile(r"<[^>]+>").expect("valid pattern"));
static ENTRY: LazyLock<Regex> =
    LazyLock::new(|| compile(r"<entry>([\s\S]*?)</entry>").expect("valid pattern"));
static NAME: LazyLock<Regex> =
    LazyLock::new(|| compile(r"<name>([\s\S]*?)</name>").expect("valid pattern"));

/// JS `.replace(/\s+/g, " ")`.
fn collapse_ws(s: &str) -> String {
    WHITESPACE_RUN.replace_all(s, " ").into_owned()
}

/// Crossref's `message` for one DOI. Keys keep Crossref's own spelling.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CrossrefMessage {
    /// Titles; the first is used.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub title: Option<Vec<String>>,
    /// Authors, in order.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub author: Option<Vec<CrossrefAuthor>>,
    /// Container (journal or proceedings) titles; the first is used.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "container-title", default)]
    pub container_title: Option<Vec<String>>,
    /// Issue date.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub issued: Option<CrossrefIssued>,
    /// DOI.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "DOI", default)]
    pub doi: Option<String>,
    /// Abstract, possibly with JATS tags.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "abstract", default)]
    pub abstract_text: Option<String>,
    /// Canonical landing page.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "URL", default)]
    pub url: Option<String>,
}

/// One Crossref author: a split name, or a whole `name` for an organisation.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CrossrefAuthor {
    /// Given name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub given: Option<String>,
    /// Family name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub family: Option<String>,
    /// Whole name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub name: Option<String>,
}

/// Crossref's issue date: `date-parts` is `[[year, month, day]]`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CrossrefIssued {
    /// The date parts.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "date-parts", default)]
    pub date_parts: Option<Vec<Vec<f64>>>,
}

/// A Semantic Scholar paper (search match or identifier lookup).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SemanticScholarPaper {
    /// Title.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub title: Option<String>,
    /// Authors, in order.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub authors: Option<Vec<SemanticScholarAuthor>>,
    /// Publication year.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub year: Option<f64>,
    /// Venue.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub venue: Option<String>,
    /// Semantic Scholar's own id.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub paper_id: Option<String>,
    /// DOI and arXiv id.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub external_ids: Option<SemanticScholarExternalIds>,
    /// Open-access PDF, when there is one.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub open_access_pdf: Option<SemanticScholarPdf>,
    /// Citation count.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub citation_count: Option<f64>,
}

/// One Semantic Scholar author.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SemanticScholarAuthor {
    /// Display name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub name: Option<String>,
}

/// Semantic Scholar's external ids.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SemanticScholarExternalIds {
    /// DOI.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "DOI", default)]
    pub doi: Option<String>,
    /// arXiv id.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "ArXiv", default)]
    pub arxiv: Option<String>,
}

/// Semantic Scholar's open-access PDF.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SemanticScholarPdf {
    /// PDF address.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub url: Option<String>,
}

/// An OpenAlex work. Keys keep OpenAlex's snake_case spelling.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OpenAlexWork {
    /// OpenAlex id (a URL).
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub id: Option<String>,
    /// Title.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub title: Option<String>,
    /// DOI, as a URL, or null.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub doi: Option<String>,
    /// Publication year.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub publication_year: Option<f64>,
    /// Authorships, in order.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub authorships: Option<Vec<OpenAlexAuthorship>>,
    /// Where the work is published.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub primary_location: Option<OpenAlexLocation>,
    /// The best open-access location, or null.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub best_oa_location: Option<OpenAlexLocation>,
    /// Citation count.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub cited_by_count: Option<f64>,
}

/// One OpenAlex authorship.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OpenAlexAuthorship {
    /// The author.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub author: Option<OpenAlexAuthor>,
}

/// An OpenAlex author.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OpenAlexAuthor {
    /// Display name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub display_name: Option<String>,
}

/// An OpenAlex location: where a work appears, and its PDF.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OpenAlexLocation {
    /// The venue.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub source: Option<OpenAlexSource>,
    /// PDF address.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub pdf_url: Option<String>,
}

/// An OpenAlex source (venue).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OpenAlexSource {
    /// Venue name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub display_name: Option<String>,
}

/// What a paper's own page says about it: the answer of the URL metadata route, or of the
/// shell's HTML relay.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct UrlMetaResponse {
    /// Title.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub title: Option<String>,
    /// Authors, in order.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub authors: Option<Vec<String>>,
    /// Publication year.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub year: Option<f64>,
    /// Venue.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub venue: Option<String>,
    /// DOI.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub doi: Option<String>,
    /// arXiv id.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub arxiv_id: Option<String>,
    /// Abstract.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(rename = "abstract", default)]
    pub abstract_text: Option<String>,
    /// The page address.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub url: String,
}

/// [`CrossrefMessage`] as a paper. `doi` is the DOI that was asked for, used when Crossref
/// does not name one.
#[must_use]
pub fn crossref_to_metadata(message: &CrossrefMessage, doi: &str) -> ZoteroPaperInput {
    let authors = message
        .author
        .iter()
        .flatten()
        .map(|a| match &a.name {
            Some(name) => name.clone(),
            None => [a.given.as_deref(), a.family.as_deref()]
                .into_iter()
                .flatten()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" "),
        })
        .filter(|name| !name.is_empty())
        .collect();
    let year = message
        .issued
        .as_ref()
        .and_then(|issued| issued.date_parts.as_ref())
        .and_then(|parts| parts.first())
        .and_then(|first| first.first())
        .copied();
    ZoteroPaperInput {
        title: message
            .title
            .as_ref()
            .and_then(|titles| titles.first())
            .map_or_else(|| doi.to_owned(), |title| collapse_ws(title)),
        authors,
        venue: message
            .container_title
            .as_ref()
            .and_then(|titles| titles.first())
            .cloned(),
        year,
        doi: Some(message.doi.clone().unwrap_or_else(|| doi.to_owned())),
        url: Some(
            message
                .url
                .clone()
                .unwrap_or_else(|| format!("https://doi.org/{doi}")),
        ),
        abstract_text: message
            .abstract_text
            .as_deref()
            .map(|a| collapse_ws(&TAG.replace_all(a, "")).trim().to_owned()),
        ..Default::default()
    }
}

/// [`SemanticScholarPaper`] as a paper, with the open-access PDF and citation count under
/// `metadata`.
#[must_use]
pub fn semantic_scholar_to_metadata(paper: &SemanticScholarPaper) -> ZoteroPaperInput {
    let ids = paper.external_ids.as_ref();
    let mut metadata = Map::new();
    if let Some(pdf) = paper.open_access_pdf.as_ref().and_then(|p| p.url.clone()) {
        let _ = metadata.insert("openAccessPdf".to_owned(), Value::String(pdf));
    }
    if let Some(count) = paper.citation_count {
        let _ = metadata.insert("citationCount".to_owned(), Value::from(count));
    }
    ZoteroPaperInput {
        title: paper.title.clone().unwrap_or_default(),
        authors: paper
            .authors
            .iter()
            .flatten()
            .filter_map(|a| a.name.clone())
            .filter(|name| !name.is_empty())
            .collect(),
        year: paper.year,
        venue: paper.venue.clone(),
        doi: normalize_doi(ids.and_then(|i| i.doi.as_deref())).filter(|d| !d.is_empty()),
        arxiv_id: ids
            .and_then(|i| i.arxiv.as_deref())
            .and_then(normalize_arxiv_id),
        url: paper.paper_id.as_deref().map(|id| {
            format!(
                "https://www.semanticscholar.org/paper/{}",
                encode_uri_component(id)
            )
        }),
        metadata: Some(metadata),
        ..Default::default()
    }
}

/// [`OpenAlexWork`] as a paper. The link is the DOI as OpenAlex gives it, else the OpenAlex id.
#[must_use]
pub fn openalex_to_metadata(work: &OpenAlexWork) -> ZoteroPaperInput {
    let primary = work.primary_location.as_ref();
    let mut metadata = Map::new();
    let pdf = work
        .best_oa_location
        .as_ref()
        .and_then(|l| l.pdf_url.clone())
        .or_else(|| primary.and_then(|l| l.pdf_url.clone()));
    if let Some(pdf) = pdf {
        let _ = metadata.insert("openAccessPdf".to_owned(), Value::String(pdf));
    }
    if let Some(count) = work.cited_by_count {
        let _ = metadata.insert("citationCount".to_owned(), Value::from(count));
    }
    ZoteroPaperInput {
        title: work.title.clone().unwrap_or_default(),
        authors: work
            .authorships
            .iter()
            .flatten()
            .filter_map(|entry| entry.author.as_ref().and_then(|a| a.display_name.clone()))
            .filter(|name| !name.is_empty())
            .collect(),
        year: work.publication_year,
        doi: normalize_doi(work.doi.as_deref()).filter(|d| !d.is_empty()),
        venue: primary
            .and_then(|l| l.source.as_ref())
            .and_then(|s| s.display_name.clone()),
        url: work.doi.clone().or_else(|| work.id.clone()),
        metadata: Some(metadata),
        ..Default::default()
    }
}

/// Decodes the five XML entities the arXiv feed uses, in the TS order. Empty is absent.
fn decode(s: &str) -> Option<String> {
    if s.is_empty() {
        return None;
    }
    Some(
        s.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'"),
    )
}

/// The first `<tag>` in an arXiv entry, trimmed and decoded.
fn pick(entry: &str, tag: &str) -> Option<String> {
    let re = compile(&format!(r"<{tag}>([\s\S]*?)</{tag}>")).expect("valid pattern");
    let raw = re.captures(entry)?.get(1)?.as_str().trim();
    decode(raw)
}

/// The first `<entry>` of an arXiv Atom feed as a paper. An unknown id answers with no entry,
/// and a malformed one with an entry titled "Error"; both are an error, not an empty paper.
///
/// # Errors
///
/// Fails with `arXiv has no paper <id>` when the feed has no usable entry.
pub fn arxiv_entry_to_metadata(xml: &str, arxiv_id: &str) -> Result<ZoteroPaperInput, String> {
    let not_found = format!("arXiv has no paper {arxiv_id}");
    let entry = ENTRY
        .captures(xml)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .ok_or_else(|| not_found.clone())?;
    let authors = NAME
        .captures_iter(entry)
        .filter_map(|c| decode(c.get(1)?.as_str().trim()))
        .collect();
    let year = pick(entry, "published").and_then(|published| {
        published
            .chars()
            .take(4)
            .collect::<String>()
            .parse::<f64>()
            .ok()
    });
    let title = pick(entry, "title").map(|t| collapse_ws(&t));
    if title.as_deref() == Some("Error") {
        return Err(not_found);
    }
    Ok(ZoteroPaperInput {
        title: title.unwrap_or_else(|| format!("arXiv:{arxiv_id}")),
        authors,
        year,
        abstract_text: pick(entry, "summary").map(|s| collapse_ws(&s)),
        arxiv_id: Some(arxiv_id.to_owned()),
        url: Some(format!("https://arxiv.org/abs/{arxiv_id}")),
        ..Default::default()
    })
}

/// A page's own metadata as a paper. A page with no title, or one that names the page rather
/// than the paper, is refused with the message the import shows.
///
/// # Errors
///
/// Fails when the page has no title, or its title is a placeholder.
pub fn url_meta_to_metadata(meta: &UrlMetaResponse) -> Result<ZoteroPaperInput, String> {
    let title = match meta.title.as_deref() {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Err(
                "That page has no title to file the paper under. Add the paper manually."
                    .to_owned(),
            );
        }
    };
    if is_placeholder_title(Some(title)) {
        return Err(format!(
            "That page is titled \"{}\", which names the page, not a paper. Add it by DOI or arXiv id instead.",
            title.trim()
        ));
    }
    Ok(ZoteroPaperInput {
        title: title_from_file_name(title),
        authors: meta.authors.clone().unwrap_or_default(),
        year: meta.year,
        venue: meta.venue.clone(),
        doi: meta.doi.clone(),
        arxiv_id: meta.arxiv_id.clone(),
        abstract_text: meta.abstract_text.clone(),
        url: Some(meta.url.clone()),
        metadata: None,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn crossref(value: Value) -> CrossrefMessage {
        serde_json::from_value(value).expect("crossref message")
    }

    #[test]
    fn crossref_maps_title_authors_year_and_links() {
        let message = crossref(json!({
            "title": ["A  Title\n Here"],
            "author": [
                { "given": "Ada", "family": "Lovelace" },
                { "name": "Analytical Engine Group" },
                { "given": "", "family": "" }
            ],
            "container-title": ["Journal X"],
            "issued": { "date-parts": [[2021, 4]] },
            "DOI": "10.1000/xyz",
            "abstract": "<jats:p>Some   text</jats:p>",
            "URL": "https://example.org/x"
        }));
        let paper = crossref_to_metadata(&message, "10.1000/fallback");
        assert_eq!(paper.title, "A Title Here");
        assert_eq!(
            paper.authors,
            vec!["Ada Lovelace", "Analytical Engine Group"]
        );
        assert_eq!(paper.venue.as_deref(), Some("Journal X"));
        assert_eq!(paper.year, Some(2021.0));
        assert_eq!(paper.doi.as_deref(), Some("10.1000/xyz"));
        assert_eq!(paper.url.as_deref(), Some("https://example.org/x"));
        assert_eq!(paper.abstract_text.as_deref(), Some("Some text"));
    }

    #[test]
    fn crossref_falls_back_to_the_asked_doi() {
        let paper = crossref_to_metadata(&CrossrefMessage::default(), "10.1000/fallback");
        assert_eq!(paper.title, "10.1000/fallback");
        assert_eq!(paper.authors, Vec::<String>::new());
        assert_eq!(paper.year, None);
        assert_eq!(paper.doi.as_deref(), Some("10.1000/fallback"));
        assert_eq!(
            paper.url.as_deref(),
            Some("https://doi.org/10.1000/fallback")
        );
        assert_eq!(paper.abstract_text, None);
    }

    fn semantic(value: Value) -> SemanticScholarPaper {
        serde_json::from_value(value).expect("semantic paper")
    }

    #[test]
    fn semantic_scholar_maps_ids_links_and_metadata() {
        let paper = semantic_scholar_to_metadata(&semantic(json!({
            "title": "Deep Things",
            "authors": [{ "name": "A. One" }, { "name": "" }, {}],
            "year": 2020,
            "venue": "Conf",
            "paperId": "abc def",
            "externalIds": { "DOI": " 10.1/ABC ", "ArXiv": "arXiv:2001.00001v2" },
            "openAccessPdf": { "url": "https://pdf.example/a.pdf" },
            "citationCount": 7
        })));
        assert_eq!(paper.title, "Deep Things");
        assert_eq!(paper.authors, vec!["A. One"]);
        assert_eq!(paper.year, Some(2020.0));
        assert_eq!(paper.venue.as_deref(), Some("Conf"));
        assert_eq!(paper.doi.as_deref(), Some("10.1/abc"));
        assert_eq!(paper.arxiv_id.as_deref(), Some("2001.00001"));
        assert_eq!(
            paper.url.as_deref(),
            Some("https://www.semanticscholar.org/paper/abc%20def")
        );
        let metadata = paper.metadata.expect("metadata object");
        assert_eq!(metadata["openAccessPdf"], "https://pdf.example/a.pdf");
        assert_eq!(metadata["citationCount"], 7.0);
    }

    #[test]
    fn semantic_scholar_omits_absent_metadata_keys() {
        let paper = semantic_scholar_to_metadata(&semantic(json!({ "title": "T" })));
        assert_eq!(paper.metadata, Some(Map::new()));
        assert_eq!(paper.doi, None);
        assert_eq!(paper.arxiv_id, None);
        assert_eq!(paper.url, None);
    }

    fn openalex(value: Value) -> OpenAlexWork {
        serde_json::from_value(value).expect("openalex work")
    }

    #[test]
    fn openalex_links_to_doi_else_id_and_prefers_best_oa_pdf() {
        let with_doi = openalex_to_metadata(&openalex(json!({
            "id": "https://openalex.org/W1",
            "title": "Work",
            "doi": "https://doi.org/10.2/Q",
            "publication_year": 2019,
            "authorships": [{ "author": { "display_name": "B. Two" } }, { "author": {} }],
            "primary_location": { "source": { "display_name": "Venue" }, "pdf_url": "https://p/1.pdf" },
            "best_oa_location": { "pdf_url": "https://best/2.pdf" },
            "cited_by_count": 3
        })));
        assert_eq!(with_doi.url.as_deref(), Some("https://doi.org/10.2/Q"));
        assert_eq!(with_doi.doi.as_deref(), Some("10.2/q"));
        assert_eq!(with_doi.authors, vec!["B. Two"]);
        assert_eq!(with_doi.venue.as_deref(), Some("Venue"));
        let metadata = with_doi.metadata.expect("metadata object");
        assert_eq!(metadata["openAccessPdf"], "https://best/2.pdf");
        assert_eq!(metadata["citationCount"], 3.0);

        let without_doi = openalex_to_metadata(&openalex(json!({
            "id": "https://openalex.org/W9",
            "title": "Work",
            "doi": null,
            "primary_location": { "pdf_url": "https://p/9.pdf" },
            "best_oa_location": null
        })));
        assert_eq!(without_doi.url.as_deref(), Some("https://openalex.org/W9"));
        assert_eq!(without_doi.doi, None);
        assert_eq!(
            without_doi.metadata.expect("metadata object")["openAccessPdf"],
            "https://p/9.pdf"
        );
    }

    const ARXIV_FEED: &str = r#"<feed><entry>
        <id>http://arxiv.org/abs/2101.00001v1</id>
        <published>2021-01-04T00:00:00Z</published>
        <title>Attention &amp;  Beyond
          Things</title>
        <summary>  We show &lt;things&gt; &quot;work&quot;.  </summary>
        <author><name>Jane Doe</name></author>
        <author><name>  Tom &#39;T&#39; Roe </name></author>
      </entry></feed>"#;

    #[test]
    fn arxiv_entry_decodes_entities_and_collapses_whitespace() {
        let paper = arxiv_entry_to_metadata(ARXIV_FEED, "2101.00001").expect("paper");
        assert_eq!(paper.title, "Attention & Beyond Things");
        assert_eq!(paper.authors, vec!["Jane Doe", "Tom 'T' Roe"]);
        assert_eq!(paper.year, Some(2021.0));
        assert_eq!(
            paper.abstract_text.as_deref(),
            Some("We show <things> \"work\".")
        );
        assert_eq!(paper.arxiv_id.as_deref(), Some("2101.00001"));
        assert_eq!(
            paper.url.as_deref(),
            Some("https://arxiv.org/abs/2101.00001")
        );
        assert_eq!(paper.doi, None);
    }

    #[test]
    fn arxiv_without_an_entry_or_with_an_error_entry_is_a_miss() {
        let message = "arXiv has no paper 9999.99999";
        assert_eq!(
            arxiv_entry_to_metadata("<feed></feed>", "9999.99999").unwrap_err(),
            message
        );
        let error_feed = "<feed><entry><title>Error</title></entry></feed>";
        assert_eq!(
            arxiv_entry_to_metadata(error_feed, "9999.99999").unwrap_err(),
            message
        );
    }

    #[test]
    fn arxiv_without_a_title_falls_back_to_the_id() {
        let feed = "<feed><entry><summary>S</summary></entry></feed>";
        let paper = arxiv_entry_to_metadata(feed, "2101.00002").expect("paper");
        assert_eq!(paper.title, "arXiv:2101.00002");
        assert_eq!(paper.year, None);
        assert_eq!(paper.abstract_text.as_deref(), Some("S"));
    }

    fn url_meta(value: Value) -> UrlMetaResponse {
        serde_json::from_value(value).expect("url meta")
    }

    #[test]
    fn url_meta_maps_a_titled_page() {
        let paper = url_meta_to_metadata(&url_meta(json!({
            "title": "Accurate, Large Minibatch SGD",
            "authors": ["Goyal"],
            "year": 2017,
            "arxivId": "1706.02677",
            "url": "https://example.org/paper"
        })))
        .expect("paper");
        assert_eq!(paper.title, "Accurate, Large Minibatch SGD");
        assert_eq!(paper.authors, vec!["Goyal"]);
        assert_eq!(paper.year, Some(2017.0));
        assert_eq!(paper.arxiv_id.as_deref(), Some("1706.02677"));
        assert_eq!(paper.url.as_deref(), Some("https://example.org/paper"));
        assert_eq!(paper.metadata, None);
    }

    #[test]
    fn url_meta_refuses_a_missing_or_placeholder_title() {
        assert_eq!(
            url_meta_to_metadata(&url_meta(json!({ "url": "https://x" }))).unwrap_err(),
            "That page has no title to file the paper under. Add the paper manually."
        );
        assert_eq!(
            url_meta_to_metadata(&url_meta(json!({ "title": "", "url": "https://x" })))
                .unwrap_err(),
            "That page has no title to file the paper under. Add the paper manually."
        );
        assert_eq!(
            url_meta_to_metadata(&url_meta(
                json!({ "title": "Catalog Page", "url": "https://x" })
            ))
            .unwrap_err(),
            "That page is titled \"Catalog Page\", which names the page, not a paper. Add it by DOI or arXiv id instead."
        );
    }
}

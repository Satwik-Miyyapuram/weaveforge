//! Zotero item <-> paper mapping rules (TS `features/papers/infrastructure/zotero-sync.ts`,
//! `zotero-metadata-source.ts` and `zotero-exporter.ts`). Pure: no fetch, no store.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::js_regex::compile;
use super::paper::{PaperStatus, normalize_doi};
use super::paper_merge::MergePaper;
use super::paper_title::title_from_file_name;

/// One creator as Zotero stores it: a single `name`, or first and last name.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroCreator {
    /// Given name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    /// Family name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    /// Whole name, for institutions and single-field creators.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// The item fields WeaveForge reads from a Zotero item. Zotero returns more; these are ours.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroItem {
    /// Zotero item key.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Zotero item type (`journalArticle`, `attachment`, ...).
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_type: Option<String>,
    /// Key of the bibliography entry a child item (attachment, note) hangs off.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_item: Option<String>,
    /// Title.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Creators, in order.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub creators: Vec<ZoteroCreator>,
    /// Journal or venue name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication_title: Option<String>,
    /// Date as Zotero stores it (free text, usually containing a year).
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// DOI.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, rename = "DOI", skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    /// Link.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Abstract.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abstract_note: Option<String>,
    /// Free-text `extra` field (carries `arXiv:<id>` lines).
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<String>,
}

/// A paper read from a Zotero item, shaped as the app's `NewPaperInput` (also `PaperMetadata`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroPaperInput {
    /// Title.
    pub title: String,
    /// Authors, in order.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub authors: Vec<String>,
    /// Venue.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub venue: Option<String>,
    /// Publication year.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<f64>,
    /// DOI.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    /// arXiv id.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arxiv_id: Option<String>,
    /// Link.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Abstract.
    #[serde(rename = "abstract", default, skip_serializing_if = "Option::is_none")]
    pub abstract_text: Option<String>,
    /// Metadata bag (the Zotero key, for a row created from an item).
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Map<String, Value>>,
}

/// A creator as written to Zotero: always an author.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroExportCreator {
    /// Creator role; always `author` here.
    pub creator_type: String,
    /// Given name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    /// Family name.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    /// Whole name, when it could not be split.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// The `journalArticle` item written to Zotero for a paper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroExportItem {
    /// Zotero item type.
    pub item_type: String,
    /// Title.
    pub title: String,
    /// Authors.
    pub creators: Vec<ZoteroExportCreator>,
    /// Venue.
    pub publication_title: String,
    /// Year, as text; empty when unknown.
    pub date: String,
    /// DOI; empty when unknown.
    #[serde(rename = "DOI")]
    pub doi: String,
    /// Link; empty when unknown.
    pub url: String,
    /// Abstract (or the summary when there is no abstract).
    pub abstract_note: String,
    /// `arXiv:<id>` line; empty when unknown.
    pub extra: String,
}

static ARXIV_TAG: LazyLock<Regex> =
    LazyLock::new(|| compile(r"(?i)arXiv:\s*([\w./-]+)").expect("valid pattern"));
static ARXIV_URL: LazyLock<Regex> = LazyLock::new(|| {
    compile(r"(?i)arxiv\.org/(?:abs|pdf)/([\w./-]+?)(?:\.pdf)?(?:[?#].*)?$").expect("valid pattern")
});
static YEAR: LazyLock<Regex> = LazyLock::new(|| compile(r"\d{4}").expect("valid pattern"));
static DATACITE_ARXIV: LazyLock<Regex> =
    LazyLock::new(|| compile(r"(?i)^10\.48550/arxiv\.(.+)$").expect("valid pattern"));
static WHITESPACE_RUN: LazyLock<Regex> = LazyLock::new(|| compile(r"\s+").expect("valid pattern"));

/// The value, or `None` when it is absent or empty (the TS `x || undefined`).
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// arXiv id from a Zotero item: the `arXiv:<id>` tag in `extra`, else the same in `url`, else
/// the id in an `arxiv.org/abs|pdf/<id>` URL.
#[must_use]
pub fn zotero_arxiv_id(item: &ZoteroItem) -> Option<String> {
    let extra = item.extra.as_deref().unwrap_or("");
    let url = item.url.as_deref().unwrap_or("");
    let capture = |regex: &Regex, text: &str| {
        regex
            .captures(text)
            .and_then(|found| found.get(1))
            .map(|id| id.as_str().trim().to_owned())
    };
    capture(&ARXIV_TAG, extra)
        .or_else(|| capture(&ARXIV_TAG, url))
        .or_else(|| capture(&ARXIV_URL, url))
}

/// The paper's author names: `name`, else first and last name joined; empty names dropped.
fn authors_of(item: &ZoteroItem) -> Vec<String> {
    item.creators
        .iter()
        .map(|creator| match &creator.name {
            Some(name) => name.clone(),
            None => [creator.first_name.as_deref(), creator.last_name.as_deref()]
                .into_iter()
                .flatten()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" "),
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// The first four-digit run in the date, as a year; `None` when there is none or it is zero.
fn year_of(date: Option<&str>) -> Option<f64> {
    non_empty(date)
        .and_then(|text| YEAR.find(text))
        .and_then(|found| found.as_str().parse::<f64>().ok())
        .filter(|year| *year != 0.0)
}

/// Content keys for a paper; a match on any one counts. Strong ids (DOI, arXiv) come first;
/// the title is only a fallback when neither exists. Whitespace-only ids and titles give none.
#[must_use]
pub fn zotero_content_keys(
    doi: Option<&str>,
    arxiv_id: Option<&str>,
    title: Option<&str>,
) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(normalized) = normalize_doi(doi).filter(|d| !d.is_empty()) {
        keys.push(format!("doi:{normalized}"));
        // arXiv DataCite DOIs embed the id: 10.48550/arXiv.2103.03230
        if let Some(found) = DATACITE_ARXIV.captures(&normalized).and_then(|c| c.get(1)) {
            keys.push(format!("arxiv:{}", found.as_str().to_lowercase()));
        }
    }
    if let Some(arxiv) = arxiv_id
        .map(|id| id.trim().to_lowercase())
        .filter(|id| !id.is_empty())
    {
        keys.push(format!("arxiv:{arxiv}"));
    }
    if keys.is_empty() {
        let lowered = title.map(|text| text.trim().to_lowercase());
        let collapsed = lowered.map(|text| WHITESPACE_RUN.replace_all(&text, " ").into_owned());
        if let Some(text) = non_empty(collapsed.as_deref()) {
            keys.push(format!("title:{text}"));
        }
    }
    keys
}

/// The paper a Zotero item describes, as the app creates it (pull path). Keeps the Zotero key
/// under `metadata.zoteroKey`.
#[must_use]
pub fn zotero_remote_to_input(item: &ZoteroItem) -> ZoteroPaperInput {
    let mut input = zotero_remote_to_metadata(item);
    input.abstract_text = item.abstract_note.clone();
    input.arxiv_id = zotero_arxiv_id(item);
    input.metadata = non_empty(item.key.as_deref()).map(|key| {
        let mut bag = Map::new();
        bag.insert("zoteroKey".to_owned(), Value::String(key.to_owned()));
        bag
    });
    input
}

/// The metadata a Zotero item yields when it is looked up (not imported): the arXiv id comes
/// from `extra` only, and the abstract is whitespace-normalised.
#[must_use]
pub fn zotero_remote_to_metadata(item: &ZoteroItem) -> ZoteroPaperInput {
    let title = match non_empty(item.title.as_deref()) {
        Some(title) => title_from_file_name(title),
        None => "Untitled (Zotero)".to_owned(),
    };
    let abstract_text = item
        .abstract_note
        .as_deref()
        .map(|text| WHITESPACE_RUN.replace_all(text, " ").trim().to_owned());
    ZoteroPaperInput {
        title,
        authors: authors_of(item),
        venue: item.publication_title.clone(),
        year: year_of(item.date.as_deref()),
        doi: non_empty(item.doi.as_deref()).map(str::to_owned),
        arxiv_id: item
            .extra
            .as_deref()
            .and_then(|extra| ARXIV_TAG.captures(extra))
            .and_then(|found| found.get(1))
            .map(|id| id.as_str().to_owned()),
        url: item.url.clone(),
        abstract_text,
        metadata: None,
    }
}

/// Splits a name into a Zotero author: the last word is the family name, the rest the given.
fn split_creator(name: &str) -> ZoteroExportCreator {
    let parts: Vec<&str> = name.trim().split_whitespace().collect();
    match parts.split_last() {
        Some((last, first)) if !first.is_empty() => ZoteroExportCreator {
            creator_type: "author".to_owned(),
            first_name: Some(first.join(" ")),
            last_name: Some((*last).to_owned()),
            name: None,
        },
        _ => ZoteroExportCreator {
            creator_type: "author".to_owned(),
            first_name: None,
            last_name: None,
            name: Some(name.to_owned()),
        },
    }
}

/// The `journalArticle` item a paper is written to Zotero as (push path).
#[must_use]
pub fn to_zotero_item(paper: &MergePaper) -> ZoteroExportItem {
    let mut extra = Vec::new();
    if let Some(arxiv) = paper.arxiv_id.as_deref().filter(|id| !id.is_empty()) {
        extra.push(format!("arXiv:{arxiv}"));
    }
    ZoteroExportItem {
        item_type: "journalArticle".to_owned(),
        title: paper.title.clone(),
        creators: paper
            .authors
            .iter()
            .map(|name| split_creator(name))
            .collect(),
        publication_title: paper.venue.clone().unwrap_or_default(),
        date: paper
            .year
            .filter(|year| *year != 0.0)
            .map(|year| format!("{year}"))
            .unwrap_or_default(),
        doi: paper.doi.clone().unwrap_or_default(),
        url: paper.url.clone().unwrap_or_default(),
        abstract_note: paper
            .abstract_text
            .clone()
            .or_else(|| paper.summary.clone())
            .unwrap_or_default(),
        extra: extra.join("\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item() -> ZoteroItem {
        ZoteroItem {
            key: Some("ABC123".to_owned()),
            item_type: Some("journalArticle".to_owned()),
            ..ZoteroItem::default()
        }
    }

    #[test]
    fn the_arxiv_id_comes_from_the_extra_tag_then_the_url() {
        let mut from_extra = item();
        from_extra.extra = Some("arXiv:2301.12345v2".to_owned());
        assert_eq!(
            zotero_arxiv_id(&from_extra).as_deref(),
            Some("2301.12345v2")
        );

        let mut from_abs = item();
        from_abs.url = Some("https://arxiv.org/abs/1706.03762".to_owned());
        assert_eq!(zotero_arxiv_id(&from_abs).as_deref(), Some("1706.03762"));

        let mut from_pdf = item();
        from_pdf.url = Some("https://arxiv.org/pdf/hep-th/9711200.pdf?x=1".to_owned());
        assert_eq!(
            zotero_arxiv_id(&from_pdf).as_deref(),
            Some("hep-th/9711200")
        );

        assert_eq!(zotero_arxiv_id(&item()), None);
    }

    #[test]
    fn content_keys_prefer_ids_and_fall_back_to_the_collapsed_title() {
        assert_eq!(
            zotero_content_keys(Some("10.48550/arXiv.2103.03230"), None, None),
            vec![
                "doi:10.48550/arxiv.2103.03230".to_owned(),
                "arxiv:2103.03230".to_owned()
            ]
        );
        assert_eq!(
            zotero_content_keys(None, Some(" 2301.12345 "), Some("Ignored Title")),
            vec!["arxiv:2301.12345".to_owned()]
        );
        assert_eq!(
            zotero_content_keys(None, None, Some("  A   Long\tTitle ")),
            vec!["title:a long title".to_owned()]
        );
        assert!(zotero_content_keys(Some("  "), Some(" "), Some("   ")).is_empty());
    }

    #[test]
    fn a_remote_item_becomes_an_input_with_its_key_and_split_authors() {
        let mut remote = item();
        remote.title = Some("attention_is_all_you_need.pdf".to_owned());
        remote.creators = vec![
            ZoteroCreator {
                name: Some("Google Brain".to_owned()),
                ..ZoteroCreator::default()
            },
            ZoteroCreator {
                first_name: Some("Ashish".to_owned()),
                last_name: Some("Vaswani".to_owned()),
                ..ZoteroCreator::default()
            },
            ZoteroCreator {
                first_name: Some(String::new()),
                ..ZoteroCreator::default()
            },
        ];
        remote.date = Some("Dec 2017".to_owned());
        remote.doi = Some(String::new());
        remote.extra = Some("arXiv:1706.03762".to_owned());

        let input = zotero_remote_to_input(&remote);
        assert_eq!(
            input.authors,
            vec!["Google Brain".to_owned(), "Ashish Vaswani".to_owned()]
        );
        assert_eq!(input.year, Some(2017.0));
        assert_eq!(input.doi, None);
        assert_eq!(input.arxiv_id.as_deref(), Some("1706.03762"));
        assert_eq!(
            input.metadata.as_ref().and_then(|bag| bag.get("zoteroKey")),
            Some(&Value::String("ABC123".to_owned()))
        );
        assert_eq!(
            zotero_remote_to_input(&ZoteroItem::default()).title,
            "Untitled (Zotero)"
        );
    }

    #[test]
    fn a_metadata_lookup_normalises_the_abstract_and_leaves_out_the_key() {
        let mut remote = item();
        remote.abstract_note = Some("  One\n\ttwo  three ".to_owned());
        let metadata = zotero_remote_to_metadata(&remote);
        assert_eq!(metadata.abstract_text.as_deref(), Some("One two three"));
        assert_eq!(metadata.metadata, None);
    }

    #[test]
    fn a_paper_is_written_as_a_journal_article_with_split_creators() {
        let paper = MergePaper {
            id: "p".to_owned(),
            title: "Attention".to_owned(),
            authors: vec!["Ashish Vaswani".to_owned(), "Plato".to_owned()],
            year: Some(2017.0),
            venue: None,
            doi: None,
            arxiv_id: Some("1706.03762".to_owned()),
            url: None,
            pdf_path: None,
            abstract_text: None,
            summary: Some("My summary.".to_owned()),
            status: PaperStatus::ToRead,
            rating: None,
            read_at: None,
            bibtex: None,
            tags: Vec::new(),
            metadata: Map::new(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        let item = to_zotero_item(&paper);
        assert_eq!(item.date, "2017");
        assert_eq!(item.abstract_note, "My summary.");
        assert_eq!(item.extra, "arXiv:1706.03762");
        assert_eq!(item.creators[0].first_name.as_deref(), Some("Ashish"));
        assert_eq!(item.creators[0].last_name.as_deref(), Some("Vaswani"));
        assert_eq!(item.creators[1].name.as_deref(), Some("Plato"));
    }
}

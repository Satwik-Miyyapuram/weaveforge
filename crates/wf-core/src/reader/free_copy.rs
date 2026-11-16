//! "Find a free copy": the words for a search that opened nothing, and the open-access ids a
//! paper offers the indexes. A port of the pure parts of
//! `apps/web/src/features/reader/application/parts-1.ts`. The lookup, the fetches and the
//! save stay in TypeScript.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::papers::open_access::{OpenAccessFormat, OpenAccessSource};

/// Why a listed copy did not open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttemptReason {
    /// The link did not serve a PDF.
    NotPdf,
    /// The link did not serve a web page.
    NotHtml,
    /// The host refused the request.
    Blocked,
    /// The request failed.
    Failed,
    /// The page held only an abstract.
    AbstractOnly,
    /// No workspace storage to keep the copy in.
    NoStorage,
}

/// One listed copy that was tried and did not open.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeCopyAttempt {
    /// The listed link.
    pub url: String,
    /// Whether the index listed it as a PDF or a page.
    pub format: OpenAccessFormat,
    /// Why it did not open.
    pub reason: AttemptReason,
}

/// The "none" outcome of a search: what was listed, tried, and which indexes were asked or
/// could not be reached.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeCopyFailure {
    /// How many copies the indexes listed.
    pub listed: usize,
    /// The listed copies that were tried.
    pub attempts: Vec<FreeCopyAttempt>,
    /// The indexes that could not be reached.
    pub unreachable: Vec<OpenAccessSource>,
    /// The indexes that were asked.
    pub asked: Vec<OpenAccessSource>,
}

/// The ids a paper offers the open-access indexes, and its own link split into a PDF or a page.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAccessIds {
    /// The DOI.
    pub doi: Option<String>,
    /// The arXiv id.
    pub arxiv_id: Option<String>,
    /// The PubMed Central id.
    pub pmcid: Option<String>,
    /// The paper's own link, when it looks like a PDF.
    pub known_pdf_url: Option<String>,
    /// The paper's own link, when it is a page.
    pub page_url: Option<String>,
}

/// The fields of a paper that give its open-access ids.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperLinks {
    /// The DOI.
    pub doi: Option<String>,
    /// The arXiv id.
    pub arxiv_id: Option<String>,
    /// The paper's own link.
    pub url: Option<String>,
    /// The paper's metadata, read for a `pmcid`.
    pub metadata: Option<Value>,
}

const NO_IDS: &str = "This paper has no DOI, arXiv id or PubMed Central id to look it up by. Add one, or paste the PDF's address.";
const ALL_INDEXES_DOWN: &str =
    "None of the open-access indexes could be reached. Check the connection and try again.";
const NOTHING_LISTED: &str = "No open-access index lists a free copy of this paper.";
const NO_STORAGE: &str =
    "A free copy was found but could not be kept here — open a workspace folder first.";
const LOAD_PDF_HINT: &str = " Download it in a browser and use Load PDF…";

static HTTP_LINK: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(?i)^https?://").ok());
static PDF_LINK: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)\.pdf(?:$|[?#])|/pdf/").ok());

fn source_name(source: OpenAccessSource) -> &'static str {
    match source {
        OpenAccessSource::Paper => "the paper's own link",
        OpenAccessSource::Arxiv => "arXiv",
        OpenAccessSource::OpenAlex => "OpenAlex",
        OpenAccessSource::Unpaywall => "Unpaywall",
        OpenAccessSource::SemanticScholar => "Semantic Scholar",
        OpenAccessSource::EuropePmc => "Europe PMC",
        OpenAccessSource::Biorxiv => "bioRxiv / medRxiv",
        OpenAccessSource::Doaj => "DOAJ",
        OpenAccessSource::Zenodo => "Zenodo",
        OpenAccessSource::Hal => "HAL",
    }
}

/// Pages go through a relay, so a blocked page is the site saying no, not CORS.
fn reason_words(attempt: &FreeCopyAttempt) -> &'static str {
    match (attempt.format, attempt.reason) {
        (OpenAccessFormat::Html, AttemptReason::Blocked) => "refused to send it",
        (_, AttemptReason::NotPdf) => "did not answer with a PDF",
        (_, AttemptReason::NotHtml) => "did not answer with a page",
        (_, AttemptReason::Blocked) => "does not let the browser fetch it",
        (_, AttemptReason::Failed) => "could not be reached",
        (_, AttemptReason::AbstractOnly) => "has only the abstract",
        (_, AttemptReason::NoStorage) => "could not be kept on this device",
    }
}

/// The host of a URL, or the URL itself when it does not parse.
fn host_of(raw: &str) -> String {
    Url::parse(raw)
        .map(|url| url.host_str().unwrap_or("").to_string())
        .unwrap_or_else(|_| raw.to_string())
}

/// "a", "a and b", "a, b and c".
fn list_names(names: &[&str]) -> String {
    match names {
        [] => String::new(),
        [only] => (*only).to_string(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// JavaScript truthiness for an optional string: absent and empty are both "not there".
fn present(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|text| !text.is_empty())
}

/// For a web article: why its own page did not open, if it was tried.
fn own_page_message(outcome: &FreeCopyFailure) -> Option<String> {
    let own = outcome
        .attempts
        .iter()
        .find(|a| a.format == OpenAccessFormat::Html)?;
    let why = if own.reason == AttemptReason::AbstractOnly {
        "has too little text to be the article"
    } else {
        reason_words(own)
    };
    Some(format!(
        "The page on {} {why}. Load a PDF of it instead, or open it in a browser.",
        host_of(&own.url)
    ))
}

/// The message for a search that opened nothing. Says what was found, what was tried and why
/// each failed, and which indexes were not asked because they could not be reached. Never
/// "no free copy" when the truth is "could not look".
#[must_use]
pub fn describe_free_copy_failure(outcome: &FreeCopyFailure, web_article: bool) -> String {
    if web_article && let Some(message) = own_page_message(outcome) {
        return message;
    }
    let unreachable: Vec<&str> = outcome
        .unreachable
        .iter()
        .map(|s| source_name(*s))
        .collect();
    if outcome.listed == 0 {
        if outcome.asked.is_empty() {
            return NO_IDS.to_string();
        }
        if unreachable.len() >= outcome.asked.len() {
            return ALL_INDEXES_DOWN.to_string();
        }
        return if unreachable.is_empty() {
            NOTHING_LISTED.to_string()
        } else {
            format!(
                "{NOTHING_LISTED} {} could not be reached, so try again later.",
                list_names(&unreachable)
            )
        };
    }
    if outcome
        .attempts
        .iter()
        .any(|a| a.reason == AttemptReason::NoStorage)
    {
        return NO_STORAGE.to_string();
    }
    let tried = outcome
        .attempts
        .iter()
        .take(4)
        .map(|a| format!("{} {}", host_of(&a.url), reason_words(a)))
        .collect::<Vec<_>>()
        .join("; ");
    let copies = if outcome.listed == 1 {
        "1 possible free copy".to_string()
    } else {
        format!("{} possible free copies", outcome.listed)
    };
    let mut message = format!("Found {copies}, but none opened: {tried}.");
    if outcome
        .attempts
        .iter()
        .any(|a| a.format == OpenAccessFormat::Pdf && a.reason == AttemptReason::Blocked)
    {
        message.push_str(LOAD_PDF_HINT);
    }
    if !unreachable.is_empty() {
        message.push_str(&format!(
            " {} could not be reached.",
            list_names(&unreachable)
        ));
    }
    message
}

/// A paper that is a web page and nothing else: a page URL with no DOI, arXiv id or PMCID.
#[must_use]
pub fn is_web_article(ids: &OpenAccessIds) -> bool {
    present(&ids.page_url) && !present(&ids.doi) && !present(&ids.arxiv_id) && !present(&ids.pmcid)
}

/// The ids a paper offers the indexes, and its own link: a PDF-looking http(s) link is the PDF,
/// any other http(s) link is the page.
#[must_use]
pub fn open_access_ids_of(paper: &PaperLinks) -> OpenAccessIds {
    let pmcid = paper
        .metadata
        .as_ref()
        .and_then(|meta| meta.get("pmcid"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let url = paper
        .url
        .as_deref()
        .filter(|link| HTTP_LINK.as_ref().is_some_and(|re| re.is_match(link)));
    let is_pdf = url.is_some_and(|link| PDF_LINK.as_ref().is_some_and(|re| re.is_match(link)));
    OpenAccessIds {
        doi: paper.doi.clone(),
        arxiv_id: paper.arxiv_id.clone(),
        pmcid,
        known_pdf_url: if is_pdf {
            url.map(str::to_string)
        } else {
            None
        },
        page_url: if is_pdf {
            None
        } else {
            url.map(str::to_string)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none_outcome(listed: usize, attempts: Vec<FreeCopyAttempt>) -> FreeCopyFailure {
        FreeCopyFailure {
            listed,
            attempts,
            unreachable: vec![],
            asked: vec![OpenAccessSource::OpenAlex],
        }
    }

    fn attempt(url: &str, format: OpenAccessFormat, reason: AttemptReason) -> FreeCopyAttempt {
        FreeCopyAttempt {
            url: url.to_string(),
            format,
            reason,
        }
    }

    #[test]
    fn no_ids_says_to_add_one() {
        let outcome = FreeCopyFailure {
            asked: vec![],
            ..none_outcome(0, vec![])
        };
        assert!(
            describe_free_copy_failure(&outcome, false)
                .contains("no DOI, arXiv id or PubMed Central id")
        );
    }

    #[test]
    fn every_index_down_is_not_no_free_copy() {
        let outcome = FreeCopyFailure {
            asked: vec![OpenAccessSource::OpenAlex, OpenAccessSource::Hal],
            unreachable: vec![OpenAccessSource::OpenAlex, OpenAccessSource::Hal],
            ..none_outcome(0, vec![])
        };
        assert!(
            describe_free_copy_failure(&outcome, false)
                .contains("None of the open-access indexes could be reached")
        );
    }

    #[test]
    fn nothing_listed_with_all_indexes_answering() {
        let outcome = none_outcome(0, vec![]);
        assert_eq!(describe_free_copy_failure(&outcome, false), NOTHING_LISTED);
    }

    #[test]
    fn nothing_listed_names_the_unreachable_indexes() {
        let outcome = FreeCopyFailure {
            asked: vec![
                OpenAccessSource::OpenAlex,
                OpenAccessSource::Hal,
                OpenAccessSource::Doaj,
            ],
            unreachable: vec![OpenAccessSource::OpenAlex, OpenAccessSource::Hal],
            ..none_outcome(0, vec![])
        };
        assert_eq!(
            describe_free_copy_failure(&outcome, false),
            "No open-access index lists a free copy of this paper. OpenAlex and HAL could not be reached, so try again later."
        );
    }

    #[test]
    fn found_but_none_opened_says_what_each_host_did() {
        let outcome = FreeCopyFailure {
            listed: 2,
            attempts: vec![
                attempt(
                    "https://a.org/p.pdf",
                    OpenAccessFormat::Pdf,
                    AttemptReason::Blocked,
                ),
                attempt(
                    "https://b.org/p",
                    OpenAccessFormat::Html,
                    AttemptReason::AbstractOnly,
                ),
            ],
            unreachable: vec![OpenAccessSource::Doaj],
            asked: vec![OpenAccessSource::OpenAlex, OpenAccessSource::Doaj],
        };
        assert_eq!(
            describe_free_copy_failure(&outcome, false),
            "Found 2 possible free copies, but none opened: a.org does not let the browser fetch it; b.org has only the abstract. Download it in a browser and use Load PDF… DOAJ could not be reached."
        );
    }

    #[test]
    fn a_copy_that_could_not_be_kept_says_so() {
        let outcome = none_outcome(
            1,
            vec![attempt(
                "https://a.org/p.pdf",
                OpenAccessFormat::Pdf,
                AttemptReason::NoStorage,
            )],
        );
        assert!(describe_free_copy_failure(&outcome, false).contains("could not be kept here"));
    }

    #[test]
    fn a_web_article_that_will_not_open_says_so_about_its_own_page() {
        let outcome = none_outcome(
            1,
            vec![attempt(
                "https://blog.example/post",
                OpenAccessFormat::Html,
                AttemptReason::Blocked,
            )],
        );
        assert_eq!(
            describe_free_copy_failure(&outcome, true),
            "The page on blog.example refused to send it. Load a PDF of it instead, or open it in a browser."
        );
    }

    #[test]
    fn open_access_ids_split_a_pdf_link_from_a_page() {
        let ids = open_access_ids_of(&PaperLinks {
            doi: Some("10.1/x".into()),
            arxiv_id: None,
            url: Some("https://a.org/paper.pdf".into()),
            metadata: Some(serde_json::json!({ "pmcid": "PMC1" })),
        });
        assert_eq!(
            ids,
            OpenAccessIds {
                doi: Some("10.1/x".into()),
                arxiv_id: None,
                pmcid: Some("PMC1".into()),
                known_pdf_url: Some("https://a.org/paper.pdf".into()),
                page_url: None,
            }
        );
        let page = open_access_ids_of(&PaperLinks {
            url: Some("https://publisher.com/article/1".into()),
            ..PaperLinks::default()
        });
        assert_eq!(page.known_pdf_url, None);
        assert_eq!(
            page.page_url.as_deref(),
            Some("https://publisher.com/article/1")
        );
    }

    #[test]
    fn a_non_http_link_is_no_link() {
        let ids = open_access_ids_of(&PaperLinks {
            url: Some("javascript:alert(1)".into()),
            ..PaperLinks::default()
        });
        assert_eq!(ids.page_url, None);
        assert_eq!(ids.known_pdf_url, None);
    }

    #[test]
    fn a_blog_post_with_no_ids_is_a_web_article_and_one_with_a_doi_is_not() {
        let blog = open_access_ids_of(&PaperLinks {
            url: Some("https://blog.example/post".into()),
            ..PaperLinks::default()
        });
        assert!(is_web_article(&blog));
        let with_doi = OpenAccessIds {
            doi: Some("10.1/x".into()),
            ..blog.clone()
        };
        assert!(!is_web_article(&with_doi));
        let pdf = open_access_ids_of(&PaperLinks {
            url: Some("https://a.org/p.pdf".into()),
            ..PaperLinks::default()
        });
        assert!(!is_web_article(&pdf));
    }

    #[test]
    fn an_empty_doi_still_counts_as_no_doi() {
        let ids = OpenAccessIds {
            doi: Some(String::new()),
            page_url: Some("https://blog.example/post".into()),
            ..OpenAccessIds::default()
        };
        assert!(is_web_article(&ids));
    }
}

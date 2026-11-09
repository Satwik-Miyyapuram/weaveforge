//! Open-access copies of a paper: the parser for each index's answer, and the ranking.
//! The HTTP steps that ask the indexes stay in TypeScript (`packages/core`, `open-access.ts`).

use std::collections::HashSet;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// How a copy is read: a PDF file, or a web page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum OpenAccessFormat {
    Pdf,
    Html,
}

/// The index that named a copy. Declaration order is the rank order within a format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum OpenAccessSource {
    Paper,
    Arxiv,
    #[serde(rename = "openalex")]
    OpenAlex,
    Unpaywall,
    SemanticScholar,
    EuropePmc,
    Biorxiv,
    Doaj,
    Zenodo,
    Hal,
}

/// One place a paper may be read for free. `url` is https, with no credentials.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OpenAccessCandidate {
    pub url: String,
    pub format: OpenAccessFormat,
    pub source: OpenAccessSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Europe PMC's answer: its free full texts, and the PMCID when it has one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct EuropePmcAnswer {
    pub candidates: Vec<OpenAccessCandidate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pmcid: Option<String>,
}

/// arXiv ids: new style `2101.00001` (with optional version) or old style `hep-th/9901001`.
static ARXIV_ID: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?/\d{7})(?:v\d+)?$").ok()
});

/// A trimmed, non-empty string, or `None`.
fn text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// The elements of a JSON array, or nothing when the value is not an array.
fn items(value: Option<&Value>) -> &[Value] {
    match value.and_then(Value::as_array) {
        Some(list) => list.as_slice(),
        None => &[],
    }
}

/// The elements of a JSON array that are objects.
fn objects(value: Option<&Value>) -> impl Iterator<Item = &Map<String, Value>> {
    items(value).iter().filter_map(Value::as_object)
}

/// A link that names a PDF: a `.pdf` file, or a `/pdf/` path as arXiv and many repositories use.
fn looks_like_pdf(url: Option<&str>) -> bool {
    let Some(url) = url else { return false };
    let lower = url.to_ascii_lowercase();
    lower.contains("/pdf/")
        || lower
            .match_indices(".pdf")
            .any(|(at, _)| matches!(lower[at + 4..].chars().next(), None | Some('?' | '#')))
}

/// An https URL without credentials, or `None`. `http` is upgraded: every index here serves both.
#[must_use]
pub fn open_access_url(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    let mut url = url::Url::parse(value).ok()?;
    if url.scheme() == "http" {
        url.set_scheme("https").ok()?;
    }
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(url.to_string())
}

/// A candidate whose URL passes [`open_access_url`]. The license and version are already trimmed.
fn build(
    url: Option<String>,
    format: OpenAccessFormat,
    source: OpenAccessSource,
    license: Option<String>,
    version: Option<String>,
) -> Option<OpenAccessCandidate> {
    Some(OpenAccessCandidate {
        url: open_access_url(url.as_deref())?,
        format,
        source,
        license,
        version,
    })
}

/// A cleaned arXiv id (an optional `arXiv:` prefix is dropped), or `None`.
#[must_use]
pub fn clean_arxiv_id(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    let value = match trimmed.get(..6) {
        Some(prefix) if prefix.eq_ignore_ascii_case("arxiv:") => &trimmed[6..],
        _ => trimmed,
    };
    (!value.is_empty() && ARXIV_ID.as_ref().is_some_and(|re| re.is_match(value)))
        .then(|| value.to_owned())
}

/// A DOI minted by arXiv (`10.48550/arXiv.2101.00001`) carries the arXiv id.
fn arxiv_id_from_doi(doi: Option<&str>) -> Option<String> {
    let doi = doi?;
    if !doi.get(..15)?.eq_ignore_ascii_case("10.48550/arxiv.") {
        return None;
    }
    clean_arxiv_id(doi.get(15..))
}

/// The arXiv id to ask about: the given one when it is valid, else the one a DOI carries.
/// The DOI is expected already normalized.
#[must_use]
pub fn resolve_arxiv_id(arxiv_id: Option<&str>, doi: Option<&str>) -> Option<String> {
    clean_arxiv_id(arxiv_id).or_else(|| arxiv_id_from_doi(doi))
}

/// A PubMed Central id, as `PMC12345`. A bare number gets the prefix. Anything else is `None`.
#[must_use]
pub fn clean_pmcid(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim().to_uppercase();
    if value.is_empty() {
        return None;
    }
    let with_prefix = if value.bytes().all(|b| b.is_ascii_digit()) {
        format!("PMC{value}")
    } else {
        value
    };
    let digits = with_prefix.strip_prefix("PMC")?;
    let valid = !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit());
    valid.then_some(with_prefix)
}

/// The copies the caller already knows: the PDF it has and the page it has, both from the paper itself.
#[must_use]
pub fn known_candidates(
    known_pdf: Option<String>,
    page: Option<String>,
) -> Vec<OpenAccessCandidate> {
    [
        build(
            known_pdf,
            OpenAccessFormat::Pdf,
            OpenAccessSource::Paper,
            None,
            None,
        ),
        build(
            page,
            OpenAccessFormat::Html,
            OpenAccessSource::Paper,
            None,
            None,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// arXiv's PDF and its HTML rendering for a cleaned arXiv id. A miss is a 404 the fetch step treats as any other miss.
#[must_use]
pub fn arxiv_candidates(arxiv_id: &str) -> Vec<OpenAccessCandidate> {
    let version = Some("submittedVersion".to_owned());
    [
        build(
            Some(format!("https://arxiv.org/pdf/{arxiv_id}")),
            OpenAccessFormat::Pdf,
            OpenAccessSource::Arxiv,
            None,
            version.clone(),
        ),
        build(
            Some(format!("https://arxiv.org/html/{arxiv_id}")),
            OpenAccessFormat::Html,
            OpenAccessSource::Arxiv,
            None,
            version,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// PubMed Central's copies of an article, by its cleaned PMCID.
#[must_use]
pub fn pmc_candidates(pmcid: &str, license: Option<String>) -> Vec<OpenAccessCandidate> {
    [
        build(
            Some(format!("https://europepmc.org/articles/{pmcid}?pdf=render")),
            OpenAccessFormat::Pdf,
            OpenAccessSource::EuropePmc,
            license.clone(),
            None,
        ),
        build(
            Some(format!("https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/")),
            OpenAccessFormat::Html,
            OpenAccessSource::EuropePmc,
            license,
            None,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// OpenAlex's answer for one work: the best location first, then the others. A closed location is skipped.
/// A landing page counts only when the index says the location is open.
#[must_use]
pub fn parse_openalex(body: &Value) -> Vec<OpenAccessCandidate> {
    let best = body.get("best_oa_location").and_then(Value::as_object);
    let locations = best.into_iter().chain(objects(body.get("locations")));
    let mut out: Vec<Option<OpenAccessCandidate>> = Vec::new();
    for location in locations {
        if location.get("is_oa").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let license = text(location.get("license"));
        let version = text(location.get("version"));
        out.push(build(
            text(location.get("pdf_url")),
            OpenAccessFormat::Pdf,
            OpenAccessSource::OpenAlex,
            license.clone(),
            version.clone(),
        ));
        if location.get("is_oa").and_then(Value::as_bool) == Some(true) {
            out.push(build(
                text(location.get("landing_page_url")),
                OpenAccessFormat::Html,
                OpenAccessSource::OpenAlex,
                license,
                version,
            ));
        }
    }
    out.into_iter().flatten().collect()
}

/// Unpaywall's answer: the best location, then the others, each with its PDF and landing page.
#[must_use]
pub fn parse_unpaywall(body: &Value) -> Vec<OpenAccessCandidate> {
    let best = body.get("best_oa_location").and_then(Value::as_object);
    let locations = best.into_iter().chain(objects(body.get("oa_locations")));
    let mut out: Vec<Option<OpenAccessCandidate>> = Vec::new();
    for location in locations {
        let license = text(location.get("license"));
        let version = text(location.get("version"));
        out.push(build(
            text(location.get("url_for_pdf")),
            OpenAccessFormat::Pdf,
            OpenAccessSource::Unpaywall,
            license.clone(),
            version.clone(),
        ));
        out.push(build(
            text(location.get("url_for_landing_page")),
            OpenAccessFormat::Html,
            OpenAccessSource::Unpaywall,
            license,
            version,
        ));
    }
    out.into_iter().flatten().collect()
}

/// Semantic Scholar's `openAccessPdf`, when it has one.
#[must_use]
pub fn parse_semantic_scholar(body: &Value) -> Vec<OpenAccessCandidate> {
    let Some(pdf) = body.get("openAccessPdf").and_then(Value::as_object) else {
        return Vec::new();
    };
    build(
        text(pdf.get("url")),
        OpenAccessFormat::Pdf,
        OpenAccessSource::SemanticScholar,
        text(pdf.get("license")),
        None,
    )
    .into_iter()
    .collect()
}

/// Europe PMC's `search` answer (`resultType=core`), for its first record. Keeps only free full texts
/// (availability `OA` or `F`), and adds the PMC copies when the record is open access.
#[must_use]
pub fn parse_europe_pmc(body: &Value) -> EuropePmcAnswer {
    let resolved = body.get("resultList").and_then(|list| list.get("result"));
    let Some(record) = objects(resolved).next() else {
        return EuropePmcAnswer::default();
    };
    let pmcid = clean_pmcid(text(record.get("pmcid")).as_deref());
    let license = text(record.get("license"));
    let is_open = record.get("isOpenAccess").and_then(Value::as_str) == Some("Y");
    let full_texts = record
        .get("fullTextUrlList")
        .and_then(|list| list.get("fullTextUrl"));
    let mut out: Vec<Option<OpenAccessCandidate>> = Vec::new();
    for entry in objects(full_texts) {
        let availability = text(entry.get("availabilityCode")).map(|s| s.to_uppercase());
        if !matches!(availability.as_deref(), Some("OA" | "F")) {
            continue;
        }
        let format = match text(entry.get("documentStyle"))
            .map(|s| s.to_lowercase())
            .as_deref()
        {
            Some("pdf") => Some(OpenAccessFormat::Pdf),
            Some("html") => Some(OpenAccessFormat::Html),
            _ => None,
        };
        if let Some(format) = format {
            out.push(build(
                text(entry.get("url")),
                format,
                OpenAccessSource::EuropePmc,
                license.clone(),
                None,
            ));
        }
    }
    if let Some(pmcid) = pmcid.as_deref().filter(|_| is_open) {
        out.extend(pmc_candidates(pmcid, license).into_iter().map(Some));
    }
    EuropePmcAnswer {
        candidates: out.into_iter().flatten().collect(),
        pmcid,
    }
}

/// The bioRxiv or medRxiv `details` answer for one DOI. The newest version's PDF and full-text page.
/// `server` is `biorxiv` or `medrxiv`.
#[must_use]
pub fn parse_biorxiv(body: &Value, server: &str) -> Vec<OpenAccessCandidate> {
    let versions: Vec<&Map<String, Value>> = objects(body.get("collection")).collect();
    let Some(&latest) = versions.last() else {
        return Vec::new();
    };
    let Some(doi) = text(latest.get("doi")) else {
        return Vec::new();
    };
    let version = match latest.get("version") {
        Some(Value::Number(n)) => Some(n.to_string()),
        other => text(other),
    };
    let Some(version) = version.filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
    else {
        return Vec::new();
    };
    let base = format!("https://www.{server}.org/content/{doi}v{version}");
    let license = text(latest.get("license"));
    let version_label = Some(format!("v{version}"));
    [
        build(
            Some(format!("{base}.full.pdf")),
            OpenAccessFormat::Pdf,
            OpenAccessSource::Biorxiv,
            license.clone(),
            version_label.clone(),
        ),
        build(
            Some(format!("{base}.full")),
            OpenAccessFormat::Html,
            OpenAccessSource::Biorxiv,
            license,
            version_label,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// DOAJ's search answer: each full-text link of each article, with the journal's first license.
#[must_use]
pub fn parse_doaj(body: &Value) -> Vec<OpenAccessCandidate> {
    let mut out: Vec<Option<OpenAccessCandidate>> = Vec::new();
    for result in objects(body.get("results")) {
        let Some(bibjson) = result.get("bibjson").and_then(Value::as_object) else {
            continue;
        };
        let license = items(
            bibjson
                .get("journal")
                .and_then(|journal| journal.get("license")),
        )
        .first()
        .and_then(Value::as_object)
        .and_then(|first| text(first.get("type")));
        for link in objects(bibjson.get("link")) {
            if text(link.get("type")).map(|t| t.to_lowercase()).as_deref() != Some("fulltext") {
                continue;
            }
            let content_type = text(link.get("content_type"))
                .map(|c| c.to_lowercase())
                .unwrap_or_default();
            let url = text(link.get("url"));
            let format = if content_type.contains("pdf") || looks_like_pdf(url.as_deref()) {
                OpenAccessFormat::Pdf
            } else {
                OpenAccessFormat::Html
            };
            out.push(build(
                url,
                format,
                OpenAccessSource::Doaj,
                license.clone(),
                Some("publishedVersion".to_owned()),
            ));
        }
    }
    out.into_iter().flatten().collect()
}

/// A Zenodo record's PDF files. A restricted or embargoed record lists files nobody can download, so it yields none.
#[must_use]
pub fn parse_zenodo(body: &Value) -> Vec<OpenAccessCandidate> {
    let metadata = body.get("metadata");
    let access = text(metadata.and_then(|m| m.get("access_right")));
    if access.is_some_and(|right| right != "open") {
        return Vec::new();
    }
    let license =
        metadata
            .and_then(|m| m.get("license"))
            .and_then(|license| match license.get("id") {
                Some(id) => text(Some(id)),
                None => text(Some(license)),
            });
    let mut out: Vec<Option<OpenAccessCandidate>> = Vec::new();
    for file in objects(body.get("files")) {
        let key = text(file.get("key")).unwrap_or_default();
        if !key.to_lowercase().ends_with(".pdf") {
            continue;
        }
        let url = file
            .get("links")
            .and_then(Value::as_object)
            .and_then(|links| text(links.get("self")));
        out.push(build(
            url,
            OpenAccessFormat::Pdf,
            OpenAccessSource::Zenodo,
            license.clone(),
            None,
        ));
    }
    out.into_iter().flatten().collect()
}

/// HAL's search answer: each record's own file, and any external link it names.
#[must_use]
pub fn parse_hal(body: &Value) -> Vec<OpenAccessCandidate> {
    let docs = body
        .get("response")
        .and_then(|response| response.get("docs"));
    let mut out: Vec<Option<OpenAccessCandidate>> = Vec::new();
    for doc in objects(docs) {
        let license = text(doc.get("licence_s"));
        out.push(build(
            text(doc.get("fileMain_s")),
            OpenAccessFormat::Pdf,
            OpenAccessSource::Hal,
            license.clone(),
            None,
        ));
        if let Some(external) = text(doc.get("linkExtUrl_s")) {
            let format = if looks_like_pdf(Some(external.as_str())) {
                OpenAccessFormat::Pdf
            } else {
                OpenAccessFormat::Html
            };
            out.push(build(
                Some(external),
                format,
                OpenAccessSource::Hal,
                license,
                None,
            ));
        }
    }
    out.into_iter().flatten().collect()
}

/// Drops repeats by URL without its `#fragment` (the first mention wins, with its license), then puts PDFs
/// before pages and keeps source order within each.
#[must_use]
pub fn rank_open_access_candidates(list: Vec<OpenAccessCandidate>) -> Vec<OpenAccessCandidate> {
    let mut seen = HashSet::new();
    let mut ranked: Vec<OpenAccessCandidate> = list
        .into_iter()
        .filter(|candidate| {
            let base = candidate
                .url
                .split_once('#')
                .map_or(candidate.url.as_str(), |(base, _)| base);
            seen.insert(base.to_owned())
        })
        .collect();
    ranked.sort_by_key(rank);
    ranked
}

/// Sort key: PDFs first, then the source's declaration order.
fn rank(candidate: &OpenAccessCandidate) -> usize {
    let format = if candidate.format == OpenAccessFormat::Pdf {
        0
    } else {
        100
    };
    format + candidate.source as usize
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::OpenAccessFormat::{Html, Pdf};
    use super::*;

    fn pairs(list: &[OpenAccessCandidate]) -> Vec<(OpenAccessFormat, &str)> {
        list.iter().map(|c| (c.format, c.url.as_str())).collect()
    }

    #[test]
    fn open_access_url_keeps_https_upgrades_http_refuses_the_rest() {
        assert_eq!(
            open_access_url(Some("https://a.org/x.pdf")).as_deref(),
            Some("https://a.org/x.pdf")
        );
        assert_eq!(
            open_access_url(Some("http://a.org/x.pdf")).as_deref(),
            Some("https://a.org/x.pdf")
        );
        assert_eq!(open_access_url(Some("javascript:alert(1)")), None);
        assert_eq!(open_access_url(Some("https://user:pw@a.org/x.pdf")), None);
        assert_eq!(open_access_url(Some("not a url")), None);
    }

    #[test]
    fn identifier_cleaning() {
        assert_eq!(
            clean_arxiv_id(Some("arXiv:2101.00001v2")).as_deref(),
            Some("2101.00001v2")
        );
        assert_eq!(
            clean_arxiv_id(Some("hep-th/9901001")).as_deref(),
            Some("hep-th/9901001")
        );
        assert_eq!(clean_arxiv_id(Some("../../etc")), None);
        assert_eq!(clean_pmcid(Some("pmc12345")).as_deref(), Some("PMC12345"));
        assert_eq!(clean_pmcid(Some("12345")).as_deref(), Some("PMC12345"));
        assert_eq!(clean_pmcid(Some("PMCX")), None);
    }

    #[test]
    fn openalex_best_location_first_closed_skipped_landing_pages_only_when_open() {
        let found = parse_openalex(&json!({
            "best_oa_location": {
                "is_oa": true, "pdf_url": "https://repo.org/a.pdf", "landing_page_url": "https://repo.org/a",
                "license": "cc-by", "version": "acceptedVersion"
            },
            "locations": [
                { "is_oa": false, "pdf_url": "https://paywall.com/a.pdf", "landing_page_url": "https://paywall.com/a" },
                { "is_oa": true, "pdf_url": null, "landing_page_url": "https://journal.org/a" }
            ]
        }));
        assert_eq!(
            pairs(&found),
            vec![
                (Pdf, "https://repo.org/a.pdf"),
                (Html, "https://repo.org/a"),
                (Html, "https://journal.org/a"),
            ]
        );
        assert_eq!(found[0].license.as_deref(), Some("cc-by"));
        assert_eq!(found[0].version.as_deref(), Some("acceptedVersion"));
        assert!(parse_openalex(&Value::Null).is_empty());
        assert!(parse_openalex(&json!({ "locations": "nope" })).is_empty());
    }

    #[test]
    fn unpaywall_and_semantic_scholar() {
        let found = parse_unpaywall(&json!({
            "best_oa_location": { "url_for_pdf": "https://x.org/p.pdf", "url_for_landing_page": "https://x.org/p", "license": "cc0" },
            "oa_locations": [{ "url_for_pdf": null, "url_for_landing_page": "https://y.org/p" }]
        }));
        let urls: Vec<&str> = found.iter().map(|c| c.url.as_str()).collect();
        assert_eq!(
            urls,
            ["https://x.org/p.pdf", "https://x.org/p", "https://y.org/p"]
        );
        assert_eq!(
            parse_semantic_scholar(
                &json!({ "openAccessPdf": { "url": "https://s.org/p.pdf", "license": "CCBY" } })
            ),
            vec![OpenAccessCandidate {
                url: "https://s.org/p.pdf".to_owned(),
                format: Pdf,
                source: OpenAccessSource::SemanticScholar,
                license: Some("CCBY".to_owned()),
                version: None,
            }]
        );
        assert!(parse_semantic_scholar(&json!({ "openAccessPdf": null })).is_empty());
    }

    #[test]
    fn europe_pmc_only_free_full_texts_and_the_pmc_copies_when_open_access() {
        let answer = parse_europe_pmc(&json!({
            "resultList": {
                "result": [{
                    "pmcid": "PMC777",
                    "isOpenAccess": "Y",
                    "license": "cc by",
                    "fullTextUrlList": {
                        "fullTextUrl": [
                            { "availabilityCode": "S", "documentStyle": "pdf", "url": "https://publisher.com/paywalled.pdf" },
                            { "availabilityCode": "OA", "documentStyle": "pdf", "url": "https://europepmc.org/articles/PMC777?pdf=render" },
                            { "availabilityCode": "F", "documentStyle": "html", "url": "https://pub.org/free" },
                            { "availabilityCode": "OA", "documentStyle": "doi", "url": "https://doi.org/10.1/x" }
                        ]
                    }
                }]
            }
        }));
        assert_eq!(answer.pmcid.as_deref(), Some("PMC777"));
        assert_eq!(
            pairs(&answer.candidates),
            vec![
                (Pdf, "https://europepmc.org/articles/PMC777?pdf=render"),
                (Html, "https://pub.org/free"),
                (Pdf, "https://europepmc.org/articles/PMC777?pdf=render"),
                (Html, "https://pmc.ncbi.nlm.nih.gov/articles/PMC777/"),
            ]
        );
        assert_eq!(
            parse_europe_pmc(&json!({ "resultList": { "result": [] } })),
            EuropePmcAnswer::default()
        );
    }

    #[test]
    fn biorxiv_newest_version_pdf_and_full_text_page() {
        let found = parse_biorxiv(
            &json!({ "collection": [
                { "doi": "10.1101/2020.01.01.111", "version": "1" },
                { "doi": "10.1101/2020.01.01.111", "version": "3", "license": "cc_by" }
            ] }),
            "biorxiv",
        );
        let urls: Vec<&str> = found.iter().map(|c| c.url.as_str()).collect();
        assert_eq!(
            urls,
            [
                "https://www.biorxiv.org/content/10.1101/2020.01.01.111v3.full.pdf",
                "https://www.biorxiv.org/content/10.1101/2020.01.01.111v3.full",
            ]
        );
        assert_eq!(found[0].version.as_deref(), Some("v3"));
        assert!(parse_biorxiv(&json!({ "collection": [] }), "biorxiv").is_empty());
        assert!(
            parse_biorxiv(
                &json!({ "collection": [{ "doi": "x", "version": "1; drop" }] }),
                "biorxiv"
            )
            .is_empty()
        );
    }

    #[test]
    fn doaj_zenodo_hal() {
        let doaj = parse_doaj(&json!({
            "results": [{
                "bibjson": {
                    "journal": { "license": [{ "type": "CC BY" }] },
                    "link": [
                        { "type": "fulltext", "content_type": "PDF", "url": "https://j.org/a.pdf" },
                        { "type": "fulltext", "url": "https://j.org/a" },
                        { "type": "homepage", "url": "https://j.org" }
                    ]
                }
            }]
        }));
        let rows: Vec<(OpenAccessFormat, &str, Option<&str>)> = doaj
            .iter()
            .map(|c| (c.format, c.url.as_str(), c.license.as_deref()))
            .collect();
        assert_eq!(
            rows,
            vec![
                (Pdf, "https://j.org/a.pdf", Some("CC BY")),
                (Html, "https://j.org/a", Some("CC BY"))
            ]
        );

        let zenodo = parse_zenodo(&json!({
            "metadata": { "access_right": "open", "license": { "id": "cc-by-4.0" } },
            "files": [
                { "key": "data.csv", "links": { "self": "https://zenodo.org/api/records/1/files/data.csv/content" } },
                { "key": "paper.pdf", "links": { "self": "https://zenodo.org/api/records/1/files/paper.pdf/content" } }
            ]
        }));
        let zenodo_urls: Vec<&str> = zenodo.iter().map(|c| c.url.as_str()).collect();
        assert_eq!(
            zenodo_urls,
            ["https://zenodo.org/api/records/1/files/paper.pdf/content"]
        );
        assert!(
            parse_zenodo(&json!({
                "metadata": { "access_right": "embargoed" },
                "files": [{ "key": "p.pdf", "links": { "self": "https://z.org/p.pdf" } }]
            }))
            .is_empty()
        );

        let hal = parse_hal(&json!({
            "response": { "docs": [{
                "fileMain_s": "https://hal.science/hal-1/document",
                "linkExtUrl_s": "https://arxiv.org/pdf/2101.00001"
            }] }
        }));
        assert_eq!(
            pairs(&hal),
            vec![
                (Pdf, "https://hal.science/hal-1/document"),
                (Pdf, "https://arxiv.org/pdf/2101.00001")
            ]
        );
    }

    #[test]
    fn ranking_dedupes_pdfs_first_and_keeps_source_order_within_each() {
        let ranked = rank_open_access_candidates(vec![
            OpenAccessCandidate {
                url: "https://b.org/p".into(),
                format: Html,
                source: OpenAccessSource::Arxiv,
                license: None,
                version: None,
            },
            OpenAccessCandidate {
                url: "https://c.org/p.pdf".into(),
                format: Pdf,
                source: OpenAccessSource::Hal,
                license: None,
                version: None,
            },
            OpenAccessCandidate {
                url: "https://a.org/p.pdf".into(),
                format: Pdf,
                source: OpenAccessSource::OpenAlex,
                license: Some("first".into()),
                version: None,
            },
            OpenAccessCandidate {
                url: "https://a.org/p.pdf#page=2".into(),
                format: Pdf,
                source: OpenAccessSource::Arxiv,
                license: Some("second".into()),
                version: None,
            },
        ]);
        let urls: Vec<&str> = ranked.iter().map(|c| c.url.as_str()).collect();
        assert_eq!(
            urls,
            [
                "https://a.org/p.pdf",
                "https://c.org/p.pdf",
                "https://b.org/p"
            ]
        );
        assert_eq!(ranked[0].license.as_deref(), Some("first"));
    }
}

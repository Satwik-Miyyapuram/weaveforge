//! Paper metadata for a URL: arXiv API, then Crossref, then a guarded page fetch.
//! Ported from apps/web/src/app/api/url-meta/_meta.ts.

use std::fmt::Write;
use std::time::Duration;

use reqwest::{Client, Response, Url};
use serde::Deserialize;
use serde_json::{Value, json};

use wf_core::papers::page_metadata::{
    decode_html_entities, extract_page_metadata, page_import_refusal,
};
use wf_core::papers::paper_ref::{extract_doi, normalize_arxiv_id};
use wf_relay::fetch::safe::{FetchOptions, Network, safe_fetch_via};
use wf_relay::fetch::url_shape::DEFAULT_FETCH_LIMITS;

/// How long the two fixed-host lookups may take before we give up on them.
const FIXED_HOST_TIMEOUT: Duration = Duration::from_secs(10);
/// Crossref asks for a contact address in the agent string.
const CROSSREF_AGENT: &str = "weaveforge (mailto:noreply@example.com)";
/// HTML first, then XML, as the TS asks.
const PAGE_ACCEPT: &str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
/// Appended to a 403 from the page fetch, pointing at the lookups that bot walls do not block.
const BLOCKED_HINT: &str = " Try the DOI or arXiv id instead.";

/// The two fixed hosts the lookups call; tests point them at a local server.
#[derive(Debug, Clone)]
pub struct MetaUpstreams {
    /// arXiv API query endpoint, without the query string.
    pub arxiv_query: String,
    /// Crossref `works` endpoint, without the DOI.
    pub crossref_works: String,
}

impl MetaUpstreams {
    /// The production arXiv and Crossref hosts.
    #[must_use]
    pub fn production() -> Self {
        Self {
            arxiv_query: "https://export.arxiv.org/api/query".to_owned(),
            crossref_works: "https://api.crossref.org/works".to_owned(),
        }
    }
}

/// The slice of a Crossref reply this route reads.
#[derive(Deserialize)]
struct CrossrefEnvelope {
    message: Option<CrossrefWork>,
}

#[derive(Deserialize, Default)]
struct CrossrefWork {
    author: Option<Vec<CrossrefAuthor>>,
    title: Option<Vec<String>>,
    issued: Option<CrossrefIssued>,
    #[serde(rename = "container-title")]
    container_title: Option<Vec<String>>,
    #[serde(rename = "DOI")]
    doi: Option<String>,
    #[serde(rename = "abstract")]
    summary: Option<String>,
    #[serde(rename = "URL")]
    url: Option<String>,
}

#[derive(Deserialize)]
struct CrossrefAuthor {
    name: Option<String>,
    given: Option<String>,
    family: Option<String>,
}

#[derive(Deserialize)]
struct CrossrefIssued {
    #[serde(rename = "date-parts")]
    date_parts: Option<Vec<Vec<Option<i64>>>>,
}

/// Reads paper metadata from `url`, returning the HTTP status and the JSON body.
pub async fn url_meta<N: Network>(
    client: &Client,
    net: &N,
    upstreams: &MetaUpstreams,
    url: Option<&str>,
) -> (u16, Value) {
    let Some(target) = url.filter(|text| !text.is_empty()) else {
        return error(400, "url is required");
    };
    let parsed = match parse_target(target) {
        Ok(parsed) => parsed,
        Err(message) => return error(400, message),
    };
    // The arXiv API is stable and never trips a bot wall, so it beats scraping the abs page.
    if let Some(id) = normalize_arxiv_id(target)
        && let Some(meta) = fetch_arxiv(client, upstreams, &id, target).await
    {
        return (200, meta);
    }
    // Many publishers block bots outright; Crossref answers for the DOI instead.
    if let Some(doi) = extract_doi(target) {
        return crossref(client, upstreams, &doi, target).await;
    }
    scrape(net, &parsed).await
}

fn error(status: u16, message: impl Into<String>) -> (u16, Value) {
    (status, json!({ "error": message.into() }))
}

/// The TS scheme test `^[a-z][a-z0-9+.-]*:(?!\d)`, case-insensitive.
fn has_scheme(input: &str) -> bool {
    let mut chars = input.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    for c in chars.by_ref() {
        if c == ':' {
            // `example.com:443/x` is a host and port, not a scheme (the TS `(?!\d)`).
            return !chars.next().is_some_and(|next| next.is_ascii_digit());
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

/// Parses the target, taking a scheme-less host as https; only http(s) passes.
fn parse_target(target: &str) -> Result<Url, &'static str> {
    let candidate = if has_scheme(target) {
        target.to_owned()
    } else {
        format!("https://{target}")
    };
    let parsed = Url::parse(&candidate).map_err(|_| "invalid url")?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("url must be http(s)"),
    }
}

/// The guarded page fetch, then the citation reading and the paper-or-refuse gate.
async fn scrape<N: Network>(net: &N, url: &Url) -> (u16, Value) {
    let options = FetchOptions {
        accept: PAGE_ACCEPT.to_owned(),
        limits: DEFAULT_FETCH_LIMITS,
    };
    let fetched = match safe_fetch_via(net, url.as_str(), &options).await {
        Ok(fetched) => fetched,
        Err(failure) => {
            let message = if failure.status == 403 {
                format!("{}{BLOCKED_HINT}", failure.message)
            } else {
                failure.message
            };
            return error(failure.status, message);
        }
    };
    let html = String::from_utf8_lossy(&fetched.body);
    let meta = extract_page_metadata(&html, &fetched.url);
    if let Some(refusal) = page_import_refusal(&meta) {
        return error(422, refusal);
    }
    serde_json::to_value(&meta).map_or_else(|_| error(500, "Internal error."), |value| (200, value))
}

/// GET on one of our fixed hosts with a deadline; None on any failure or non-2xx.
async fn fixed_get(client: &Client, url: &str, agent: Option<&str>) -> Option<Response> {
    let mut request = client.get(url).timeout(FIXED_HOST_TIMEOUT);
    if let Some(agent) = agent {
        request = request.header("User-Agent", agent);
    }
    request
        .send()
        .await
        .ok()
        .filter(|response| response.status().is_success())
}

/// The arXiv API entry for `id`, or None when arXiv is unreachable or has no such entry.
async fn fetch_arxiv(
    client: &Client,
    upstreams: &MetaUpstreams,
    id: &str,
    url: &str,
) -> Option<Value> {
    let request_url = format!("{}?id_list={}", upstreams.arxiv_query, encode_component(id));
    let response = fixed_get(client, &request_url, None).await?;
    let xml = response.text().await.ok()?;
    arxiv_meta(&xml, id, url)
}

/// Reads the first `<entry>` of an arXiv Atom feed with the TS's string rules.
fn arxiv_meta(xml: &str, id: &str, url: &str) -> Option<Value> {
    let entry = elements(xml, "entry").into_iter().next()?;
    let title = collapse_ws(&pick(entry, "title"));
    if title.is_empty() {
        return None;
    }
    let published = pick(entry, "published");
    let year = published
        .chars()
        .take(4)
        .collect::<String>()
        .trim()
        .parse::<i32>()
        .ok()
        .filter(|year| *year != 0);
    let doi = doi_text(entry).map(str::trim).filter(|doi| !doi.is_empty());
    let authors: Vec<String> = elements(entry, "name")
        .into_iter()
        .map(|name| decode_html_entities(name.trim()))
        .filter(|name| !name.is_empty())
        .collect();
    let summary = collapse_ws(&pick(entry, "summary"));
    let mut fields = vec![
        ("title", json!(title)),
        ("authors", json!(authors)),
        ("arxivId", json!(id)),
        ("url", json!(url)),
        ("hasCitationMeta", json!(true)),
    ];
    if let Some(year) = year {
        fields.push(("year", json!(year)));
    }
    if let Some(doi) = doi {
        fields.push(("doi", json!(doi)));
    }
    if !summary.is_empty() {
        fields.push(("abstract", json!(summary)));
    }
    Some(object(fields))
}

/// The Crossref record for `doi`, or the 404 the TS gives when Crossref has none.
async fn crossref(
    client: &Client,
    upstreams: &MetaUpstreams,
    doi: &str,
    target: &str,
) -> (u16, Value) {
    let request_url = format!("{}/{}", upstreams.crossref_works, encode_component(doi));
    let Some(response) = fixed_get(client, &request_url, Some(CROSSREF_AGENT)).await else {
        return not_in_crossref(doi);
    };
    // A body that is not JSON (a maintenance page, a dropped connection) or is
    // JSON `null` counts as a miss, like a non-ok answer, as in the TS.
    let text = response.text().await.unwrap_or_default();
    let Some(body) = serde_json::from_str::<Value>(&text)
        .ok()
        .filter(|body| !body.is_null())
    else {
        return not_in_crossref(doi);
    };
    let work = serde_json::from_value::<CrossrefEnvelope>(body)
        .ok()
        .and_then(|envelope| envelope.message)
        .unwrap_or_default();
    (200, crossref_meta(&work, doi, target))
}

fn not_in_crossref(doi: &str) -> (u16, Value) {
    error(
        404,
        format!(
            "DOI {doi} not found in Crossref (some ACM DOIs are unregistered). Enter the paper manually or try the arXiv id."
        ),
    )
}

fn crossref_meta(work: &CrossrefWork, doi: &str, target: &str) -> Value {
    let title = work
        .title
        .as_ref()
        .and_then(|titles| titles.first())
        .map_or(doi, String::as_str);
    let authors: Vec<String> = work
        .author
        .iter()
        .flatten()
        .map(author_name)
        .filter(|name| !name.is_empty())
        .collect();
    let year = work
        .issued
        .as_ref()
        .and_then(|issued| issued.date_parts.as_ref())
        .and_then(|parts| parts.first())
        .and_then(|row| row.first())
        .copied()
        .flatten();
    let venue = work
        .container_title
        .as_ref()
        .and_then(|titles| titles.first())
        .cloned();
    let summary = work
        .summary
        .as_deref()
        .map(|text| collapse_ws(&strip_tags(text)).trim().to_owned());
    let mut fields = vec![
        ("title", json!(collapse_ws(title))),
        ("authors", json!(authors)),
        ("doi", json!(work.doi.as_deref().unwrap_or(doi))),
        ("url", json!(work.url.as_deref().unwrap_or(target))),
    ];
    if let Some(year) = year {
        fields.push(("year", json!(year)));
    }
    if let Some(venue) = venue {
        fields.push(("venue", json!(venue)));
    }
    if let Some(summary) = summary {
        fields.push(("abstract", json!(summary)));
    }
    object(fields)
}

fn author_name(author: &CrossrefAuthor) -> String {
    match author.name.as_deref() {
        Some(name) => name.to_owned(),
        None => [author.given.as_deref(), author.family.as_deref()]
            .into_iter()
            .flatten()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// The contents of every `<name>…</name>` in `xml`, in order, without overlap.
fn elements<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let mut found = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let body = &rest[start + open.len()..];
        let Some(end) = body.find(&close) else {
            break;
        };
        found.push(&body[..end]);
        rest = &body[end + close.len()..];
    }
    found
}

/// The first `<tag>` text, trimmed then entity-decoded; empty when absent.
fn pick(xml: &str, tag: &str) -> String {
    let text = elements(xml, tag).into_iter().next().unwrap_or("").trim();
    decode_html_entities(text)
}

/// The text of the first `<arxiv:doi …>` element, which may carry attributes.
fn doi_text(entry: &str) -> Option<&str> {
    const OPEN: &str = "<arxiv:doi";
    let start = entry.find(OPEN)? + OPEN.len();
    let after = &entry[start..];
    let body = &after[after.find('>')? + 1..];
    Some(&body[..body.find("</arxiv:doi>")?])
}

/// `replace(/\s+/g, " ")`: each run of whitespace becomes one space, ends kept.
fn collapse_ws(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !in_run {
                out.push(' ');
            }
            in_run = true;
        } else {
            out.push(ch);
            in_run = false;
        }
    }
    out
}

/// `replace(/<[^>]+>/g, "")`: drops each `<…>` with at least one character inside.
fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(lt) = rest.find('<') {
        out.push_str(&rest[..lt]);
        let after = &rest[lt + 1..];
        match after.find('>') {
            Some(gt) if gt > 0 => rest = &after[gt + 1..],
            _ => {
                out.push('<');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `encodeURIComponent`: everything but the unreserved set is percent-encoded.
fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

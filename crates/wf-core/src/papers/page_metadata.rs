//! Reading a paper's details off a web page: citation tags, Dublin Core, JSON-LD, OpenGraph.
//! Pure string work, no DOM. Port of `features/papers/domain/page-metadata.ts`.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::LazyLock;

use regex_lite::{Captures, Regex};

use super::js_regex::compile;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Interstitials that answer 200 with an ordinary-looking title.
pub const BOT_WALL_PATTERN: &str = r"(?i)client challenge|verifying your browser|just a moment|attention required|are you a robot|access denied|captcha|checking your browser";

/// Everything a page says about the paper it carries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PageMetadata {
    /// Title with the site's name suffix removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub title: Option<String>,
    /// Author names, de-duplicated case-insensitively.
    pub authors: Vec<String>,
    /// Year of the publish date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = i32))]
    pub year: Option<i32>,
    /// Journal, conference or site name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub venue: Option<String>,
    /// DOI without its resolver prefix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub doi: Option<String>,
    /// arXiv id, from the tag or the page address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub arxiv_id: Option<String>,
    /// Abstract with whitespace collapsed.
    #[serde(rename = "abstract", default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub r#abstract: Option<String>,
    /// The page address the metadata came from.
    pub url: String,
    /// The page carries bibliographic tags (Highwire / Dublin Core).
    pub has_citation_meta: bool,
    /// The page says it is an article: JSON-LD, `og:type=article`, or a publish time.
    pub is_article: bool,
}

/// schema.org types that are a piece of writing someone could cite (lower case).
const ARTICLE_TYPES: [&str; 9] = [
    "article",
    "blogposting",
    "scholarlyarticle",
    "newsarticle",
    "techarticle",
    "report",
    "socialmediaposting",
    "creativework",
    "thesis",
];

// Each pattern is a literal; `None` (never reached) means no match, not a panic.
static BOT_WALL: LazyLock<Option<Regex>> = LazyLock::new(|| compile(BOT_WALL_PATTERN).ok());
static META_TAG: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)<meta\b[^>]*>").ok());
static JSON_LD: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(r#"(?i)<script\b[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>([\s\S]*?)</script>"#)
        .ok()
});
static HTML_TITLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)<title[^>]*>([\s\S]*?)</title>").ok());
static WHITESPACE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\s+").ok());
static YEAR: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"\b(1[89][0-9]{2}|2[0-9]{3})\b").ok());
static SITE_SUFFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(.*\S)\s+[|\-–—·:]\s+([^|\-–—·:]+)$").ok());
static ARXIV_AT: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)arxiv\.org/(?:abs|pdf)/").ok());
static ARXIV_ID: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"^[A-Za-z0-9_./-]+$").ok());
static ARXIV_VERSION: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)v[0-9]+$").ok());
static DOI_PREFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)^(?:https?://(?:dx\.)?doi\.org/|doi:)").ok());
static HTTP_URL: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)^https?://").ok());
static HEX_ENTITY: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)&#x([0-9a-f]+);").ok());
static DEC_ENTITY: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"&#([0-9]+);").ok());
// Order matters: `&amp;` is last so `&amp;lt;` decodes to `&lt;`, not `<`.
static NAMED_ENTITIES: LazyLock<Option<Vec<(Regex, &'static str)>>> = LazyLock::new(|| {
    [
        (r"(?i)&nbsp;", " "),
        (r"(?i)&lt;", "<"),
        (r"(?i)&gt;", ">"),
        (r"(?i)&quot;", "\""),
        (r"(?i)&apos;", "'"),
        (r"&#0?39;", "'"),
        (r"(?i)&amp;", "&"),
    ]
    .into_iter()
    .map(|(pattern, with)| compile(pattern).ok().map(|re| (re, with)))
    .collect()
});

type Tags = HashMap<String, Vec<String>>;

/// Decodes the HTML entities a page title or meta value can carry.
#[must_use]
pub fn decode_html_entities(text: &str) -> String {
    let mut out = replace_codes(&HEX_ENTITY, text, 16);
    out = replace_codes(&DEC_ENTITY, &out, 10);
    if let Some(named) = NAMED_ENTITIES.as_ref() {
        for (re, with) in named {
            out = re.replace_all(&out, *with).into_owned();
        }
    }
    out
}

/// Replaces numeric escapes; a code point that is not a char becomes nothing, not an error.
fn replace_codes(re: &LazyLock<Option<Regex>>, text: &str, radix: u32) -> String {
    let Some(re) = re.as_ref() else {
        return text.to_string();
    };
    re.replace_all(text, |caps: &Captures| {
        caps.get(1)
            .and_then(|m| u32::from_str_radix(m.as_str(), radix).ok())
            .and_then(char::from_u32)
            .map_or_else(String::new, |c| c.to_string())
    })
    .into_owned()
}

fn collapse(text: &str) -> String {
    match WHITESPACE.as_ref() {
        Some(re) => re.replace_all(text, " ").into_owned(),
        None => text.to_string(),
    }
}

/// Decodes, collapses whitespace and trims; an empty result is absent.
fn text_of(raw: &str) -> Option<String> {
    let collapsed = collapse(&decode_html_entities(raw));
    let trimmed = collapsed.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn text(value: Option<&Value>) -> Option<String> {
    value?.as_str().and_then(text_of)
}

fn name_of(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) => text_of(s),
        Value::Object(o) => text(o.get("name")),
        _ => None,
    }
}

/// JS `asArray`: arrays as-is, null/absent as empty, anything else as one item.
fn as_array(value: Option<&Value>) -> Vec<&Value> {
    match value {
        Some(Value::Array(items)) => items.iter().collect(),
        None | Some(Value::Null) => Vec::new(),
        Some(other) => vec![other],
    }
}

fn field<'a>(article: Option<&'a Map<String, Value>>, key: &str) -> Option<&'a Value> {
    article?.get(key)
}

fn is_article_node(node: &Map<String, Value>) -> bool {
    as_array(node.get("@type"))
        .into_iter()
        .filter_map(Value::as_str)
        .any(|t| ARTICLE_TYPES.contains(&t.to_lowercase().as_str()))
}

/// The article nodes in a page's JSON-LD, flattened out of `@graph` and arrays.
fn json_ld_articles(html: &str) -> Vec<Map<String, Value>> {
    let Some(re) = JSON_LD.as_ref() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for caps in re.captures_iter(html) {
        let Some(body) = caps.get(1) else {
            continue;
        };
        // A broken block on someone else's page is not our error.
        let Ok(parsed) = serde_json::from_str::<Value>(body.as_str().trim()) else {
            continue;
        };
        let mut queue: VecDeque<&Value> = as_array(Some(&parsed)).into();
        while let Some(node) = queue.pop_front() {
            let Value::Object(rec) = node else {
                continue;
            };
            queue.extend(as_array(rec.get("@graph")));
            if is_article_node(rec) {
                out.push(rec.clone());
            }
        }
    }
    out
}

/// `<meta name|property|itemprop=… content=…>` keyed by lower-cased name.
fn meta_tags(html: &str) -> Tags {
    let mut tags = Tags::new();
    let Some(re) = META_TAG.as_ref() else {
        return tags;
    };
    for found in re.find_iter(html) {
        let tag = found.as_str();
        let Some(name) = attr(tag, "name")
            .or_else(|| attr(tag, "property"))
            .or_else(|| attr(tag, "itemprop"))
        else {
            continue;
        };
        let Some(content) = attr(tag, "content") else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        tags.entry(name.to_lowercase())
            .or_default()
            .push(decode_html_entities(&content));
    }
    tags
}

fn attr(tag: &str, name: &str) -> Option<String> {
    capture(&format!(r#"(?i)\b{name}\s*=\s*"([^"]*)""#), tag)
        .or_else(|| capture(&format!(r#"(?i)\b{name}\s*=\s*'([^']*)'"#), tag))
}

fn capture(pattern: &str, text: &str) -> Option<String> {
    let re = compile(pattern).ok()?;
    re.captures(text)?.get(1).map(|m| m.as_str().to_string())
}

/// First non-empty trimmed value among `keys`, reading only each key's first tag.
fn first(meta: &Tags, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        meta.get(*key)?
            .first()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    })
}

fn html_title(html: &str) -> Option<String> {
    let raw = HTML_TITLE.as_ref()?.captures(html)?.get(1)?;
    text_of(raw.as_str())
}

fn year_of(date: Option<&str>) -> Option<i32> {
    let caps = YEAR.as_ref()?.captures(date?)?;
    caps.get(1)?.as_str().parse().ok()
}

/// A site suffix ("Attention | Lil'Log") is the site's name, not the article's.
fn strip_site_suffix(title: String, site_name: Option<&str>) -> String {
    let stripped = site_name.and_then(|name| {
        let site = name.trim().to_lowercase();
        let caps = SITE_SUFFIX.as_ref()?.captures(&title)?;
        let head = caps.get(1)?.as_str();
        let tail = caps.get(2)?.as_str();
        (tail.trim().to_lowercase() == site && head.encode_utf16().count() >= 4)
            .then(|| head.to_string())
    });
    stripped.unwrap_or(title)
}

/// Drops empty items and case-insensitive repeats, keeping first occurrences.
fn unique(list: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    list.into_iter()
        .filter(|s| !s.is_empty() && seen.insert(s.to_lowercase()))
        .collect()
}

fn authors_of(meta: &Tags, ld_authors: Vec<String>) -> Vec<String> {
    let raw = meta
        .get("citation_author")
        .cloned()
        .or_else(|| meta.get("dc.creator").cloned())
        .or_else(|| (!ld_authors.is_empty()).then_some(ld_authors))
        .or_else(|| meta.get("author").cloned())
        .or_else(|| meta.get("article:author").cloned())
        .or_else(|| meta.get("parsely-author").cloned())
        .unwrap_or_default();
    // `article:author` is often a profile URL rather than a name.
    let names: Vec<String> = raw
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !HTTP_URL.as_ref().is_some_and(|re| re.is_match(a)))
        .collect();
    unique(names)
}

fn doi_of(meta: &Tags) -> Option<String> {
    let raw = first(
        meta,
        &["citation_doi", "dc.identifier.doi", "doi", "prism.doi"],
    )?;
    let stripped = match DOI_PREFIX.as_ref() {
        Some(re) => re.replace(&raw, "").into_owned(),
        None => raw,
    };
    let doi = stripped.trim();
    (!doi.is_empty()).then(|| doi.to_string())
}

/// The arXiv id at the end of an abs / pdf URL, without its version or `.pdf`.
fn arxiv_id_from_url(url: &str) -> Option<String> {
    let at = ARXIV_AT.as_ref()?.find(url)?;
    let rest = url.get(at.end()..)?;
    if !ARXIV_ID.as_ref()?.is_match(rest) {
        return None;
    }
    let stem = if rest.to_ascii_lowercase().ends_with(".pdf") {
        rest.get(..rest.len().saturating_sub(4)).unwrap_or(rest)
    } else {
        rest
    };
    let id = match ARXIV_VERSION.as_ref() {
        Some(re) => re.replace(stem, "").into_owned(),
        None => stem.to_string(),
    };
    (!id.is_empty()).then_some(id)
}

/// The publication date: citation tags, then JSON-LD, then generic article tags.
fn publication_date(meta: &Tags, ld: Option<&Map<String, Value>>) -> Option<String> {
    first(
        meta,
        &[
            "citation_publication_date",
            "citation_date",
            "citation_online_date",
            "dc.date",
        ],
    )
    .or_else(|| text(field(ld, "datePublished")))
    .or_else(|| {
        first(
            meta,
            &[
                "article:published_time",
                "og:published_time",
                "date",
                "parsely-pub-date",
            ],
        )
    })
    .or_else(|| text(field(ld, "dateCreated")))
}

/// The abstract, whitespace collapsed: citation tags, then JSON-LD, then generic descriptions.
fn abstract_of(meta: &Tags, ld: Option<&Map<String, Value>>) -> Option<String> {
    first(meta, &["citation_abstract", "dc.description"])
        .or_else(|| text(field(ld, "description")))
        .or_else(|| {
            first(
                meta,
                &["og:description", "description", "twitter:description"],
            )
        })
        .map(|a| collapse(&a))
}

/// Everything a page says about the paper it carries.
#[must_use]
pub fn extract_page_metadata(html: &str, url: &str) -> PageMetadata {
    let meta = meta_tags(html);
    let article = json_ld_articles(html).into_iter().next();
    let ld = article.as_ref();

    let site_name = first(&meta, &["og:site_name", "application-name"])
        .or_else(|| name_of(field(ld, "publisher")));
    let raw_title = first(&meta, &["citation_title", "dc.title"])
        .or_else(|| text(field(ld, "headline")))
        .or_else(|| text(field(ld, "name")))
        .or_else(|| first(&meta, &["og:title", "twitter:title"]))
        .or_else(|| html_title(html));
    let title = raw_title.map(|t| strip_site_suffix(collapse(&t), site_name.as_deref()));

    let ld_authors: Vec<String> = as_array(field(ld, "author"))
        .into_iter()
        .filter_map(|v| name_of(Some(v)))
        .collect();
    let date = publication_date(&meta, ld);

    let has_citation_meta = meta
        .keys()
        .any(|k| k.starts_with("citation_") || k.starts_with("dc."));
    let is_article = ld.is_some()
        || first(&meta, &["og:type"]).is_some_and(|t| t.to_lowercase() == "article")
        || first(&meta, &["article:published_time"]).is_some();
    let venue = first(
        &meta,
        &[
            "citation_journal_title",
            "citation_conference_title",
            "dc.source",
        ],
    )
    .or_else(|| {
        if is_article && !has_citation_meta {
            site_name.clone()
        } else {
            None
        }
    });

    let abstract_text = abstract_of(&meta, ld);

    PageMetadata {
        title,
        authors: authors_of(&meta, ld_authors),
        year: year_of(date.as_deref()),
        venue,
        doi: doi_of(&meta),
        arxiv_id: first(&meta, &["citation_arxiv_id"]).or_else(|| arxiv_id_from_url(url)),
        r#abstract: abstract_text,
        url: url.to_string(),
        has_citation_meta,
        is_article,
    }
}

/// Whether a page is worth importing as a paper, and if not, why, in words the user can act on.
#[must_use]
pub fn page_import_refusal(meta: &PageMetadata) -> Option<&'static str> {
    let title = meta.title.as_deref().unwrap_or("");
    if BOT_WALL.as_ref().is_some_and(|re| re.is_match(title)) {
        return Some("That site blocked automated access. Import by DOI or arXiv id instead.");
    }
    if title.is_empty() {
        return Some("That page has no title to file the paper under. Add the paper manually.");
    }
    if meta.has_citation_meta || meta.is_article {
        return None;
    }
    Some(
        "That page does not look like a paper or an article — it has no citation tags and does not say it is an article. Import by DOI or arXiv id, or add the paper manually.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_static_regex_compiles() {
        // A pattern regex-lite rejects becomes None and silently never matches.
        for (name, ok) in [
            ("BOT_WALL", BOT_WALL.is_some()),
            ("META_TAG", META_TAG.is_some()),
            ("JSON_LD", JSON_LD.is_some()),
            ("HTML_TITLE", HTML_TITLE.is_some()),
            ("WHITESPACE", WHITESPACE.is_some()),
            ("YEAR", YEAR.is_some()),
            ("SITE_SUFFIX", SITE_SUFFIX.is_some()),
            ("ARXIV_AT", ARXIV_AT.is_some()),
            ("ARXIV_ID", ARXIV_ID.is_some()),
            ("ARXIV_VERSION", ARXIV_VERSION.is_some()),
            ("DOI_PREFIX", DOI_PREFIX.is_some()),
            ("HTTP_URL", HTTP_URL.is_some()),
            ("HEX_ENTITY", HEX_ENTITY.is_some()),
            ("DEC_ENTITY", DEC_ENTITY.is_some()),
            ("NAMED_ENTITIES", NAMED_ENTITIES.is_some()),
        ] {
            assert!(ok, "{name} does not compile");
        }
    }

    #[test]
    fn page_metadata_deserializes_camel_case() {
        let meta: PageMetadata = serde_json::from_str(
            r#"{"authors":[],"url":"https://x.org","hasCitationMeta":true,"isArticle":false,"arxivId":"2305.12345"}"#,
        )
        .unwrap();
        assert_eq!(meta.arxiv_id.as_deref(), Some("2305.12345"));
        assert_eq!(meta.title, None);
        assert!(meta.has_citation_meta);
    }
}

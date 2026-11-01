//! Page titles from HTML. Ported from packages/core/src/net/page-title.ts.

use std::sync::LazyLock;

use regex::{Captures, Regex};

use super::is_js_space;

/// JS `\s` and `trim()` whitespace, as the inside of a regex character class.
const JS_SPACE: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// Longer than this is a page dumping its whole description into the title.
pub const MAX_TITLE: usize = 300;

/// How much of a document is scanned for a title. Counted in UTF-16 units, as JS did.
pub const PAGE_TITLE_SCAN_CHARS: usize = 200_000;

/// A title and whether it looks like a challenge page rather than the article.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageTitle {
    /// The cleaned title text.
    pub title: String,
    /// True when the title looks like a bot wall, not the article.
    pub suspect: bool,
}

/// Case-insensitive ASCII-only letter classes, since JS `/i` without `u` is ASCII-only.
fn ascii_ci(word: &str) -> String {
    word.chars()
        .map(|c| {
            if c.is_ascii_alphabetic() {
                format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase())
            } else {
                regex::escape(&c.to_string())
            }
        })
        .collect()
}

/// One entity: a hex reference, a decimal reference, or a name (TS `/&(?:#x(hex)|#(\d+)|([a-z]+));/gi`).
static ENTITY: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new("&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));").ok());

static BOT_WALL: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(&bot_wall_pattern()).ok());
static IMAGE_EXT: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(&image_ext_pattern()).ok());
static META_TAG: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!("<{}(?-u:\\b)[^>]*>", ascii_ci("meta"))).ok());
static TITLE_ELEMENT: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        "<{}[^>]*>((?s:.)*?)</{}>",
        ascii_ci("title"),
        ascii_ci("title")
    ))
    .ok()
});
static JS_RUN: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!("[{}]+", JS_SPACE)).ok());

static PROPERTY_DOUBLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("property", Quote::Double));
static PROPERTY_SINGLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("property", Quote::Single));
static PROPERTY_BARE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("property", Quote::Bare));
static NAME_DOUBLE: LazyLock<Option<Regex>> = LazyLock::new(|| attr_regex("name", Quote::Double));
static NAME_SINGLE: LazyLock<Option<Regex>> = LazyLock::new(|| attr_regex("name", Quote::Single));
static NAME_BARE: LazyLock<Option<Regex>> = LazyLock::new(|| attr_regex("name", Quote::Bare));
static ITEMPROP_DOUBLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("itemprop", Quote::Double));
static ITEMPROP_SINGLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("itemprop", Quote::Single));
static ITEMPROP_BARE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("itemprop", Quote::Bare));
static CONTENT_DOUBLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("content", Quote::Double));
static CONTENT_SINGLE: LazyLock<Option<Regex>> =
    LazyLock::new(|| attr_regex("content", Quote::Single));
static CONTENT_BARE: LazyLock<Option<Regex>> = LazyLock::new(|| attr_regex("content", Quote::Bare));

/// Which quoting style an attribute value uses.
#[derive(Clone, Copy)]
enum Quote {
    Double,
    Single,
    Bare,
}

/// The attributes read off a `<meta>` tag.
#[derive(Clone, Copy)]
enum Attr {
    Property,
    Name,
    Itemprop,
    Content,
}

impl Attr {
    /// The double-quoted, single-quoted and bare regexes for this attribute, in that order.
    fn regexes(self) -> [&'static LazyLock<Option<Regex>>; 3] {
        match self {
            Attr::Property => [&PROPERTY_DOUBLE, &PROPERTY_SINGLE, &PROPERTY_BARE],
            Attr::Name => [&NAME_DOUBLE, &NAME_SINGLE, &NAME_BARE],
            Attr::Itemprop => [&ITEMPROP_DOUBLE, &ITEMPROP_SINGLE, &ITEMPROP_BARE],
            Attr::Content => [&CONTENT_DOUBLE, &CONTENT_SINGLE, &CONTENT_BARE],
        }
    }
}

/// Decodes the entities a title actually contains.
///
/// One pass, like the TS: an entity's output is not decoded again, so `&#38;lt;` is `&lt;`.
/// Unknown names stay as written. A code point that is a surrogate is `""`, since a Rust
/// `String` cannot hold one (JS keeps a lone surrogate).
#[must_use]
pub fn decode_html_entities(value: &str) -> String {
    let Some(re) = ENTITY.as_ref() else {
        return value.to_string();
    };
    re.replace_all(value, |caps: &Captures| {
        if let Some(hex) = caps.get(1) {
            return safe_code_point(hex.as_str(), 16);
        }
        if let Some(digits) = caps.get(2) {
            return safe_code_point(digits.as_str(), 10);
        }
        let whole = caps.get(0).map_or("", |m| m.as_str());
        caps.get(3)
            .and_then(|name| named_entity(name.as_str()))
            .map_or_else(|| whole.to_string(), str::to_string)
    })
    .into_owned()
}

/// The six names a title uses (TS `NAMED_ENTITIES`), matched ASCII case-insensitively.
fn named_entity(name: &str) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "nbsp" => Some(" "),
        "lt" => Some("<"),
        "gt" => Some(">"),
        "quot" => Some("\""),
        "apos" => Some("'"),
        "amp" => Some("&"),
        _ => None,
    }
}

/// One code point from its digits, or `""` when it is malformed or not a scalar value.
fn safe_code_point(digits: &str, radix: u32) -> String {
    u32::from_str_radix(digits, radix)
        .ok()
        .and_then(char::from_u32)
        .map_or_else(String::new, |c| c.to_string())
}

/// The best title the HTML offers: OpenGraph-style meta first, then `<title>`.
#[must_use]
pub fn extract_page_title(html: &str) -> Option<PageTitle> {
    let head = utf16_prefix(html, PAGE_TITLE_SCAN_CHARS);
    let raw = og_title(head).or_else(|| title_element(head))?;
    let title = clean_title(&raw);
    if title.is_empty() {
        return None;
    }
    let suspect = BOT_WALL.as_ref().is_some_and(|re| re.is_match(&title));
    Some(PageTitle { title, suspect })
}

fn og_title(head: &str) -> Option<String> {
    ["og:title", "twitter:title", "citation_title", "dc.title"]
        .into_iter()
        .find_map(|wanted| meta_content(head, wanted))
}

fn title_element(head: &str) -> Option<String> {
    let re = TITLE_ELEMENT.as_ref()?;
    re.captures(head)?.get(1).map(|m| m.as_str().to_string())
}

/// Decodes, collapses JS whitespace runs to one space, trims, and cuts to `MAX_TITLE`.
fn clean_title(raw: &str) -> String {
    let decoded = decode_html_entities(raw);
    let collapsed = match JS_RUN.as_ref() {
        Some(re) => re.replace_all(&decoded, " ").into_owned(),
        None => decoded,
    };
    let trimmed = collapsed.trim_matches(is_js_space);
    utf16_prefix(trimmed, MAX_TITLE).to_string()
}

/// The longest prefix of `s` within `units` UTF-16 code units, cut on a char boundary.
fn utf16_prefix(s: &str, units: usize) -> &str {
    let mut used = 0usize;
    for (i, c) in s.char_indices() {
        used += c.len_utf16();
        if used > units {
            return s.get(..i).unwrap_or("");
        }
    }
    s
}

/// The content of the first `<meta>` tag whose property, name or itemprop is `wanted`.
fn meta_content(html: &str, wanted: &str) -> Option<String> {
    let re = META_TAG.as_ref()?;
    re.find_iter(html)
        .find_map(|m| meta_tag_content(m.as_str(), wanted))
}

fn meta_tag_content(tag: &str, wanted: &str) -> Option<String> {
    // Only falls through when the attribute is absent, not when it is empty.
    let name = attribute(tag, Attr::Property)
        .or_else(|| attribute(tag, Attr::Name))
        .or_else(|| attribute(tag, Attr::Itemprop))?;
    if name.is_empty() || name.to_lowercase() != wanted {
        return None;
    }
    attribute(tag, Attr::Content)
        .filter(|c| !c.is_empty())
        .map(str::to_string)
}

fn attribute(tag: &str, which: Attr) -> Option<&str> {
    which.regexes().into_iter().find_map(|re| {
        let regex: &Option<Regex> = re;
        regex.as_ref()?.captures(tag)?.get(1).map(|m| m.as_str())
    })
}

/// True when a URL's path ends in an image extension.
#[must_use]
pub fn looks_like_image_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    IMAGE_EXT
        .as_ref()
        .is_some_and(|re| re.is_match(parsed.path()))
}

fn attr_regex(name: &str, quote: Quote) -> Option<Regex> {
    let value = match quote {
        Quote::Double => "\"([^\"]*)\"".to_string(),
        Quote::Single => "'([^']*)'".to_string(),
        Quote::Bare => format!("([^{JS_SPACE}>]+)"),
    };
    Regex::new(&format!(
        "(?-u:\\b){}[{JS_SPACE}]*=[{JS_SPACE}]*{value}",
        ascii_ci(name)
    ))
    .ok()
}

fn bot_wall_pattern() -> String {
    let words = [
        "just a moment",
        "attention required",
        "access denied",
        "client challenge",
        "verifying your browser",
        "are you a robot",
        "checking your browser",
        "please wait",
        "security check",
        "redirecting",
    ];
    let mut alts: Vec<String> = words.iter().map(|w| ascii_ci(w)).collect();
    alts.push(format!("{}[0-9]{{3}}", ascii_ci("error ")));
    alts.push(format!(
        "[0-9]{{3}} (?:{}|{})",
        ascii_ci("forbidden"),
        ascii_ci("not found")
    ));
    format!("^[{JS_SPACE}]*(?:{})(?-u:\\b)", alts.join("|"))
}

fn image_ext_pattern() -> String {
    let alts = [
        ascii_ci("png"),
        format!("{}[eE]?{}", ascii_ci("jp"), ascii_ci("g")),
        ascii_ci("gif"),
        ascii_ci("webp"),
        ascii_ci("avif"),
        ascii_ci("bmp"),
        format!("{}[fF]?", ascii_ci("tif")),
    ];
    format!("\\.(?:{})$", alts.join("|"))
}

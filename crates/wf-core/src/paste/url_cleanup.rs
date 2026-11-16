//! Stripping the tracking off links in a paste.
//!
//! Two halves, and the first is the harder one: finding where a URL in prose
//! actually ends. A greedy match swallows the full stop that ended the sentence,
//! the bracket that wrapped the link, and the `[[` of a wikilink pasted straight
//! behind it. Every trim here hands the cut text back verbatim, so a URL this
//! file declines to shorten comes out exactly as it went in.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::Serialize;

use super::markdown_ranges::markdown_code_ranges;
use super::text_range::{TextRange, index_ranges};
use super::tracking_parameters::{
    SIGNED_URL_PARAMETER_SETS, SiteParameterRemoval, TRACKING_PARAMETERS,
    matches_parameter_pattern, site_parameter_removals,
};
use crate::papers::js_regex::{compile, space_class};
use crate::search::js_text::{is_js_whitespace, utf16_len};

/// What to remove, once the built-in lists and the user's rules are merged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UrlCleanupOptions {
    /// Names removed on every host.
    pub global_parameters: Vec<String>,
    /// Per-host rules.
    pub site_removals: Vec<SiteParameterRemoval>,
}

/// Permissive by design: trailing punctuation is trimmed afterwards, which is
/// far more reliable than trying to say "not sentence-final punctuation" inside
/// the pattern.
static URL_PATTERN: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&format!(r#"(?i)https?://[^{}<>"`\\]+"#, space_class())).ok());

/// Punctuation that is almost always the sentence's, not the URL's.
const TRAILING_PUNCTUATION: &[char] = &['.', ',', ';', ':', '!', '?', '"', '\'', '`'];

/// Closing brackets and the opener each one needs, as `(closer, opener)`.
const BRACKET_PAIRS: &[(char, char)] = &[(')', '('), (']', '['), ('}', '{'), ('>', '<')];

/// A wikilink or Markdown link opener ends a URL. Without this a link pasted
/// flush in front of `[[Note]]` swallows the wikilink and deletes it when the
/// query is rewritten.
static LINK_OPENER: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"\[\[|\[(?:[^\]\[]|\[[^\]\[]*\])*\]\(").ok());

/// The opener a closing bracket pairs with, if `close` is one.
fn bracket_opener(close: char) -> Option<char> {
    BRACKET_PAIRS
        .iter()
        .find(|(closer, _)| *closer == close)
        .map(|&(_, opener)| opener)
}

/// Byte index of the first closing bracket with no earlier opening partner, if any.
fn unmatched_closer(url: &str) -> Option<usize> {
    // Open-bracket depth per opener, in `BRACKET_PAIRS` order.
    let mut depth: Vec<(char, usize)> = BRACKET_PAIRS.iter().map(|&(_, open)| (open, 0)).collect();
    for (index, ch) in url.char_indices() {
        if let Some((_, count)) = depth.iter_mut().find(|(open, _)| *open == ch) {
            *count += 1;
            continue;
        }
        let Some(opener) = bracket_opener(ch) else {
            continue;
        };
        let Some((_, open)) = depth.iter_mut().find(|(known, _)| *known == opener) else {
            continue;
        };
        if *open == 0 {
            return Some(index);
        }
        *open -= 1;
    }
    None
}

/// Where a URL match really ends, and whether shortening it would be a guess.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UrlBoundary<'a> {
    /// The match cut down to where the URL ends.
    pub url: &'a str,
    /// True when the cut reads as URL data just as well as prose. Such a URL is
    /// left uncleaned rather than corrupted under whichever reading is wrong.
    pub ambiguous: bool,
}

/// Cuts a greedy match down to where the URL ends.
#[must_use]
pub fn url_boundary(m: &str) -> UrlBoundary<'_> {
    let mut cut = m.len();
    let mut ambiguous = false;

    if let Some(closer) = unmatched_closer(m) {
        cut = closer;
    }

    let opener = LINK_OPENER
        .as_ref()
        .and_then(|re| re.find(m))
        .filter(|found| found.start() < cut);
    if let Some(found) = opener {
        cut = found.start();
        // `[[` behind a query reads as a pasted wikilink or as a JSON array in a
        // filter parameter, equally well.
        ambiguous = found.as_str() == "[[" && m.get(..cut).unwrap_or_default().contains('?');
    }

    UrlBoundary {
        url: m.get(..cut).unwrap_or_default(),
        ambiguous,
    }
}

/// Trims sentence punctuation, closing emphasis pairs and unbalanced brackets.
#[must_use]
pub fn trim_url_tail(url: &str) -> &str {
    let mut end = url.len();
    while let Some(head) = url.get(..end) {
        let mut rev = head.chars().rev();
        let Some(ch) = rev.next() else {
            break;
        };
        if TRAILING_PUNCTUATION.contains(&ch) {
            end -= 1;
            continue;
        }
        // `**https://x**` — a bold or struck run closing around the link.
        if (ch == '*' || ch == '~') && rev.next() == Some(ch) {
            end -= 2;
            continue;
        }
        if let Some(opener) = bracket_opener(ch) {
            let opened = head.chars().filter(|&c| c == opener).count();
            let closed = head.chars().filter(|&c| c == ch).count();
            // More closers than openers means this one came from the prose, as in
            // "(see https://example.com/a)". A balanced pair is Wikipedia's
            // /wiki/Foo_(film) and stays.
            if closed > opened {
                end -= 1;
                continue;
            }
        }
        break;
    }
    url.get(..end).unwrap_or_default()
}

/// Normalises a rule's domain, accepting `*.site.com` and `site.*`.
fn parse_domain(raw: &str) -> (String, bool) {
    let lowered = raw.trim_matches(is_js_whitespace).to_lowercase();
    let cleaned = lowered.strip_prefix("*.").unwrap_or(lowered.as_str());
    match cleaned.strip_suffix(".*") {
        Some(domain) => (domain.to_string(), true),
        None => (cleaned.to_string(), false),
    }
}

/// Second-level labels that appear in front of a two-letter country suffix.
const COUNTRY_SECOND_LEVEL: &[&str] = &[
    "ac", "co", "com", "edu", "go", "gov", "ne", "net", "or", "org",
];

/// True when `host` is the rule's site, a subdomain of it, or it under another TLD.
#[must_use]
pub fn host_matches_removal(host: &str, removal: &SiteParameterRemoval) -> bool {
    if !removal.any_tld {
        return host == removal.domain || host.ends_with(&format!(".{}", removal.domain));
    }

    let labels: Vec<&str> = host.split('.').collect();
    let wanted: Vec<&str> = removal.domain.split('.').collect();
    let mut start = 0;
    while start + wanted.len() < labels.len() {
        if wanted
            .iter()
            .enumerate()
            .all(|(offset, label)| labels.get(start + offset) == Some(label))
        {
            let index = start + wanted.len();
            let remaining = labels.len() - index;
            // One label covers .com and .se; two must look like .co.uk, so that
            // google.example.com does not match a `google.*` rule.
            if remaining == 1 {
                return true;
            }
            if remaining == 2
                && labels
                    .get(index)
                    .is_some_and(|second| COUNTRY_SECOND_LEVEL.contains(second))
                && labels
                    .get(index + 1)
                    .is_some_and(|country| utf16_len(country) == 2)
            {
                return true;
            }
        }
        start += 1;
    }
    false
}

/// The user's own rules, split by the three shapes they can take.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ParsedLinkRemovals {
    /// Names removed on every host.
    pub global_parameters: Vec<String>,
    /// Per-host rules.
    pub site_removals: Vec<SiteParameterRemoval>,
    /// Hosts whose built-in rules are turned off.
    pub disabled_domains: Vec<String>,
}

/// Parses the user's own removal rules.
///
/// Three shapes, one per line:
///   `fbclid`                 remove that name everywhere
///   `mine.example | a, b`    remove `a` and `b` on that host and its subdomains
///   `!youtube.com`           turn the built-in rules off for that host
/// `#` opens a comment.
#[must_use]
pub fn parse_link_removals(lines: &[String]) -> ParsedLinkRemovals {
    let mut parsed = ParsedLinkRemovals::default();

    for raw in lines {
        let line = raw.trim_matches(is_js_whitespace);
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some(rest) = line.strip_prefix('!') {
            let (domain, _) = parse_domain(rest);
            if !domain.is_empty() {
                parsed.disabled_domains.push(domain);
            }
            continue;
        }

        // A pipe wins over a colon, so `localhost:3000 | debug` is not read as a
        // parameter list starting at the port.
        let Some(separator) = line.find('|').or_else(|| line.find(':')) else {
            if !line
                .chars()
                .any(|ch| is_js_whitespace(ch) || matches!(ch, ',' | '|' | ':'))
            {
                parsed.global_parameters.push(line.to_string());
            }
            continue;
        };

        let (domain, any_tld) = parse_domain(line.get(..separator).unwrap_or_default());
        if domain.is_empty() {
            continue;
        }
        let parameters: Vec<String> = line
            .get(separator + 1..)
            .unwrap_or_default()
            .split(',')
            .map(|name| name.trim_matches(is_js_whitespace))
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect();
        if !parameters.is_empty() {
            parsed.site_removals.push(SiteParameterRemoval {
                domain,
                any_tld,
                parameters,
            });
        }
    }

    parsed
}

/// Merges the built-in lists with the user's rules.
///
/// A `!site` line reaches the built-in rules for that site and every subdomain
/// of it, because those rules are not shown in the settings field and the user
/// cannot be expected to know their exact spelling.
#[must_use]
pub fn build_url_cleanup_options(user_rules: &[String]) -> UrlCleanupOptions {
    let parsed = parse_link_removals(user_rules);
    let disabled = |removal: &SiteParameterRemoval| {
        parsed.disabled_domains.iter().any(|domain| {
            removal.domain == *domain || removal.domain.ends_with(&format!(".{domain}"))
        })
    };

    let mut global_parameters: Vec<String> = TRACKING_PARAMETERS
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    global_parameters.extend(parsed.global_parameters.iter().cloned());

    let mut site_removals: Vec<SiteParameterRemoval> = site_parameter_removals()
        .into_iter()
        .filter(|removal| !disabled(removal))
        .collect();
    site_removals.extend(parsed.site_removals);

    UrlCleanupOptions {
        global_parameters,
        site_removals,
    }
}

/// One query pair: its decoded name, and the text it was written as.
struct QueryPair<'a> {
    /// The name after percent-decoding, with `+` read as a space.
    name: String,
    /// The pair exactly as it appeared in the URL.
    raw: &'a str,
}

/// Decodes one hex digit pair, as `decodeURIComponent` reads a `%XX` escape.
fn hex_value(byte: u8) -> Option<u8> {
    char::from(byte)
        .to_digit(16)
        .and_then(|digit| u8::try_from(digit).ok())
}

/// Decodes `value` the way `decodeURIComponent` does; `None` where JS throws.
fn decode_uri_component(value: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut input = value.bytes();
    while let Some(byte) = input.next() {
        if byte != b'%' {
            bytes.push(byte);
            continue;
        }
        let high = input.next().and_then(hex_value)?;
        let low = input.next().and_then(hex_value)?;
        bytes.push(high * 16 + low);
    }
    String::from_utf8(bytes).ok()
}

/// Splits a raw query into pairs, keeping each pair's original encoding.
fn split_query(query: &str) -> Vec<QueryPair<'_>> {
    if query.is_empty() {
        return Vec::new();
    }
    query
        .split('&')
        .map(|raw| {
            let encoded = raw.split_once('=').map_or(raw, |(name, _)| name);
            // A malformed percent escape is left as written rather than dropped.
            let name = decode_uri_component(&encoded.replace('+', " "))
                .unwrap_or_else(|| encoded.to_string());
            QueryPair { name, raw }
        })
        .collect()
}

/// True when the pairs contain every name of some signed-URL parameter set.
fn is_signed_url(pairs: &[QueryPair<'_>]) -> bool {
    let names: HashSet<String> = pairs.iter().map(|pair| pair.name.to_lowercase()).collect();
    SIGNED_URL_PARAMETER_SETS
        .iter()
        .any(|set| set.iter().all(|name| names.contains(&name.to_lowercase())))
}

/// Drops a scroll-to-text fragment while keeping a real anchor. Browsers append
/// these when you copy a link to highlighted text: long, brittle, and never
/// wanted in a note.
fn clean_fragment(fragment: &str) -> &str {
    let Some(marker) = fragment.find(":~:") else {
        return fragment;
    };
    let remainder = fragment.get(..marker).unwrap_or_default();
    if remainder == "#" { "" } else { remainder }
}

/// The text after `https://` or `http://`, matched ASCII case-insensitively.
fn after_http_scheme(raw: &str) -> Option<&str> {
    ["https://", "http://"].into_iter().find_map(|scheme| {
        let head = raw.get(..scheme.len())?;
        if head.eq_ignore_ascii_case(scheme) {
            raw.get(scheme.len()..)
        } else {
            None
        }
    })
}

/// The host of an `http(s)` URL after its scheme, or `None` where a URL parser
/// would refuse the address.
fn plain_host(rest: &str) -> Option<&str> {
    let authority_end = rest.find(['/', '?', '#', '\\']).unwrap_or(rest.len());
    let authority = rest.get(..authority_end)?;
    // Userinfo ends at the last `@`, so a password may hold one.
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, after)| after);

    let (host, port) = if host_port.starts_with('[') {
        let close = host_port.find(']')?;
        let host = host_port.get(..=close)?;
        let after = host_port.get(close + 1..)?;
        if after.is_empty() {
            (host, None)
        } else {
            (host, Some(after.strip_prefix(':')?))
        }
    } else {
        match host_port.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (host_port, None),
        }
    };

    if host.is_empty() {
        return None;
    }
    if let Some(port) = port {
        let digits = port.bytes().all(|byte| byte.is_ascii_digit());
        if !port.is_empty() && (!digits || port.parse::<u16>().is_err()) {
            return None;
        }
    }
    if host
        .chars()
        .any(|ch| " <>^|%".contains(ch) || ch.is_control())
    {
        return None;
    }
    Some(host)
}

/// Cleans one URL, returning it byte for byte when nothing is removed so that
/// links needing no work keep their exact original spelling.
///
/// There is no URL parser here: only `http://` and `https://` addresses with a
/// plausible host are rewritten, and anything else comes back unchanged.
#[must_use]
pub fn clean_url(raw: &str, options: &UrlCleanupOptions) -> String {
    let Some(rest) = after_http_scheme(raw) else {
        return raw.to_string();
    };
    let Some(host) = plain_host(rest) else {
        return raw.to_string();
    };
    let host = host.to_lowercase();

    // The raw string is rewritten rather than a normalised form, so surviving
    // parameters keep their original encoding.
    let hash = raw.find('#');
    let fragment = hash.and_then(|index| raw.get(index..)).unwrap_or_default();
    let without_fragment = hash.and_then(|index| raw.get(..index)).unwrap_or(raw);
    let mark = without_fragment.find('?');
    let base = mark
        .and_then(|index| without_fragment.get(..index))
        .unwrap_or(without_fragment);
    let query = mark
        .and_then(|index| without_fragment.get(index + 1..))
        .unwrap_or_default();
    let pairs = split_query(query);

    if is_signed_url(&pairs) {
        return raw.to_string();
    }

    let removed = |pair: &QueryPair<'_>| {
        matches_parameter_pattern(&pair.name, options.global_parameters.as_slice())
            || options.site_removals.iter().any(|removal| {
                host_matches_removal(&host, removal)
                    && matches_parameter_pattern(&pair.name, removal.parameters.as_slice())
            })
    };

    // A scheme inside the value of a parameter about to be dropped means a second
    // address ran into this one. Removing the parameter would delete the second
    // link outright, so nothing is removed and both survive verbatim.
    if pairs
        .iter()
        .any(|pair| removed(pair) && pair.raw.contains("://"))
    {
        return raw.to_string();
    }

    let kept: Vec<&str> = pairs
        .iter()
        .filter(|pair| !removed(pair))
        .map(|pair| pair.raw)
        .collect();
    let kept_query = kept.join("&");
    let query_part = if kept_query.is_empty() {
        String::new()
    } else {
        format!("?{kept_query}")
    };
    format!("{base}{query_part}{}", clean_fragment(fragment))
}

/// The result of cleaning the URLs in a text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UrlCleanupResult {
    /// The text with the URLs shortened.
    pub text: String,
    /// How many URLs were actually shortened.
    pub count: u32,
}

/// The first http(s) match at or after byte `pos`.
fn next_url(text: &str, pos: usize) -> Option<regex_lite::Match<'_>> {
    URL_PATTERN.as_ref()?.find_at(text, pos)
}

/// The spans http(s) addresses occupy, with prose punctuation excluded.
#[must_use]
pub fn http_url_ranges(text: &str) -> Vec<TextRange> {
    let mut ranges = Vec::new();
    let mut pos = 0;
    while let Some(found) = next_url(text, pos) {
        let url = trim_url_tail(url_boundary(found.as_str()).url);
        ranges.push(TextRange {
            start: found.start(),
            end: found.start() + url.len(),
        });
        // Rescan the text the trim gave back, so a URL pasted flush behind this one
        // gets a range of its own.
        pos = found.start() + url.len().max(1);
    }
    ranges
}

/// Cleans every http(s) URL in `text`, including Markdown link destinations.
#[must_use]
pub fn clean_urls_in_text(
    text: &str,
    options: &UrlCleanupOptions,
    protect: &[TextRange],
) -> UrlCleanupResult {
    let mut claimed = protect.to_vec();
    claimed.extend(markdown_code_ranges(text));
    let ranges = index_ranges(&claimed);

    let mut out = String::new();
    let mut cursor = 0;
    let mut count: u32 = 0;
    let mut pos = 0;

    while let Some(found) = next_url(text, pos) {
        let boundary = url_boundary(found.as_str());
        let url = trim_url_tail(boundary.url);

        if boundary.ambiguous {
            // Resume past the whole greedy match: rescanning inside it would clean a
            // URL nested in the very query this match declined to touch.
            pos = found.end();
            continue;
        }
        pos = found.start() + url.len().max(1);

        if ranges.overlaps(found.start(), found.start() + url.len()) {
            continue;
        }

        let cleaned = clean_url(url, options);
        if cleaned == url {
            continue;
        }
        count += 1;
        out.push_str(text.get(cursor..found.start()).unwrap_or_default());
        out.push_str(&cleaned);
        cursor = found.start() + url.len();
    }

    out.push_str(text.get(cursor..).unwrap_or_default());
    UrlCleanupResult { text: out, count }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn options() -> UrlCleanupOptions {
        build_url_cleanup_options(&[])
    }

    #[test]
    fn strips_campaign_and_click_parameters() {
        assert_eq!(
            clean_url(
                "https://www.theverge.com/2026/1/9/story?utm_source=newsletter&utm_medium=email&fbclid=IwAR2x9",
                &options(),
            ),
            "https://www.theverge.com/2026/1/9/story"
        );
    }

    #[test]
    fn keeps_parameters_that_address_content() {
        let url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxAbC123&si=8f2a1c&utm_source=share&t=42";
        assert_eq!(
            clean_url(url, &options()),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxAbC123&t=42"
        );
    }

    #[test]
    fn leaves_scholarly_links_alone() {
        for url in [
            "https://doi.org/10.1000/182",
            "https://arxiv.org/abs/1706.03762v7",
            "https://api.semanticscholar.org/graph/v1/paper/649def34?fields=title,year",
            "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        ] {
            assert_eq!(clean_url(url, &options()), url, "{url}");
        }
    }

    #[test]
    fn site_rule_matches_subdomains_and_any_tld_but_not_impostors() {
        assert_eq!(
            clean_url(
                "https://www.google.co.uk/search?q=obsidian+plugins&client=safari&sca_esv=9f1",
                &options(),
            ),
            "https://www.google.co.uk/search?q=obsidian+plugins"
        );
        let impostor = "https://google.example.com/search?q=a&client=safari";
        assert_eq!(clean_url(impostor, &options()), impostor);
    }

    #[test]
    fn signed_url_and_scroll_fragment() {
        let signed = "https://files.example.com/paper.pdf?X-Amz-Algorithm=AWS4&utm_source=mail&X-Amz-Signature=abcd";
        assert_eq!(clean_url(signed, &options()), signed);
        assert_eq!(
            clean_url(
                "https://example.com/a#results:~:text=the%20finding",
                &options()
            ),
            "https://example.com/a#results"
        );
        assert_eq!(
            clean_url("https://example.com/a#:~:text=the%20finding", &options()),
            "https://example.com/a"
        );
    }

    #[test]
    fn unchanged_url_keeps_its_spelling_and_non_urls_pass_through() {
        let url = "https://example.com/a?B=1&b=2#Frag";
        assert_eq!(clean_url(url, &options()), url);
        assert_eq!(clean_url("not a url", &options()), "not a url");
        assert_eq!(
            clean_url("mailto:a@b.example", &options()),
            "mailto:a@b.example"
        );
        assert_eq!(clean_url("https://", &options()), "https://");
        assert_eq!(clean_url("", &options()), "");
    }

    #[test]
    fn trims_prose_punctuation_but_keeps_balanced_brackets() {
        assert_eq!(
            trim_url_tail("https://example.com/a."),
            "https://example.com/a"
        );
        assert_eq!(
            trim_url_tail("https://example.com/a),"),
            "https://example.com/a"
        );
        assert_eq!(
            trim_url_tail("https://en.wikipedia.org/wiki/Foo_(film)"),
            "https://en.wikipedia.org/wiki/Foo_(film)"
        );
        assert_eq!(
            trim_url_tail("**https://example.com/a**"),
            "**https://example.com/a"
        );
        assert_eq!(trim_url_tail(""), "");
    }

    #[test]
    fn wikilink_pasted_flush_behind_a_url_is_not_swallowed() {
        let boundary = url_boundary("https://example.com/a[[Note]]");
        assert_eq!(boundary.url, "https://example.com/a");
        assert!(!boundary.ambiguous);
    }

    #[test]
    fn undecidable_bracket_after_a_query_leaves_the_url_uncleaned() {
        let text = "https://example.com/a?filter=[[1,2]]&utm_source=x";
        assert_eq!(clean_urls_in_text(text, &options(), &[]).text, text);
    }

    #[test]
    fn cleans_markdown_destination_and_bare_link_in_prose() {
        let result = clean_urls_in_text(
            "See [the story](https://a.example/x?utm_source=n) and https://b.example/y?fbclid=1.",
            &options(),
            &[],
        );
        assert_eq!(
            result.text,
            "See [the story](https://a.example/x) and https://b.example/y."
        );
        assert_eq!(result.count, 2);
    }

    #[test]
    fn url_inside_code_is_left_alone() {
        let text = "```\ncurl https://a.example/x?utm_source=n\n```";
        assert_eq!(clean_urls_in_text(text, &options(), &[]).text, text);
        let inline = "Run `https://a.example/x?utm_source=n` first";
        assert_eq!(clean_urls_in_text(inline, &options(), &[]).text, inline);
    }

    #[test]
    fn second_link_absorbed_into_the_first_match_is_never_deleted() {
        let text = "https://a.example/x?utm_source=n,https://b.example/y?utm_medium=e";
        let result = clean_urls_in_text(text, &options(), &[]);
        assert_eq!(result.text, text);
        assert_eq!(result.count, 0);
    }

    #[test]
    fn two_links_separated_by_markdown_are_both_cleaned() {
        let result = clean_urls_in_text(
            "[a](https://a.example/x?utm_source=n)[b](https://b.example/y?utm_medium=e)",
            &options(),
            &[],
        );
        assert_eq!(
            result.text,
            "[a](https://a.example/x)[b](https://b.example/y)"
        );
        assert_eq!(result.count, 2);
    }

    #[test]
    fn non_ascii_text_and_empty_input_are_preserved() {
        let result = clean_urls_in_text("café https://a.example/x?utm_source=n é", &options(), &[]);
        assert_eq!(result.text, "café https://a.example/x é");
        assert_eq!(result.count, 1);
        let empty = clean_urls_in_text("", &options(), &[]);
        assert_eq!(empty.text, "");
        assert_eq!(empty.count, 0);
        assert!(http_url_ranges("").is_empty());
    }

    #[test]
    fn parses_the_three_shapes_of_user_rule() {
        let lines: Vec<String> = [
            "# a comment",
            "fbclid",
            "mine.example | source, ref",
            "!youtube.com",
            "   ",
        ]
        .iter()
        .map(|line| (*line).to_string())
        .collect();
        let parsed = parse_link_removals(&lines);
        assert_eq!(parsed.global_parameters, vec!["fbclid".to_string()]);
        assert_eq!(parsed.disabled_domains, vec!["youtube.com".to_string()]);
        assert_eq!(parsed.site_removals.len(), 1);
        assert_eq!(
            parsed.site_removals[0].parameters,
            vec!["source".to_string(), "ref".to_string()]
        );
    }

    #[test]
    fn user_rule_adds_a_removal_and_a_bang_line_turns_one_off() {
        let with_user = build_url_cleanup_options(&["mine.example | ref".to_string()]);
        assert_eq!(
            clean_url("https://mine.example/a?ref=x&keep=1", &with_user),
            "https://mine.example/a?keep=1"
        );
        let disabled = build_url_cleanup_options(&["!youtube.com".to_string()]);
        let url = "https://www.youtube.com/watch?v=abc&si=123";
        assert_eq!(clean_url(url, &disabled), url);
    }

    #[test]
    fn every_pattern_compiles() {
        assert!(URL_PATTERN.is_some(), "URL_PATTERN");
        assert!(LINK_OPENER.is_some(), "LINK_OPENER");
    }
}

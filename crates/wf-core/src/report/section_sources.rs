//! Port of `apps/web/src/features/report/lib/section-sources.ts`. Counts the distinct sources a
//! section draft cites: `[[wikilinks]]` to papers or notes, plus `@citekeys`.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex_lite::Regex;

use crate::papers::js_regex::compile;
use crate::vault::page::{extract_wikilinks, normalize_title_key};

/// Pandoc-style keys: `[@smith2020]`, `[@a; @b]`, or a bare `@smith2020` after a space. Group 1 is the key.
static CITE_KEY_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?:^|[\s\[;])@([A-Za-z][\w:.-]*\w)").ok());

/// How many distinct sources a section draft cites. An absent or empty body counts 0.
#[must_use]
pub fn count_section_sources(body: Option<&str>) -> usize {
    let Some(body) = body.filter(|b| !b.is_empty()) else {
        return 0;
    };
    let mut seen: HashSet<String> = HashSet::new();
    for link in extract_wikilinks(body) {
        seen.insert(format!("w:{}", normalize_title_key(&link.target)));
    }
    if let Some(re) = CITE_KEY_RE.as_ref() {
        for caps in re.captures_iter(body) {
            if let Some(key) = caps.get(1) {
                seen.insert(format!("k:{}", key.as_str().to_lowercase()));
            }
        }
    }
    seen.len()
}

#[cfg(test)]
mod tests {
    use super::count_section_sources;

    #[test]
    fn counts_distinct_wikilinks_and_citekeys() {
        let body = "As [[Meng 2022]] shows [@smith2020; @doe_21], and [[meng 2022|again]] @smith2020.";
        assert_eq!(count_section_sources(Some(body)), 3);
    }

    #[test]
    fn ignores_emails_and_empty_bodies() {
        assert_eq!(count_section_sources(Some("mail me at a@b.com")), 0);
        assert_eq!(count_section_sources(None), 0);
        assert_eq!(count_section_sources(Some("")), 0);
    }

    #[test]
    fn citekeys_are_case_insensitive() {
        assert_eq!(count_section_sources(Some("@Smith2020 and @smith2020")), 1);
    }
}

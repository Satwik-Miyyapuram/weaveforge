//! Placeholder titles, filename-derived titles and match keys (TS `features/papers/domain/paper-title.ts`).
//!
//! Regexes go through [`compile`] so `\s` matches JS whitespace; `(?i)` and `\b` are ASCII as in JS.

use std::sync::LazyLock;

use regex_lite::Regex;
use unicode_normalization::UnicodeNormalization;

use crate::papers::js_regex::compile;
use crate::search::js_text::{is_js_whitespace, is_letter_or_number, utf16_len};

/// JS `.`: any character except a line terminator.
const NOT_LINE_END: &str = "[^\n\r\u{2028}\u{2029}]";

/// Titles a publisher or reference manager gives a page or file, not a paper.
static PLACEHOLDER_TITLES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)^catalog(ue)? page$",
        // "SAGE PDF Full Text", "Full Text PDF", "ScienceDirect Full Text PDF"
        r"(?i)^([A-Za-z0-9_]+ )*(full[ -]?text|pdf)( pdf| full[ -]?text)*$",
        r"(?i)^(preprint|accepted|submitted|published) (pdf|version)$",
        r"(?i)^snapshot$",
        r"(?i)^(untitled|document|download|view|pdf|article)$",
        r"(?i)^(just a moment|access denied|attention required|page not found|404 not found|sign in|log ?in)\b",
    ]
    .iter()
    .filter_map(|p| compile(p).ok())
    .collect()
});

/// A trailing reference-manager file extension.
static EXTENSION: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)\.(pdf|html?|epub|djvu)$").ok());

/// `{author} - {year} - {title}`, with JS `.` in place of the line-terminator-free class.
static PREFIXED: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(&format!(
        r"^({NOT_LINE_END}{{1,80}}?) - (\d{{4}}|n\.d\.) - ({NOT_LINE_END}+)$"
    ))
    .ok()
});

/// JS `\s+` runs.
static SPACE_RUN: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\s+").ok());

/// Replaces each run of JS whitespace with one space.
fn collapse_spaces(s: &str) -> String {
    SPACE_RUN
        .as_ref()
        .map_or_else(|| s.to_owned(), |re| re.replace_all(s, " ").into_owned())
}

/// Whether a title is a placeholder rather than a paper's title.
///
/// Deliberately narrow: a real paper may be called "Full Text Search at Scale",
/// so only a title made of nothing but these words counts.
#[must_use]
pub fn is_placeholder_title(title: Option<&str>) -> bool {
    let trimmed = title.unwrap_or("").trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return true;
    }
    let t = collapse_spaces(trimmed);
    PLACEHOLDER_TITLES.iter().any(|re| re.is_match(&t))
}

/// The title inside a reference-manager filename, or the input unchanged.
///
/// `"Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf"` becomes
/// `"Accurate, Large Minibatch SGD"`. A `_ ` subtitle separator becomes `: `.
/// Anything with no extension and no `author - year -` prefix is returned as it was.
#[must_use]
pub fn title_from_file_name(title: &str) -> String {
    let trimmed = title.trim_matches(is_js_whitespace);
    let without_ext = EXTENSION.as_ref().map_or_else(
        || trimmed.to_owned(),
        |re| re.replace(trimmed, "").into_owned(),
    );
    let had_ext = without_ext != trimmed;
    // A prefix over 80 UTF-16 units fails the JS match; the regex counts code points.
    let prefixed = PREFIXED
        .as_ref()
        .and_then(|re| re.captures(&without_ext))
        .filter(|caps| caps.get(1).is_some_and(|m| utf16_len(m.as_str()) <= 80));
    if prefixed.is_none() && !had_ext {
        return title.to_owned();
    }
    let base = prefixed
        .as_ref()
        .and_then(|caps| caps.get(3))
        .map_or(without_ext.as_str(), |m| m.as_str());
    let rest = base.trim_matches(is_js_whitespace);
    let rest = collapse_spaces(&rest.replace("_ ", ": "));
    if rest.is_empty() {
        title.to_owned()
    } else {
        rest
    }
}

/// A title reduced to what identifies it: lower case, letters and digits only,
/// placeholder and filename noise removed. `None` when too short to trust, since
/// "Notes" or "Introduction" names many things.
#[must_use]
pub fn title_key(title: Option<&str>) -> Option<String> {
    let title = title.filter(|t| !t.is_empty())?;
    if is_placeholder_title(Some(title)) {
        return None;
    }
    let lowered = title_from_file_name(title)
        .nfkd()
        .collect::<String>()
        .to_lowercase();
    // Same as JS `.replace(/[^\p{L}\p{N}]+/gu, " ")`: each gap becomes one space.
    let mut spaced = String::with_capacity(lowered.len());
    let mut in_gap = false;
    for ch in lowered.chars() {
        if is_letter_or_number(ch) {
            spaced.push(ch);
            in_gap = false;
        } else if !in_gap {
            spaced.push(' ');
            in_gap = true;
        }
    }
    let key = spaced.trim_matches(is_js_whitespace).to_owned();
    let compact: String = key.chars().filter(|&c| c != ' ').collect();
    (utf16_len(&compact) >= 20).then_some(key)
}

#[cfg(test)]
mod tests {
    use super::{is_placeholder_title, title_from_file_name, title_key};

    #[test]
    fn goyal_filename_becomes_title() {
        assert_eq!(
            title_from_file_name("Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf"),
            "Accurate, Large Minibatch SGD"
        );
    }

    #[test]
    fn sage_pdf_full_text_is_placeholder() {
        assert!(is_placeholder_title(Some("SAGE PDF Full Text")));
    }

    #[test]
    fn full_text_search_at_scale_is_not_placeholder() {
        assert!(!is_placeholder_title(Some("Full Text Search at Scale")));
    }

    #[test]
    fn empty_and_missing_titles_are_placeholders() {
        assert!(is_placeholder_title(None));
        assert!(is_placeholder_title(Some("")));
        assert!(is_placeholder_title(Some("   ")));
    }

    #[test]
    fn short_key_is_none() {
        assert_eq!(title_key(Some("Notes")), None);
    }

    #[test]
    fn placeholder_key_is_none() {
        assert_eq!(title_key(Some("SAGE PDF Full Text")), None);
    }

    #[test]
    fn long_title_key_is_lowercase_words() {
        assert_eq!(
            title_key(Some("Full Text Search at Scale")),
            Some("full text search at scale".to_owned())
        );
    }

    #[test]
    fn underscore_space_becomes_colon_space() {
        assert_eq!(title_from_file_name("Foo_ Bar.pdf"), "Foo: Bar");
    }

    #[test]
    fn no_date_year_prefix_is_stripped() {
        assert_eq!(
            title_from_file_name("Smith - n.d. - Some Title"),
            "Some Title"
        );
    }
}

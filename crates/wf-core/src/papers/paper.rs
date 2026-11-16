//! Pure paper-domain helpers: status, DOI and tag normalization, hashtag reading,
//! and the empty-summary check (TS `features/papers/domain/paper.ts`).
//!
//! Offsets from [`extract_hashtag_refs`] are UTF-16 units, as JS `String` indexes count.

use std::collections::HashSet;

use crate::search::js_text::{is_js_whitespace, is_letter_or_number, utf16_len};

/// Reading status of a paper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PaperStatus {
    /// Not started.
    ToRead,
    /// In progress.
    Reading,
    /// Finished.
    Read,
    /// Skimmed only.
    Skimmed,
}

/// Every `PaperStatus`, in the order TS lists them.
pub const PAPER_STATUSES: &[PaperStatus] = &[
    PaperStatus::ToRead,
    PaperStatus::Reading,
    PaperStatus::Read,
    PaperStatus::Skimmed,
];

/// Prefixes stripped from a DOI, checked in order.
const DOI_PREFIXES: [&str; 4] = [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
];

/// The placeholder older rows hold in place of a summary.
pub const NO_SUMMARY: &str = "No summary yet.";

/// A hashtag with the offset it was found at, for evidence that points at it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct HashtagRef {
    /// Normalized: no leading '#', lowercased.
    pub tag: String,
    /// UTF-16 index of the '#' in the text it was read from.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub index: usize,
    /// UTF-16 length of the matched text, including the '#'.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub length: usize,
}

/// Strips a DOI resolver prefix ignoring ASCII case, or `None` when absent.
fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    if head.eq_ignore_ascii_case(prefix) {
        s.get(prefix.len()..)
    } else {
        None
    }
}

/// Whether a character can appear in a hashtag body: `[\p{L}\p{N}_-]`.
pub(crate) fn is_tag_char(ch: char) -> bool {
    ch == '_' || ch == '-' || is_letter_or_number(ch)
}

/// Trim, strip a DOI URL prefix, and lowercase. `None` for absent or empty input.
#[must_use]
pub fn normalize_doi(doi: Option<&str>) -> Option<String> {
    let doi = doi.filter(|d| !d.is_empty())?;
    let trimmed = doi.trim_matches(is_js_whitespace);
    let bare = DOI_PREFIXES
        .iter()
        .find_map(|p| strip_prefix_ci(trimmed, p))
        .unwrap_or(trimmed);
    Some(bare.to_lowercase())
}

/// Trim, drop leading '#', lowercase, and dedupe (order-preserving).
#[must_use]
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for raw in tags {
        let tag = raw
            .trim_matches(is_js_whitespace)
            .trim_start_matches('#')
            .to_lowercase();
        if !tag.is_empty() && seen.insert(tag.clone()) {
            out.push(tag);
        }
    }
    out
}

/// Pull `#hashtags` out of free text, with the position each was found at.
///
/// Deduped by normalized tag, first occurrence wins, so the offsets match what
/// [`extract_hashtags`] returns in the same order.
#[must_use]
pub fn extract_hashtag_refs(text: Option<&str>) -> Vec<HashtagRef> {
    let Some(text) = text else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    // '#' is not a tag character, so each match starts at a '#' and no '#' is skipped.
    for (start, _) in text.match_indices('#') {
        let body_len: usize = text[start + 1..]
            .chars()
            .take_while(|&ch| is_tag_char(ch))
            .map(char::len_utf8)
            .sum();
        if body_len == 0 {
            continue;
        }
        let matched = &text[start..start + 1 + body_len];
        let tag = matched[1..].to_lowercase();
        if seen.insert(tag.clone()) {
            out.push(HashtagRef {
                tag,
                index: utf16_len(&text[..start]),
                length: utf16_len(matched),
            });
        }
    }
    out
}

/// Pull `#hashtags` out of free text, normalized (no '#', lowercase, deduped).
#[must_use]
pub fn extract_hashtags(text: Option<&str>) -> Vec<String> {
    extract_hashtag_refs(text)
        .into_iter()
        .map(|r| r.tag)
        .collect()
}

/// Whether a paper's summary is missing, only whitespace, or only the old placeholder.
#[must_use]
pub fn is_empty_paper_summary(summary: Option<&str>) -> bool {
    let text = summary.unwrap_or("").trim_matches(is_js_whitespace);
    text.is_empty() || text == NO_SUMMARY
}

/// Checks the rules a new paper must meet (TS `createPaper`): the title is required once
/// trimmed, and a rating, when given, is 1 to 5.
///
/// Returns the trimmed title, or the refusal message the TS `PaperValidationError` carries.
///
/// # Errors
///
/// Fails with `"Paper title is required."` for a blank title, or
/// `"Rating must be between 1 and 5."` for a rating out of range.
pub fn check_new_paper(title: &str, rating: Option<f64>) -> Result<String, String> {
    let trimmed = title.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return Err("Paper title is required.".to_owned());
    }
    if rating.is_some_and(|value| value < 1.0 || value > 5.0) {
        return Err("Rating must be between 1 and 5.".to_owned());
    }
    Ok(trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_doi_strips_url_prefix_and_lowercases() {
        assert_eq!(
            normalize_doi(Some("https://doi.org/10.1145/ABC")),
            Some("10.1145/abc".to_owned())
        );
        assert_eq!(
            normalize_doi(Some("HTTP://DX.DOI.ORG/10.1/X")),
            Some("10.1/x".to_owned())
        );
        assert_eq!(
            normalize_doi(Some("10.1145/abc")),
            Some("10.1145/abc".to_owned())
        );
    }

    #[test]
    fn normalize_doi_absent_or_empty_is_none() {
        assert_eq!(normalize_doi(None), None);
        assert_eq!(normalize_doi(Some("")), None);
    }

    #[test]
    fn normalize_tags_trims_strips_hash_dedupes_in_order() {
        let input: Vec<String> = [" #Beta ", "alpha", "#BETA", "", "#"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        assert_eq!(normalize_tags(&input), vec!["beta", "alpha"]);
    }

    #[test]
    fn extract_hashtags_fixtures() {
        let cases: [(&str, Vec<&str>); 9] = [
            (
                "Key #Disentanglement idea, see #beta-VAE and #beta-VAE again.",
                vec!["disentanglement", "beta-vae"],
            ),
            (
                "#Ünïcode and #日本語 and #a_b-c",
                vec!["ünïcode", "日本語", "a_b-c"],
            ),
            ("case #Tag then #TAG then #tag", vec!["tag"]),
            ("##double hash", vec!["double"]),
            ("a lone # and word#inside", vec!["inside"]),
            ("#2024 #x1", vec!["2024", "x1"]),
            ("trailing punctuation #end. #comma,", vec!["end", "comma"]),
            ("", vec![]),
            ("no tags here", vec![]),
        ];
        for (text, tags) in cases {
            assert_eq!(extract_hashtags(Some(text)), tags, "{text}");
        }
        assert!(extract_hashtags(None).is_empty());
    }

    #[test]
    fn each_ref_offset_points_at_its_first_occurrence() {
        assert_eq!(
            extract_hashtag_refs(Some("#ab then #a then #ab")),
            vec![
                HashtagRef {
                    tag: "ab".to_owned(),
                    index: 0,
                    length: 3
                },
                HashtagRef {
                    tag: "a".to_owned(),
                    index: 9,
                    length: 2
                },
            ]
        );
    }

    #[test]
    fn hashtag_offsets_are_utf16_units() {
        // U+1F600 is two UTF-16 units, so the '#' sits at 3 (2 + space).
        let refs = extract_hashtag_refs(Some("\u{1F600} #a"));
        assert_eq!(refs[0].index, 3);
        assert_eq!(refs[0].length, 2);
    }

    #[test]
    fn empty_summary_covers_missing_blank_and_placeholder() {
        assert!(is_empty_paper_summary(None));
        assert!(is_empty_paper_summary(Some("  \n\t ")));
        assert!(is_empty_paper_summary(Some(" No summary yet. ")));
        assert!(!is_empty_paper_summary(Some("Real notes")));
    }

    #[test]
    fn new_paper_title_is_trimmed_and_required() {
        assert_eq!(
            check_new_paper("  Attention  ", None),
            Ok("Attention".to_owned())
        );
        assert_eq!(
            check_new_paper(" \t ", None),
            Err("Paper title is required.".to_owned())
        );
    }

    #[test]
    fn new_paper_rating_must_be_one_to_five_when_given() {
        assert_eq!(check_new_paper("T", Some(1.0)), Ok("T".to_owned()));
        assert_eq!(check_new_paper("T", Some(5.0)), Ok("T".to_owned()));
        assert_eq!(
            check_new_paper("T", Some(0.0)),
            Err("Rating must be between 1 and 5.".to_owned())
        );
        assert_eq!(
            check_new_paper("T", Some(6.0)),
            Err("Rating must be between 1 and 5.".to_owned())
        );
    }
}

//! Cite and wikilink rules for the markdown editor (TS: `components/markdown/markdown-editor-extensions.ts`).
//!
//! Caret positions and match offsets are UTF-16 units, as CodeMirror counts them.

use serde::Deserialize;

use crate::search::js_text::utf16_len;
use crate::vault::page::{WIKILINK_RE, extract_wikilinks};

/// Most completions the cite and wikilink menus show.
const MAX_COMPLETIONS: usize = 20;

/// A completion as the menus filter it: the fields that are matched on.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CiteCandidate {
    /// The title the menu matches on.
    pub title: String,
    /// The label the menu matches on.
    pub label: String,
    /// Optional extra text shown with the completion.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The target of each `[[link]]` the caret has left, in document order (TS `finishedLinks`).
///
/// A `[[title]]` that resolves to nothing gets its note the moment the caret leaves it. While the
/// caret is still inside the brackets nothing happens: with `closeBrackets` the link is `[[F]]`
/// after one keystroke. `caret` is a UTF-16 offset, or `None` when the editor has no focus, so no
/// link is skipped. `[[title|alias]]` and `[[title#heading]]` name `title`.
#[must_use]
pub fn finished_links(doc: &str, caret: Option<usize>) -> Vec<String> {
    let Some(re) = WIKILINK_RE.as_ref() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    // Last match's byte and UTF-16 offsets, so each offset counts from the one before it.
    let mut cursor = (0_usize, 0_usize);
    for whole in re.find_iter(doc) {
        let index = cursor.1 + utf16_len(&doc[cursor.0..whole.start()]);
        cursor = (whole.start(), index);
        let length = utf16_len(whole.as_str());
        if caret.is_some_and(|c| c > index && c < index + length) {
            continue;
        }
        if let Some(link) = extract_wikilinks(whole.as_str()).into_iter().next() {
            out.push(link.target);
        }
    }
    out
}

/// Indices into `items` of the first completions whose title, label or detail contains `query`,
/// ignoring case (TS `filterCompletions`). At most 20.
#[must_use]
pub fn matching_completions(items: &[CiteCandidate], query: &str) -> Vec<u32> {
    let q = query.to_lowercase();
    items
        .iter()
        .enumerate()
        .filter(|(_, c)| {
            c.title.to_lowercase().contains(&q)
                || c.label.to_lowercase().contains(&q)
                || c.detail
                    .as_deref()
                    .is_some_and(|d| d.to_lowercase().contains(&q))
        })
        .take(MAX_COMPLETIONS)
        .map(|(i, _)| u32::try_from(i).unwrap_or(u32::MAX))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{CiteCandidate, finished_links, matching_completions};

    fn candidate(title: &str, label: &str, detail: Option<&str>) -> CiteCandidate {
        CiteCandidate {
            title: title.to_owned(),
            label: label.to_owned(),
            detail: detail.map(str::to_owned),
        }
    }

    #[test]
    // it: "a link the caret has left is finished; one it is still inside is not"
    fn a_link_the_caret_has_left_is_finished_one_it_is_still_inside_is_not() {
        let doc = "see [[Alpha]] and [[Be]] here";
        let inside_be = doc.find("Be").unwrap_or_default() + 2;
        assert_eq!(finished_links(doc, Some(inside_be)), vec!["Alpha"]);
        assert_eq!(finished_links(doc, Some(doc.len())), vec!["Alpha", "Be"]);
        assert_eq!(finished_links(doc, None), vec!["Alpha", "Be"]);
    }

    #[test]
    // it: "an alias or heading names its target"
    fn an_alias_or_heading_names_its_target() {
        assert_eq!(
            finished_links("[[Alpha|the first]] [[Beta#Intro]]", Some(0)),
            vec!["Alpha", "Beta"]
        );
    }

    #[test]
    fn caret_offsets_count_utf16_units_not_bytes() {
        // `é` is one UTF-16 unit but two UTF-8 bytes; the link spans UTF-16 units 1..10.
        assert_eq!(finished_links("é[[Alpha]]", Some(5)), Vec::<String>::new());
        assert_eq!(finished_links("é[[Alpha]]", Some(10)), vec!["Alpha"]);
    }

    #[test]
    fn completions_match_title_label_or_detail_ignoring_case() {
        let items = [
            candidate("Alpha", "Alpha", None),
            candidate("Beta", "beta-label", Some("Smith 2020")),
        ];
        assert_eq!(matching_completions(&items, "BET"), vec![1]);
        assert_eq!(matching_completions(&items, "smith"), vec![1]);
        assert_eq!(matching_completions(&items, ""), vec![0, 1]);
        assert!(matching_completions(&items, "zzz").is_empty());
    }

    #[test]
    fn completions_stop_at_twenty() {
        let items: Vec<CiteCandidate> = (0..25)
            .map(|i| candidate(&format!("note {i}"), "x", None))
            .collect();
        assert_eq!(matching_completions(&items, "note").len(), 20);
    }
}

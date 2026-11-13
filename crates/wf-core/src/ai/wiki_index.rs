//! Port of packages/core/src/features/ai-assistant/domain/wiki-index.ts. Pure.

use std::cmp::Ordering;

use crate::js_collate::locale_compare;
use crate::reader_analysis::lines::{js_trim, js_trim_end};

/// Marks the generated region so a rebuild never eats hand-written text.
pub const INDEX_MARKER_START: &str = "<!-- weaveforge:wiki-index -->";
/// Closes the generated region opened by [`INDEX_MARKER_START`].
pub const INDEX_MARKER_END: &str = "<!-- /weaveforge:wiki-index -->";

/// Pages are grouped under this when the title starts with a digit or symbol.
const OTHER_GROUP: &str = "#";

/// The fields of a wiki page the index reads (TS `WikiPageRef`, from `wiki-lint.ts`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiPageRef {
    /// The page title; the index groups and sorts by it.
    pub title: String,
    /// Other names the page answers to. Absent or empty adds no `also` suffix.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub aliases: Option<Vec<String>>,
}

/// The group a title files under: its upper-cased first character when that is `A`-`Z`.
fn group_key(title: &str) -> String {
    let Some(first) = js_trim(title).chars().next() else {
        return OTHER_GROUP.to_owned();
    };
    // Full case mapping, as JS `toUpperCase`: `ß` gives `SS`, which still files under `S`.
    let upper: String = first.to_uppercase().collect();
    if upper.as_str() >= "A" && upper.as_str() <= "Z" {
        upper
    } else {
        OTHER_GROUP.to_owned()
    }
}

/// `s.slice(0, n)` in UTF-16 units. A surrogate pair the cut would split is dropped
/// whole, where JS keeps a lone half.
fn js_prefix(s: &str, units: usize) -> &str {
    let mut used = 0;
    for (at, c) in s.char_indices() {
        used += c.len_utf16();
        if used > units {
            return &s[..at];
        }
    }
    s
}

/// Build the generated block. `heading` defaults to `Index`; `generated_at` is an ISO
/// timestamp whose first ten units give the date line (unused when there are no pages).
///
/// Sorting is by title rather than by insertion, and groups are alphabetical
/// with the symbol group last: an index is read by scanning for a name, so the
/// order that matters is the reader's, not the wiki's history.
#[must_use]
pub fn build_wiki_index(
    pages: &[WikiPageRef],
    heading: Option<&str>,
    generated_at: &str,
) -> String {
    let heading = heading.unwrap_or("Index");
    let mut sorted: Vec<&WikiPageRef> = pages.iter().collect();
    sorted.sort_by(|a, b| locale_compare(&a.title, &b.title));

    let mut groups: Vec<(String, Vec<&WikiPageRef>)> = Vec::new();
    for &page in &sorted {
        let key = group_key(&page.title);
        match groups.iter().position(|(k, _)| *k == key) {
            Some(i) => groups[i].1.push(page),
            None => groups.push((key, vec![page])),
        }
    }

    groups.sort_by(|(a, _), (b, _)| {
        if a == OTHER_GROUP {
            Ordering::Greater
        } else if b == OTHER_GROUP {
            Ordering::Less
        } else {
            locale_compare(a, b)
        }
    });

    let mut lines: Vec<String> = vec![
        INDEX_MARKER_START.to_owned(),
        format!("## {heading}"),
        String::new(),
    ];

    if sorted.is_empty() {
        lines.push("_No pages yet._".to_owned());
        lines.push(String::new());
    } else {
        for (key, bucket) in &groups {
            lines.push(format!("### {key}"));
            lines.push(String::new());
            for page in bucket {
                // Wikilinks rather than ids: the link resolver already matches by
                // title, so the index survives being read outside the app.
                let aliases = match page.aliases.as_deref() {
                    Some(list) if !list.is_empty() => format!(" — also {}", list.join(", ")),
                    _ => String::new(),
                };
                lines.push(format!("- [[{}]]{aliases}", page.title));
            }
            lines.push(String::new());
        }
        let count = sorted.len();
        let plural = if count == 1 { "" } else { "s" };
        lines.push(format!(
            "_{count} page{plural}. Generated {}._",
            js_prefix(generated_at, 10)
        ));
        lines.push(String::new());
    }

    lines.push(INDEX_MARKER_END.to_owned());
    lines.join("\n")
}

/// Splice a freshly built index into a body, replacing any previous one.
///
/// Text outside the markers is left exactly as written. Someone who put a note
/// at the top of the wiki root keeps it — regeneration is only entitled to the
/// region it generated.
#[must_use]
pub fn replace_wiki_index(body: &str, index: &str) -> String {
    let Some(start) = body.find(INDEX_MARKER_START) else {
        let trimmed = js_trim_end(body);
        return if trimmed.is_empty() {
            format!("{index}\n")
        } else {
            format!("{trimmed}\n\n{index}\n")
        };
    };
    let before = &body[..start];
    // Only an end marker after this start closes the block. Without one the block was cut
    // short and runs to the end of the page.
    let from = start + INDEX_MARKER_START.len();
    let Some(end) = body[from..].find(INDEX_MARKER_END).map(|at| from + at) else {
        return format!("{before}{index}\n");
    };
    let after = &body[end + INDEX_MARKER_END.len()..];
    format!("{before}{index}{after}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(title: &str, aliases: Option<Vec<String>>) -> WikiPageRef {
        WikiPageRef {
            title: title.to_owned(),
            aliases,
        }
    }

    #[test]
    fn groups_sort_and_symbols_last() {
        let pages = [
            page("beta", None),
            page("Alpha", Some(vec!["A1".to_owned()])),
            page("9 lives", None),
        ];
        let got = build_wiki_index(&pages, None, "2026-11-05T10:00:00.000Z");
        let want = [
            INDEX_MARKER_START,
            "## Index",
            "",
            "### A",
            "",
            "- [[Alpha]] — also A1",
            "",
            "### B",
            "",
            "- [[beta]]",
            "",
            "### #",
            "",
            "- [[9 lives]]",
            "",
            "_3 pages. Generated 2026-11-05._",
            "",
            INDEX_MARKER_END,
        ]
        .join("\n");
        assert_eq!(got, want);
    }

    #[test]
    fn empty_index_says_no_pages() {
        let got = build_wiki_index(&[], Some("Notes"), "");
        let want = [
            INDEX_MARKER_START,
            "## Notes",
            "",
            "_No pages yet._",
            "",
            INDEX_MARKER_END,
        ]
        .join("\n");
        assert_eq!(got, want);
    }

    #[test]
    fn single_page_is_singular_and_empty_aliases_add_nothing() {
        let pages = [page("x", Some(Vec::new()))];
        let got = build_wiki_index(&pages, None, "2026-01-02T03:04:05Z");
        assert!(got.contains("_1 page. Generated 2026-01-02._"));
        assert!(!got.contains(" — also"));
    }

    #[test]
    fn group_key_follows_js_upper_case() {
        assert_eq!(group_key("  beta"), "B");
        assert_eq!(group_key("\u{131}x"), "I");
        assert_eq!(group_key("\u{df}x"), "SS");
        assert_eq!(group_key("(x"), "#");
        assert_eq!(group_key("   "), "#");
    }

    #[test]
    fn replace_without_markers_appends_after_trimmed_body() {
        assert_eq!(replace_wiki_index("hi  \n", "IDX"), "hi\n\nIDX\n");
        assert_eq!(replace_wiki_index("  \n", "IDX"), "IDX\n");
    }

    #[test]
    fn replace_keeps_text_outside_markers() {
        let body = format!("top\n{INDEX_MARKER_START}\nold\n{INDEX_MARKER_END}\ntail");
        assert_eq!(replace_wiki_index(&body, "NEW"), "top\nNEW\ntail");
    }

    #[test]
    fn unclosed_or_reversed_block_runs_to_end_as_ts_does() {
        let body = format!("top\n{INDEX_MARKER_START}\nold\ntail");
        assert_eq!(replace_wiki_index(&body, "NEW"), "top\nNEW\n");
        let body = format!("{INDEX_MARKER_END}\nmid\n{INDEX_MARKER_START}");
        assert_eq!(
            replace_wiki_index(&body, "NEW"),
            format!("{INDEX_MARKER_END}\nmid\nNEW\n")
        );
    }
}

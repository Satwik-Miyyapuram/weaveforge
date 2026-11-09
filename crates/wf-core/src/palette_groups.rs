//! The jump palette's headings, page matches and open keys (wf-core `palette_groups`). Ported from
//! `apps/web/src/lib/palette-groups.ts`.
//!
//! Every function returns indices into the caller's rows, so the caller keeps its own row objects
//! (with their callbacks) and maps the indices back. The footer's key labels stay in the UI.

use serde::{Deserialize, Serialize};

use crate::search::js_text::is_js_whitespace;

/// Headings, in the order the palette shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PaletteGroup {
    /// Recently opened items.
    #[serde(rename = "Recent")]
    Recent,
    /// App pages.
    #[serde(rename = "Pages")]
    Pages,
    /// Papers.
    #[serde(rename = "Papers")]
    Papers,
    /// Notes.
    #[serde(rename = "Notes")]
    Notes,
    /// Report sections.
    #[serde(rename = "Report sections")]
    ReportSections,
    /// Matches inside papers.
    #[serde(rename = "In papers")]
    InPapers,
    /// Commands.
    #[serde(rename = "Actions")]
    Actions,
}

impl PaletteGroup {
    /// Every heading, in display order.
    pub const ALL: [Self; 7] = [
        Self::Recent,
        Self::Pages,
        Self::Papers,
        Self::Notes,
        Self::ReportSections,
        Self::InPapers,
        Self::Actions,
    ];
}

/// Search (`Ctrl+K`, `Ctrl+Shift+F`) or commands (`Ctrl+Shift+P`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PaletteMode {
    /// Search the workspace.
    Search,
    /// List commands.
    Commands,
}

/// A key press, as the palette reads it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaletteKey {
    /// The `key` value of the event.
    pub key: String,
    /// Shift is held.
    pub shift_key: bool,
    /// Ctrl is held.
    pub ctrl_key: bool,
    /// Meta (Cmd on a Mac) is held.
    pub meta_key: bool,
    /// Alt is held.
    pub alt_key: bool,
}

/// One heading and the indices of its rows, in the caller's order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GroupedRows {
    /// The heading.
    pub label: PaletteGroup,
    /// Indices of the rows under it.
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub rows: Vec<usize>,
}

/// Rows under their headings, in [`PaletteGroup::ALL`] order. Order inside a group is kept.
#[must_use]
pub fn group_palette_rows(groups: &[PaletteGroup]) -> Vec<GroupedRows> {
    PaletteGroup::ALL
        .iter()
        .filter_map(|&label| {
            let rows: Vec<usize> = groups
                .iter()
                .enumerate()
                .filter(|(_, group)| **group == label)
                .map(|(index, _)| index)
                .collect();
            (!rows.is_empty()).then_some(GroupedRows { label, rows })
        })
        .collect()
}

/// Indices of the labels that hold the query, names that start with it first. Nothing for an
/// empty query.
#[must_use]
pub fn matching_page_indices(labels: &[String], query: &str) -> Vec<usize> {
    let q = query.trim_matches(is_js_whitespace).to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<usize> = labels
        .iter()
        .enumerate()
        .filter(|(_, label)| label.to_lowercase().contains(&q))
        .map(|(index, _)| index)
        .collect();
    // Stable sort: names that start with the query first, the rest in their order.
    hits.sort_by_key(|&index| u8::from(!labels[index].to_lowercase().starts_with(&q)));
    hits
}

/// Command-mode rows: every one for an empty query, else the page rule.
#[must_use]
pub fn command_match_indices(labels: &[String], query: &str) -> Vec<usize> {
    if query.trim_matches(is_js_whitespace).is_empty() {
        (0..labels.len()).collect()
    } else {
        matching_page_indices(labels, query)
    }
}

/// `Ctrl+K` and `Ctrl+Shift+F` search; `Ctrl+Shift+P` lists commands, as in VS Code. Alt and
/// bare keys open nothing.
#[must_use]
pub fn palette_mode_for(event: &PaletteKey) -> Option<PaletteMode> {
    if !(event.meta_key || event.ctrl_key) || event.alt_key {
        return None;
    }
    let key = event.key.to_lowercase();
    match (key.as_str(), event.shift_key) {
        ("k", false) | ("f", true) => Some(PaletteMode::Search),
        ("p", true) => Some(PaletteMode::Commands),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    fn chord(key: &str, shift: bool, ctrl: bool, meta: bool, alt: bool) -> PaletteKey {
        PaletteKey {
            key: key.to_owned(),
            shift_key: shift,
            ctrl_key: ctrl,
            meta_key: meta,
            alt_key: alt,
        }
    }

    #[test]
    fn rows_group_under_headings_in_a_fixed_order_keeping_their_order() {
        use PaletteGroup::*;
        let groups = [Notes, Papers, Actions, Notes, Pages, Recent];
        let out = group_palette_rows(&groups);
        let got: Vec<(PaletteGroup, Vec<usize>)> =
            out.into_iter().map(|g| (g.label, g.rows)).collect();
        assert_eq!(
            got,
            vec![
                (Recent, vec![5]),
                (Pages, vec![4]),
                (Papers, vec![1]),
                (Notes, vec![0, 3]),
                (Actions, vec![2]),
            ]
        );
    }

    #[test]
    fn no_rows_no_headings() {
        assert!(group_palette_rows(&[]).is_empty());
    }

    #[test]
    fn pages_match_on_their_name_only_once_something_is_typed() {
        let pages = labels(&["Papers", "Settings", "Plan"]);
        assert!(matching_page_indices(&pages, "").is_empty());
        assert!(matching_page_indices(&pages, "  ").is_empty());
        assert_eq!(matching_page_indices(&pages, "SET"), vec![1]);
    }

    #[test]
    fn a_name_that_starts_with_the_query_comes_first() {
        let pages = labels(&["Report", "Paper map", "Workspace"]);
        assert_eq!(matching_page_indices(&pages, "p"), vec![1, 0, 2]);
        assert_eq!(matching_page_indices(&labels(&["Papers"]), "pa"), vec![0]);
    }

    #[test]
    fn commands_list_everything_until_typed_then_filter() {
        let rows = labels(&["Settings", "New project", "Switch to dark theme"]);
        assert_eq!(command_match_indices(&rows, ""), vec![0, 1, 2]);
        assert_eq!(command_match_indices(&rows, "  "), vec![0, 1, 2]);
        assert_eq!(command_match_indices(&rows, "pro"), vec![1]);
        assert!(command_match_indices(&rows, "zzz").is_empty());
    }

    #[test]
    fn ctrl_k_and_ctrl_shift_f_search_and_ctrl_shift_p_commands() {
        assert_eq!(palette_mode_for(&chord("k", false, true, false, false)), Some(PaletteMode::Search));
        assert_eq!(palette_mode_for(&chord("F", true, true, false, false)), Some(PaletteMode::Search));
        assert_eq!(palette_mode_for(&chord("P", true, true, false, false)), Some(PaletteMode::Commands));
        assert_eq!(palette_mode_for(&chord("k", false, false, true, false)), Some(PaletteMode::Search));
    }

    #[test]
    fn other_chords_open_nothing() {
        assert_eq!(palette_mode_for(&chord("k", false, false, false, false)), None);
        assert_eq!(palette_mode_for(&chord("k", false, true, false, true)), None);
        assert_eq!(palette_mode_for(&chord("p", false, true, false, false)), None);
        assert_eq!(palette_mode_for(&chord("f", false, true, false, false)), None);
        assert_eq!(palette_mode_for(&chord("K", true, true, false, false)), None);
    }
}

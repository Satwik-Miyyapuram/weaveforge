//! Quick open: type a few letters, get the document. Ported from
//! `apps/web/src/features/editor-workspace/application/quick-open.ts`.
//!
//! Matching is subsequence-based, and the hits are scored rather than merely
//! filtered: prefix and word-start hits win, contiguous runs win, and a match in
//! the filename beats one in the directory it sits under. Indices are UTF-16
//! code units, because the palette highlights the original text with them.

use serde::{Deserialize, Serialize};

use super::breadcrumbs::tree_kind_name;
use super::workspace_tree::WorkspaceTreeNode;
use crate::js_collate::locale_compare;
use crate::search::js_text::is_js_whitespace;

const MATCH: i32 = 8;
const CONTIGUOUS_BONUS: i32 = 12;
const WORD_START_BONUS: i32 = 10;
const START_BONUS: i32 = 16;
/// Charged per skipped character, so a scattered match loses to a tight one.
const GAP_PENALTY: i32 = 1;
const MAX_RESULTS: usize = 40;

/// Group order: the explorer's root order, then kinds with no heading in the
/// order they were first seen.
const GROUP_ORDER: &[(&str, &str)] = &[
    ("vault_page", "Notes"),
    ("paper", "Papers"),
    ("paper_pdf", "PDFs"),
    ("reading_list", "Reading lists"),
    ("report_section", "Report"),
    // The logbook: its rows are named by a date, not a title.
    ("log_entry", "Log"),
    ("overleaf", "Overleaf"),
];

/// One ranked hit.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct QuickOpenResult {
    /// The tree row that matched.
    pub node: WorkspaceTreeNode,
    /// Higher is better.
    pub score: i32,
    /// UTF-16 indices into `node.path` that matched, for highlighting.
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub matched: Vec<usize>,
}

/// A palette section: the hits of one kind, in score order.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct QuickOpenGroup {
    /// The root the group belongs to, as `kind.ts` names it.
    pub kind: String,
    /// The heading the palette shows.
    pub label: String,
    /// The hits, best first.
    pub results: Vec<QuickOpenResult>,
}

#[derive(Debug)]
struct ScoreMatch {
    score: i32,
    matched: Vec<usize>,
}

/// What a row is called in the palette: its title, which its label may not be.
#[must_use]
pub fn title_of(node: &WorkspaceTreeNode) -> &str {
    node.title.as_deref().unwrap_or(&node.label)
}

fn to_i32(n: usize) -> i32 {
    i32::try_from(n).unwrap_or(i32::MAX)
}

/// Lower-case without changing the length, as the TypeScript does: index N of
/// the result is index N of the input, in UTF-16 code units.
fn fold_case(text: &str) -> Vec<u16> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let lower: Vec<u16> = text.to_lowercase().encode_utf16().collect();
    if lower.len() == units.len() {
        return lower;
    }
    units.into_iter().map(fold_unit).collect()
}

/// One code unit lower-cased on its own; the first unit of the result.
fn fold_unit(unit: u16) -> u16 {
    char::from_u32(u32::from(unit))
        .and_then(|ch| ch.to_lowercase().next())
        .and_then(|ch| {
            let mut buf = [0_u16; 2];
            ch.encode_utf16(&mut buf).first().copied()
        })
        .unwrap_or(unit)
}

/// The code points of a UTF-16 string, each as its units (a pair stays together).
fn code_points(units: &[u16]) -> Vec<&[u16]> {
    let mut points = Vec::new();
    let mut i = 0;
    while i < units.len() {
        let is_high = (0xD800..=0xDBFF).contains(&units[i]);
        let is_low_follows = units
            .get(i + 1)
            .is_some_and(|low| (0xDC00..=0xDFFF).contains(low));
        let len = if is_high && is_low_follows { 2 } else { 1 };
        points.push(&units[i..i + len]);
        i += len;
    }
    points
}

fn find_from(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    let last = hay.len() - needle.len();
    (from..=last).find(|&i| hay[i..i + needle.len()] == *needle)
}

/// A position after a non-alphanumeric ASCII unit, or at the start.
fn is_boundary(text: &[u16], index: usize) -> bool {
    if index == 0 {
        return true;
    }
    !u8::try_from(text[index - 1]).is_ok_and(|b| b.is_ascii_alphanumeric())
}

/// Score one candidate, or `None` when the query is not a subsequence of it.
/// Greedy left to right, as the TypeScript is.
fn score_match(text: &str, query: &str) -> Option<ScoreMatch> {
    if query.is_empty() {
        return Some(ScoreMatch {
            score: 0,
            matched: Vec::new(),
        });
    }
    let haystack = fold_case(text);
    let needle = fold_case(query);

    let mut score = 0_i32;
    let mut at = 0_usize;
    let mut previous: Option<usize> = None;
    let mut matched = Vec::new();

    for point in code_points(&needle) {
        // A space is the user separating terms, not a character to find.
        if point == [0x20] {
            continue;
        }
        let found = find_from(&haystack, point, at)?;
        score += MATCH;
        // Before the first match the TypeScript's previous index is -1, so a hit
        // at 0 counts as contiguous.
        if found == previous.map_or(0, |p| p + 1) {
            score += CONTIGUOUS_BONUS;
        } else {
            score -= to_i32(found - at).min(MATCH) * GAP_PENALTY;
        }
        if is_boundary(&haystack, found) {
            score += WORD_START_BONUS;
        }
        if found == 0 {
            score += START_BONUS;
        }
        matched.push(found);
        previous = Some(found);
        at = found + 1;
    }

    // Shorter candidates win ties.
    Some(ScoreMatch {
        score: score - to_i32(haystack.len() / 12),
        matched,
    })
}

/// Rank documents against a query. Both the title and the mirrored path are
/// scored and the better wins; a title hit is worth 4 more. An empty query
/// lists everything.
#[must_use]
pub fn quick_open_results(documents: &[WorkspaceTreeNode], query: &str) -> Vec<QuickOpenResult> {
    let trimmed = query.trim_matches(is_js_whitespace);
    let mut results = Vec::new();

    for node in documents {
        let by_path = score_match(&node.path, trimmed);
        let by_title = score_match(title_of(node), trimmed);
        let title_score = by_title.as_ref().map(|m| m.score + 4);
        let path_score = by_path.as_ref().map(|m| m.score);
        let score = match (title_score, path_score) {
            (Some(t), Some(p)) => t.max(p),
            (Some(t), None) => t,
            (None, Some(p)) => p,
            (None, None) => continue,
        };
        let matched = by_path.map(|m| m.matched).unwrap_or_default();
        results.push(QuickOpenResult {
            node: node.clone(),
            score,
            matched,
        });
    }

    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| locale_compare(title_of(&a.node), title_of(&b.node)))
    });
    results.truncate(MAX_RESULTS);
    results
}

/// `kind` as a heading: underscores and hyphens become spaces, each word capitalised.
fn title_case(text: &str) -> String {
    text.replace(['_', '-'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Split score-ordered hits into palette groups without re-sorting them.
#[must_use]
pub fn group_results(results: &[QuickOpenResult]) -> Vec<QuickOpenGroup> {
    let mut groups: Vec<QuickOpenGroup> = Vec::new();

    for &(kind, label) in GROUP_ORDER {
        groups.push(QuickOpenGroup {
            kind: kind.to_owned(),
            label: label.to_owned(),
            results: results
                .iter()
                .filter(|r| tree_kind_name(r.node.kind) == kind)
                .cloned()
                .collect(),
        });
    }

    for result in results {
        let kind = tree_kind_name(result.node.kind);
        if GROUP_ORDER.iter().any(|&(headed, _)| headed == kind) {
            continue;
        }
        if let Some(group) = groups.iter_mut().find(|g| g.kind == kind) {
            group.results.push(result.clone());
        } else {
            groups.push(QuickOpenGroup {
                kind: kind.to_owned(),
                label: title_case(kind),
                results: vec![result.clone()],
            });
        }
    }

    groups.retain(|group| !group.results.is_empty());
    groups
}

/// The results in the order the palette paints them: group by group. Keyboard
/// navigation walks this.
#[must_use]
pub fn painted_order(results: &[QuickOpenResult]) -> Vec<QuickOpenResult> {
    group_results(results)
        .into_iter()
        .flat_map(|group| group.results)
        .collect()
}

/// The row an arrow lands on. It wraps, so the bottom hit is one `↑` away from
/// the top. A cursor left past the end by a shorter list steps from the last
/// row. `delta` is `1` or `-1`; an empty list gives `0`.
#[must_use]
pub fn step_cursor(cursor: i32, delta: i32, length: i32) -> i32 {
    if length <= 0 {
        return 0;
    }
    let from = cursor.clamp(0, length - 1);
    (from + delta).rem_euclid(length)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn node(kind: &str, label: &str, path: &str) -> WorkspaceTreeNode {
        serde_json::from_value(json!({
            "key": format!("{kind}:{label}"), "kind": kind, "id": label, "label": label,
            "path": path, "children": []
        }))
        .expect("node fixture")
    }

    #[test]
    fn subsequence_matches_and_misses() {
        assert!(score_match("baselines.note.md", "bsl").is_some());
        assert!(score_match("baselines.note.md", "xyz").is_none());
        let hit = score_match("abc", "ac").expect("match");
        assert_eq!(hit.matched, [0, 2]);
    }

    #[test]
    fn prefix_beats_scattered_match() {
        let docs = vec![
            node("vault_page", "zeta bat", "zeta-bat"),
            node("vault_page", "batch", "batch"),
        ];
        let titles: Vec<String> = quick_open_results(&docs, "bat")
            .iter()
            .map(|r| title_of(&r.node).to_owned())
            .collect();
        assert_eq!(titles, ["batch", "zeta bat"]);
    }

    #[test]
    fn empty_query_lists_everything() {
        let docs = vec![node("vault_page", "a", "a"), node("paper", "b", "b")];
        assert_eq!(quick_open_results(&docs, "   ").len(), 2);
    }

    #[test]
    fn groups_follow_root_order_then_first_seen() {
        let docs = vec![
            node("experiment", "e", "e"),
            node("paper", "p", "p"),
            node("vault_page", "n", "n"),
        ];
        let results = quick_open_results(&docs, "");
        let groups = group_results(&results);
        let labels: Vec<&str> = groups.iter().map(|g| g.label.as_str()).collect();
        assert_eq!(labels, ["Notes", "Papers", "Experiment"]);
    }

    #[test]
    fn painted_order_is_group_by_group() {
        let docs = vec![node("paper", "p", "p"), node("vault_page", "n", "n")];
        let painted: Vec<String> = painted_order(&quick_open_results(&docs, ""))
            .iter()
            .map(|r| title_of(&r.node).to_owned())
            .collect();
        assert_eq!(painted, ["n", "p"]);
    }

    #[test]
    fn cursor_wraps_and_clamps() {
        assert_eq!(step_cursor(0, -1, 3), 2);
        assert_eq!(step_cursor(2, 1, 3), 0);
        assert_eq!(step_cursor(9, -1, 3), 1);
        assert_eq!(step_cursor(0, 1, 0), 0);
    }

    #[test]
    fn title_case_words() {
        assert_eq!(title_case("reading_list"), "Reading List");
        assert_eq!(title_case("ink-page"), "Ink Page");
    }
}

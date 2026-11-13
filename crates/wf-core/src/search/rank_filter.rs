//! Screen-list filtering by search rank (TS `rank-filter.ts`).
//!
//! The caller runs the search and passes the hit entity ids in rank order. Items
//! the index knows keep their best rank. Items it does not (shared or pinned
//! from other users) fall back to a substring match, and sort after every
//! ranked item.

use std::collections::HashMap;

use crate::search::js_text::is_js_whitespace;

/// One list item, as the caller sees it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RankItem {
    /// Entity id, matched against the search hits.
    pub id: String,
    /// Text searched for items the index does not hold.
    pub fallback_text: String,
}

/// Order of ranked matches: indices into `items`.
///
/// An empty (after trimming) query keeps every item in list order. Otherwise
/// an item is kept when its id is among `hit_entity_ids`, or when its
/// `fallback_text` contains the query, ignoring case. Ranked items come first,
/// by their first position in `hit_entity_ids`. Unranked matches follow in
/// list order.
#[must_use]
pub fn rank_filter_order(query: &str, hit_entity_ids: &[String], items: &[RankItem]) -> Vec<usize> {
    let query = query.trim_matches(is_js_whitespace);
    if query.is_empty() {
        return (0..items.len()).collect();
    }
    let mut rank: HashMap<&str, usize> = HashMap::new();
    for (position, id) in hit_entity_ids.iter().enumerate() {
        let _ = rank.entry(id.as_str()).or_insert(position);
    }
    let lower = query.to_lowercase();
    let mut matches: Vec<(usize, usize)> = Vec::new();
    for (position, item) in items.iter().enumerate() {
        let ranked = rank.get(item.id.as_str()).copied();
        if ranked.is_none() && !item.fallback_text.to_lowercase().contains(&lower) {
            continue;
        }
        matches.push((ranked.unwrap_or(usize::MAX), position));
    }
    matches.sort_by_key(|&(score, position)| (score, position));
    matches.into_iter().map(|(_, position)| position).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, fallback: &str) -> RankItem {
        RankItem {
            id: id.into(),
            fallback_text: fallback.into(),
        }
    }

    #[test]
    fn empty_query_keeps_every_item_in_order() {
        let items = vec![item("a", "x"), item("b", "y")];
        assert_eq!(rank_filter_order("   ", &[], &items), vec![0, 1]);
    }

    #[test]
    fn ranked_items_come_first_in_hit_order() {
        let items = vec![item("a", ""), item("b", ""), item("c", "")];
        let hits = vec!["c".to_string(), "a".to_string()];
        assert_eq!(rank_filter_order("q", &hits, &items), vec![2, 0]);
    }

    #[test]
    fn unranked_items_match_by_substring_after_ranked_ones() {
        let items = vec![
            item("shared-1", "Shared Note Alpha"),
            item("a", "Alpha Paper"),
            item("b", ""),
        ];
        let hits = vec!["a".to_string()];
        // `a` is ranked, so it leads; `shared-1` is a substring match after it.
        assert_eq!(rank_filter_order("alpha", &hits, &items), vec![1, 0]);
        // Without hits both are substring matches, kept in list order.
        assert_eq!(rank_filter_order("alpha", &[], &items), vec![0, 1]);
    }
}

//! Reciprocal rank fusion of ranked id lists. Port of `fuseRankings` in
//! `packages/core/src/search/rank-fusion.ts`; ties break on code point order
//! of the id instead of `localeCompare`.

use std::collections::BTreeMap;
use std::num::NonZeroUsize;

/// Rank-fusion constant from Cormack et al. (2009).
pub const RRF_K: u32 = 60;

/// One arm's ranking: ids best first, and its relative influence.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RankedList {
    /// Ids, best first. May repeat; every occurrence counts.
    pub ids: Vec<String>,
    /// Relative influence; finite and >= 0.
    pub weight: f64,
}

/// Fuse ranked lists into one ordering of distinct ids.
#[must_use]
pub fn fuse_rankings(lists: &[RankedList], k: u32, limit: Option<NonZeroUsize>) -> Vec<String> {
    debug_assert!(
        lists
            .iter()
            .all(|list| list.weight.is_finite() && list.weight >= 0.0),
        "list weights must be finite and non-negative"
    );

    let mut scores: BTreeMap<&str, f64> = BTreeMap::new();
    for list in lists {
        for (position, id) in list.ids.iter().enumerate() {
            // Positions past u32::MAX are clamped; they only contribute a tiny tail.
            let position = f64::from(u32::try_from(position).unwrap_or(u32::MAX));
            let contribution = list.weight / (f64::from(k) + position + 1.0);
            *scores.entry(id.as_str()).or_insert(0.0) += contribution;
        }
    }

    let distinct = scores.len();
    let mut ranked: Vec<(&str, f64)> = scores.into_iter().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));

    let mut out: Vec<String> = ranked.into_iter().map(|(id, _)| id.to_owned()).collect();
    if let Some(n) = limit {
        out.truncate(n.get());
    }

    debug_assert!(out.len() <= distinct, "output cannot exceed distinct ids");
    debug_assert!(
        limit.is_none_or(|n| out.len() <= n.get()),
        "output cannot exceed limit"
    );
    out
}

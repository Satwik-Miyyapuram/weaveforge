//! Port of packages/core/src/search/personalized-pagerank.ts (Monte Carlo personalized PageRank).
//! Pure: the TS `rng` option is the `rng` parameter here, so tests can inject a sequence.

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::js_collate::locale_compare;
use crate::search::wiki_graph::WikiGraph;

/// Walks per seed when `PprOptions::num_walks` is unset (TS `DEFAULT_NUM_WALKS`).
const DEFAULT_NUM_WALKS: u32 = 3_000;
/// Steps per walk when `PprOptions::max_steps` is unset (TS `DEFAULT_MAX_STEPS`).
const DEFAULT_MAX_STEPS: u32 = 50;
/// Teleport probability when `PprOptions::damping` is unset (TS `DEFAULT_DAMPING`).
const DEFAULT_DAMPING: f64 = 0.15;

/// Walk settings (TS `PprOptions` without the injected `rng`). Unset fields take the defaults.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PprOptions {
    /// Walks per seed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub num_walks: Option<u32>,
    /// Steps per walk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub max_steps: Option<u32>,
    /// Teleport probability back to the seed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub damping: Option<f64>,
}

/// A node's visit probability (one entry of the TS score `Map`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NodeScore {
    /// The node id.
    pub node: String,
    /// Visits to the node divided by total visits.
    pub score: f64,
}

/// A related node (TS `RelatedNode`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelatedNode {
    /// The node id.
    pub id: String,
    /// Its personalized PageRank score.
    pub score: f64,
}

type Adjacency<'a> = HashMap<&'a str, &'a [String]>;

fn index_edges(graph: &WikiGraph) -> Adjacency<'_> {
    graph
        .edges
        .iter()
        .map(|entry| (entry.node.as_str(), entry.neighbours.as_slice()))
        .collect()
}

/// One walk step from `current` (TS loop body). Draws `rng` in the same order as TS.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "index is floored and checked non-negative before indexing"
)]
fn step<'a>(
    adjacency: &Adjacency<'a>,
    current: &'a str,
    seed: &'a str,
    damping: f64,
    rng: &mut impl FnMut() -> f64,
) -> &'a str {
    let neighbours = adjacency.get(current).copied().unwrap_or(&[]);
    // The teleport draw always happens first, even at a dead end.
    if rng() < damping || neighbours.is_empty() {
        return seed;
    }
    let index = (rng() * neighbours.len() as f64).floor();
    // A NaN or out-of-range draw teleports, as an undefined JS index does.
    let next = if index >= 0.0 {
        neighbours.get(index as usize)
    } else {
        None
    };
    next.map_or(seed, String::as_str)
}

/// Add one visit to `node`, keeping first-visit order (TS `record`).
fn record<'a>(
    visits: &mut Vec<(&'a str, f64)>,
    slots: &mut HashMap<&'a str, usize>,
    node: &'a str,
) {
    if let Some(&slot) = slots.get(node) {
        visits[slot].1 += 1.0;
    } else {
        let _ = slots.insert(node, visits.len());
        visits.push((node, 1.0));
    }
}

/// Visit probabilities from `seed`, in first-visit order (TS `personalizedPageRank`).
///
/// A seed with no edges keeps all its probability. A seed missing from the graph gives
/// an empty result.
#[must_use]
pub fn personalized_page_rank(
    graph: &WikiGraph,
    seed: &str,
    options: &PprOptions,
    rng: &mut impl FnMut() -> f64,
) -> Vec<NodeScore> {
    let adjacency = index_edges(graph);
    if !adjacency.contains_key(seed) {
        return Vec::new();
    }
    let num_walks = options.num_walks.unwrap_or(DEFAULT_NUM_WALKS);
    let max_steps = options.max_steps.unwrap_or(DEFAULT_MAX_STEPS);
    let damping = options.damping.unwrap_or(DEFAULT_DAMPING);

    let mut visits: Vec<(&str, f64)> = Vec::new();
    let mut slots: HashMap<&str, usize> = HashMap::new();
    for _ in 0..num_walks {
        let mut current = seed;
        for _ in 0..max_steps {
            current = step(&adjacency, current, seed, damping, rng);
            record(&mut visits, &mut slots, current);
        }
    }

    let total = visits.iter().fold(0.0, |sum, (_, count)| sum + count);
    if total <= 0.0 {
        return Vec::new();
    }
    visits
        .into_iter()
        .map(|(node, count)| NodeScore {
            node: node.to_owned(),
            score: count / total,
        })
        .collect()
}

/// Top-`limit` neighbours by PPR, excluding the seed (TS `relatedByPpr`).
///
/// Ties sort by id with `localeCompare` order.
#[must_use]
pub fn related_by_ppr(
    graph: &WikiGraph,
    seed: &str,
    limit: usize,
    options: &PprOptions,
    rng: &mut impl FnMut() -> f64,
) -> Vec<RelatedNode> {
    let mut related: Vec<RelatedNode> = personalized_page_rank(graph, seed, options, rng)
        .into_iter()
        .filter(|scored| scored.node != seed)
        .map(|scored| RelatedNode {
            id: scored.node,
            score: scored.score,
        })
        .collect();
    related.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| locale_compare(&a.id, &b.id))
    });
    related.truncate(limit);
    related
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::wiki_graph::WikiGraphEdges;

    fn graph(entries: &[(&str, &[&str])]) -> WikiGraph {
        WikiGraph {
            nodes: entries.iter().map(|(node, _)| (*node).to_owned()).collect(),
            edges: entries
                .iter()
                .map(|(node, neighbours)| WikiGraphEdges {
                    node: (*node).to_owned(),
                    neighbours: neighbours.iter().map(|n| (*n).to_owned()).collect(),
                })
                .collect(),
        }
    }

    fn options(num_walks: u32, max_steps: u32) -> PprOptions {
        PprOptions {
            num_walks: Some(num_walks),
            max_steps: Some(max_steps),
            damping: None,
        }
    }

    #[test]
    fn unknown_seed_gives_empty_result() {
        let g = graph(&[("a", &["b"]), ("b", &["a"])]);
        let out = personalized_page_rank(&g, "zzz", &options(5, 5), &mut || 0.5);
        assert!(out.is_empty());
    }

    #[test]
    fn isolated_seed_keeps_all_probability() {
        let g = graph(&[("a", &[])]);
        let out = personalized_page_rank(&g, "a", &options(4, 4), &mut || 0.9);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].node, "a");
        assert!((out[0].score - 1.0).abs() < 1e-12);
    }

    #[test]
    fn teleport_only_visits_seed() {
        let g = graph(&[("a", &["b"]), ("b", &["a"])]);
        let out = personalized_page_rank(&g, "a", &options(3, 3), &mut || 0.0);
        assert_eq!(out.len(), 1);
        assert!((out[0].score - 1.0).abs() < 1e-12);
    }

    #[test]
    fn two_node_chain_follows_neighbours_in_order() {
        // Draws of 0.5 never teleport (0.5 >= 0.15) and pick index floor(0.5 * 1) = 0.
        let g = graph(&[("a", &["b"]), ("b", &["a"])]);
        let out = personalized_page_rank(&g, "a", &options(1, 3), &mut || 0.5);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].node, "b");
        assert!((out[0].score - 2.0 / 3.0).abs() < 1e-12);
        assert_eq!(out[1].node, "a");
        assert!((out[1].score - 1.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn related_excludes_seed_and_truncates() {
        let g = graph(&[("s", &["x", "y"]), ("x", &["s"]), ("y", &["s"])]);
        let all = related_by_ppr(&g, "s", 10, &options(1, 2), &mut || 0.5);
        assert!(all.iter().all(|r| r.id != "s"));
        let top = related_by_ppr(&g, "s", 1, &options(1, 2), &mut || 0.5);
        assert_eq!(top.len(), 1);
    }
}

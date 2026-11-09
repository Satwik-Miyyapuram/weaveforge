//! The local graph view: the nodes within a few hops of a seed (TS `localSubgraph` in
//! `apps/web/src/features/relations/application/local-graph.ts`).

use std::collections::{HashMap, HashSet};

/// Nodes reachable from `seed` in at most `depth` hops, the seed first, in breadth-first
/// discovery order. `None` when there is no seed or `depth` is below 1.
///
/// A seed with no neighbours (or `depth` large enough to exhaust the frontier) stops early;
/// the result is the same as running every hop.
#[must_use]
pub fn local_subgraph(
    seed: Option<&str>,
    depth: f64,
    neighbors: &HashMap<String, Vec<String>>,
) -> Option<Vec<String>> {
    let seed = seed.filter(|id| !id.is_empty())?;
    if depth < 1.0 {
        return None;
    }
    let mut seen: HashSet<String> = HashSet::from([seed.to_owned()]);
    let mut order = vec![seed.to_owned()];
    let mut frontier = vec![seed.to_owned()];
    let mut hop = 0.0;
    while hop < depth && !frontier.is_empty() {
        let mut next = Vec::new();
        for id in &frontier {
            for neighbour in neighbors.get(id).into_iter().flatten() {
                if seen.insert(neighbour.clone()) {
                    order.push(neighbour.clone());
                    next.push(neighbour.clone());
                }
            }
        }
        frontier = next;
        hop += 1.0;
    }
    Some(order)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::local_subgraph;

    fn graph() -> HashMap<String, Vec<String>> {
        let edges: [(&str, &[&str]); 4] = [
            ("a", &["b", "c"]),
            ("b", &["a", "d"]),
            ("c", &["a"]),
            ("d", &["b"]),
        ];
        edges
            .into_iter()
            .map(|(id, ns)| (id.to_owned(), ns.iter().map(|n| (*n).to_owned()).collect()))
            .collect()
    }

    fn sorted(ids: Option<Vec<String>>) -> Option<Vec<String>> {
        ids.map(|mut v| {
            v.sort();
            v
        })
    }

    #[test]
    fn none_without_seed_or_with_depth_below_one() {
        assert_eq!(local_subgraph(None, 2.0, &graph()), None);
        assert_eq!(local_subgraph(Some(""), 2.0, &graph()), None);
        assert_eq!(local_subgraph(Some("a"), 0.0, &graph()), None);
    }

    #[test]
    fn expands_to_the_depth_limited_neighbourhood() {
        let g = graph();
        assert_eq!(
            sorted(local_subgraph(Some("a"), 1.0, &g)),
            Some(vec!["a".into(), "b".into(), "c".into()])
        );
        assert_eq!(
            sorted(local_subgraph(Some("a"), 2.0, &g)),
            Some(vec!["a".into(), "b".into(), "c".into(), "d".into()])
        );
    }

    #[test]
    fn seed_comes_first_and_unknown_seed_is_alone() {
        let g = graph();
        assert_eq!(local_subgraph(Some("a"), 1.0, &g).unwrap()[0], "a");
        assert_eq!(local_subgraph(Some("zz"), 3.0, &g), Some(vec!["zz".into()]));
    }
}

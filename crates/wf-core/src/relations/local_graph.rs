//! The local graph view: the nodes within a few hops of a seed, and the graph helpers the canvas
//! applies to it (TS `localSubgraph`, `linkNodeId`, `filterGraphByNodes` and `cloneLinks` in
//! `apps/web/src/features/relations/application/local-graph.ts`).

use std::collections::{HashMap, HashSet};

use serde_json::Value;

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

/// The id a link endpoint names: the endpoint itself when it is a string, or the `id` of an
/// endpoint object (d3 replaces string endpoints with node objects once laid out).
#[must_use]
pub fn link_node_id(source: &Value) -> Option<String> {
    match source {
        Value::String(id) => Some(id.clone()),
        Value::Object(node) => node.get("id")?.as_str().map(str::to_owned),
        _ => None,
    }
}

/// `nodes` restricted to the ids in `allowed`, and the `links` whose two endpoints both remain.
/// With `allowed` of `None` both lists come back whole.
#[must_use]
pub fn filter_graph_by_nodes(
    nodes: &[Value],
    links: &[Value],
    allowed: Option<&HashSet<String>>,
) -> (Vec<Value>, Vec<Value>) {
    let Some(allowed) = allowed else {
        return (nodes.to_vec(), links.to_vec());
    };
    let kept: Vec<Value> = nodes
        .iter()
        .filter(|node| {
            node.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| allowed.contains(id))
        })
        .cloned()
        .collect();
    let ids: HashSet<String> = kept
        .iter()
        .filter_map(|node| node.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let kept_links = links
        .iter()
        .filter(|link| {
            let end = |key: &str| {
                link.get(key)
                    .and_then(link_node_id)
                    .is_some_and(|id| ids.contains(&id))
            };
            end("source") && end("target")
        })
        .cloned()
        .collect();
    (kept, kept_links)
}

/// Copies of `links` with both endpoints as plain id strings; every other field is kept. An
/// endpoint that names no id becomes `null`.
#[must_use]
pub fn clone_links(links: &[Value]) -> Vec<Value> {
    links
        .iter()
        .map(|link| {
            let mut copy = link.clone();
            if let Value::Object(fields) = &mut copy {
                for key in ["source", "target"] {
                    let id = link
                        .get(key)
                        .and_then(link_node_id)
                        .map_or(Value::Null, Value::String);
                    let _ = fields.insert(key.to_owned(), id);
                }
            }
            copy
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use serde_json::json;

    use super::{clone_links, filter_graph_by_nodes, link_node_id, local_subgraph};

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

    #[test]
    fn link_node_id_reads_strings_and_object_ids() {
        assert_eq!(link_node_id(&json!("a")), Some("a".into()));
        assert_eq!(
            link_node_id(&json!({ "id": "b", "x": 1 })),
            Some("b".into())
        );
        assert_eq!(link_node_id(&json!(3)), None);
    }

    #[test]
    fn filter_keeps_allowed_nodes_and_links_between_them() {
        let nodes = [
            json!({ "id": "a" }),
            json!({ "id": "b" }),
            json!({ "id": "c" }),
        ];
        let links = [
            json!({ "source": "a", "target": "b" }),
            json!({ "source": "b", "target": "c" }),
            json!({ "source": { "id": "a" }, "target": { "id": "c" } }),
        ];
        let (all_nodes, all_links) = filter_graph_by_nodes(&nodes, &links, None);
        assert_eq!((all_nodes.len(), all_links.len()), (3, 3));

        let allowed: HashSet<String> = ["a".into(), "b".into()].into();
        let (kept, kept_links) = filter_graph_by_nodes(&nodes, &links, Some(&allowed));
        assert_eq!(kept, vec![json!({ "id": "a" }), json!({ "id": "b" })]);
        assert_eq!(kept_links, vec![json!({ "source": "a", "target": "b" })]);
    }

    #[test]
    fn clone_links_turns_object_endpoints_into_ids_and_keeps_fields() {
        let links = [json!({ "source": { "id": "x", "x": 1.5 }, "target": "y", "color": "#000" })];
        assert_eq!(
            clone_links(&links),
            vec![json!({ "source": "x", "target": "y", "color": "#000" })]
        );
    }
}

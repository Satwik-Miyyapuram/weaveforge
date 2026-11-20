//! The relation graph around one item, read from the index (`index_relations_graph`).

use std::collections::{BTreeSet, VecDeque};

use serde::Serialize;

use super::store::{IndexStore, Relation};

/// One node of a relation graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// The item id.
    pub id: String,
    /// The title, when a file declares the id.
    pub title: Option<String>,
    /// The kind, when a file declares the id.
    pub kind: Option<String>,
    /// True when no file declares the id: a dangling target, shown with a badge.
    pub missing: bool,
}

/// The nodes within `depth` hops of a root, and the relations between them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct RelationGraph {
    /// Nodes in the order they were reached, the root first.
    pub nodes: Vec<GraphNode>,
    /// Every relation walked, once each.
    pub edges: Vec<Relation>,
}

/// Walks relations in both directions from `root_id`, at most `depth` hops.
#[must_use]
pub fn relation_graph(store: &IndexStore, root_id: &str, depth: usize) -> RelationGraph {
    let mut graph = RelationGraph::default();
    let mut seen = BTreeSet::from([root_id.to_owned()]);
    let mut queue = VecDeque::from([(root_id.to_owned(), 0)]);
    while let Some((id, hops)) = queue.pop_front() {
        graph.nodes.push(node(store, &id));
        if hops == depth {
            continue;
        }
        for relation in store.relations_of(&id) {
            if !graph.edges.contains(relation) {
                graph.edges.push(relation.clone());
            }
            for next in [&relation.source_id, &relation.target_id] {
                if seen.insert(next.clone()) {
                    queue.push_back((next.clone(), hops + 1));
                }
            }
        }
    }
    graph
}

fn node(store: &IndexStore, id: &str) -> GraphNode {
    let entry = store.get(id);
    GraphNode {
        id: id.to_owned(),
        title: entry.map(|found| found.title.clone()),
        kind: entry.map(|found| found.kind.clone()),
        missing: entry.is_none(),
    }
}

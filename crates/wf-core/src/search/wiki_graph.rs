//! Port of packages/core/src/search/parts.ts. Pure.
//!
//! Nodes are `kind:id`, so they line up with search document ids. Edges come from wikilinks,
//! explicit paper relations and shared tags. Output follows insertion order, as the JS `Map`
//! and `Set` did, so no `HashMap` iteration reaches a result.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::papers::paper::extract_hashtags;
use crate::sync::workspace_snapshot::WorkspaceSnapshot;
use crate::vault::page::{extract_wikilinks, normalize_title_key};

/// Most documents one tag may connect before it is ignored (TS `MAX_TAG_FANOUT`).
const MAX_TAG_FANOUT: usize = 12;

/// One node and its neighbours, in insertion order (one TS `edges` entry).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiGraphEdges {
    /// The node, `kind:id`.
    pub node: String,
    /// Undirected neighbours, in insertion order.
    pub neighbours: Vec<String>,
}

/// The wiki-link graph over a workspace (TS `WikiGraph`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiGraph {
    /// Nodes in insertion order.
    pub nodes: Vec<String>,
    /// Adjacency, undirected: a link implies relatedness in both directions.
    pub edges: Vec<WikiGraphEdges>,
}

/// Link count for one node (one TS `graphDegrees` entry).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiGraphDegree {
    /// The node, `kind:id`.
    pub node: String,
    /// Number of neighbours.
    pub degree: f64,
}

/// Measured shape of a graph (TS `GraphDensity`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphDensity {
    /// Node count.
    pub nodes: f64,
    /// Undirected edge count.
    pub edges: f64,
    /// Mean degree; the reference cascade uses density to pick an arm.
    pub mean_degree: f64,
    /// Fraction of nodes in the largest connected component.
    pub largest_component_ratio: f64,
}

/// Insertion-ordered lists keyed by string: the Rust twin of a JS `Map<string, string[]>`.
#[derive(Default)]
struct OrderedLists {
    entries: Vec<(String, Vec<String>)>,
    index: HashMap<String, usize>,
}

impl OrderedLists {
    /// Creates `key` with an empty list when it is missing.
    fn ensure(&mut self, key: &str) {
        if self.index.contains_key(key) {
            return;
        }
        let _ = self.index.insert(key.to_owned(), self.entries.len());
        self.entries.push((key.to_owned(), Vec::new()));
    }

    /// Appends `value` to `key`'s list, duplicates included.
    fn push(&mut self, key: &str, value: String) {
        self.ensure(key);
        if let Some(&at) = self.index.get(key)
            && let Some((_, list)) = self.entries.get_mut(at)
        {
            list.push(value);
        }
    }

    /// Appends `value` to `key`'s list unless it is already there.
    fn push_unique(&mut self, key: &str, value: &str) {
        self.ensure(key);
        if let Some(&at) = self.index.get(key)
            && let Some((_, list)) = self.entries.get_mut(at)
            && !list.iter().any(|item| item == value)
        {
            list.push(value.to_owned());
        }
    }

    /// Adds an undirected edge: self-edges are ignored (TS `addEdge`).
    fn add_edge(&mut self, from: &str, to: &str) {
        if from == to {
            return;
        }
        self.push_unique(from, to);
    }

    /// The entries in insertion order.
    fn into_entries(self) -> Vec<(String, Vec<String>)> {
        self.entries
    }
}

/// Node ids and title lookups, filled from the snapshot's documents.
#[derive(Default)]
struct Documents {
    nodes: Vec<String>,
    node_set: HashSet<String>,
    note_by_title: HashMap<String, String>,
    paper_by_title: HashMap<String, String>,
    section_by_title: HashMap<String, String>,
}

impl Documents {
    /// Adds `node` once, keeping the first position.
    fn add_node(&mut self, node: String) {
        if self.node_set.insert(node.clone()) {
            self.nodes.push(node);
        }
    }

    /// Resolves a wikilink target: note, then paper, then section.
    fn resolve(&self, target: &str) -> Option<String> {
        let key = normalize_title_key(target);
        self.note_by_title
            .get(&key)
            .or_else(|| self.paper_by_title.get(&key))
            .or_else(|| self.section_by_title.get(&key))
            .cloned()
    }
}

/// Registers every note, paper and section as a node, keyed by normalized title.
fn index_documents(snapshot: &WorkspaceSnapshot) -> Documents {
    let mut docs = Documents::default();
    for page in &snapshot.vault_pages {
        let node = format!("note:{}", page.id);
        let _ = docs
            .note_by_title
            .insert(normalize_title_key(&page.title), node.clone());
        docs.add_node(node);
    }
    for paper in &snapshot.papers {
        let node = format!("paper:{}", paper.id);
        let _ = docs
            .paper_by_title
            .insert(normalize_title_key(&paper.title), node.clone());
        docs.add_node(node);
    }
    for section in &snapshot.report_sections {
        let node = format!("section:{}", section.id);
        let _ = docs
            .section_by_title
            .insert(normalize_title_key(&section.title), node.clone());
        docs.add_node(node);
    }
    docs
}

/// Adds the edges that `[[wikilinks]]` in `body` make from `source` (TS `linkFrom`).
fn add_link_edges(docs: &Documents, edges: &mut OrderedLists, source: &str, body: Option<&str>) {
    let Some(body) = body else {
        return;
    };
    for link in extract_wikilinks(body) {
        let Some(target) = docs.resolve(&link.target) else {
            continue;
        };
        if target == source {
            continue;
        }
        edges.add_edge(source, &target);
        edges.add_edge(&target, source);
    }
}

/// Adds explicit paper relations, when both papers are in the graph.
fn add_relation_edges(snapshot: &WorkspaceSnapshot, docs: &Documents, edges: &mut OrderedLists) {
    for relation in &snapshot.relations {
        let (Some(from), Some(to)) = (
            relation.get("fromPaper").and_then(Value::as_str),
            relation.get("toPaper").and_then(Value::as_str),
        ) else {
            continue;
        };
        let from = format!("paper:{from}");
        let to = format!("paper:{to}");
        if !docs.node_set.contains(&from) || !docs.node_set.contains(&to) {
            continue;
        }
        edges.add_edge(&from, &to);
        edges.add_edge(&to, &from);
    }
}

/// Connects documents that share a tag, unless the tag reaches more than `MAX_TAG_FANOUT`.
fn add_tag_edges(snapshot: &WorkspaceSnapshot, edges: &mut OrderedLists) {
    let mut by_tag = OrderedLists::default();
    for page in &snapshot.vault_pages {
        let node = format!("note:{}", page.id);
        for tag in extract_hashtags(Some(&page.body)) {
            by_tag.push(&tag, node.clone());
        }
    }
    for paper in &snapshot.papers {
        let node = format!("paper:{}", paper.id);
        for tag in &paper.tags {
            by_tag.push(tag, node.clone());
        }
    }
    for (_, members) in by_tag.into_entries() {
        if members.len() < 2 || members.len() > MAX_TAG_FANOUT {
            continue;
        }
        for (i, first) in members.iter().enumerate() {
            for second in members.iter().skip(i + 1) {
                edges.add_edge(first, second);
                edges.add_edge(second, first);
            }
        }
    }
}

/// Build the graph (TS `buildWikiGraph`).
///
/// Wikilink targets resolve note, then paper, then section, by normalized title.
#[must_use]
pub fn build_wiki_graph(snapshot: &WorkspaceSnapshot) -> WikiGraph {
    let docs = index_documents(snapshot);
    let mut edges = OrderedLists::default();
    for page in &snapshot.vault_pages {
        let source = format!("note:{}", page.id);
        add_link_edges(&docs, &mut edges, &source, Some(&page.body));
    }
    for paper in &snapshot.papers {
        let source = format!("paper:{}", paper.id);
        add_link_edges(&docs, &mut edges, &source, paper.summary.as_deref());
    }
    for section in &snapshot.report_sections {
        let source = format!("section:{}", section.id);
        add_link_edges(&docs, &mut edges, &source, section.notes.as_deref());
    }
    add_relation_edges(snapshot, &docs, &mut edges);
    add_tag_edges(snapshot, &mut edges);
    for node in &docs.nodes {
        edges.ensure(node);
    }
    let edges = edges
        .into_entries()
        .into_iter()
        .map(|(node, neighbours)| WikiGraphEdges { node, neighbours })
        .collect();
    WikiGraph {
        nodes: docs.nodes,
        edges,
    }
}

/// A count as `f64`; graph sizes are far below 2^53, so the conversion is exact.
#[allow(
    clippy::cast_precision_loss,
    reason = "graph sizes are far below 2^53, so the f64 is exact"
)]
fn count_f64(count: usize) -> f64 {
    count as f64
}

/// Link count per node, in the graph's edge order (TS `graphDegrees`).
#[must_use]
pub fn graph_degrees(graph: &WikiGraph) -> Vec<WikiGraphDegree> {
    graph
        .edges
        .iter()
        .map(|entry| WikiGraphDegree {
            node: entry.node.clone(),
            degree: count_f64(entry.neighbours.len()),
        })
        .collect()
}

/// Size of the largest connected component, walked with an explicit stack.
fn largest_component(graph: &WikiGraph, neighbours: &HashMap<&str, &[String]>) -> usize {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut largest = 0;
    for start in &graph.nodes {
        if seen.contains(start.as_str()) {
            continue;
        }
        let mut size = 0;
        let mut stack = vec![start.as_str()];
        let _ = seen.insert(start.as_str());
        while let Some(node) = stack.pop() {
            size += 1;
            for next in neighbours.get(node).copied().unwrap_or(&[]) {
                if seen.insert(next.as_str()) {
                    stack.push(next.as_str());
                }
            }
        }
        largest = largest.max(size);
    }
    largest
}

/// Measure the graph (TS `graphDensity`). Sparse graphs degrade PPR to "return the seed".
#[must_use]
pub fn graph_density(graph: &WikiGraph) -> GraphDensity {
    let node_count = graph.nodes.len();
    if node_count == 0 {
        return GraphDensity {
            nodes: 0.0,
            edges: 0.0,
            mean_degree: 0.0,
            largest_component_ratio: 0.0,
        };
    }
    let edge_ends: usize = graph.edges.iter().map(|entry| entry.neighbours.len()).sum();
    let neighbours: HashMap<&str, &[String]> = graph
        .edges
        .iter()
        .map(|entry| (entry.node.as_str(), entry.neighbours.as_slice()))
        .collect();
    let largest = largest_component(graph, &neighbours);
    GraphDensity {
        nodes: count_f64(node_count),
        edges: count_f64(edge_ends) / 2.0,
        mean_degree: count_f64(edge_ends) / count_f64(node_count),
        largest_component_ratio: count_f64(largest) / count_f64(node_count),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::workspace_snapshot::{SnapshotPaper, SnapshotVaultPage};
    use serde_json::json;

    fn note(id: &str, title: &str, body: &str) -> SnapshotVaultPage {
        SnapshotVaultPage {
            id: id.to_owned(),
            title: title.to_owned(),
            body: body.to_owned(),
            ..Default::default()
        }
    }

    fn paper(id: &str, title: &str, tags: &[&str]) -> SnapshotPaper {
        SnapshotPaper {
            id: id.to_owned(),
            title: title.to_owned(),
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
            ..Default::default()
        }
    }

    fn neighbours<'a>(graph: &'a WikiGraph, node: &str) -> Vec<&'a str> {
        graph
            .edges
            .iter()
            .find(|entry| entry.node == node)
            .map(|entry| entry.neighbours.iter().map(String::as_str).collect())
            .unwrap_or_default()
    }

    #[test]
    fn wikilink_resolves_across_kinds_and_is_undirected() {
        let snapshot = WorkspaceSnapshot {
            vault_pages: vec![note("a", "Alpha", "see [[Beta]] and [[Missing]]")],
            papers: vec![paper("b", "beta", &[])],
            ..Default::default()
        };
        let graph = build_wiki_graph(&snapshot);
        assert_eq!(graph.nodes, vec!["note:a", "paper:b"]);
        assert_eq!(neighbours(&graph, "note:a"), vec!["paper:b"]);
        assert_eq!(neighbours(&graph, "paper:b"), vec!["note:a"]);
    }

    #[test]
    fn self_and_unresolved_links_add_no_edges_but_keep_the_node() {
        let snapshot = WorkspaceSnapshot {
            vault_pages: vec![note("a", "Alpha", "[[Alpha]] [[Nope]]")],
            ..Default::default()
        };
        let graph = build_wiki_graph(&snapshot);
        assert_eq!(
            graph.edges,
            vec![WikiGraphEdges {
                node: "note:a".to_owned(),
                neighbours: Vec::new(),
            }]
        );
    }

    #[test]
    fn shared_tag_connects_documents_until_fanout_cap() {
        let mut papers = vec![paper("p1", "One", &["ml"]), paper("p2", "Two", &["ml"])];
        papers.extend((0..13).map(|i| paper(&format!("x{i}"), "T", &["big"])));
        let snapshot = WorkspaceSnapshot {
            papers,
            ..Default::default()
        };
        let graph = build_wiki_graph(&snapshot);
        assert_eq!(neighbours(&graph, "paper:p1"), vec!["paper:p2"]);
        assert!(neighbours(&graph, "paper:x0").is_empty());
    }

    #[test]
    fn relations_need_both_papers_in_the_graph() {
        let snapshot = WorkspaceSnapshot {
            papers: vec![paper("p1", "One", &[]), paper("p2", "Two", &[])],
            relations: vec![
                json!({"fromPaper": "p1", "toPaper": "p2"})
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
                json!({"fromPaper": "p1", "toPaper": "ghost"})
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
            ],
            ..Default::default()
        };
        let graph = build_wiki_graph(&snapshot);
        assert_eq!(neighbours(&graph, "paper:p1"), vec!["paper:p2"]);
    }

    #[test]
    fn density_counts_nodes_edges_and_largest_component() {
        let mut linked = paper("p1", "One", &[]);
        linked.summary = Some("[[Two]]".to_owned());
        let snapshot = WorkspaceSnapshot {
            papers: vec![linked, paper("p2", "Two", &[]), paper("p3", "Three", &[])],
            ..Default::default()
        };
        let density = graph_density(&build_wiki_graph(&snapshot));
        assert_eq!(density.nodes, 3.0);
        assert_eq!(density.edges, 1.0);
        assert!((density.mean_degree - 2.0 / 3.0).abs() < 1e-12);
        assert!((density.largest_component_ratio - 2.0 / 3.0).abs() < 1e-12);
    }
}

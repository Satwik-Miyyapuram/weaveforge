//! Port of packages/core/src/search/parts.ts: the arm and result types, the minimum seed
//! degree, the arm reason text, and `findRelated`. Pure: the lexical and tag arms are passed in
//! as closures, and the PPR `rng` is the `rng` parameter.

use super::personalized_pagerank::{PprOptions, RelatedNode, related_by_ppr};
use super::wiki_graph::WikiGraph;

/// Below this the seed has too little neighbourhood for a walk to say anything (TS `MIN_SEED_DEGREE_FOR_PPR`).
pub const MIN_SEED_DEGREE_FOR_PPR: usize = 3;

/// The method that found a related document (TS `RelatedArm`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum RelatedArm {
    /// Links between notes and papers.
    Graph,
    /// Similar wording.
    Lexical,
    /// Similar meaning.
    Semantic,
    /// Shared tags.
    Tags,
    /// Nothing related found.
    None,
}

/// One related document (TS `RelatedResult`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelatedResult {
    /// Document id.
    pub id: String,
    /// Rank-blend score; not a number with meaning on its own.
    pub score: f64,
    /// The method that ranked it first.
    pub arm: RelatedArm,
    /// Every method that found it, strongest first, when more than one ran.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub arms: Option<Vec<RelatedArm>>,
    /// Cosine similarity to the seed, 0–1, when the meaning arm found it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub similarity: Option<f64>,
}

/// Human-readable reason for an arm, so a thin result set is explained (TS `explainArm`).
#[must_use]
pub fn explain_arm(arm: RelatedArm) -> &'static str {
    match arm {
        RelatedArm::Graph => "From links between your notes and papers",
        RelatedArm::Lexical => "By similar wording — not enough links yet for the graph",
        RelatedArm::Semantic => "By similar meaning — not enough links yet for the graph",
        RelatedArm::Tags => "By shared tags",
        RelatedArm::None => "Nothing related found yet",
    }
}

/// Related documents for a seed (TS `findRelated`). Graph expansion first, then the lexical
/// arm, then the tag arm; the first non-empty arm wins and names every result it returns.
///
/// `lexical` and `tagged` take `(seed, limit)`, as the TS `deps` callbacks do, and run only when
/// the arms before them came back empty.
#[must_use]
pub fn find_related(
    seed: &str,
    graph: &WikiGraph,
    limit: usize,
    options: &PprOptions,
    rng: &mut impl FnMut() -> f64,
    lexical: impl FnOnce(&str, usize) -> Vec<RelatedNode>,
    tagged: impl FnOnce(&str, usize) -> Vec<RelatedNode>,
) -> Vec<RelatedResult> {
    let degree = graph
        .edges
        .iter()
        .find(|entry| entry.node == seed)
        .map_or(0, |entry| entry.neighbours.len());

    if degree >= MIN_SEED_DEGREE_FOR_PPR {
        let hits = related_by_ppr(graph, seed, limit, options, rng);
        if !hits.is_empty() {
            return tag_arm(hits, RelatedArm::Graph);
        }
    }

    let hits = lexical(seed, limit);
    if !hits.is_empty() {
        return tag_arm(hits, RelatedArm::Lexical);
    }

    let hits = tagged(seed, limit);
    if !hits.is_empty() {
        return tag_arm(hits, RelatedArm::Tags);
    }

    Vec::new()
}

fn tag_arm(hits: Vec<RelatedNode>, arm: RelatedArm) -> Vec<RelatedResult> {
    hits.into_iter()
        .map(|hit| RelatedResult {
            id: hit.id,
            score: hit.score,
            arm,
            arms: None,
            similarity: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::wiki_graph::WikiGraphEdges;
    use super::*;

    /// A graph from `(node, neighbours)` pairs, in the order given.
    fn graph(edges: &[(&str, &[&str])]) -> WikiGraph {
        WikiGraph {
            nodes: edges.iter().map(|(node, _)| (*node).to_owned()).collect(),
            edges: edges
                .iter()
                .map(|(node, neighbours)| WikiGraphEdges {
                    node: (*node).to_owned(),
                    neighbours: neighbours.iter().map(|n| (*n).to_owned()).collect(),
                })
                .collect(),
        }
    }

    fn hit(id: &str, score: f64) -> RelatedNode {
        RelatedNode {
            id: id.to_owned(),
            score,
        }
    }

    /// Always lands above the teleport damping, so walks never restart.
    fn steady_rng() -> impl FnMut() -> f64 {
        || 0.99
    }

    #[test]
    fn thin_seed_skips_the_graph_arm_and_uses_lexical() {
        let g = graph(&[("note:s", &["note:a"]), ("note:a", &["note:s"])]);
        let found = find_related(
            "note:s",
            &g,
            5,
            &PprOptions::default(),
            &mut steady_rng(),
            |_, _| vec![hit("note:b", 0.4)],
            |_, _| panic!("tags must not run once lexical found something"),
        );
        assert_eq!(
            found,
            vec![RelatedResult {
                id: "note:b".to_owned(),
                score: 0.4,
                arm: RelatedArm::Lexical,
                arms: None,
                similarity: None,
            }]
        );
    }

    #[test]
    fn empty_lexical_falls_through_to_tags() {
        let g = graph(&[("note:a", &[])]);
        let found = find_related(
            "note:a",
            &g,
            5,
            &PprOptions::default(),
            &mut steady_rng(),
            |_, _| Vec::new(),
            |_, _| vec![hit("note:z", 0.1)],
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "note:z");
        assert_eq!(found[0].arm, RelatedArm::Tags);
    }

    #[test]
    fn nothing_found_is_empty() {
        let g = graph(&[]);
        let found = find_related(
            "note:none",
            &g,
            5,
            &PprOptions::default(),
            &mut steady_rng(),
            |_, _| Vec::new(),
            |_, _| Vec::new(),
        );
        assert!(found.is_empty());
    }

    #[test]
    fn well_connected_seed_uses_the_graph_arm() {
        // Seed linked to three notes, which link to each other.
        let g = graph(&[
            ("note:hub", &["note:a", "note:b", "note:c"]),
            ("note:a", &["note:hub", "note:b"]),
            ("note:b", &["note:hub", "note:a"]),
            ("note:c", &["note:hub"]),
        ]);
        let options = PprOptions {
            num_walks: Some(200),
            max_steps: Some(10),
            damping: None,
        };
        let found = find_related(
            "note:hub",
            &g,
            5,
            &options,
            &mut steady_rng(),
            |_, _| panic!("lexical must not run when the graph arm found something"),
            |_, _| panic!("tags must not run when the graph arm found something"),
        );
        assert!(!found.is_empty());
        assert!(found.iter().all(|r| r.arm == RelatedArm::Graph));
        assert!(found.iter().all(|r| r.id != "note:hub"));
    }

    #[test]
    fn explain_arm_gives_the_reason_text() {
        assert_eq!(
            explain_arm(RelatedArm::Graph),
            "From links between your notes and papers"
        );
        assert_eq!(
            explain_arm(RelatedArm::Lexical),
            "By similar wording — not enough links yet for the graph"
        );
        assert_eq!(
            explain_arm(RelatedArm::Semantic),
            "By similar meaning — not enough links yet for the graph"
        );
        assert_eq!(explain_arm(RelatedArm::Tags), "By shared tags");
        assert_eq!(explain_arm(RelatedArm::None), "Nothing related found yet");
    }

    #[test]
    fn arms_serialize_as_lowercase_names() {
        assert_eq!(
            serde_json::to_string(&RelatedArm::Semantic).unwrap(),
            "\"semantic\""
        );
        assert_eq!(
            serde_json::to_string(&RelatedArm::None).unwrap(),
            "\"none\""
        );
        let arm: RelatedArm = serde_json::from_str("\"tags\"").unwrap();
        assert_eq!(arm, RelatedArm::Tags);
    }

    #[test]
    fn result_omits_absent_optionals_and_keeps_key_order() {
        let bare = RelatedResult {
            id: "a".to_owned(),
            score: 0.5,
            arm: RelatedArm::Lexical,
            arms: None,
            similarity: None,
        };
        assert_eq!(
            serde_json::to_string(&bare).unwrap(),
            r#"{"id":"a","score":0.5,"arm":"lexical"}"#
        );
        let full = RelatedResult {
            id: "b".to_owned(),
            score: 0.25,
            arm: RelatedArm::Graph,
            arms: Some(vec![RelatedArm::Graph, RelatedArm::Semantic]),
            similarity: Some(0.5),
        };
        assert_eq!(
            serde_json::to_string(&full).unwrap(),
            r#"{"id":"b","score":0.25,"arm":"graph","arms":["graph","semantic"],"similarity":0.5}"#
        );
    }

    #[test]
    fn result_reads_missing_optionals_as_none() {
        let hit: RelatedResult =
            serde_json::from_str(r#"{"id":"c","score":1.5,"arm":"tags"}"#).unwrap();
        assert_eq!(hit.arms, None);
        assert_eq!(hit.similarity, None);
        assert_eq!(hit.arm, RelatedArm::Tags);
    }
}

//! The key that tells the graph simulation when its layout inputs changed,
//! ported from `graphTopologyKey` in
//! `apps/web/src/features/relations/application/graph-timeline.ts`.
//!
//! Node and link ids are sorted by UTF-16 code units, as JS `sort()` does, so
//! the key does not depend on the order the graph lists them in.

use serde::Deserialize;

/// One graph node or link, as far as the key reads it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct IdRef {
    /// The id the graph uses for this node or link.
    pub id: String,
}

/// What the simulation is laid out over: the shown nodes and links.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyInput {
    /// Nodes on screen.
    pub nodes: Vec<IdRef>,
    /// Links on screen.
    pub links: Vec<IdRef>,
}

/// A change to this key restarts the simulation.
#[must_use]
pub fn graph_topology_key(
    shown: &TopologyInput,
    local_seed: Option<&str>,
    local_depth: f64,
) -> String {
    format!(
        "{}|{}|{}|{}",
        sorted_ids(&shown.nodes),
        sorted_ids(&shown.links),
        local_seed.unwrap_or(""),
        js_number_text(local_depth),
    )
}

/// Ids sorted by UTF-16 code units and joined with commas, as JS `sort().join(",")`.
fn sorted_ids(items: &[IdRef]) -> String {
    let mut ids: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
    ids.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    ids.join(",")
}

/// JS `String(number)` for the values the graph passes: whole and small
/// fractional depths. `-0` prints as `0`, as in JS.
fn js_number_text(number: f64) -> String {
    if number.is_nan() {
        "NaN".to_owned()
    } else if number.is_infinite() {
        (if number > 0.0 {
            "Infinity"
        } else {
            "-Infinity"
        })
        .to_owned()
    } else if number == 0.0 {
        "0".to_owned()
    } else {
        format!("{number}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str) -> IdRef {
        IdRef { id: id.to_owned() }
    }

    fn topology(nodes: &[&str], links: &[&str]) -> TopologyInput {
        TopologyInput {
            nodes: nodes.iter().map(|id| node(id)).collect(),
            links: links.iter().map(|id| node(id)).collect(),
        }
    }

    #[test]
    fn the_topology_key_ignores_order_and_includes_the_local_view() {
        let a = graph_topology_key(&topology(&["b", "a"], &["y", "x"]), Some("a"), 2.0);
        let b = graph_topology_key(&topology(&["a", "b"], &["x", "y"]), Some("a"), 2.0);
        assert_eq!(a, b);
        assert_eq!(a, "a,b|x,y|a|2");
        assert_eq!(graph_topology_key(&topology(&[], &[]), None, 1.0), "|||1");
    }

    #[test]
    fn ids_sort_by_utf16_code_units_like_js() {
        // U+1F600 is D83D DE00 in UTF-16, below U+FFFD, so it sorts first.
        let key = graph_topology_key(&topology(&["\u{fffd}", "\u{1f600}"], &[]), None, 0.0);
        assert_eq!(key, "\u{1f600},\u{fffd}|||0");
    }

    #[test]
    fn a_missing_seed_is_blank_and_depth_formats_like_js() {
        assert_eq!(
            graph_topology_key(&topology(&["a"], &["l"]), None, 0.0),
            "a|l||0"
        );
        assert_eq!(
            graph_topology_key(&topology(&[], &[]), Some(""), -0.0),
            "|||0"
        );
        assert_eq!(graph_topology_key(&topology(&[], &[]), None, 0.5), "|||0.5");
        assert_eq!(
            graph_topology_key(&topology(&[], &[]), None, f64::NAN),
            "|||NaN"
        );
        assert_eq!(
            graph_topology_key(&topology(&[], &[]), None, f64::NEG_INFINITY),
            "|||-Infinity"
        );
    }
}

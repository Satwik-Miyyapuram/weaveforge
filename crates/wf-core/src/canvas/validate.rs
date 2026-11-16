//! Checks a canvas against the JSON Canvas 1.0 rules. Reading never fails on these: the
//! canvas still opens, and the editor shows the issues.

use std::collections::HashSet;

use serde::Serialize;

use super::{Canvas, CanvasEdge, CanvasNode};

/// One rule a canvas breaks.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CanvasIssue {
    /// `missing-id`, `duplicate-id`, `missing-field`, `bad-size`, `missing-node`, `bad-side`,
    /// `bad-end` or `bad-color`.
    pub code: String,
    /// Id of the node or edge at fault (empty when it has none).
    pub id: String,
    /// What is wrong, for a person.
    pub message: String,
}

const SIDES: [&str; 4] = ["top", "right", "bottom", "left"];
const ENDS: [&str; 2] = ["none", "arrow"];

/// Every rule `canvas` breaks, nodes first, in file order.
#[must_use]
pub fn validate(canvas: &Canvas) -> Vec<CanvasIssue> {
    let mut issues = Vec::new();
    let mut node_ids = HashSet::new();
    for node in &canvas.nodes {
        check_id(&node.id, "node", &mut node_ids, &mut issues);
        check_node(node, &mut issues);
    }
    let mut edge_ids = HashSet::new();
    for edge in &canvas.edges {
        check_id(&edge.id, "edge", &mut edge_ids, &mut issues);
        check_edge(edge, &node_ids, &mut issues);
    }
    issues
}

fn issue(issues: &mut Vec<CanvasIssue>, code: &str, id: &str, message: String) {
    issues.push(CanvasIssue {
        code: code.to_owned(),
        id: id.to_owned(),
        message,
    });
}

fn check_id<'a>(
    id: &'a str,
    what: &str,
    seen: &mut HashSet<&'a str>,
    issues: &mut Vec<CanvasIssue>,
) {
    if id.is_empty() {
        issue(issues, "missing-id", id, format!("A {what} has no id."));
    } else if !seen.insert(id) {
        issue(
            issues,
            "duplicate-id",
            id,
            format!("Two {what}s share the id {id}."),
        );
    }
}

fn check_node(node: &CanvasNode, issues: &mut Vec<CanvasIssue>) {
    let required = match node.kind.as_str() {
        "text" => Some(("text", node.text.is_some())),
        "file" => Some(("file", node.file.as_deref().is_some_and(|f| !f.is_empty()))),
        "link" => Some(("url", node.url.as_deref().is_some_and(|u| !u.is_empty()))),
        "" => Some(("type", false)),
        // `group` needs nothing more; an unknown type is a later version's and is kept as is.
        _ => None,
    };
    if let Some((field, false)) = required {
        issue(
            issues,
            "missing-field",
            &node.id,
            format!("Node {} has no {field}.", node.id),
        );
    }
    if !(node.width > 0.0 && node.height > 0.0) {
        issue(
            issues,
            "bad-size",
            &node.id,
            format!("Node {} has no positive width and height.", node.id),
        );
    }
    check_color(node.color.as_deref(), &node.id, issues);
}

fn check_edge(edge: &CanvasEdge, nodes: &HashSet<&str>, issues: &mut Vec<CanvasIssue>) {
    for end in [&edge.from_node, &edge.to_node] {
        if !nodes.contains(end.as_str()) {
            issue(
                issues,
                "missing-node",
                &edge.id,
                format!(
                    "Edge {} points to a node that is not there ({end}).",
                    edge.id
                ),
            );
        }
    }
    for side in [&edge.from_side, &edge.to_side].into_iter().flatten() {
        if !SIDES.contains(&side.as_str()) {
            issue(
                issues,
                "bad-side",
                &edge.id,
                format!("Edge {} has side {side}.", edge.id),
            );
        }
    }
    for end in [&edge.from_end, &edge.to_end].into_iter().flatten() {
        if !ENDS.contains(&end.as_str()) {
            issue(
                issues,
                "bad-end",
                &edge.id,
                format!("Edge {} has end {end}.", edge.id),
            );
        }
    }
    check_color(edge.color.as_deref(), &edge.id, issues);
}

/// A preset `1`..`6`, or `#` with 3 or 6 hex digits.
fn check_color(color: Option<&str>, id: &str, issues: &mut Vec<CanvasIssue>) {
    let Some(color) = color else { return };
    let preset = matches!(color, "1" | "2" | "3" | "4" | "5" | "6");
    let hex = color.strip_prefix('#').is_some_and(|digits| {
        matches!(digits.len(), 3 | 6) && digits.chars().all(|c| c.is_ascii_hexdigit())
    });
    if !preset && !hex {
        issue(issues, "bad-color", id, format!("{id} has colour {color}."));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::parse_canvas;

    fn codes(text: &str) -> Vec<(String, String)> {
        validate(&parse_canvas(text).unwrap())
            .into_iter()
            .map(|i| (i.code, i.id))
            .collect()
    }

    fn pair(code: &str, id: &str) -> (String, String) {
        (code.to_owned(), id.to_owned())
    }

    #[test]
    fn a_well_formed_canvas_has_no_issues() {
        let text = r##"{"nodes":[
            {"id":"t","type":"text","text":"","x":0,"y":0,"width":10,"height":10,"color":"1"},
            {"id":"f","type":"file","file":"a.md","subpath":"#h","x":0,"y":0,"width":10,"height":10},
            {"id":"l","type":"link","url":"https://a.org","x":0,"y":0,"width":10,"height":10,"color":"#a0B"},
            {"id":"g","type":"group","x":0,"y":0,"width":10,"height":10}],
          "edges":[{"id":"e","fromNode":"t","fromSide":"left","fromEnd":"none",
                    "toNode":"g","toSide":"top","toEnd":"arrow","color":"#ff0000"}]}"##;
        assert_eq!(codes(text), Vec::<(String, String)>::new());
    }

    #[test]
    fn duplicate_and_missing_ids_are_reported_per_kind() {
        let text = r#"{"nodes":[
            {"id":"a","type":"group","x":0,"y":0,"width":1,"height":1},
            {"id":"a","type":"group","x":0,"y":0,"width":1,"height":1},
            {"type":"group","x":0,"y":0,"width":1,"height":1}],
          "edges":[{"id":"a","fromNode":"a","toNode":"a"}]}"#;
        // A node and an edge may share an id; two nodes may not.
        assert_eq!(
            codes(text),
            vec![pair("duplicate-id", "a"), pair("missing-id", "")]
        );
    }

    #[test]
    fn edges_to_missing_nodes_are_reported_once_per_end() {
        let text = r#"{"nodes":[{"id":"a","type":"group","x":0,"y":0,"width":1,"height":1}],
          "edges":[{"id":"e","fromNode":"a","toNode":"gone"},{"id":"f","fromNode":"x","toNode":"y"}]}"#;
        assert_eq!(
            codes(text),
            vec![
                pair("missing-node", "e"),
                pair("missing-node", "f"),
                pair("missing-node", "f")
            ]
        );
    }

    #[test]
    fn required_fields_sizes_sides_ends_and_colours() {
        let text = r##"{"nodes":[
            {"id":"t","type":"text","x":0,"y":0,"width":0,"height":5},
            {"id":"f","type":"file","file":"","x":0,"y":0,"width":1,"height":1},
            {"id":"l","type":"link","x":0,"y":0,"width":1,"height":1,"color":"7"},
            {"id":"n","x":0,"y":0,"width":1,"height":1},
            {"id":"u","type":"future","x":0,"y":0,"width":1,"height":1,"color":"#12"}],
          "edges":[{"id":"e","fromNode":"t","toNode":"f","fromSide":"middle","toEnd":"dot"}]}"##;
        assert_eq!(
            codes(text),
            vec![
                pair("missing-field", "t"),
                pair("bad-size", "t"),
                pair("missing-field", "f"),
                pair("missing-field", "l"),
                pair("bad-color", "l"),
                pair("missing-field", "n"),
                pair("bad-color", "u"),
                pair("bad-side", "e"),
                pair("bad-end", "e"),
            ]
        );
    }

    #[test]
    fn nan_size_is_not_positive() {
        let mut canvas = Canvas::default();
        canvas.nodes.push(CanvasNode {
            id: "a".into(),
            kind: "group".into(),
            width: f64::NAN,
            height: 1.0,
            ..CanvasNode::default()
        });
        assert_eq!(validate(&canvas)[0].code, "bad-size");
    }
}

//! JSON Canvas 1.0 (<https://jsoncanvas.org>, MIT), the open format of Obsidian's `.canvas`
//! files. A canvas note keeps its body as this text, so a note opens in Obsidian unchanged.
//!
//! Reading is lenient and lossless: a missing required field reads as its empty value (and
//! [`validate`] reports it), an unknown node type or field is kept and written back. Writing
//! follows Obsidian's layout, one node or edge per line, so a moved node is a one-line diff.

use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Map, Value};

mod geometry;
mod validate;

pub use geometry::{CanvasRect, canvas_bounds, group_members, node_rect};
pub use validate::{CanvasIssue, validate};

/// A whole canvas: nodes in z-order (first is drawn at the back), then edges.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Canvas {
    /// Nodes, back to front.
    #[serde(default)]
    pub nodes: Vec<CanvasNode>,
    /// Edges between nodes.
    #[serde(default)]
    pub edges: Vec<CanvasEdge>,
    /// Top-level fields this version does not know, kept for the round trip.
    #[serde(flatten)]
    #[cfg_attr(feature = "specta", specta(skip))]
    pub extra: Map<String, Value>,
}

/// One node. `type` is `text`, `file`, `link` or `group`; the fields of the other types are
/// absent. Field order is Obsidian's, so written files diff cleanly against its own.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    /// Unique id within the canvas.
    #[serde(default)]
    pub id: String,
    /// `text`, `file`, `link`, `group`, or a type a later version adds.
    #[serde(rename = "type", default)]
    pub kind: String,
    /// Markdown of a text node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Vault path of a file node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Heading or block of a file node, starting with `#`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
    /// Address of a link node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Title of a group node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Background image path of a group node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// `cover`, `ratio` or `repeat`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_style: Option<String>,
    /// Left edge, in canvas pixels.
    #[serde(default, serialize_with = "whole")]
    pub x: f64,
    /// Top edge, in canvas pixels.
    #[serde(default, serialize_with = "whole")]
    pub y: f64,
    /// Width, in canvas pixels.
    #[serde(default, serialize_with = "whole")]
    pub width: f64,
    /// Height, in canvas pixels.
    #[serde(default, serialize_with = "whole")]
    pub height: f64,
    /// Preset `1`..`6` or a hex colour such as `#FF0000`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Fields this version does not know, kept for the round trip.
    #[serde(flatten)]
    #[cfg_attr(feature = "specta", specta(skip))]
    pub extra: Map<String, Value>,
}

/// One edge from a node to another.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    /// Unique id within the canvas.
    #[serde(default)]
    pub id: String,
    /// Node the edge starts at.
    #[serde(default)]
    pub from_node: String,
    /// `top`, `right`, `bottom` or `left`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_side: Option<String>,
    /// `none` (the default) or `arrow`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_end: Option<String>,
    /// Node the edge ends at.
    #[serde(default)]
    pub to_node: String,
    /// `top`, `right`, `bottom` or `left`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_side: Option<String>,
    /// `arrow` (the default) or `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_end: Option<String>,
    /// Preset `1`..`6` or a hex colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Text drawn on the edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Fields this version does not know, kept for the round trip.
    #[serde(flatten)]
    #[cfg_attr(feature = "specta", specta(skip))]
    pub extra: Map<String, Value>,
}

/// Writes a whole number without a fraction (`10`, not `10.0`), as JSON Canvas expects integers.
#[allow(
    clippy::trivially_copy_pass_by_ref,
    reason = "serde's serialize_with signature"
)]
fn whole<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    const LIMIT: f64 = 9_007_199_254_740_992.0; // 2^53: every integer below is exact in f64.
    if value.fract() == 0.0 && value.abs() < LIMIT {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "checked whole and in range above"
        )]
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}

/// Reads canvas text. Empty or blank text is an empty canvas (a new canvas note).
///
/// # Errors
///
/// Fails when the text is not JSON, not an object, or a field has the wrong JSON type
/// (`"x": "left"`, `"nodes": {}`).
pub fn parse_canvas(text: &str) -> Result<Canvas, String> {
    if text.trim().is_empty() {
        return Ok(Canvas::default());
    }
    let value: Value =
        serde_json::from_str(text).map_err(|e| format!("not a JSON Canvas file: {e}"))?;
    if !value.is_object() {
        return Err("not a JSON Canvas file: the top level is not an object".to_owned());
    }
    serde_json::from_value(value).map_err(|e| format!("not a JSON Canvas file: {e}"))
}

/// Writes a canvas as Obsidian does: tab indent, one compact node or edge per line, no
/// trailing newline.
#[must_use]
pub fn canvas_text(canvas: &Canvas) -> String {
    let mut out = String::from("{\n\t\"nodes\":[");
    push_lines(&mut out, &canvas.nodes);
    out.push_str("],\n\t\"edges\":[");
    push_lines(&mut out, &canvas.edges);
    out.push(']');
    for (key, value) in &canvas.extra {
        out.push_str(",\n\t");
        out.push_str(&compact(&Value::String(key.clone())));
        out.push(':');
        out.push_str(&compact(value));
    }
    out.push_str("\n}");
    out
}

fn push_lines<T: Serialize>(out: &mut String, items: &[T]) {
    if items.is_empty() {
        return;
    }
    for (i, item) in items.iter().enumerate() {
        out.push_str(if i == 0 { "\n\t\t" } else { ",\n\t\t" });
        out.push_str(&compact(item));
    }
    out.push_str("\n\t");
}

fn compact<T: Serialize + ?Sized>(value: &T) -> String {
    // Serialising plain data with string keys cannot fail.
    serde_json::to_string(value).unwrap_or_default()
}

/// Reads then rewrites canvas text: the form a canvas note is saved and exported in.
///
/// # Errors
///
/// As [`parse_canvas`].
pub fn normalize_canvas_text(text: &str) -> Result<String, String> {
    parse_canvas(text).map(|canvas| canvas_text(&canvas))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const OBSIDIAN: &str = "{\n\t\"nodes\":[\n\t\t{\"id\":\"8132d4d894c80022\",\"type\":\"file\",\"file\":\"readme.md\",\"x\":-280,\"y\":-200,\"width\":570,\"height\":560,\"color\":\"6\"},\n\t\t{\"id\":\"7efdbbe0c4742315\",\"type\":\"text\",\"text\":\"# Hello\\n\\nworld\",\"x\":-480,\"y\":440,\"width\":250,\"height\":60}\n\t],\n\t\"edges\":[\n\t\t{\"id\":\"816c5b2b6a2ee5d7\",\"fromNode\":\"7efdbbe0c4742315\",\"fromSide\":\"right\",\"toNode\":\"8132d4d894c80022\",\"toSide\":\"left\"}\n\t]\n}";

    #[test]
    fn obsidian_text_round_trips_byte_for_byte() {
        let canvas = parse_canvas(OBSIDIAN).unwrap();
        assert_eq!(canvas.nodes.len(), 2);
        assert_eq!(canvas.nodes[1].text.as_deref(), Some("# Hello\n\nworld"));
        assert_eq!(canvas.edges[0].from_side.as_deref(), Some("right"));
        assert_eq!(canvas_text(&canvas), OBSIDIAN);
    }

    #[test]
    fn blank_text_is_an_empty_canvas_and_writes_both_arrays() {
        let canvas = parse_canvas("  \n").unwrap();
        assert_eq!(canvas, Canvas::default());
        assert_eq!(
            canvas_text(&canvas),
            "{\n\t\"nodes\":[],\n\t\"edges\":[]\n}"
        );
        assert_eq!(parse_canvas("{}").unwrap(), Canvas::default());
    }

    #[test]
    fn unknown_fields_and_types_survive_a_round_trip() {
        let text = json!({
            "nodes": [{"id": "a", "type": "sticker", "x": 1, "y": 2, "width": 3, "height": 4,
                       "emoji": "smile", "styleAttributes": {"shape": "pill"}}],
            "edges": [{"id": "e", "fromNode": "a", "toNode": "a", "wobble": 3}],
            "metadata": {"version": "1.0-1.0"}
        })
        .to_string();
        let canvas = parse_canvas(&text).unwrap();
        assert_eq!(canvas.nodes[0].kind, "sticker");
        let again: Value = serde_json::from_str(&canvas_text(&canvas)).unwrap();
        let original: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(again, original);
    }

    #[test]
    fn whole_numbers_lose_the_fraction_and_fractions_stay() {
        let canvas = parse_canvas(
            r#"{"nodes":[{"id":"a","type":"text","text":"","x":10.0,"y":-0.5,"width":1e2,"height":3}]}"#,
        )
        .unwrap();
        let line = canvas_text(&canvas);
        assert!(
            line.contains("\"x\":10,\"y\":-0.5,\"width\":100,\"height\":3"),
            "{line}"
        );
    }

    #[test]
    fn missing_required_fields_read_as_empty_values() {
        let canvas = parse_canvas(r#"{"nodes":[{"type":"text"}]}"#).unwrap();
        assert_eq!(canvas.nodes[0].id, "");
        assert!(canvas.nodes[0].width.abs() < f64::EPSILON);
    }

    #[test]
    fn malformed_input_is_an_error_not_a_panic() {
        for bad in [
            "{",
            "[]",
            "\"text\"",
            r#"{"nodes":{}}"#,
            r#"{"nodes":[{"id":"a","x":"left"}]}"#,
            r#"{"edges":[1]}"#,
            r#"{"nodes":[{"id":7}]}"#,
        ] {
            let err = parse_canvas(bad).unwrap_err();
            assert!(err.starts_with("not a JSON Canvas file"), "{bad}: {err}");
        }
    }

    #[test]
    fn normalize_rewrites_spaced_json_in_obsidian_layout() {
        let spaced = "{ \"nodes\": [ { \"id\": \"a\", \"type\": \"link\", \"url\": \"https://x.org\", \"x\": 0, \"y\": 0, \"width\": 400, \"height\": 400 } ] }";
        assert_eq!(
            normalize_canvas_text(spaced).unwrap(),
            "{\n\t\"nodes\":[\n\t\t{\"id\":\"a\",\"type\":\"link\",\"url\":\"https://x.org\",\"x\":0,\"y\":0,\"width\":400,\"height\":400}\n\t],\n\t\"edges\":[]\n}"
        );
    }

    #[test]
    fn extra_top_level_fields_are_written_after_edges_in_order() {
        let canvas = parse_canvas(r#"{"z":1,"nodes":[],"a":{"b":[1]}}"#).unwrap();
        assert_eq!(
            canvas_text(&canvas),
            "{\n\t\"nodes\":[],\n\t\"edges\":[],\n\t\"z\":1,\n\t\"a\":{\"b\":[1]}\n}"
        );
    }

    #[test]
    fn huge_and_odd_numbers_still_write_valid_json() {
        let mut canvas = Canvas::default();
        canvas.nodes.push(CanvasNode {
            id: "a".into(),
            kind: "text".into(),
            x: 1e300,
            y: -0.0,
            ..CanvasNode::default()
        });
        let text = canvas_text(&canvas);
        assert!(serde_json::from_str::<Value>(&text).is_ok(), "{text}");
    }
}

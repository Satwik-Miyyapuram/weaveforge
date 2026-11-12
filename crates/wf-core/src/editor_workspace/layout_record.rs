//! The pane layout as stored: a saved record parsed back into a layout.
//! Port of the parse half of `features/editor-workspace/application/layout-storage.ts`
//! (`readLayout`, `parseNode`, `parseTab`, `parseGroups`, `firstLeafId`).
//!
//! Validated rather than trusted: a record that does not parse is one empty pane.
//! Pure: the raw text in, the layout out. Reading and writing storage stay in TS.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    reason = "tab counts are far below i32::MAX, and the index is clamped to the tab count before the cast"
)]

use serde_json::{Map, Value};

use super::pane_tree::{
    DEFAULT_PANE_ID, DocumentMode, PaneLayout, PaneLeaf, PaneNode, PaneSplit, SplitDirection,
    TabRef, empty_layout,
};
use super::tab_groups::{GROUP_COLORS, TabGroup, clean_groups};

/// The layout a stored record describes, or one empty pane when there is no usable record.
#[must_use]
pub fn layout_from_record(raw: Option<&str>) -> PaneLayout {
    let Some(text) = raw.filter(|t| !t.is_empty()) else {
        return empty_layout(DEFAULT_PANE_ID);
    };
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return empty_layout(DEFAULT_PANE_ID);
    };
    let Some(record) = parsed.as_object() else {
        return empty_layout(DEFAULT_PANE_ID);
    };
    let Some(root) = record.get("root").and_then(parse_node) else {
        return empty_layout(DEFAULT_PANE_ID);
    };
    // `settleFocus` corrects a focus id that no longer matches a pane on the
    // first operation, so an absent or empty one falls back to the first leaf.
    let focused = record
        .get("focusedPaneId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let focused_pane_id = if focused.is_empty() {
        first_leaf_id(&root).to_owned()
    } else {
        focused.to_owned()
    };
    PaneLayout {
        root,
        focused_pane_id,
    }
}

fn parse_node(value: &Value) -> Option<PaneNode> {
    let node = value.as_object()?;
    match node.get("type").and_then(Value::as_str) {
        Some("leaf") => parse_leaf(node).map(PaneNode::Leaf),
        Some("split") => parse_split(node),
        _ => None,
    }
}

fn parse_leaf(node: &Map<String, Value>) -> Option<PaneLeaf> {
    let id = node.get("id")?.as_str()?;
    let raw_tabs = node.get("tabs")?.as_array()?;
    let tabs: Vec<TabRef> = raw_tabs.iter().filter_map(parse_tab).collect();
    let last = (tabs.len() as f64 - 1.0).max(0.0);
    let requested = node
        .get("activeIndex")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let active_index = requested.clamp(0.0, last) as i32;
    let leaf = PaneLeaf {
        id: id.to_owned(),
        tabs,
        active_index,
        groups: Some(parse_groups(node.get("groups"))),
    };
    Some(clean_groups(&leaf))
}

/// Keeps whichever side parsed; a split with both sides gets its ratio and direction.
fn parse_split(node: &Map<String, Value>) -> Option<PaneNode> {
    let children = node.get("children")?.as_array()?;
    let [first, second] = children.as_slice() else {
        return None;
    };
    match (parse_node(first), parse_node(second)) {
        (None, second) => second,
        (first, None) => first,
        (Some(first), Some(second)) => {
            let ratio = node.get("ratio").and_then(Value::as_f64).unwrap_or(0.5);
            let direction = if node.get("direction").and_then(Value::as_str) == Some("column") {
                SplitDirection::Column
            } else {
                SplitDirection::Row
            };
            Some(PaneNode::Split(PaneSplit {
                direction,
                ratio: ratio.clamp(0.1, 0.9),
                children: (Box::new(first), Box::new(second)),
            }))
        }
    }
}

/// A tab needs a string kind and id. An unknown mode reads as none chosen yet.
fn parse_tab(value: &Value) -> Option<TabRef> {
    let tab = value.as_object()?;
    let kind = tab.get("kind")?.as_str()?;
    let id = tab.get("id")?.as_str()?;
    let mode = match tab.get("mode").and_then(Value::as_str) {
        Some("edit") => Some(DocumentMode::Edit),
        Some("ink") => Some(DocumentMode::Ink),
        _ => None,
    };
    let group = tab.get("group").and_then(Value::as_str).map(str::to_owned);
    Some(TabRef {
        kind: kind.to_owned(),
        id: id.to_owned(),
        mode,
        group,
    })
}

/// A group needs a string id. A colour outside the tones reads as tone 1.
fn parse_groups(value: Option<&Value>) -> Vec<TabGroup> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    items.iter().filter_map(parse_group).collect()
}

fn parse_group(value: &Value) -> Option<TabGroup> {
    let group = value.as_object()?;
    let id = group.get("id")?.as_str()?;
    let color = group.get("color").and_then(color_tone).unwrap_or(1);
    let name = group.get("name").and_then(Value::as_str).unwrap_or("");
    let collapsed = matches!(group.get("collapsed"), Some(Value::Bool(true))).then_some(true);
    Some(TabGroup {
        id: id.to_owned(),
        name: name.to_owned(),
        color,
        collapsed,
    })
}

fn color_tone(value: &Value) -> Option<u8> {
    let n = value.as_f64()?;
    GROUP_COLORS.iter().copied().find(|c| f64::from(*c) == n)
}

fn first_leaf_id(node: &PaneNode) -> &str {
    match node {
        PaneNode::Leaf(leaf) => &leaf.id,
        PaneNode::Split(split) => first_leaf_id(&split.children.0),
    }
}

/// The key the layout is stored under; a project's layout lives under `KEY.<projectId>`.
pub const LAYOUT_STORAGE_KEY: &str = "weaveforge.editor.layout";

/// The storage key for a project's layout. No project id, or an empty one, is the plain key.
#[must_use]
pub fn layout_storage_key(project_id: Option<&str>) -> String {
    match project_id {
        Some(id) if !id.is_empty() => format!("{LAYOUT_STORAGE_KEY}.{id}"),
        _ => LAYOUT_STORAGE_KEY.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    // The storage key is `weaveforge.editor.layout`, with the project id after a dot when one is set.
    #[test]
    fn layout_storage_key_is_plain_without_a_project_id() {
        assert_eq!(super::layout_storage_key(None), "weaveforge.editor.layout");
        assert_eq!(
            super::layout_storage_key(Some("")),
            "weaveforge.editor.layout"
        );
    }

    #[test]
    fn layout_storage_key_appends_the_project_id() {
        assert_eq!(
            super::layout_storage_key(Some("p1")),
            "weaveforge.editor.layout.p1"
        );
    }

    use serde_json::json;

    use super::*;

    fn tab(kind: &str, id: &str) -> TabRef {
        TabRef {
            kind: kind.to_owned(),
            id: id.to_owned(),
            mode: None,
            group: None,
        }
    }

    #[test]
    fn absent_or_unusable_records_are_one_empty_pane() {
        let empty = empty_layout(DEFAULT_PANE_ID);
        for raw in [
            None,
            Some(""),
            Some("not json"),
            Some("null"),
            Some("[]"),
            Some(r#"{"root":{"type":"mystery"}}"#),
            Some(r#"{"root":{"type":"split","children":[{"type":"bogus"}]}}"#),
        ] {
            assert_eq!(layout_from_record(raw), empty, "record {raw:?}");
        }
    }

    #[test]
    fn a_split_restores_its_shape_and_drops_what_does_not_parse() {
        let raw = r#"{"root":{"type":"split","direction":"column","ratio":0.95,"children":[
            {"type":"leaf","id":"a","activeIndex":5,"tabs":[
                {"kind":"vault_page","id":"x","mode":"read","group":"g"},
                {"kind":"vault_page","id":"y","mode":"ink"},
                7,
                {"kind":1,"id":"z"}],
              "groups":[{"id":"g","name":"G","color":9},
                        {"id":"unused","name":"","color":2,"collapsed":true}]},
            {"type":"leaf","id":"b","activeIndex":0,"tabs":[]}]},
          "focusedPaneId":""}"#;

        let leaf_a = PaneNode::Leaf(PaneLeaf {
            id: "a".to_owned(),
            tabs: vec![
                TabRef {
                    kind: "vault_page".to_owned(),
                    id: "x".to_owned(),
                    mode: None,
                    group: Some("g".to_owned()),
                },
                TabRef {
                    kind: "vault_page".to_owned(),
                    id: "y".to_owned(),
                    mode: Some(DocumentMode::Ink),
                    group: None,
                },
            ],
            active_index: 1,
            groups: Some(vec![TabGroup {
                id: "g".to_owned(),
                name: "G".to_owned(),
                color: 1,
                collapsed: None,
            }]),
        });
        let leaf_b = PaneNode::Leaf(PaneLeaf {
            id: "b".to_owned(),
            tabs: vec![],
            active_index: 0,
            groups: Some(vec![]),
        });
        let expected = PaneLayout {
            root: PaneNode::Split(PaneSplit {
                direction: SplitDirection::Column,
                ratio: 0.9,
                children: (Box::new(leaf_a), Box::new(leaf_b)),
            }),
            focused_pane_id: "a".to_owned(),
        };
        assert_eq!(layout_from_record(Some(raw)), expected);
    }

    #[test]
    fn half_a_split_keeps_the_side_that_parsed() {
        let raw = r#"{"root":{"type":"split","children":[{"type":"bogus"},
            {"type":"leaf","id":"b","tabs":[],"activeIndex":0}]},"focusedPaneId":"zz"}"#;
        let expected = PaneLayout {
            root: PaneNode::Leaf(PaneLeaf {
                id: "b".to_owned(),
                tabs: vec![],
                active_index: 0,
                groups: Some(vec![]),
            }),
            focused_pane_id: "zz".to_owned(),
        };
        assert_eq!(layout_from_record(Some(raw)), expected);
    }

    #[test]
    fn a_low_ratio_is_clamped_and_an_unknown_direction_is_a_row() {
        let raw = r#"{"root":{"type":"split","direction":"sideways","ratio":0.01,
            "children":[{"type":"leaf","id":"l","tabs":[],"activeIndex":0},
                        {"type":"leaf","id":"r","tabs":[],"activeIndex":0}]}}"#;
        let layout = layout_from_record(Some(raw));
        let PaneNode::Split(split) = layout.root else {
            panic!("expected a split root");
        };
        assert_eq!(split.direction, SplitDirection::Row);
        assert_eq!(split.ratio, 0.1);
        assert_eq!(layout.focused_pane_id, "l");
    }

    #[test]
    fn a_missing_ratio_is_even() {
        let raw = r#"{"root":{"type":"split","children":[{"type":"leaf","id":"l","tabs":[]},
                        {"type":"leaf","id":"r","tabs":[]}]}}"#;
        let PaneNode::Split(split) = layout_from_record(Some(raw)).root else {
            panic!("expected a split root");
        };
        assert_eq!(split.ratio, 0.5);
    }

    #[test]
    fn an_unknown_or_missing_mode_reads_as_none_chosen() {
        assert_eq!(
            parse_tab(&json!({"kind": "k", "id": "i", "mode": "telepathy"})),
            Some(tab("k", "i"))
        );
        assert_eq!(
            parse_tab(&json!({"kind": "k", "id": "i"})),
            Some(tab("k", "i"))
        );
        assert_eq!(
            parse_tab(&json!({"kind": "k", "id": "i", "mode": "edit"})),
            Some(TabRef {
                mode: Some(DocumentMode::Edit),
                ..tab("k", "i")
            })
        );
    }

    #[test]
    fn a_tab_without_string_kind_or_id_is_dropped() {
        assert_eq!(parse_tab(&json!({"kind": "k"})), None);
        assert_eq!(parse_tab(&json!("nope")), None);
    }
}

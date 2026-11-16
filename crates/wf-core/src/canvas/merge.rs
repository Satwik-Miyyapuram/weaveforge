//! Three-way merge of a canvas whose handwriting may have changed on both sides. Nodes and edges
//! merge line by line as before; strokes merge by id, so two people adding strokes at the same
//! time do not clash just because both appended to the end of the list.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::Value;

use super::{Canvas, FreeStroke, INK_FIELD, canvas_text, parse_canvas, validate, write_ink};
use crate::sync::text_merge::{TextMerge, merge_text};

/// Merges three versions of a canvas file. Strokes are matched by id: each side's adds are
/// kept, a stroke deleted on one side and untouched on the other is deleted, and a stroke
/// changed on one side only takes that change. Both sides changing the same stroke differently,
/// or one deleting what the other changed, is a conflict (`None`), as two edits to one node
/// line are. Ink this version cannot read in full (a stroke that does not parse, a `wfInk` that
/// is not a list, or two strokes with one id) is a conflict too, so a merge never drops it. The
/// rest of the canvas merges line by line; it must still parse, and every edge must still reach
/// both its nodes.
#[must_use]
pub fn merge_canvas_with_ink(base: &str, local: &str, remote: &str) -> Option<String> {
    let (mut base, mut local, mut remote) = (
        parse_canvas(base).ok()?,
        parse_canvas(local).ok()?,
        parse_canvas(remote).ok()?,
    );
    let (base_ink, local_ink, remote_ink) = (
        take_ink(&mut base)?,
        take_ink(&mut local)?,
        take_ink(&mut remote)?,
    );
    let TextMerge::Clean(text) = merge_text(
        &canvas_text(&base),
        &canvas_text(&local),
        &canvas_text(&remote),
    ) else {
        return None;
    };
    let mut merged = parse_canvas(&text).ok()?;
    if validate(&merged)
        .iter()
        .any(|issue| issue.code == "missing-node")
    {
        return None;
    }
    write_ink(&mut merged, &merge_ink(&base_ink, &local_ink, &remote_ink)?);
    Some(canvas_text(&merged))
}

/// The strokes of a canvas, removed from it so the rest can merge on its own. `None` unless
/// every item is a stroke with an id of its own.
fn take_ink(canvas: &mut Canvas) -> Option<Vec<FreeStroke>> {
    let items = match canvas.extra.remove(INK_FIELD) {
        None => return Some(Vec::new()),
        Some(Value::Array(items)) => items,
        Some(_) => return None,
    };
    let strokes = items
        .into_iter()
        .map(|item| FreeStroke::deserialize(item).ok())
        .collect::<Option<Vec<_>>>()?;
    let mut ids = HashSet::new();
    strokes
        .iter()
        .all(|stroke| ids.insert(stroke.id.as_str()))
        .then_some(strokes)
}

/// Merges stroke lists by id. The result follows the remote order, then the strokes only the
/// local side has, in local order. `None` when both sides changed one stroke differently.
fn merge_ink(
    base: &[FreeStroke],
    local: &[FreeStroke],
    remote: &[FreeStroke],
) -> Option<Vec<FreeStroke>> {
    let (base_by_id, local_by_id, remote_by_id) = (by_id(base), by_id(local), by_id(remote));
    let mut seen = HashSet::new();
    let mut merged = Vec::new();
    for id in remote.iter().chain(local).map(|s| s.id.as_str()) {
        if !seen.insert(id) {
            continue;
        }
        let chosen = pick(
            base_by_id.get(id).copied(),
            local_by_id.get(id).copied(),
            remote_by_id.get(id).copied(),
        )?;
        merged.extend(chosen.cloned());
    }
    Some(merged)
}

/// Each stroke by its id; ids are unique, as `take_ink` checked.
fn by_id(strokes: &[FreeStroke]) -> HashMap<&str, &FreeStroke> {
    let mut map = HashMap::new();
    for stroke in strokes {
        let _ = map.entry(stroke.id.as_str()).or_insert(stroke);
    }
    map
}

/// The merged version of one stroke: `Some(None)` drops it, `None` is a conflict.
fn pick<'a>(
    base: Option<&'a FreeStroke>,
    local: Option<&'a FreeStroke>,
    remote: Option<&'a FreeStroke>,
) -> Option<Option<&'a FreeStroke>> {
    if local == remote || local == base {
        Some(remote)
    } else if remote == base {
        Some(local)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::super::{normalize_canvas_text, read_ink};
    use super::*;
    use serde_json::Map;

    fn stroke(id: &str, x: f64) -> FreeStroke {
        FreeStroke {
            id: id.into(),
            x,
            y: 0.0,
            w: 2.0,
            c: "#000000".into(),
            t: "pen".into(),
            p: vec![0, 0, 10, 10],
            r: Vec::new(),
            extra: Map::new(),
        }
    }

    fn text_with(nodes: &str, strokes: &[FreeStroke]) -> String {
        let mut canvas = parse_canvas(&format!("{{\"nodes\":[{nodes}],\"edges\":[]}}")).unwrap();
        write_ink(&mut canvas, strokes);
        canvas_text(&canvas)
    }

    fn merged_ids(text: &str) -> Vec<(String, f64)> {
        read_ink(&parse_canvas(text).unwrap())
            .into_iter()
            .map(|s| (s.id, s.x))
            .collect()
    }

    const NODE_A: &str =
        r#"{"id":"a","type":"text","text":"a","x":0,"y":0,"width":10,"height":10}"#;
    const NODE_B: &str =
        r#"{"id":"b","type":"text","text":"b","x":0,"y":0,"width":10,"height":10}"#;

    #[test]
    fn strokes_added_on_both_sides_are_all_kept() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0)]);
        let local = text_with(NODE_A, &[stroke("s0", 0.0), stroke("mine", 1.0)]);
        let remote = text_with(NODE_A, &[stroke("s0", 0.0), stroke("theirs", 2.0)]);
        let merged = merge_canvas_with_ink(&base, &local, &remote).unwrap();
        assert_eq!(
            merged_ids(&merged),
            vec![
                ("s0".into(), 0.0),
                ("theirs".into(), 2.0),
                ("mine".into(), 1.0)
            ]
        );
    }

    #[test]
    fn a_stroke_deleted_on_one_side_and_untouched_on_the_other_is_deleted() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0), stroke("s1", 1.0)]);
        let local = text_with(NODE_A, &[stroke("s1", 1.0)]);
        let remote = text_with(NODE_A, &[stroke("s0", 0.0), stroke("s1", 1.0)]);
        let merged = merge_canvas_with_ink(&base, &local, &remote).unwrap();
        assert_eq!(merged_ids(&merged), vec![("s1".into(), 1.0)]);
        // The same from the other side.
        let merged = merge_canvas_with_ink(&base, &remote, &local).unwrap();
        assert_eq!(merged_ids(&merged), vec![("s1".into(), 1.0)]);
    }

    #[test]
    fn a_stroke_changed_on_one_side_takes_that_change() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0), stroke("s1", 1.0)]);
        let local = text_with(NODE_A, &[stroke("s0", 5.0), stroke("s1", 1.0)]);
        let remote = text_with(NODE_A, &[stroke("s0", 0.0), stroke("s1", 9.0)]);
        let merged = merge_canvas_with_ink(&base, &local, &remote).unwrap();
        assert_eq!(
            merged_ids(&merged),
            vec![("s0".into(), 5.0), ("s1".into(), 9.0)]
        );
    }

    #[test]
    fn both_sides_changing_one_stroke_differently_is_a_conflict() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0)]);
        let local = text_with(NODE_A, &[stroke("s0", 1.0)]);
        let remote = text_with(NODE_A, &[stroke("s0", 2.0)]);
        assert_eq!(merge_canvas_with_ink(&base, &local, &remote), None);
        // The same change on both sides is not a conflict.
        let merged = merge_canvas_with_ink(&base, &local, &local).unwrap();
        assert_eq!(merged_ids(&merged), vec![("s0".into(), 1.0)]);
    }

    #[test]
    fn deleting_a_stroke_the_other_side_changed_is_a_conflict() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0)]);
        let local = text_with(NODE_A, &[]);
        let remote = text_with(NODE_A, &[stroke("s0", 2.0)]);
        assert_eq!(merge_canvas_with_ink(&base, &local, &remote), None);
        assert_eq!(merge_canvas_with_ink(&base, &remote, &local), None);
    }

    #[test]
    fn nodes_still_merge_by_line_next_to_the_strokes() {
        let base = text_with(NODE_A, &[]);
        let local = text_with(&format!("{NODE_A},{NODE_B}"), &[]);
        let remote = text_with(NODE_A, &[stroke("s0", 0.0)]);
        let merged = merge_canvas_with_ink(&base, &local, &remote).unwrap();
        let canvas = parse_canvas(&merged).unwrap();
        assert_eq!(canvas.nodes.len(), 2);
        assert_eq!(merged_ids(&merged), vec![("s0".into(), 0.0)]);
        // Two edits of one node line still conflict.
        let edited = |text: &str| {
            text_with(
                &NODE_A.replace("\"text\":\"a\"", &format!("\"text\":\"{text}\"")),
                &[],
            )
        };
        assert_eq!(
            merge_canvas_with_ink(&base, &edited("mine"), &edited("theirs")),
            None
        );
    }

    #[test]
    fn the_merge_does_not_depend_on_which_strokes_merge_first() {
        let base = text_with(NODE_A, &[]);
        let local = text_with(NODE_A, &[stroke("m1", 1.0), stroke("m2", 2.0)]);
        let remote = text_with(NODE_A, &[stroke("t1", 3.0)]);
        let once = merge_canvas_with_ink(&base, &local, &remote).unwrap();
        assert_eq!(merge_canvas_with_ink(&base, &local, &remote).unwrap(), once);
        assert_eq!(
            merged_ids(&once),
            vec![("t1".into(), 3.0), ("m1".into(), 1.0), ("m2".into(), 2.0)]
        );
    }

    #[test]
    fn text_that_is_not_a_canvas_is_a_conflict() {
        let base = text_with(NODE_A, &[]);
        assert_eq!(merge_canvas_with_ink(&base, "{", &base), None);
    }

    /// Canvas text with `ink` as the raw `wfInk` value.
    fn text_with_raw_ink(ink: &str) -> String {
        format!("{{\"nodes\":[{NODE_A}],\"edges\":[],\"wfInk\":{ink}}}")
    }

    #[test]
    fn a_stroke_that_does_not_parse_is_a_conflict_not_a_silent_drop() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0)]);
        let bad = text_with_raw_ink(
            r##"[{"id":"s0","x":0,"y":0,"w":2,"c":"#000000","p":[0,0]},{"id":"s1"}]"##,
        );
        assert_eq!(merge_canvas_with_ink(&base, &base, &bad), None);
        assert_eq!(merge_canvas_with_ink(&base, &bad, &base), None);
        assert_eq!(merge_canvas_with_ink(&bad, &base, &base), None);
    }

    #[test]
    fn ink_that_is_not_an_array_is_a_conflict() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0)]);
        for odd in ["{}", "null", "\"s0\"", "3"] {
            let bad = text_with_raw_ink(odd);
            assert_eq!(merge_canvas_with_ink(&base, &base, &bad), None, "{odd}");
            assert_eq!(merge_canvas_with_ink(&base, &bad, &base), None, "{odd}");
        }
    }

    #[test]
    fn duplicate_stroke_ids_are_a_conflict() {
        let base = text_with(NODE_A, &[stroke("s0", 0.0)]);
        let twice = text_with(NODE_A, &[stroke("s0", 0.0), stroke("s0", 5.0)]);
        assert_eq!(merge_canvas_with_ink(&base, &base, &twice), None);
        assert_eq!(merge_canvas_with_ink(&base, &twice, &base), None);
        assert_eq!(merge_canvas_with_ink(&twice, &base, &base), None);
    }

    #[test]
    fn a_merge_writes_the_same_text_the_editor_saves() {
        let saved = normalize_canvas_text(&text_with_raw_ink(
            r##"[{"id":"s0","x":100,"y":-20,"w":2,"c":"#000000","t":"pen","p":[0,0,10,10]}]"##,
        ))
        .unwrap();
        assert!(saved.contains(r#""x":100,"y":-20,"w":2,"#), "{saved}");
        assert_eq!(
            merge_canvas_with_ink(&saved, &saved, &saved).as_deref(),
            Some(saved.as_str())
        );
    }

    #[test]
    fn an_ink_only_change_leaves_the_node_and_edge_lines_alone() {
        let nodes = format!("{NODE_A},{NODE_B}");
        let mut canvas = parse_canvas(&text_with(&nodes, &[stroke("s0", 0.0)])).unwrap();
        canvas.edges = parse_canvas(r#"{"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}"#)
            .unwrap()
            .edges;
        let base = canvas_text(&canvas);
        write_ink(&mut canvas, &[stroke("s0", 0.0), stroke("s1", 4.0)]);
        let local = canvas_text(&canvas);
        let merged = merge_canvas_with_ink(&base, &local, &base).unwrap();
        assert_eq!(merged, local);
        let ink_free = |text: &str| -> Vec<String> {
            text.lines()
                .filter(|line| !line.contains("\"c\":"))
                .map(str::to_owned)
                .collect()
        };
        assert_eq!(ink_free(&merged), ink_free(&base));
    }
}

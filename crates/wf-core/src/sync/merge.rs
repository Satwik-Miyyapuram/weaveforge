//! Port of `packages/core/src/shared/parts.ts`: a per-field three-way
//! merge of rows. Missing keys read as JS `undefined`, which is `null` in
//! conflicts and absent from the merged row.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::canvas::{parse_canvas, validate};
use crate::sync::instant::parse_instant;
use crate::sync::text_merge::{TextMerge, merge_text};
use crate::vault::page::CANVAS_KIND;

/// Columns the sync machinery owns; the server is the only author of them.
const RESERVED: [&str; 4] = ["id", "server_seq", "row_version", "created_at"];

/// A field that both sides moved to different values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Conflict {
    /// Column name.
    pub field: String,
    /// Value in the common base, `null` when absent.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub base: Value,
    /// Value on this device, `null` when absent.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub local: Value,
    /// Value on the server, `null` when absent.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub remote: Value,
}

/// A merged row and the conflicts the reader has to decide.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MergeResult {
    /// The row with the server's values, overridden by local-only edits.
    #[cfg_attr(feature = "specta", specta(type = std::collections::HashMap<String, specta_typescript::Unknown>))]
    pub merged: Map<String, Value>,
    /// Conflicts in field order: local keys, then remote-only keys.
    pub conflicts: Vec<Conflict>,
}

/// Merges `local` and `remote` against their common `base`, field by field.
#[must_use]
pub fn merge_rows(
    base: &Map<String, Value>,
    local: &Map<String, Value>,
    remote: &Map<String, Value>,
) -> MergeResult {
    let mut merged = remote.clone();
    let mut conflicts = Vec::new();
    // The TS walks a Set of local keys then remote keys: first-seen order.
    let mut seen = HashSet::new();
    let canvas = [local, remote]
        .iter()
        .any(|row| row.get("kind").and_then(Value::as_str) == Some(CANVAS_KIND));
    let fields = local
        .keys()
        .chain(remote.keys())
        .map(String::as_str)
        .filter(|field| seen.insert(*field));

    for field in fields {
        if RESERVED.contains(&field) {
            continue;
        }
        let b = base.get(field);
        let l = local.get(field);
        let r = remote.get(field);

        // Nobody touched it, or only one side did: there is nothing to decide.
        if same_value(&or_null(b), &or_null(l)) {
            continue;
        }
        if same_value(&or_null(b), &or_null(r)) {
            set_field(&mut merged, field, l);
            continue;
        }
        // Both moved it to the same place. Agreement is not a conflict.
        if same_value(&or_null(l), &or_null(r)) {
            set_field(&mut merged, field, l);
            continue;
        }
        // An edit stamp is not work: the later one wins.
        if field == "updated_at" {
            set_field(&mut merged, field, later_stamp(l, r));
            continue;
        }
        // A note body both sides edited: their changes to different lines both land.
        if field == "body"
            && let (Some(Value::String(b)), Some(Value::String(l)), Some(Value::String(r))) =
                (b, l, r)
            && let Some(text) = merged_body(b, l, r, canvas)
        {
            set_field(&mut merged, field, Some(&Value::String(text)));
            continue;
        }
        // The server's value stands so this device agrees with it until the reader decides.
        conflicts.push(Conflict {
            field: field.to_owned(),
            base: or_null(b),
            local: or_null(l),
            remote: or_null(r),
        });
    }

    MergeResult { merged, conflicts }
}

/// The clean line merge of a body, or `None` when the lines clash. A canvas
/// merge must still parse, and every edge must still reach both its nodes.
fn merged_body(base: &str, local: &str, remote: &str, canvas: bool) -> Option<String> {
    // Ink merges stroke by stroke, so strokes drawn on two devices both land. Only a side that
    // parses with the field counts; a text node that merely mentions it does not.
    if canvas
        && [base, local, remote].iter().any(|text| {
            parse_canvas(text).is_ok_and(|c| c.extra.contains_key(crate::canvas::INK_FIELD))
        })
    {
        return crate::canvas::merge_canvas_with_ink(base, local, remote);
    }
    let TextMerge::Clean(text) = merge_text(base, local, remote) else {
        return None;
    };
    if canvas {
        let parsed = parse_canvas(&text).ok()?;
        if validate(&parsed)
            .iter()
            .any(|issue| issue.code == "missing-node")
        {
            return None;
        }
    }
    Some(text)
}

/// Equality as the database means it: a missing value equals `null`, and
/// timestamps are the same when they are the same instant.
#[must_use]
pub fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, _) | (_, Value::Null) => matches!((a, b), (Value::Null, Value::Null)),
        (Value::String(x), Value::String(y)) => {
            x == y || matches!((instant_text(x), instant_text(y)), (Some(p), Some(q)) if p == q)
        }
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Object(_) | Value::Array(_), Value::Object(_) | Value::Array(_)) => {
            json_equal(a, b)
        }
        _ => false,
    }
}

/// Structural equality; key order is ignored, nested strings compare exactly.
fn json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| json_equal(v, w)))
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(v, w)| json_equal(v, w))
        }
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}

/// Sets `field` to `value`, or removes it when `value` is absent (JS `undefined`).
fn set_field(merged: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    match value {
        Some(v) => {
            let _ = merged.insert(field.to_owned(), v.clone());
        }
        None => {
            // Keep the other keys where they are, as JS `delete` does.
            let _ = merged.shift_remove(field);
        }
    }
}

/// The later `updated_at`; the remote one when either side is not an instant.
fn later_stamp<'a>(local: Option<&'a Value>, remote: Option<&'a Value>) -> Option<&'a Value> {
    match (instant_of(local), instant_of(remote)) {
        (Some(l), Some(r)) if l > r => local,
        _ => remote,
    }
}

fn or_null(value: Option<&Value>) -> Value {
    value.cloned().unwrap_or(Value::Null)
}

fn instant_of(value: Option<&Value>) -> Option<i64> {
    value?.as_str().and_then(instant_text)
}

/// Epoch ms for a timestamp string; the TS gate accepts only `T` or a space as separator.
fn instant_text(text: &str) -> Option<i64> {
    if text.as_bytes().get(10) == Some(&b't') {
        return None;
    }
    parse_instant(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(kind: Option<&str>, body: &str) -> Map<String, Value> {
        let mut row = Map::new();
        let _ = row.insert("body".into(), json!(body));
        if let Some(kind) = kind {
            let _ = row.insert("kind".into(), json!(kind));
        }
        row
    }

    fn merge(kind: Option<&str>, base: &str, local: &str, remote: &str) -> MergeResult {
        merge_rows(&row(kind, base), &row(kind, local), &row(kind, remote))
    }

    #[test]
    fn a_canvas_merge_that_leaves_an_edge_dangling_is_a_conflict() {
        // Local drops node b; remote adds an edge to b on another line.
        let base = "{\"nodes\":[\n{\"id\":\"a\"},\n{\"id\":\"b\"}\n],\n\"edges\":[\n\n]}";
        let local = "{\"nodes\":[\n{\"id\":\"a\"}\n],\n\"edges\":[\n\n]}";
        let remote = "{\"nodes\":[\n{\"id\":\"a\"},\n{\"id\":\"b\"}\n],\n\"edges\":[\n\
            {\"id\":\"e\",\"fromNode\":\"a\",\"toNode\":\"b\"}\n]}";
        // As plain text the lines merge cleanly.
        assert!(merge(None, base, local, remote).conflicts.is_empty());
        let result = merge(Some("canvas"), base, local, remote);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].field, "body");
        assert_eq!(result.merged["body"], remote);
    }

    #[test]
    fn a_canvas_merge_that_no_longer_parses_is_a_conflict() {
        let base = "{\"nodes\":[\n\n\n\n]}";
        let local = "{\"nodes\":[],\"x\":{\n\n\n\n}}";
        let remote = "{\"nodes\":[\n\n{\"id\":\"a\"}\n\n]}";
        assert!(merge(None, base, local, remote).conflicts.is_empty());
        let result = merge(Some("canvas"), base, local, remote);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.merged["body"], remote);
    }

    #[test]
    fn strokes_added_on_both_devices_both_land() {
        // Both sides append a stroke at the end of the ink: as lines that clash.
        let base = "{\"nodes\":[],\n\"wfInk\":[\n{\"id\":\"s1\",\"x\":0,\"y\":0,\"w\":2,\"c\":\"#000\",\"t\":\"pen\",\"p\":[0,0]}\n]}";
        let local = "{\"nodes\":[],\n\"wfInk\":[\n{\"id\":\"s1\",\"x\":0,\"y\":0,\"w\":2,\"c\":\"#000\",\"t\":\"pen\",\"p\":[0,0]},\n{\"id\":\"s2\",\"x\":5,\"y\":5,\"w\":2,\"c\":\"#000\",\"t\":\"pen\",\"p\":[0,0]}\n]}";
        let remote = "{\"nodes\":[],\n\"wfInk\":[\n{\"id\":\"s1\",\"x\":0,\"y\":0,\"w\":2,\"c\":\"#000\",\"t\":\"pen\",\"p\":[0,0]},\n{\"id\":\"s3\",\"x\":9,\"y\":9,\"w\":2,\"c\":\"#000\",\"t\":\"pen\",\"p\":[0,0]}\n]}";
        assert_eq!(merge(None, base, local, remote).conflicts.len(), 1);
        let result = merge(Some("canvas"), base, local, remote);
        assert!(result.conflicts.is_empty());
        let body = result.merged["body"].as_str().unwrap();
        let ink = crate::canvas::read_ink(&parse_canvas(body).unwrap());
        let ids: Vec<&str> = ink.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["s1", "s3", "s2"]);
    }

    #[test]
    fn a_canvas_merge_that_stays_whole_lands() {
        let base = "{\"nodes\":[\n{\"id\":\"a\"},\n{\"id\":\"b\"},\n{\"id\":\"c\"}\n]}";
        let local = "{\"nodes\":[\n{\"id\":\"A\"},\n{\"id\":\"b\"},\n{\"id\":\"c\"}\n]}";
        let remote = "{\"nodes\":[\n{\"id\":\"a\"},\n{\"id\":\"b\"},\n{\"id\":\"C\"}\n]}";
        let result = merge(Some("canvas"), base, local, remote);
        assert!(result.conflicts.is_empty());
        assert_eq!(
            result.merged["body"],
            "{\"nodes\":[\n{\"id\":\"A\"},\n{\"id\":\"b\"},\n{\"id\":\"C\"}\n]}"
        );
    }

    #[test]
    fn a_note_that_only_mentions_ink_still_merges_by_line() {
        // The word is in a text node, not the top-level ink field: the lines merge as written.
        let base =
            "{\"nodes\":[\n{\"id\":\"a\",\"text\":\"wfInk\"},\n{\"id\":\"b\"},\n{\"id\":\"c\"}\n]}";
        let local =
            "{\"nodes\":[\n{\"id\":\"A\",\"text\":\"wfInk\"},\n{\"id\":\"b\"},\n{\"id\":\"c\"}\n]}";
        let remote =
            "{\"nodes\":[\n{\"id\":\"a\",\"text\":\"wfInk\"},\n{\"id\":\"b\"},\n{\"id\":\"C\"}\n]}";
        let result = merge(Some("canvas"), base, local, remote);
        assert!(result.conflicts.is_empty());
        assert_eq!(
            result.merged["body"],
            "{\"nodes\":[\n{\"id\":\"A\",\"text\":\"wfInk\"},\n{\"id\":\"b\"},\n{\"id\":\"C\"}\n]}"
        );
    }
}

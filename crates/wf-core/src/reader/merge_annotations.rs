//! Merges Zotero-projected and local reader annotations. A port of
//! `apps/web/src/features/reader/application/merge-reader-annotations.ts`.
//!
//! Annotations stay JSON objects: only `id`, `zoteroKey` and `sortIndex` are read and
//! every other field passes through unchanged, so callers keep their full row shape.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::js_collate::locale_compare;

/// A string field of an annotation, or `None` when it is missing or not a string.
fn str_field<'a>(annotation: &'a Value, field: &str) -> Option<&'a str> {
    annotation.get(field).and_then(Value::as_str)
}

/// Rows keyed by id, in first-insertion order, as a JS `Map` keeps them: a later row
/// with the same id replaces the value and keeps the position.
#[derive(Default)]
struct IdMap<'a> {
    rows: Vec<&'a Value>,
    slot: HashMap<Option<&'a str>, usize>,
}

impl<'a> IdMap<'a> {
    fn set(&mut self, annotation: &'a Value) {
        let id = str_field(annotation, "id");
        match self.slot.get(&id).copied() {
            Some(index) => self.rows[index] = annotation,
            None => {
                _ = self.slot.insert(id, self.rows.len());
                self.rows.push(annotation);
            }
        }
    }
}

/// Zotero-projected and local annotations as one list, sorted by `sortIndex`.
///
/// A local annotation wins on id collision. A Zotero annotation whose key a local row
/// already sent to Zotero is dropped, so a synced mark does not show twice.
#[must_use]
pub fn merge_reader_annotations(zotero: &[Value], local: &[Value]) -> Vec<Value> {
    // JS `!!k`: only non-empty strings count.
    let sent_from_here: HashSet<&str> = local
        .iter()
        .filter_map(|annotation| str_field(annotation, "zoteroKey"))
        .filter(|key| !key.is_empty())
        .collect();
    let mut map = IdMap::default();
    for annotation in zotero {
        // JS `a.zoteroKey ?? a.id`: the id is used only when zoteroKey is null or missing.
        let key = str_field(annotation, "zoteroKey").or_else(|| str_field(annotation, "id"));
        let sent = key.is_some_and(|key| sent_from_here.contains(key));
        if !sent {
            map.set(annotation);
        }
    }
    for annotation in local {
        map.set(annotation);
    }
    let mut rows = map.rows;
    rows.sort_by(|a, b| {
        locale_compare(
            str_field(a, "sortIndex").unwrap_or(""),
            str_field(b, "sortIndex").unwrap_or(""),
        )
    });
    rows.into_iter().cloned().collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn zotero(id: &str, sort_index: &str, text: &str) -> Value {
        json!({
            "id": id,
            "origin": "zotero",
            "zoteroKey": id,
            "sortIndex": sort_index,
            "text": text,
        })
    }

    #[test]
    fn prefers_local_on_id_collision_and_sorts() {
        let merged = merge_reader_annotations(
            &[
                zotero("a", "00002|000000|00000", "zotero"),
                zotero("b", "00001|000000|00000", "early"),
            ],
            &[json!({
                "id": "a",
                "origin": "local",
                "zoteroKey": null,
                "sortIndex": "00002|000000|00000",
                "text": "local",
            })],
        );
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0]["id"], "b");
        assert_eq!(merged[1]["text"], "local");
        assert_eq!(merged[1]["origin"], "local");
    }

    #[test]
    fn local_mark_already_sent_to_zotero_is_not_shown_twice() {
        let merged = merge_reader_annotations(
            &[
                zotero("ZK1", "00001|000000|00000", "echo"),
                zotero("ZK2", "00002|000000|00000", "made in Zotero"),
            ],
            &[json!({
                "id": "local-1",
                "origin": "local",
                "zoteroKey": "ZK1",
                "sortIndex": "00001|000000|00000",
                "text": "mine",
            })],
        );
        let ids: Vec<&Value> = merged.iter().map(|row| &row["id"]).collect();
        assert_eq!(ids, [&json!("local-1"), &json!("ZK2")]);
    }

    #[test]
    fn empty_zotero_key_does_not_drop_a_zotero_row() {
        let merged = merge_reader_annotations(
            &[json!({ "id": "Z", "zoteroKey": "", "sortIndex": "1" })],
            &[json!({ "id": "L", "zoteroKey": "", "sortIndex": "2" })],
        );
        assert_eq!(merged.len(), 2);
    }
}

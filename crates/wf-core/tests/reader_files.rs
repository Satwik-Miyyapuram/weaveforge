//! Tests for annotation files (files-first L2): `wf_core::reader::annotations_file`.
//! The laws are in `docs/building/core/reader.md`.

use proptest::prelude::*;
use serde_json::{Value, json};
use wf_core::reader::annotations_file::{
    AnnotationRow, AnnotationsFileError, annotations_file_path, merge_annotations,
    parse_annotations, render_annotations,
};
use wf_core::sync::folder_layout::{annotations_path, comments_path};

/// Helpers live here so `cfg(test)` covers their unwraps, which clippy would otherwise flag.
#[cfg(test)]
mod support {
    use serde_json::Value;
    use wf_core::reader::annotations_file::AnnotationRow;

    /// A JSON object literal as a row.
    pub fn row(value: Value) -> AnnotationRow {
        serde_json::from_value(value).expect("object")
    }

    /// Parses `text`, failing the test if it is not an annotations file.
    pub fn parse(text: &str) -> Vec<AnnotationRow> {
        wf_core::reader::annotations_file::parse_annotations(text).expect("parses")
    }
}

use support::{parse, row};

fn ids(rows: &[AnnotationRow]) -> Vec<&str> {
    rows.iter()
        .filter_map(|row| row.get("id").and_then(Value::as_str))
        .collect()
}

#[test]
fn annotations_round_trip_sorted() {
    let rows: Vec<AnnotationRow> = (0..200)
        .rev()
        .map(|n| row(json!({"id": format!("a{n:03}"), "page": n % 7, "color": "#ff0", "text": "q\n\"x\""})))
        .collect();
    let text = render_annotations(&rows);
    let back = parse(&text);
    assert_eq!(back.len(), 200);
    let mut want: Vec<String> = (0..200).map(|n| format!("a{n:03}")).collect();
    want.sort();
    assert_eq!(ids(&back), want);
    assert_eq!(render_annotations(&back), text);
    assert!(text.ends_with("]\n"));
}

#[test]
fn empty_annotations_file() {
    assert_eq!(render_annotations(&[]), "[]\n");
    assert_eq!(parse("[]\n"), Vec::<AnnotationRow>::new());
    assert_eq!(parse(""), Vec::<AnnotationRow>::new());
    assert_eq!(parse("  \r\n"), Vec::<AnnotationRow>::new());
}

#[test]
fn broken_file_is_refused() {
    assert!(matches!(
        parse_annotations("{"),
        Err(AnnotationsFileError::NotJson(_))
    ));
    assert_eq!(
        parse_annotations("{}"),
        Err(AnnotationsFileError::NotAnArray)
    );
    assert_eq!(
        parse_annotations("[{\"id\":\"a\"},{}]"),
        Err(AnnotationsFileError::BadRow(1))
    );
    assert_eq!(
        parse_annotations("[{\"id\":\"\"}]"),
        Err(AnnotationsFileError::BadRow(0))
    );
}

#[test]
fn external_edit_merges_by_id() {
    let base = vec![
        row(json!({"id": "a", "color": "red", "text": "one"})),
        row(json!({"id": "b", "color": "red"})),
        row(json!({"id": "c", "color": "red"})),
    ];
    // This device: recolours a, deletes b, adds d.
    let local = vec![
        row(json!({"id": "a", "color": "blue", "text": "one"})),
        row(json!({"id": "c", "color": "red"})),
        row(json!({"id": "d", "color": "green"})),
    ];
    // Outside the app: edits a's text, deletes c, adds e.
    let disk = vec![
        row(json!({"id": "a", "color": "red", "text": "edited"})),
        row(json!({"id": "b", "color": "red"})),
        row(json!({"id": "e", "color": "pink"})),
    ];
    let merged = merge_annotations(&base, &local, &disk);
    assert!(merged.conflicts.is_empty());
    assert_eq!(ids(&merged.rows), ["a", "d", "e"]);
    assert_eq!(
        merged.rows[0],
        row(json!({"id": "a", "color": "blue", "text": "edited"}))
    );
}

#[test]
fn edit_beats_delete_and_conflict_keeps_disk() {
    let base = vec![row(json!({"id": "a", "color": "red"}))];
    let local = vec![row(json!({"id": "a", "color": "blue"}))];
    let merged = merge_annotations(&base, &local, &[]);
    assert_eq!(merged.rows, local);

    let disk = vec![row(json!({"id": "a", "color": "green"}))];
    let merged = merge_annotations(&base, &local, &disk);
    assert_eq!(merged.conflicts.len(), 1);
    assert_eq!(merged.conflicts[0].0, "a");
    assert_eq!(merged.rows, disk);
}

#[test]
fn duplicate_ids_are_refused() {
    assert_eq!(
        parse_annotations("[{\"id\":\"a\"},{\"id\":\"b\"},{\"id\":\"a\",\"x\":1}]"),
        Err(AnnotationsFileError::DuplicateId("a".to_owned()))
    );
}

#[test]
fn file_path_sits_next_to_the_paper_under_its_name() {
    assert_eq!(
        annotations_file_path("thesis/papers/Attention is all.paper.md"),
        "thesis/papers/Attention is all.annotations.json"
    );
    assert_eq!(
        annotations_file_path("papers/x.paper.md"),
        "papers/x.annotations.json"
    );
    // A paper stored as its PDF keeps the PDF's sidecar.
    assert_eq!(
        annotations_file_path("thesis/papers/x.pdf"),
        annotations_path("thesis/papers/x.pdf")
    );
    // No id in the path: a dotted name keeps everything before the kind.
    assert_eq!(
        annotations_file_path("p/papers/v1.2 notes.paper.md"),
        "p/papers/v1.2 notes.annotations.json"
    );
}

#[test]
fn comments_sit_next_to_the_paper_under_its_name() {
    assert_eq!(
        comments_path("thesis/papers/x.paper.md"),
        "thesis/papers/x.comments.json"
    );
    assert_eq!(comments_path("p/notes/x.md"), "p/notes/x.comments.json");
}

// ---- Laws (property tests) ----

fn annotation() -> impl Strategy<Value = AnnotationRow> {
    (
        "[a-f0-9]{1,4}",
        prop::collection::btree_map("[a-z]{1,6}", "[a-zA-Z0-9 \\n\"]{0,10}", 0..4),
    )
        .prop_map(|(id, fields)| {
            let mut row = AnnotationRow::new();
            let _ = row.insert("id".to_owned(), Value::String(id));
            for (key, value) in fields {
                if key != "id" {
                    let _ = row.insert(key, Value::String(value));
                }
            }
            row
        })
}

/// Rows with distinct ids.
fn rows() -> impl Strategy<Value = Vec<AnnotationRow>> {
    prop::collection::vec(annotation(), 0..12).prop_map(|rows| {
        let mut seen = std::collections::BTreeSet::new();
        rows.into_iter()
            .filter(|row| seen.insert(row.get("id").map(ToString::to_string)))
            .collect()
    })
}

fn sorted(rows: &[AnnotationRow]) -> Vec<AnnotationRow> {
    parse(&render_annotations(rows))
}

proptest! {
    /// Law: parse(render(rows)) is rows sorted by id; render is stable under it.
    #[test]
    fn law_render_parse_round_trip(rows in rows()) {
        let text = render_annotations(&rows);
        let back = parse(&text);
        let mut want = rows.clone();
        want.sort_by(|a, b| a.get("id").and_then(Value::as_str).cmp(&b.get("id").and_then(Value::as_str)));
        prop_assert_eq!(&back, &want);
        prop_assert_eq!(render_annotations(&back), text);
    }

    /// Law: merge(b, x, x) == x.
    #[test]
    fn law_merge_same_sides(base in rows(), x in rows()) {
        prop_assert_eq!(merge_annotations(&base, &x, &x).rows, sorted(&x));
    }

    /// Law: merge(b, b, r) == r and merge(b, l, b) == l (one side unchanged).
    #[test]
    fn law_merge_one_side_unchanged(base in rows(), other in rows()) {
        let result = merge_annotations(&base, &base, &other);
        prop_assert!(result.conflicts.is_empty());
        prop_assert_eq!(result.rows, sorted(&other));
        prop_assert_eq!(merge_annotations(&base, &other, &base).rows, sorted(&other));
    }

    /// Law: a row new on either side (not in base) is never lost.
    #[test]
    fn law_merge_keeps_new_rows(local in rows(), disk in rows()) {
        let merged = merge_annotations(&[], &local, &disk);
        for row in local.iter().chain(&disk) {
            let id = row.get("id");
            prop_assert!(merged.rows.iter().any(|kept| kept.get("id") == id));
        }
    }
}

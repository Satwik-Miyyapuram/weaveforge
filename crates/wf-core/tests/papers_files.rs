//! Tests for paper files (files-first L1): `wf_core::papers::paper_file` and the
//! paper relations the index reads from them. The laws are in `docs/building/core/papers.md`.

use proptest::prelude::*;
use serde_json::{Map, Value, json};
use wf_core::index::graph::relation_graph;
use wf_core::index::scan::index_files;
use wf_core::papers::paper_file::{
    ExtrasChange, PaperExtras, PaperFile, PaperFileError, RelationRef, VALUE_KEYS, may_write,
    paper_extras, paper_row, parse_paper_file, render_paper_file, write_paper_extras,
    write_paper_row,
};
use wf_core::sync::frontmatter::{FORMAT_VERSION, canonical_text};

/// Helpers live here so `cfg(test)` covers their unwraps, which clippy would otherwise flag.
#[cfg(test)]
mod support {
    use serde_json::{Map, Value};

    /// A JSON object literal as a row.
    pub fn row(value: Value) -> Map<String, Value> {
        serde_json::from_value(value).expect("object")
    }

    /// Writes `row` as a new file.
    pub fn new_file(row: &Map<String, Value>) -> String {
        wf_core::papers::paper_file::write_paper_row(None, row).expect("writes")
    }

    /// A JSON object literal as an extras change.
    pub fn extras_change(value: Value) -> wf_core::papers::paper_file::ExtrasChange {
        serde_json::from_value(value).expect("change")
    }

    /// Parses `text`, failing the test if it is not a paper file.
    pub fn parse(text: &str) -> wf_core::papers::paper_file::PaperFile {
        wf_core::papers::paper_file::parse_paper_file(text).expect("parses")
    }
}

use support::{extras_change, new_file, parse, row};

fn full_row() -> Map<String, Value> {
    row(json!({
        "id": "p-1",
        "title": "Attention: is it all you need?\n---",
        "authors": ["A. Vaswani", "N. Shazeer"],
        "year": 2017,
        "venue": "NeurIPS",
        "doi": "10.5555/3295222",
        "arxivId": "1706.03762",
        "url": "https://arxiv.org/abs/1706.03762",
        "pdfPath": "p/papers/pdf/p-1.pdf",
        "status": "reading",
        "rating": 4,
        "readAt": "2026-11-01T10:00:00Z",
        "bibtex": "@article{x,\n  title={y}\n}",
        "abstract": "We propose \"the\" Transformer.",
        "summary": "short",
        "metadata": {"zoteroKey": "ABCD", "nested": {"a": [1, 2]}},
        "tags": ["ml", "attention"],
        "createdAt": "2026-10-01T00:00:00Z",
        "updatedAt": "2026-11-01T00:00:00Z"
    }))
}

#[test]
fn paper_round_trip() {
    let row = full_row();
    let text = new_file(&row);
    let back = paper_row(&parse(&text));
    assert_eq!(back, row);
    assert_eq!(render_paper_file(&parse(&text)), text);
    assert!(text.starts_with("---\nweaveforge-id: \"p-1\"\nweaveforge-type: paper\n"));
    assert!(text.contains(&format!("\nwf: {FORMAT_VERSION}\n")));
}

#[test]
fn paper_file_indexes_as_paper() {
    let text = new_file(&full_row());
    let store = index_files([("p/papers/attention--p1.paper.md", text.as_str())]);
    let entry = store.get("p-1").expect("indexed");
    assert_eq!(entry.kind, "paper");
    assert_eq!(entry.project_id.as_deref(), Some("p"));
    assert_eq!(entry.tags, ["ml", "attention"]);
    assert_eq!(store.list("paper", Some("p")).len(), 1);
}

#[test]
fn paper_without_tags() {
    let text = new_file(&row(json!({"id": "p-2", "title": "T"})));
    assert!(text.contains("\ntags: []\n"));
    let back = paper_row(&parse(&text));
    assert_eq!(back.get("tags"), Some(&json!([])));
    assert_eq!(back.get("status"), Some(&json!("to_read")));
    assert_eq!(render_paper_file(&parse(&text)), text);
}

#[test]
fn unknown_frontmatter_key_kept() {
    let text = "---\nweaveforge-id: p-3\nweaveforge-type: paper\ntitle: Old\nmy-key: keep me\nlist:\n  - a\n  - b\n# a comment\n---\n\nmy notes\n";
    let written =
        write_paper_row(Some(text), &row(json!({"id": "p-3", "title": "New"}))).expect("writes");
    assert!(written.contains("\nmy-key: keep me\nlist:\n  - a\n  - b\n# a comment\n---\n"));
    assert!(written.contains("\ntitle: \"New\"\n"));
    assert!(written.ends_with("---\n\nmy notes\n"));
    let again = write_paper_row(Some(&written), &row(json!({"id": "p-3", "title": "New"})));
    assert_eq!(again.as_deref(), Ok(written.as_str()));
}

#[test]
fn plain_yaml_values_read() {
    let text = "---\nweaveforge-id: p-4\nweaveforge-type: paper\ntitle: Typed by hand\nauthors:\n  - Ada\n  - Grace\nyear: 1843\ntags: [x, y]\n---\n";
    let back = paper_row(&parse(text));
    assert_eq!(back.get("title"), Some(&json!("Typed by hand")));
    assert_eq!(back.get("authors"), Some(&json!(["Ada", "Grace"])));
    assert_eq!(back.get("tags"), Some(&json!(["x", "y"])));
}

#[test]
fn relation_in_file_and_relations_json_counts_once() {
    let text = "---\nweaveforge-id: p-6\nweaveforge-type: paper\nrelations: [{\"to\":\"p-7\",\"type\":\"cites\"}]\n---\n";
    let json = r#"[{"source_id":"p-6","target_id":"p-7","type":"cites"},{"source_id":"p-6","target_id":"p-7","type":"supports"}]"#;
    let store = index_files([
        ("p/papers/a--p6.paper.md", text),
        ("p/.weaveforge/relations.json", json),
    ]);
    let mut types: Vec<&str> = store
        .relations_of("p-6")
        .iter()
        .map(|row| row.relation_type.as_str())
        .collect();
    types.sort_unstable();
    assert_eq!(types, ["cites", "supports"]);
}

#[test]
fn relation_to_missing_id() {
    let text = "---\nweaveforge-id: p-5\nweaveforge-type: paper\nrelations: [{\"to\":\"gone\",\"type\":\"cites\",\"note\":\"why\"}]\n---\n";
    let store = index_files([("p/papers/a--p5.paper.md", text)]);
    let relations = store.relations_of("p-5");
    assert_eq!(relations.len(), 1);
    assert_eq!(relations[0].target_id, "gone");
    assert!(store.get("gone").is_none());

    let graph = relation_graph(&store, "p-5", 2);
    assert_eq!(graph.nodes.len(), 2);
    assert!(!graph.nodes[0].missing);
    assert!(graph.nodes[1].missing);

    let written =
        write_paper_row(Some(text), &row(json!({"id": "p-5", "title": "T"}))).expect("writes");
    let relations = parse(&written).relations;
    assert_eq!(relations.len(), 1);
    assert_eq!(relations[0].to, "gone");
    assert_eq!(relations[0].extra.get("note"), Some(&json!("why")));
}

#[test]
fn relation_graph_walks_both_ways() {
    let a = "---\nweaveforge-id: a\nweaveforge-type: paper\nrelations: [{\"to\":\"b\",\"type\":\"cites\"}]\n---\n";
    let b = "---\nweaveforge-id: b\nweaveforge-type: paper\nrelations: [{\"to\":\"c\",\"type\":\"cites\"}]\n---\n";
    let c = "---\nweaveforge-id: c\nweaveforge-type: paper\n---\n";
    let store = index_files([
        ("p/papers/a.paper.md", a),
        ("p/papers/b.paper.md", b),
        ("p/papers/c.paper.md", c),
    ]);
    let ids = |depth| -> Vec<String> {
        relation_graph(&store, "b", depth)
            .nodes
            .into_iter()
            .map(|node| node.id)
            .collect()
    };
    assert_eq!(ids(0), ["b"]);
    assert_eq!(ids(1), ["b", "a", "c"]);
    assert_eq!(relation_graph(&store, "a", 5).edges.len(), 2);
}

#[test]
fn pdf_path_changed_outside() {
    let text = new_file(&full_row());
    let mut store = index_files([("p/papers/attention--p1.paper.md", text.as_str())]);
    let edited = text.replace("p/papers/pdf/p-1.pdf", "p/papers/pdf/renamed.pdf");
    assert!(store.rename_path(
        "p/papers/attention--p1.paper.md",
        "p/papers/moved--p1.paper.md"
    ));
    assert_eq!(
        store.get("p-1").map(|e| e.path.as_str()),
        Some("p/papers/moved--p1.paper.md")
    );
    let back = paper_row(&parse(&edited));
    assert_eq!(back.get("id"), Some(&json!("p-1")));
    assert_eq!(
        back.get("pdfPath"),
        Some(&json!("p/papers/pdf/renamed.pdf"))
    );
}

#[test]
fn duplicate_paper_id() {
    let text = new_file(&full_row());
    let store = index_files([
        ("p/papers/a--p1.paper.md", text.as_str()),
        ("p/papers/b--p1.paper.md", text.as_str()),
    ]);
    let entries = store.list("paper", None);
    assert_eq!(entries.len(), 2);
    assert!(
        entries
            .iter()
            .all(|entry| entry.duplicate && !may_write(entry))
    );
}

#[test]
fn newer_file_is_not_written() {
    let text = "---\nweaveforge-id: p-6\nweaveforge-type: paper\nwf: 99\n---\n";
    assert!(parse(text).is_read_only());
    let result = write_paper_row(Some(text), &row(json!({"id": "p-6"})));
    assert_eq!(result, Err(PaperFileError::ReadOnly(99)));
}

#[test]
fn not_a_paper_is_refused() {
    let note = "---\nweaveforge-id: n\nweaveforge-type: vault_page\n---\n";
    assert_eq!(
        parse_paper_file(note),
        Err(PaperFileError::NotAPaper("vault_page".to_owned()))
    );
    assert_eq!(
        parse_paper_file("no frontmatter"),
        Err(PaperFileError::NoFrontmatter)
    );
}

#[test]
fn file_without_id_reads_and_is_not_given_one() {
    // A paper made in another editor: no weaveforge-id. It is identified by its path.
    let text = "---\ntitle: Made in Obsidian\n---\nnotes\n";
    let file = parse(text);
    assert_eq!(file.id, "");
    let back = paper_row(&file);
    assert_eq!(back.get("id"), None);
    assert_eq!(back.get("title"), Some(&json!("Made in Obsidian")));
    // The app passes the path as the row id; it is never written into the file.
    let written = write_paper_row(
        Some(text),
        &row(json!({"id": "p/papers/Made in Obsidian.paper.md", "title": "Renamed"})),
    )
    .expect("writes");
    assert!(!written.contains("weaveforge-id"));
    assert!(written.ends_with("---\nnotes\n"));
}

#[test]
fn existing_id_is_kept_over_the_row_id() {
    let text = "---\nweaveforge-id: p-9\nweaveforge-type: paper\n---\n";
    let written =
        write_paper_row(Some(text), &row(json!({"id": "p/papers/x.paper.md"}))).expect("writes");
    assert_eq!(parse(&written).id, "p-9");
}

#[test]
fn new_file_without_id_has_no_id_line() {
    let written = new_file(&row(json!({"title": "T"})));
    assert!(!written.contains("weaveforge-id"));
    assert!(written.starts_with("---\nweaveforge-type: paper\n"));
}

#[test]
fn crlf_file_reads_like_lf_and_stays_crlf() {
    let text = new_file(&full_row());
    let crlf = text.replace('\n', "\r\n");
    assert_eq!(paper_row(&parse(&crlf)), paper_row(&parse(&text)));
    assert_eq!(parse(&crlf).body, parse(&text).body);
    let mut changed = full_row();
    let _ = changed.insert("tags".to_owned(), json!(["new"]));
    let written = write_paper_row(Some(&crlf), &changed).expect("writes");
    assert_eq!(written, new_file(&changed).replace('\n', "\r\n"));
}

#[test]
fn body_is_not_normalized() {
    // NFD "e" + combining acute, as a macOS paste leaves it. A write must not churn it.
    let text = "---\nweaveforge-id: p-1\nweaveforge-type: paper\n---\ncafe\u{301}\n";
    let written = write_paper_row(Some(text), &row(json!({"id": "p-1"}))).expect("writes");
    assert!(written.ends_with("---\ncafe\u{301}\n"));
}

#[test]
fn row_is_the_complete_owned_state() {
    // A field the row lacks is removed: callers pass whole rows, never patches.
    let text = new_file(&full_row());
    let partial = row(json!({"id": "p-1", "title": "only"}));
    let after = paper_row(&parse(
        &write_paper_row(Some(&text), &partial).expect("writes"),
    ));
    assert_eq!(after.get("abstract"), None);
    assert_eq!(after.get("bibtex"), None);
    assert_eq!(after.get("title"), Some(&json!("only")));
}

#[test]
fn cleared_field_is_removed() {
    let text = new_file(&full_row());
    let mut cleared = full_row();
    let _ = cleared.insert("doi".to_owned(), Value::Null);
    let _ = cleared.shift_remove("venue");
    let written = write_paper_row(Some(&text), &cleared).expect("writes");
    assert!(!written.contains("\ndoi: "));
    assert!(!written.contains("\nvenue: "));
}

// ---- Laws (property tests) ----

fn text() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 ,.:#\\-\"'\\[\\]{}\\n\u{e9}\u{4e2d}]{0,24}"
}

fn json_value() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        text().prop_map(Value::String),
        any::<i64>().prop_map(Value::from),
        any::<bool>().prop_map(Value::Bool),
    ];
    leaf.prop_recursive(2, 8, 4, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..4).prop_map(Value::Array),
            prop::collection::btree_map("[a-z]{1,6}", inner, 0..4)
                .prop_map(|map| Value::Object(map.into_iter().collect())),
        ]
    })
}

fn relation() -> impl Strategy<Value = RelationRef> {
    (
        "[a-z0-9-]{1,10}",
        "[a-z_]{1,10}",
        prop::collection::btree_map("x[a-z]{0,5}", json_value(), 0..3),
    )
        .prop_map(|(to, relation_type, extra)| RelationRef {
            to,
            relation_type,
            extra: extra.into_iter().collect(),
        })
}

fn unknown_entry() -> impl Strategy<Value = String> {
    ("x-[a-z]{1,8}", "[a-zA-Z0-9 ,.]{0,16}").prop_map(|(key, value)| format!("{key}: {value}\n"))
}

fn paper_file() -> impl Strategy<Value = PaperFile> {
    (
        // Empty: a file with no weaveforge-id (identified by its path).
        "[a-z0-9-]{0,12}",
        0..=FORMAT_VERSION + 2,
        prop::collection::btree_map(
            prop::sample::select(VALUE_KEYS.to_vec()),
            json_value(),
            0..8,
        ),
        prop::collection::vec(text(), 0..4),
        prop::collection::vec(relation(), 0..3),
        prop::collection::vec(unknown_entry(), 0..3),
        text(),
        any::<bool>(),
    )
        .prop_map(
            |(id, wf, values, tags, relations, unknown, body, crlf)| PaperFile {
                id,
                crlf,
                wf,
                values: values
                    .into_iter()
                    .map(|(key, value)| (key.to_owned(), value))
                    .collect(),
                tags,
                relations,
                unknown,
                body: canonical_text(&body),
            },
        )
}

proptest! {
    /// Law: parse(render(p)) == p.
    #[test]
    fn law_parse_render_is_identity(paper in paper_file()) {
        prop_assert_eq!(parse_paper_file(&render_paper_file(&paper)), Ok(paper));
    }

    /// Law: render(parse(f)) == f for every canonical f (a file this module rendered).
    #[test]
    fn law_render_parse_is_identity(paper in paper_file()) {
        let text = render_paper_file(&paper);
        let parsed = parse_paper_file(&text).expect("parses");
        prop_assert_eq!(render_paper_file(&parsed), text);
    }

    /// Law: a write keeps every unknown entry byte for byte, the body and the relations.
    #[test]
    fn law_write_keeps_what_it_does_not_own(paper in paper_file(), title in text()) {
        prop_assume!(!paper.is_read_only());
        let text = render_paper_file(&paper);
        let mut row = Map::new();
        let _ = row.insert("id".to_owned(), Value::String(paper.id.clone()));
        let _ = row.insert("title".to_owned(), Value::String(title));
        let written = write_paper_row(Some(&text), &row).expect("writes");
        let after = parse_paper_file(&written).expect("parses");
        for raw in &paper.unknown {
            let raw = if paper.crlf { raw.replace('\n', "\r\n") } else { raw.clone() };
            prop_assert!(written.contains(raw.as_str()));
        }
        prop_assert_eq!(after.unknown, paper.unknown);
        prop_assert_eq!(after.body, paper.body);
        prop_assert_eq!(after.relations, paper.relations);
    }

    /// Law: writing the row a file reads as gives back the same file (idempotent write).
    #[test]
    fn law_write_of_own_row_is_identity(paper in paper_file()) {
        prop_assume!(!paper.is_read_only());
        let text = render_paper_file(&paper);
        let row = paper_row(&parse_paper_file(&text).expect("parses"));
        let written = write_paper_row(Some(&text), &row).expect("writes");
        prop_assert_eq!(paper_row(&parse_paper_file(&written).expect("parses")), row);
    }
}

#[test]
fn extras_round_trip_and_keep_the_rest() {
    let text = new_file(&full_row()).replace('\n', "\r\n") + "Body \u{00fc}.\r\n";
    let text = text.replacen("---\r\nBody", "x-mine: 1\r\n---\r\nBody", 1);
    assert_eq!(paper_extras(&parse(&text)), PaperExtras::default());
    let change = extras_change(json!({
        "relations": [{"to": "[[\u{00fc}nicode b.paper]]", "type": "cites", "note": "\u{00ab}k\u{00bb}"}],
        "fields": {"f1": "h\u{00e9}llo", "f2": 4.5, "f3": ["[[b.paper]]"]}
    }));
    let written = write_paper_extras(&text, &change).expect("writes");
    let extras = paper_extras(&parse(&written));
    assert_eq!(extras.relations.len(), 1);
    assert_eq!(extras.relations[0].to, "[[\u{00fc}nicode b.paper]]");
    assert_eq!(
        extras.relations[0].extra.get("note"),
        Some(&json!("\u{00ab}k\u{00bb}"))
    );
    assert_eq!(
        Value::Object(extras.fields),
        json!({"f1": "h\u{00e9}llo", "f2": 4.5, "f3": ["[[b.paper]]"]})
    );
    assert!(written.ends_with("Body \u{00fc}.\r\n"));
    assert!(written.contains("x-mine: 1\r\n"));
    assert!(!written.replace("\r\n", "").contains('\n'));
    assert_eq!(paper_row(&parse(&written)), full_row());
}

#[test]
fn extras_change_touches_only_what_it_names() {
    let text = new_file(&row(json!({"id": "p", "title": "T"})));
    let both =
        extras_change(json!({"relations": [{"to": "b", "type": "cites"}], "fields": {"f": 1}}));
    let text = write_paper_extras(&text, &both).expect("writes");
    let only_fields =
        write_paper_extras(&text, &extras_change(json!({"fields": {"g": 2}}))).expect("writes");
    let extras = paper_extras(&parse(&only_fields));
    assert_eq!(extras.relations.len(), 1);
    assert_eq!(Value::Object(extras.fields), json!({"g": 2}));
    assert_eq!(
        write_paper_extras(&text, &ExtrasChange::default()).expect("writes"),
        text
    );
}

#[test]
fn empty_extras_remove_their_keys() {
    let plain = new_file(&row(json!({"id": "p", "title": "T"})));
    let full = write_paper_extras(
        &plain,
        &extras_change(json!({"relations": [{"to": "b", "type": "cites"}], "fields": {"f": 1}})),
    )
    .expect("writes");
    let cleared = write_paper_extras(
        &full,
        &extras_change(json!({"relations": [], "fields": {}})),
    )
    .expect("writes");
    assert_eq!(cleared, plain);
}

#[test]
fn extras_refuse_newer_and_unreadable_files() {
    let newer = "---\nweaveforge-id: p\nweaveforge-type: paper\nwf: 99\n---\n";
    let change = extras_change(json!({"fields": {"f": 1}}));
    assert_eq!(
        write_paper_extras(newer, &change),
        Err(PaperFileError::ReadOnly(99))
    );
    let bad = "---\nweaveforge-id: p\nweaveforge-type: paper\nrelations: oops\n---\n";
    assert!(paper_extras(&parse(bad)).relations.is_empty());
    let set = extras_change(json!({"relations": [{"to": "b", "type": "cites"}]}));
    assert!(matches!(
        write_paper_extras(bad, &set),
        Err(PaperFileError::Unreadable(_))
    ));
    let kept = write_paper_extras(bad, &change).expect("fields still write");
    assert!(kept.contains("relations: oops\n"));
    assert_eq!(
        write_paper_extras("no frontmatter", &change),
        Err(PaperFileError::NoFrontmatter)
    );
}

#[test]
fn hand_typed_non_object_fields_read_as_empty() {
    let text = "---\nweaveforge-id: p\nweaveforge-type: paper\nfields: 3\n---\n";
    assert!(paper_extras(&parse(text)).fields.is_empty());
}

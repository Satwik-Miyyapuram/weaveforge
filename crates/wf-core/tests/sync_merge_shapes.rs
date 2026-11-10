//! Wire shapes of the merge types that cross to JavaScript: camelCase keys, lowercase picks,
//! and field order kept through a round trip.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use serde_json::{Map, Value, from_value, json, to_value};
use wf_core::sync::frontmatter::ParsedDocument;
use wf_core::sync::merge::Conflict;
use wf_core::sync::merge_vault_page::{VaultPageBase, VaultPageMerge, VaultPageSide};
use wf_core::sync::text_diff::HunkPick;

fn fields(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("not a row: {other}"),
    }
}

#[test]
fn vault_page_base_serializes_body_digest_in_camel_case() {
    let base = VaultPageBase {
        fields: json!({"title": "T"}),
        body_digest: "abc".into(),
    };
    let wire = json!({"fields": {"title": "T"}, "bodyDigest": "abc"});
    assert_eq!(to_value(&base).expect("serialize"), wire);
    let back: VaultPageBase = from_value(wire).expect("deserialize");
    assert_eq!(back, base);
}

#[test]
fn vault_page_side_and_merge_round_trip() {
    let side = VaultPageSide {
        fields: fields(json!({"title": "T"})),
        body: "b".into(),
    };
    let side_wire = json!({"fields": {"title": "T"}, "body": "b"});
    assert_eq!(to_value(&side).expect("serialize"), side_wire);
    let side_back: VaultPageSide = from_value(side_wire).expect("deserialize");
    assert_eq!(side_back, side);

    let merge = VaultPageMerge {
        fields: fields(json!({"title": "T"})),
        body: "b".into(),
        conflicts: vec![Conflict {
            field: "body".into(),
            base: json!("x"),
            local: json!("y"),
            remote: json!("z"),
        }],
    };
    let merge_wire = json!({
        "fields": {"title": "T"},
        "body": "b",
        "conflicts": [{"field": "body", "base": "x", "local": "y", "remote": "z"}]
    });
    assert_eq!(to_value(&merge).expect("serialize"), merge_wire);
    let merge_back: VaultPageMerge = from_value(merge_wire).expect("deserialize");
    assert_eq!(merge_back, merge);
}

#[test]
fn hunk_pick_is_lowercase() {
    assert_eq!(to_value(HunkPick::Ours).expect("serialize"), json!("ours"));
    assert_eq!(
        to_value(HunkPick::Theirs).expect("serialize"),
        json!("theirs")
    );
    assert_eq!(to_value(HunkPick::Both).expect("serialize"), json!("both"));
    let both: HunkPick = from_value(json!("both")).expect("deserialize");
    assert_eq!(both, HunkPick::Both);
    assert!(from_value::<HunkPick>(json!("Ours")).is_err());
}

#[test]
fn parsed_document_round_trips() {
    let doc = ParsedDocument {
        frontmatter: fields(json!({"a": 1})),
        body: "x".into(),
    };
    let wire = json!({"frontmatter": {"a": 1}, "body": "x"});
    assert_eq!(to_value(&doc).expect("serialize"), wire);
    let back: ParsedDocument = from_value(wire).expect("deserialize");
    assert_eq!(back, doc);
}

#[test]
fn field_order_survives_a_round_trip() {
    let side = VaultPageSide {
        fields: fields(json!({"z": 1, "a": 2, "m": 3})),
        body: String::new(),
    };
    let wire = to_value(&side).expect("serialize");
    let back: VaultPageSide = from_value(wire).expect("deserialize");
    assert_eq!(back.fields.keys().collect::<Vec<_>>(), vec!["z", "a", "m"]);
}

//! Instant, golden, ported and property tests for `sync::instant` and
//! `sync::merge`. Goldens come from `tests/goldens/sync-merge.mjs`, which runs
//! `packages/core/src/shared/three-way-merge.ts`. Ported cases come from
//! `packages/core/test/shared/three-way-merge.test.ts`.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use serde_json::{Map, Value, json};
use wf_core::sync::instant::parse_instant;
use wf_core::sync::merge::{Conflict, MergeResult, merge_rows, same_value};

const GOLDEN: &str = include_str!("goldens/sync-merge.json");
const RESERVED: [&str; 4] = ["id", "server_seq", "row_version", "created_at"];
const KEYS: &[&str] = &[
    "a",
    "b",
    "updated_at",
    "id",
    "server_seq",
    "row_version",
    "created_at",
];
const STRS: &[&str] = &[
    "a",
    "b",
    "2026-01-01T10:00:00Z",
    "2026-01-01 10:00:00+00",
    "2026-01-01T12:00:00+02:00",
];

/// 2024-01-01T00:00Z in epoch milliseconds.
const BASE: i64 = 1_704_067_200_000;

fn golden() -> Value {
    serde_json::from_str(GOLDEN).expect("golden parses")
}

fn row(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("not a row: {other}"),
    }
}

/// JS `undefined` is absent from the golden JSON; the Rust side reads it as null.
fn or_null(value: Option<&Value>) -> Value {
    value.cloned().unwrap_or(Value::Null)
}

fn conflict(field: &str, base: Value, local: Value, remote: Value) -> Conflict {
    Conflict {
        field: field.to_owned(),
        base,
        local,
        remote,
    }
}

#[test]
fn instant_accepts_each_separator_and_zone_form() {
    let cases: &[(&str, i64)] = &[
        ("2024-01-01T00:00Z", BASE),
        ("2024-01-01t00:00z", BASE),
        ("2024-01-01 00:00", BASE),
        ("2024-01-01T00:00:00Z", BASE),
        ("2024-01-01T00:00:00.123Z", BASE + 123),
        ("2024-01-01T00:00:00.1239Z", BASE + 123),
        ("2024-01-01T00:00:00.1Z", BASE + 100),
        ("2024-01-01T00:00:00.12Z", BASE + 120),
        ("2024-01-01T02:00+02:00", BASE),
        ("2024-01-01T02:00+0200", BASE),
        ("2024-01-01T02:00+02", BASE),
        ("2024-01-01T00:00-0130", BASE + 5_400_000),
        ("2024-01-01 00:00 +01:00", BASE - 3_600_000),
        ("2024-01-01 00:00:00 -0500", BASE + 18_000_000),
        ("2024-01-01 00:00:00.1+00", BASE + 100),
        ("2024-01-01T00:00+23:59", BASE - 86_340_000),
        ("2024-01-01T00:00:00.5-00:00", BASE + 500),
        ("2024-01-01T24:00Z", BASE + 86_400_000),
        ("2024-01-01T24:00:00.000Z", BASE + 86_400_000),
        ("2023-02-29T00:00Z", 1_677_628_800_000),
        ("2026-02-30T10:00:00Z", 1_772_445_600_000),
        ("1970-01-01T00:00Z", 0),
        ("1969-12-31T23:59:59.999Z", -1),
    ];
    for &(input, expected) in cases {
        assert_eq!(parse_instant(input), Some(expected), "input {input:?}");
    }
}

#[test]
fn instant_rejects_everything_outside_the_grammar() {
    let cases: &[&str] = &[
        "2024-13-01T00:00Z",
        "2024-00-01T00:00Z",
        "2024-01-32T00:00Z",
        "2024-01-00T00:00Z",
        "2024-01-01T25:00Z",
        "2024-01-01T00:60Z",
        "2024-01-01T00:00:61Z",
        "2024-01-01T24:00:01Z",
        "2024-01-01T24:01Z",
        "2024-01-01T24:00:00.001Z",
        "2024-01-01T00:00ZZ",
        "2024-01-01T00:00 extra",
        "2024-01-01X00:00Z",
        "2024-01-01T00:00:00.Z",
        "2024-01-01T00:00:00,5Z",
        "2024-01-01T00:00+2",
        "2024-01-01T0:00Z",
        "2024-01-01T00:00+24:00",
        "2024-01-01T00:00+01:60",
        "2024-01-01T00:00+01:0",
        "2024-01-01T00:00:00.1+00",
        "2024-01-01T00:00:00.5+02",
        "2024-01-01T00:00.1Z",
        "2024-01-01 00:00.1Z",
        "2024-01-01 00:00.1+0000",
        "2024-01-01T00:00UTC",
        "2024-01-01T00:00GMT+2",
        "2024-01-01 00:00 pm",
        "2024-01-01 00:00 Z",
        "2024-01-01T00:00 +01:00",
        "2024-01-01",
        "",
        "+002024-01-01T00:00Z",
    ];
    for input in cases {
        assert_eq!(parse_instant(input), None, "input {input:?}");
    }
}

#[test]
fn same_value_golden_cases() {
    let golden = golden();
    let cases = golden["same"].as_array().expect("same section");
    assert!(!cases.is_empty());
    for case in cases {
        let expected = case[2].as_bool().expect("bool");
        let actual = same_value(&case[0], &case[1]);
        assert_eq!(actual, expected, "same case {case}");
    }
}

#[test]
fn merge_rows_golden_cases() {
    let golden = golden();
    let cases = golden["merge"].as_array().expect("merge section");
    assert!(!cases.is_empty());
    for case in cases {
        let base = row(case["base"].clone());
        let local = row(case["local"].clone());
        let remote = row(case["remote"].clone());
        let result = merge_rows(&base, &local, &remote);

        assert_eq!(
            Value::Object(result.merged.clone()),
            case["out"]["merged"],
            "merged for case {case}"
        );

        let mut expected: Vec<Conflict> = case["out"]["conflicts"]
            .as_array()
            .expect("conflicts array")
            .iter()
            .map(|c| {
                conflict(
                    c["field"].as_str().expect("field"),
                    or_null(c.get("base")),
                    or_null(c.get("local")),
                    or_null(c.get("remote")),
                )
            })
            .collect();
        expected.sort_by(|a, b| a.field.cmp(&b.field));
        let mut actual = result.conflicts.clone();
        actual.sort_by(|a, b| a.field.cmp(&b.field));
        assert_eq!(actual, expected, "conflicts for case {case}");
    }
}

#[test]
fn same_value_treats_null_and_missing_alike() {
    assert!(same_value(&Value::Null, &Value::Null));
    assert!(!same_value(&Value::Null, &json!(0)));
}

#[test]
fn same_value_compares_timestamps_by_instant_but_not_lowercase_t() {
    assert!(same_value(
        &json!("2026-01-01T10:00:00Z"),
        &json!("2026-01-01 10:00:00+00:00")
    ));
    assert!(!same_value(
        &json!("2026-01-01t10:00:00z"),
        &json!("2026-01-01T10:00:00Z")
    ));
}

#[test]
fn same_value_compares_numbers_by_value() {
    assert!(same_value(&json!(1), &json!(1.0)));
    assert!(!same_value(&json!(1), &json!("1")));
}

#[test]
fn same_value_compares_structures_with_sorted_keys() {
    assert!(same_value(
        &json!({"a": 1, "b": 2}),
        &json!({"b": 2, "a": 1})
    ));
    assert!(same_value(
        &json!({"a": {"y": 1, "x": 2}}),
        &json!({"a": {"x": 2, "y": 1}})
    ));
    assert!(!same_value(&json!([1, 2]), &json!([2, 1])));
    assert!(!same_value(&json!([]), &json!({})));
}

#[test]
fn ported_takes_a_field_only_one_side_changed() {
    let base =
        row(json!({"id": "p1", "title": "Draft", "read": false, "tags": ["a"], "row_version": 3}));
    let mut local = base.clone();
    let _ = local.insert("title".into(), json!("Renamed"));
    let result = merge_rows(&base, &local, &base);
    assert_eq!(result.merged["title"], json!("Renamed"));
    assert!(result.conflicts.is_empty());
}

#[test]
fn ported_takes_the_server_field_when_only_the_server_changed_it() {
    let base =
        row(json!({"id": "p1", "title": "Draft", "read": false, "tags": ["a"], "row_version": 3}));
    let mut remote = base.clone();
    let _ = remote.insert("read".into(), json!(true));
    let result = merge_rows(&base, &base, &remote);
    assert_eq!(result.merged["read"], json!(true));
    assert!(result.conflicts.is_empty());
}

#[test]
fn ported_does_not_call_two_edits_to_different_fields_a_conflict() {
    let base = row(json!({"id": "p1", "title": "Draft", "read": false}));
    let mut local = base.clone();
    let _ = local.insert("title".into(), json!("Renamed"));
    let mut remote = base.clone();
    let _ = remote.insert("read".into(), json!(true));
    let result = merge_rows(&base, &local, &remote);
    assert!(result.conflicts.is_empty());
    assert_eq!(result.merged["title"], json!("Renamed"));
    assert_eq!(result.merged["read"], json!(true));
}

#[test]
fn ported_agreement_is_not_a_conflict() {
    let base = row(json!({"id": "p1", "title": "Draft"}));
    let same = row(json!({"id": "p1", "title": "Same"}));
    let result = merge_rows(&base, &same, &same);
    assert!(result.conflicts.is_empty());
    assert_eq!(result.merged["title"], json!("Same"));
}

#[test]
fn ported_reports_a_field_both_sides_moved_differently() {
    let base = row(json!({"id": "p1", "title": "Draft"}));
    let local = row(json!({"id": "p1", "title": "Mine"}));
    let remote = row(json!({"id": "p1", "title": "Theirs"}));
    let result = merge_rows(&base, &local, &remote);
    assert_eq!(
        result.conflicts,
        vec![conflict(
            "title",
            json!("Draft"),
            json!("Mine"),
            json!("Theirs")
        )]
    );
    assert_eq!(result.merged["title"], json!("Theirs"));
}

#[test]
fn ported_compares_structures_by_value() {
    let base = row(json!({"tags": ["a"]}));
    let local = row(json!({"tags": ["a"]}));
    let remote = row(json!({"tags": ["a", "b"]}));
    let result = merge_rows(&base, &local, &remote);
    assert!(result.conflicts.is_empty());
    assert_eq!(result.merged["tags"], json!(["a", "b"]));
}

#[test]
fn ported_leaves_reserved_columns_to_the_server() {
    let base = row(json!({"id": "p1", "row_version": 3}));
    let local = row(json!({"id": "p1", "row_version": 9}));
    let remote = row(json!({"id": "p1", "row_version": 4}));
    let result = merge_rows(&base, &local, &remote);
    assert!(result.conflicts.is_empty());
    assert_eq!(result.merged["row_version"], json!(4));
}

#[test]
fn ported_keeps_the_later_edit_stamp_instead_of_asking() {
    let base = row(json!({"title": "Draft", "updated_at": "2026-01-01T00:00:00Z"}));
    let local = row(json!({"title": "Mine", "updated_at": "2026-01-03T00:00:00Z"}));
    let remote = row(json!({"title": "Draft", "done": true, "updated_at": "2026-01-02T00:00:00Z"}));
    let result = merge_rows(&base, &local, &remote);
    assert!(result.conflicts.is_empty());
    assert_eq!(result.merged["updated_at"], json!("2026-01-03T00:00:00Z"));
}

#[test]
fn ported_reads_one_instant_in_two_offsets_as_the_same_value() {
    let local = row(json!({"started_at": "2026-08-27T19:24:39.357+05:00"}));
    let remote = row(json!({"started_at": "2026-08-27T14:24:39.357+00:00"}));
    let result = merge_rows(&Map::new(), &local, &remote);
    assert!(result.conflicts.is_empty());
}

#[test]
fn ported_ignores_key_order_inside_structures() {
    let local = row(json!({"config": {"lr": 1, "batch": 2}}));
    let remote = row(json!({"config": {"batch": 2, "lr": 1}}));
    let result = merge_rows(&Map::new(), &local, &remote);
    assert!(result.conflicts.is_empty());
}

fn value_strategy() -> impl Strategy<Value = Value> {
    prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        (0i64..3).prop_map(|n| json!(n)),
        prop::sample::select(STRS).prop_map(|s| Value::String(s.to_owned())),
        Just(json!([1, 2])),
        Just(json!({"x": 1})),
    ]
}

fn row_strategy() -> impl Strategy<Value = Map<String, Value>> {
    prop::collection::btree_map(prop::sample::select(KEYS), value_strategy(), 0..5).prop_map(|m| {
        m.into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect::<Map<String, Value>>()
    })
}

fn conflict_fields(result: &MergeResult) -> Vec<String> {
    let mut fields: Vec<String> = result.conflicts.iter().map(|c| c.field.clone()).collect();
    fields.sort();
    fields
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn only_local_changed_takes_local_without_conflicts(base in row_strategy(), local in row_strategy()) {
        let result = merge_rows(&base, &local, &base);
        prop_assert!(result.conflicts.is_empty());
        // Same value, not same bytes: one instant written two ways keeps the base form.
        for key in KEYS.iter().filter(|k| !RESERVED.contains(*k)) {
            let merged = or_null(result.merged.get(*key));
            let mine = or_null(local.get(*key));
            prop_assert!(same_value(&merged, &mine), "field {}: {} vs {}", key, merged, mine);
        }
    }

    #[test]
    fn swapping_local_and_remote_gives_the_same_conflict_fields(
        base in row_strategy(),
        local in row_strategy(),
        remote in row_strategy(),
    ) {
        let forward = merge_rows(&base, &local, &remote);
        let swapped = merge_rows(&base, &remote, &local);
        prop_assert_eq!(conflict_fields(&forward), conflict_fields(&swapped));
    }

    #[test]
    fn reserved_fields_in_merged_always_equal_remote(
        base in row_strategy(),
        local in row_strategy(),
        remote in row_strategy(),
    ) {
        let result = merge_rows(&base, &local, &remote);
        for key in RESERVED {
            prop_assert_eq!(result.merged.get(key), remote.get(key), "field {}", key);
        }
    }
}

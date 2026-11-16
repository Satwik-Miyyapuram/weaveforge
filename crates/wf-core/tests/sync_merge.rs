//! Instant, table, ported and property tests for `sync::instant` and
//! `sync::merge`. The tables keep every case the old TypeScript-printed golden
//! of `packages/core/src/shared/parts.ts` covered. Ported cases come from
//! `packages/core/test/shared/three-way-merge.test.ts`.

// Row helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use serde_json::{Map, Value, json};
use wf_core::sync::instant::parse_instant;
use wf_core::sync::merge::{Conflict, MergeResult, merge_rows, same_value};

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

fn row(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("not a row: {other}"),
    }
}

/// A field missing from a row reads as null, as in `merge_rows` conflicts.
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
        "2024-01-01T02:00+02",
        "2024-01-01T02:00:00+02",
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

/// Instant strings grouped by the moment they name. `same_value` is true for
/// any two strings in one group and false across groups. Offsetless forms read
/// as UTC; a string outside the instant grammar only equals itself.
const INSTANT_GROUPS: &[&[&str]] = &[
    &[
        "2026-01-01T10:00:00Z",
        "2026-01-01T10:00:00.000Z",
        "2026-01-01 10:00:00+00",
        "2026-01-01 10:00:00+00:00",
        "2026-01-01T12:00:00+02:00",
        "2026-01-01T10:00",
        "2026-01-01 10:00",
        "2026-01-01T10:00:00",
    ],
    // Fractions past milliseconds are cut, not rounded.
    &[
        "2026-01-01T10:00:00.123456Z",
        "2026-01-01T10:00:00.123Z",
        "2026-01-01T10:00:00.1239Z",
    ],
    &["2026-01-01 08:00:00.5+00", "2026-01-01T08:00:00.500Z"],
    // Hour 24 is midnight of the next day.
    &["2026-01-01T24:00:00Z", "2026-01-02T00:00:00Z"],
    &["2026-01-01T12:00+02"],
    &["2026-01-01T12:00:00+02"],
    &["2026-01-01T10:00:00-05:30"],
    &["2026-01-01T04:30:00Z"],
    &["2026-01-01T10:00:00+0200"],
    &["2026-01-01T10:00:00+23:59"],
    &["2026-02-30T10:00:00Z"],
    &["2024-02-29T10:00:00Z"],
    &["2023-02-29T10:00:00Z"],
    &["1970-01-01T00:00:00Z"],
    &["1969-12-31T23:59:59.999Z"],
    &["9999-12-31T23:59:59Z"],
    &["2026-13-01T10:00:00Z"],
    &["2026-01-01T25:00:00Z"],
    &["2026-01-01T10:60:00Z"],
    &["2026-01-01T10:00:00ZZ"],
    &["2026-01-01T10:00:00 extra"],
    &["2026-01-01X10:00"],
    &["2026-01-01"],
    &["10:00"],
    &[""],
    &["abc"],
    &["+002026-01-01T10:00:00Z"],
    &["2026-01-01T10:00:00.Z"],
    &["2026-01-01T10:00:00,5Z"],
    &["2026-01-01T10:00:00+24:00"],
    &["2026-01-01t10:00:00z"],
    &["2026-01-01T1:00:00Z"],
];

/// Asserts `same_value` holds exactly within each group, over every ordered pair.
fn assert_groups(groups: &[Vec<Value>]) {
    for (i, group_a) in groups.iter().enumerate() {
        for (j, group_b) in groups.iter().enumerate() {
            for a in group_a {
                for b in group_b {
                    assert_eq!(same_value(a, b), i == j, "same_value({a}, {b})");
                }
            }
        }
    }
}

#[test]
fn same_value_matches_instants_by_moment() {
    let groups: Vec<Vec<Value>> = INSTANT_GROUPS
        .iter()
        .map(|group| group.iter().map(|s| json!(s)).collect())
        .collect();
    assert_groups(&groups);
}

#[test]
fn same_value_matches_other_values_structurally() {
    let groups = vec![
        vec![Value::Null],
        vec![json!(true)],
        vec![json!(false)],
        vec![json!(0)],
        vec![json!(1)],
        vec![json!(-1)],
        vec![json!(1.5)],
        vec![json!("a")],
        vec![json!("")],
        vec![json!("1")],
        vec![json!([])],
        vec![json!([1, 2])],
        vec![json!([2, 1])],
        vec![json!({})],
        vec![json!({"a": 1, "b": 2}), json!({"b": 2, "a": 1})],
        vec![
            json!({"a": {"y": 1, "x": 2}}),
            json!({"a": {"x": 2, "y": 1}}),
        ],
        vec![json!([{"b": 1, "a": 2}]), json!([{"a": 2, "b": 1}])],
        vec![json!({"a": null})],
        vec![json!({"a": [1, {"d": 1, "c": 2}]})],
    ];
    assert_groups(&groups);
}

/// One `merge_rows` case: base, local, remote, the merged row, and the
/// conflicts as `[field, base, local, remote]` (null where a side lacks it).
type MergeCase = (Value, Value, Value, Value, Value);

#[test]
#[allow(clippy::too_many_lines, reason = "one table of cases")]
fn merge_rows_cases() {
    let cases: Vec<MergeCase> = vec![
        (json!({}), json!({}), json!({}), json!({}), json!([])),
        // One side changed: take it.
        (
            json!({"t": "a"}),
            json!({"t": "b"}),
            json!({"t": "a"}),
            json!({"t": "b"}),
            json!([]),
        ),
        (
            json!({"t": "a"}),
            json!({"t": "a"}),
            json!({"t": "b"}),
            json!({"t": "b"}),
            json!([]),
        ),
        // Both made the same change.
        (
            json!({"t": "a"}),
            json!({"t": "b"}),
            json!({"t": "b"}),
            json!({"t": "b"}),
            json!([]),
        ),
        // Both changed differently: remote wins and the field is a conflict.
        (
            json!({"t": "a"}),
            json!({"t": "b"}),
            json!({"t": "c"}),
            json!({"t": "c"}),
            json!([["t", "a", "b", "c"]]),
        ),
        (
            json!({"t": "a", "r": false}),
            json!({"t": "b", "r": false}),
            json!({"t": "a", "r": true}),
            json!({"t": "b", "r": true}),
            json!([]),
        ),
        // Added on one side, or differently on both.
        (
            json!({}),
            json!({"t": "new"}),
            json!({}),
            json!({"t": "new"}),
            json!([]),
        ),
        (
            json!({}),
            json!({}),
            json!({"t": "new"}),
            json!({"t": "new"}),
            json!([]),
        ),
        (
            json!({}),
            json!({"t": "x"}),
            json!({"t": "y"}),
            json!({"t": "y"}),
            json!([["t", null, "x", "y"]]),
        ),
        // Removed on one side; removed against an edit is a conflict.
        (
            json!({"t": "a"}),
            json!({}),
            json!({"t": "a"}),
            json!({}),
            json!([]),
        ),
        (
            json!({"t": "a"}),
            json!({"t": "a"}),
            json!({}),
            json!({}),
            json!([]),
        ),
        (
            json!({"t": "a"}),
            json!({}),
            json!({"t": "b"}),
            json!({"t": "b"}),
            json!([["t", "a", null, "b"]]),
        ),
        (
            json!({"t": "a"}),
            json!({"t": null}),
            json!({"t": "b"}),
            json!({"t": "b"}),
            json!([["t", "a", null, "b"]]),
        ),
        // Reserved columns always come from the server.
        (
            json!({"id": 1, "server_seq": 1, "row_version": 1, "created_at": "x"}),
            json!({"id": 2, "server_seq": 2, "row_version": 2, "created_at": "y"}),
            json!({"id": 3, "server_seq": 3, "row_version": 3, "created_at": "z"}),
            json!({"id": 3, "server_seq": 3, "row_version": 3, "created_at": "z"}),
            json!([]),
        ),
        // `updated_at` keeps the later instant; unreadable stamps take remote.
        (
            json!({"updated_at": "2026-01-01T10:00:00Z"}),
            json!({"updated_at": "2026-01-02T10:00:00Z"}),
            json!({"updated_at": "2026-01-03T10:00:00Z"}),
            json!({"updated_at": "2026-01-03T10:00:00Z"}),
            json!([]),
        ),
        (
            json!({"updated_at": "2026-01-01T10:00:00Z"}),
            json!({"updated_at": "2026-01-04T10:00:00Z"}),
            json!({"updated_at": "2026-01-03T10:00:00Z"}),
            json!({"updated_at": "2026-01-04T10:00:00Z"}),
            json!([]),
        ),
        (
            json!({"updated_at": "2026-01-01T10:00:00Z"}),
            json!({"updated_at": "2026-01-04 10:00:00+00"}),
            json!({"updated_at": "2026-01-04T10:00:00Z"}),
            json!({"updated_at": "2026-01-04 10:00:00+00"}),
            json!([]),
        ),
        (
            json!({"updated_at": "x"}),
            json!({"updated_at": "y"}),
            json!({"updated_at": "z"}),
            json!({"updated_at": "z"}),
            json!([]),
        ),
        (
            json!({"updated_at": "x"}),
            json!({"updated_at": "2026-01-04T10:00:00Z"}),
            json!({"updated_at": "z"}),
            json!({"updated_at": "z"}),
            json!([]),
        ),
        (
            json!({"updated_at": "2026-01-01T10:00:00Z"}),
            json!({"updated_at": "2026-01-04T10:00:00Z"}),
            json!({"updated_at": "2026-01-04T10:00:00.000Z"}),
            json!({"updated_at": "2026-01-04T10:00:00Z"}),
            json!([]),
        ),
        // The same instant in another form counts as unchanged.
        (
            json!({"at": "2026-01-01T10:00:00Z"}),
            json!({"at": "2026-01-01 10:00:00+00"}),
            json!({"at": "2026-01-02T10:00:00Z"}),
            json!({"at": "2026-01-02T10:00:00Z"}),
            json!([]),
        ),
        (
            json!({"s": "2026-01-01T10:00:00Z"}),
            json!({"s": "2026-01-01T10:00:00Z"}),
            json!({"s": "2026-01-01T12:00:00+02:00"}),
            json!({"s": "2026-01-01T12:00:00+02:00"}),
            json!([]),
        ),
        // Structures compare by value, ignoring key order.
        (
            json!({"j": {"a": 1, "b": 2}}),
            json!({"j": {"b": 2, "a": 1}}),
            json!({"j": {"a": 1, "b": 3}}),
            json!({"j": {"a": 1, "b": 3}}),
            json!([]),
        ),
        (
            json!({"j": {"a": 1}}),
            json!({"j": {"a": 2}}),
            json!({"j": {"a": 3}}),
            json!({"j": {"a": 3}}),
            json!([["j", {"a": 1}, {"a": 2}, {"a": 3}]]),
        ),
        // Numbers compare by value and never equal their text.
        (
            json!({"n": 1}),
            json!({"n": 1.0}),
            json!({"n": 2}),
            json!({"n": 2}),
            json!([]),
        ),
        (
            json!({"n": 1}),
            json!({"n": "1"}),
            json!({"n": 1}),
            json!({"n": "1"}),
            json!([]),
        ),
        // Several fields at once.
        (
            json!({"a": 1, "b": 1, "c": 1}),
            json!({"a": 2, "b": 1, "c": 5}),
            json!({"a": 1, "b": 3, "c": 6, "d": 9}),
            json!({"a": 2, "b": 3, "c": 6, "d": 9}),
            json!([["c", 1, 5, 6]]),
        ),
    ];
    for (base, local, remote, merged, conflicts) in cases {
        let case = format!("base {base}, local {local}, remote {remote}");
        let result = merge_rows(&row(base), &row(local), &row(remote));
        assert_eq!(Value::Object(result.merged), merged, "merged for {case}");
        let expected: Vec<Conflict> = conflicts
            .as_array()
            .expect("conflicts array")
            .iter()
            .map(|c| {
                conflict(
                    c[0].as_str().expect("field"),
                    c[1].clone(),
                    c[2].clone(),
                    c[3].clone(),
                )
            })
            .collect();
        assert_eq!(result.conflicts, expected, "conflicts for {case}");
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
fn a_body_both_sides_edited_on_different_lines_merges_line_by_line() {
    let base = row(json!({"body": "one
two
three"}));
    let local = row(json!({"body": "ONE
two
three"}));
    let remote = row(json!({"body": "one
two
THREE"}));
    let result = merge_rows(&base, &local, &remote);
    assert!(result.conflicts.is_empty());
    assert_eq!(
        result.merged["body"],
        json!(
            "ONE
two
THREE"
        )
    );
}

#[test]
fn a_body_both_sides_edited_on_the_same_line_stays_a_conflict() {
    let base = row(json!({"body": "one
two"}));
    let local = row(json!({"body": "one
mine"}));
    let remote = row(json!({"body": "one
theirs"}));
    let result = merge_rows(&base, &local, &remote);
    assert_eq!(
        result.conflicts,
        vec![conflict(
            "body",
            json!(
                "one
two"
            ),
            json!(
                "one
mine"
            ),
            json!(
                "one
theirs"
            )
        )]
    );
    assert_eq!(
        result.merged["body"],
        json!(
            "one
theirs"
        )
    );
}

#[test]
fn a_body_with_no_base_text_stays_a_conflict() {
    let local = row(json!({"body": "mine"}));
    let remote = row(json!({"body": "theirs"}));
    let result = merge_rows(&Map::new(), &local, &remote);
    assert_eq!(result.conflicts.len(), 1);
}

#[test]
fn only_the_body_field_merges_by_line() {
    let base = row(json!({"title": "a
b"}));
    let local = row(json!({"title": "A
b"}));
    let remote = row(json!({"title": "a
B"}));
    assert_eq!(merge_rows(&base, &local, &remote).conflicts.len(), 1);
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
    #![proptest_config(ProptestConfig::default())]

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

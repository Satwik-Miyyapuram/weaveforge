//! Golden, ported and property tests for `sync::change_origin` and
//! `sync::snapshot_delta`. Goldens come from `tests/goldens/sync-text.mjs`, which
//! runs `packages/core/src/workspace/{change-origin,snapshot-delta}.ts`. Ported
//! cases come from `packages/core/test/workspace/{change-origin,snapshot-delta}.test.ts`.
//! `readWithDelta` is async I/O and is not ported, so its tests are not here.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashSet;
use wf_core::sync::change_origin::{ChangeOrigin, ChangeSide, changed_side, digest_text};
use wf_core::sync::snapshot_delta::{EntityStamp, apply_delta, plan_delta};

const GOLDEN: &str = include_str!("goldens/sync-origin.json");

#[derive(Clone, Debug, PartialEq)]
struct Row {
    id: String,
    updated_at: String,
    body: String,
}

#[derive(Clone, Debug, PartialEq)]
struct Item {
    id: String,
    v: i64,
}

fn golden() -> Value {
    serde_json::from_str(GOLDEN).expect("sync-origin.json parses")
}

fn section<'a>(golden: &'a Value, name: &str) -> &'a [Value] {
    golden
        .get(name)
        .and_then(Value::as_array)
        .expect("section present")
        .as_slice()
}

fn text(v: &Value) -> &str {
    v.as_str().expect("string")
}

fn side_name(side: ChangeSide) -> &'static str {
    match side {
        ChangeSide::Neither => "neither",
        ChangeSide::Folder => "folder",
        ChangeSide::Workspace => "workspace",
        ChangeSide::Both => "both",
        ChangeSide::Unknown => "unknown",
    }
}

fn origin_of(v: &Value) -> ChangeOrigin<'_> {
    ChangeOrigin {
        base: v.get("base").and_then(Value::as_str),
        folder: v.get("folder").and_then(Value::as_str),
        workspace: v.get("workspace").and_then(Value::as_str),
    }
}

fn stamp(id: &str, updated_at: &str) -> EntityStamp {
    EntityStamp {
        id: id.to_owned(),
        updated_at: updated_at.to_owned(),
    }
}

fn stamps_of(v: &Value) -> Vec<EntityStamp> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|s| stamp(text(&s["id"]), text(&s["updatedAt"])))
        .collect()
}

fn held_of(v: &Value) -> Vec<(String, String)> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|p| (text(&p[0]).to_owned(), text(&p[1]).to_owned()))
        .collect()
}

fn strings_of(v: &Value) -> Vec<String> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|s| text(s).to_owned())
        .collect()
}

fn items_of(v: &Value) -> Vec<Item> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|r| Item {
            id: text(&r["id"]).to_owned(),
            v: r["v"].as_i64().expect("integer"),
        })
        .collect()
}

fn row(id: &str, updated_at: &str, body: &str) -> Row {
    Row {
        id: id.to_owned(),
        updated_at: updated_at.to_owned(),
        body: body.to_owned(),
    }
}

fn held(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(id, at)| ((*id).to_owned(), (*at).to_owned()))
        .collect()
}

fn side(base: &str, folder: &str, workspace: &str) -> ChangeSide {
    let (b, f, w) = (
        digest_text(base),
        digest_text(folder),
        digest_text(workspace),
    );
    changed_side(ChangeOrigin {
        base: Some(&b),
        folder: Some(&f),
        workspace: Some(&w),
    })
}

// ------------------------------------------------------------------ goldens

#[test]
fn golden_digest_cases() {
    let g = golden();
    for case in section(&g, "digest") {
        assert_eq!(
            digest_text(text(&case[0])),
            text(&case[1]),
            "case {:?}",
            text(&case[0])
        );
    }
}

#[test]
fn golden_side_cases() {
    let g = golden();
    for case in section(&g, "side") {
        let got = side_name(changed_side(origin_of(&case[0])));
        assert_eq!(got, text(&case[1]), "case {}", case[0]);
    }
}

#[test]
fn golden_plan_cases() {
    let g = golden();
    for case in section(&g, "plan") {
        let plan = plan_delta(&stamps_of(&case["remote"]), &held_of(&case["held"]));
        let want = &case["out"];
        assert_eq!(plan.fetch, strings_of(&want["fetch"]), "fetch, case {case}");
        assert_eq!(plan.drop, strings_of(&want["drop"]), "drop, case {case}");
        assert_eq!(
            plan.unchanged,
            want["unchanged"].as_bool().expect("bool"),
            "unchanged, case {case}"
        );
    }
}

#[test]
fn golden_apply_cases() {
    let g = golden();
    for case in section(&g, "apply") {
        let out = apply_delta(
            &items_of(&case["held"]),
            &items_of(&case["fetched"]),
            &stamps_of(&case["order"]),
            |item| item.id.as_str(),
        );
        assert_eq!(out, items_of(&case["out"]), "case {case}");
    }
}

// ------------------------------------------------------- change origin (ported)

#[test]
fn digest_is_stable_and_text_sensitive() {
    assert_eq!(digest_text("hello"), digest_text("hello"));
    assert_ne!(digest_text("hello"), digest_text("hello "));
    assert_ne!(digest_text("ab"), digest_text("ba"));
}

#[test]
fn who_moved_is_read_from_the_three_digests() {
    assert_eq!(side("a", "a", "a"), ChangeSide::Neither);
    assert_eq!(side("a", "b", "a"), ChangeSide::Folder);
    assert_eq!(side("a", "a", "b"), ChangeSide::Workspace);
    assert_eq!(side("a", "b", "c"), ChangeSide::Both);
    // Both sides arriving at the same text is agreement, not a conflict.
    assert_eq!(side("a", "b", "b"), ChangeSide::Neither);
}

#[test]
fn a_missing_side_is_unknown_never_a_guess() {
    assert_eq!(
        changed_side(ChangeOrigin {
            folder: Some("x"),
            workspace: Some("y"),
            ..Default::default()
        }),
        ChangeSide::Unknown
    );
    assert_eq!(
        changed_side(ChangeOrigin {
            base: Some("x"),
            workspace: Some("y"),
            ..Default::default()
        }),
        ChangeSide::Unknown
    );
    assert_eq!(
        changed_side(ChangeOrigin {
            base: Some("x"),
            folder: Some("y"),
            ..Default::default()
        }),
        ChangeSide::Unknown
    );
}

#[test]
fn a_folder_matching_the_workspace_changed_nowhere_base_or_not() {
    assert_eq!(
        changed_side(ChangeOrigin {
            folder: Some("aa"),
            workspace: Some("aa"),
            ..Default::default()
        }),
        ChangeSide::Neither
    );
    assert_eq!(
        changed_side(ChangeOrigin {
            folder: Some("aa"),
            workspace: Some("bb"),
            ..Default::default()
        }),
        ChangeSide::Unknown
    );
}

// ------------------------------------------------------- snapshot delta (ported)

#[test]
fn an_unchanged_corpus_needs_nothing_fetched() {
    let plan = plan_delta(
        &[stamp("a", "t1"), stamp("b", "t1")],
        &held(&[("a", "t1"), ("b", "t1")]),
    );
    assert!(plan.unchanged);
    assert!(plan.fetch.is_empty());
    assert!(plan.drop.is_empty());
}

#[test]
fn a_changed_row_is_fetched_an_untouched_one_is_not() {
    let plan = plan_delta(
        &[stamp("a", "t2"), stamp("b", "t1")],
        &held(&[("a", "t1"), ("b", "t1")]),
    );
    assert_eq!(plan.fetch, vec!["a".to_owned()]);
    assert!(!plan.unchanged);
}

#[test]
fn a_new_row_is_fetched() {
    let plan = plan_delta(
        &[stamp("a", "t1"), stamp("new", "t1")],
        &held(&[("a", "t1")]),
    );
    assert_eq!(plan.fetch, vec!["new".to_owned()]);
}

#[test]
fn a_deleted_row_is_dropped_which_is_why_ids_are_compared() {
    let plan = plan_delta(&[stamp("a", "t1")], &held(&[("a", "t1"), ("gone", "t1")]));
    assert_eq!(plan.drop, vec!["gone".to_owned()]);
    assert!(
        plan.fetch.is_empty(),
        "nothing needs re-reading, but something must go"
    );
}

#[test]
fn an_empty_database_drops_everything_held() {
    let mut plan = plan_delta(&[], &held(&[("a", "t1"), ("b", "t1")]));
    plan.drop.sort();
    assert_eq!(plan.drop, vec!["a".to_owned(), "b".to_owned()]);
}

#[test]
fn merging_keeps_the_order_the_database_reported() {
    let held_rows = [
        row("a", "t1", "a"),
        row("b", "t1", "b"),
        row("c", "t1", "c"),
    ];
    let fetched = [row("b", "t2", "b2")];
    let order = [stamp("c", "t1"), stamp("b", "t2"), stamp("a", "t1")];
    let merged = apply_delta(&held_rows, &fetched, &order, |r| r.id.as_str());
    let ids: Vec<&str> = merged.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["c", "b", "a"]);
}

#[test]
fn a_fetched_row_replaces_the_held_one() {
    let merged = apply_delta(
        &[row("a", "t1", "old")],
        &[row("a", "t2", "new")],
        &[stamp("a", "t2")],
        |r| r.id.as_str(),
    );
    assert_eq!(merged[0].body, "new");
}

#[test]
fn a_row_absent_from_the_order_is_not_carried_over() {
    let merged = apply_delta(
        &[row("a", "t1", "a"), row("gone", "t1", "g")],
        &[],
        &[stamp("a", "t1")],
        |r| r.id.as_str(),
    );
    let ids: Vec<&str> = merged.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["a"]);
}

// ------------------------------------------------------------------ properties

/// Rows are identified by `(id, version)`; the body is a function of both, so a
/// stamp that matches means the held row already is the row that was published.
fn build(spec: &[(u8, u8)]) -> Vec<Row> {
    let mut seen = HashSet::new();
    spec.iter()
        .filter(|(id, _)| seen.insert(*id))
        .map(|(id, v)| {
            row(
                &format!("r{id}"),
                &format!("t{v}"),
                &format!("body {id}@{v}"),
            )
        })
        .collect()
}

fn spec() -> impl Strategy<Value = Vec<(u8, u8)>> {
    proptest::collection::vec((0u8..8, 0u8..3), 0..10)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn applying_the_plan_reproduces_the_next_snapshot(base_spec in spec(), next_spec in spec()) {
        let base = build(&base_spec);
        let next = build(&next_spec);

        let remote: Vec<EntityStamp> = next
            .iter()
            .map(|r| stamp(&r.id, &r.updated_at))
            .collect();
        let held_pairs: Vec<(String, String)> = base
            .iter()
            .map(|r| (r.id.clone(), r.updated_at.clone()))
            .collect();

        let plan = plan_delta(&remote, &held_pairs);
        let fetched: Vec<Row> = next
            .iter()
            .filter(|r| plan.fetch.contains(&r.id))
            .cloned()
            .collect();
        let merged = apply_delta(&base, &fetched, &remote, |r| r.id.as_str());

        prop_assert_eq!(merged, next);
    }

    #[test]
    fn plan_is_unchanged_exactly_when_stamps_match(base_spec in spec(), next_spec in spec()) {
        let base = build(&base_spec);
        let next = build(&next_spec);
        let remote: Vec<EntityStamp> = next
            .iter()
            .map(|r| stamp(&r.id, &r.updated_at))
            .collect();
        let held_pairs: Vec<(String, String)> = base
            .iter()
            .map(|r| (r.id.clone(), r.updated_at.clone()))
            .collect();

        let plan = plan_delta(&remote, &held_pairs);
        // Order does not matter to the plan, so compare the stamp sets.
        let mut a = held_pairs.clone();
        let mut b: Vec<(String, String)> = remote
            .iter()
            .map(|s| (s.id.clone(), s.updated_at.clone()))
            .collect();
        a.sort();
        b.sort();
        prop_assert_eq!(plan.unchanged, a == b);
    }
}

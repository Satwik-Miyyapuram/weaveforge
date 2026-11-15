//! Table, ported and property tests for `sync::change_origin` and
//! `sync::snapshot_delta`. The tables keep every case the old TypeScript-printed
//! golden of `packages/core/src/workspace/{change-origin,snapshot-delta}.ts`
//! covered. Ported cases come from
//! `packages/core/test/workspace/{change-origin,snapshot-delta}.test.ts`.
//! `readWithDelta` is async I/O and is not ported, so its tests are not here.

use proptest::prelude::*;
use std::collections::HashSet;
use wf_core::sync::change_origin::{ChangeOrigin, ChangeSide, changed_side, digest_text};
use wf_core::sync::snapshot_delta::{EntityStamp, apply_delta, plan_delta};

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

fn stamp(id: &str, updated_at: &str) -> EntityStamp {
    EntityStamp {
        id: id.to_owned(),
        updated_at: updated_at.to_owned(),
    }
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

fn items(pairs: &[(&str, i64)]) -> Vec<Item> {
    pairs
        .iter()
        .map(|(id, v)| Item {
            id: (*id).to_owned(),
            v: *v,
        })
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

// ------------------------------------------------------------------- tables

/// `digest_text` walks UTF-16 units, so astral characters and U+FFFF hash as units.
#[test]
fn digest_cases() {
    let long = "x".repeat(1000);
    let cases = [
        ("", "811c9dc501000193"),
        ("a", "e40c292cefafc426"),
        ("ab", "4d2505cae3ac7ad7"),
        ("hello world", "d58b3fa7d3025c56"),
        ("héllo", "f1e5b55fec13d51f"),
        ("日本語", "5406374ef94592a7"),
        ("😀", "cb31c4b88e7ecf29"),
        ("\u{10000}", "36215bcd2bc474d0"),
        ("a\r\nb", "c40663dbf6933c33"),
        (long.as_str(), "07d181652dc67853"),
        ("\0", "050c5d1f3d2fa671"),
        ("\u{ffff}", "79aea14edd4f8f24"),
    ];
    for (text, want) in cases {
        assert_eq!(digest_text(text), want, "case {text:?}");
    }
}

/// Digests as (base, folder, workspace); `None` is a side with no digest.
#[test]
fn side_cases() {
    let cases = [
        (None, None, None, ChangeSide::Unknown),
        (Some("a"), None, None, ChangeSide::Unknown),
        (Some("a"), Some("a"), None, ChangeSide::Unknown),
        (Some("a"), None, Some("a"), ChangeSide::Unknown),
        (None, Some("a"), Some("a"), ChangeSide::Neither),
        (None, Some("a"), Some("b"), ChangeSide::Unknown),
        (Some("a"), Some("a"), Some("a"), ChangeSide::Neither),
        (Some("a"), Some("b"), Some("a"), ChangeSide::Folder),
        (Some("a"), Some("a"), Some("b"), ChangeSide::Workspace),
        (Some("a"), Some("b"), Some("c"), ChangeSide::Both),
        (Some("a"), Some("b"), Some("b"), ChangeSide::Neither),
        (Some("a"), Some(""), Some(""), ChangeSide::Neither),
        (Some(""), Some(""), Some("x"), ChangeSide::Workspace),
    ];
    for (base, folder, workspace, want) in cases {
        let origin = ChangeOrigin {
            base,
            folder,
            workspace,
        };
        assert_eq!(
            changed_side(origin),
            want,
            "case {base:?} {folder:?} {workspace:?}"
        );
    }
}

/// One `plan_delta` case: remote stamps, held (id, updated_at), then the
/// expected fetch ids, drop ids and `unchanged`.
type PlanCase<'a> = (
    &'a [(&'a str, &'a str)],
    &'a [(&'a str, &'a str)],
    &'a [&'a str],
    &'a [&'a str],
    bool,
);

#[test]
fn plan_cases() {
    let cases: [PlanCase; 8] = [
        (&[], &[], &[], &[], true),
        (&[("a", "1")], &[], &["a"], &[], false),
        (&[], &[("a", "1")], &[], &["a"], false),
        (&[("a", "1")], &[("a", "1")], &[], &[], true),
        (&[("a", "2")], &[("a", "1")], &["a"], &[], false),
        (
            &[("a", "1"), ("b", "1"), ("c", "1")],
            &[("c", "1"), ("d", "1"), ("a", "0")],
            &["a", "b"],
            &["d"],
            false,
        ),
        // A repeated remote id with one stamp is one row.
        (&[("a", "1"), ("a", "1")], &[("a", "1")], &[], &[], true),
        // A repeated remote id with a newer stamp is fetched once.
        (&[("a", "1"), ("a", "2")], &[("a", "1")], &["a"], &[], false),
    ];
    for (remote, held_rows, fetch, drop, unchanged) in cases {
        let remote: Vec<EntityStamp> = remote.iter().map(|(id, at)| stamp(id, at)).collect();
        let plan = plan_delta(&remote, &held(held_rows));
        let case = format!("remote {remote:?}, held {held_rows:?}");
        assert_eq!(plan.fetch, fetch, "fetch, {case}");
        assert_eq!(plan.drop, drop, "drop, {case}");
        assert_eq!(plan.unchanged, unchanged, "unchanged, {case}");
    }
}

/// One `apply_delta` case: held items, fetched items, the database's id order,
/// then the expected items.
type ApplyCase<'a> = (
    &'a [(&'a str, i64)],
    &'a [(&'a str, i64)],
    &'a [&'a str],
    &'a [(&'a str, i64)],
);

#[test]
fn apply_cases() {
    let cases: [ApplyCase; 6] = [
        (&[], &[], &[], &[]),
        (&[("a", 1)], &[], &["a"], &[("a", 1)]),
        (
            &[("a", 1), ("b", 1)],
            &[("b", 2), ("c", 2)],
            &["c", "b", "a"],
            &[("c", 2), ("b", 2), ("a", 1)],
        ),
        (&[("a", 1)], &[], &["z"], &[]),
        // A repeated id keeps its last copy.
        (&[("a", 1), ("a", 2)], &[], &["a"], &[("a", 2)]),
        (
            &[("a", 1)],
            &[("a", 2), ("a", 3)],
            &["a", "a"],
            &[("a", 3), ("a", 3)],
        ),
    ];
    for (held_items, fetched, order, want) in cases {
        let order: Vec<EntityStamp> = order.iter().map(|id| stamp(id, "")).collect();
        let out = apply_delta(&items(held_items), &items(fetched), &order, |item| {
            item.id.as_str()
        });
        assert_eq!(out, items(want), "held {held_items:?}, fetched {fetched:?}");
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
    #![proptest_config(ProptestConfig::default())]

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

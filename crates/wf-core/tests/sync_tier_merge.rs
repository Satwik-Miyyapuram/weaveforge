//! Table and property tests for `sync::tier_merge`: the tier fields of
//! `.weaveforge/settings.json` merge the same way whichever device pulls first.

#![allow(clippy::panic)]

use proptest::prelude::*;
use wf_core::sync::tier_merge::{Tier, TierFields, merge};

fn fields(id: Option<&str>, tier: Tier, epoch: u64, account: Option<&str>) -> TierFields {
    TierFields {
        workspace_id: id.map(str::to_owned),
        tier,
        tier_epoch: epoch,
        tier_account: account.map(str::to_owned),
    }
}

#[test]
fn tiers_order_from_lowest_to_highest() {
    assert!(Tier::Local < Tier::LocalWeb);
    assert!(Tier::LocalWeb < Tier::Sharing);
}

#[test]
fn a_higher_epoch_wins_whatever_its_tier() {
    let raised = fields(Some("a"), Tier::Sharing, 3, Some("acct"));
    let old_local = fields(Some("a"), Tier::Local, 2, None);
    assert_eq!(merge(&raised, &old_local).fields, raised);
    assert_eq!(merge(&old_local, &raised).fields, raised);
}

#[test]
fn a_higher_epoch_lowering_to_local_wins_over_an_older_sharing_tier() {
    let lowered = fields(Some("a"), Tier::Local, 4, None);
    let old_sharing = fields(Some("a"), Tier::Sharing, 3, Some("acct"));
    assert_eq!(merge(&lowered, &old_sharing).fields, lowered);
}

#[test]
fn on_an_epoch_tie_the_lower_tier_wins() {
    let local = fields(Some("a"), Tier::Local, 2, None);
    let sharing = fields(Some("a"), Tier::Sharing, 2, Some("acct"));
    let local_web = fields(Some("a"), Tier::LocalWeb, 2, None);
    assert_eq!(merge(&local, &sharing).fields, local);
    assert_eq!(merge(&sharing, &local).fields, local);
    assert_eq!(merge(&local_web, &sharing).fields, local_web);
}

#[test]
fn on_a_full_tie_the_smaller_account_wins_so_the_result_does_not_depend_on_order() {
    let a = fields(Some("a"), Tier::Sharing, 5, Some("bob"));
    let b = fields(Some("a"), Tier::Sharing, 5, Some("alice"));
    let expected = fields(Some("a"), Tier::Sharing, 5, Some("alice"));
    assert_eq!(merge(&a, &b).fields, expected);
    assert_eq!(merge(&b, &a).fields, expected);
}

#[test]
fn a_missing_account_loses_a_full_tie_to_a_present_one() {
    let none = fields(Some("a"), Tier::LocalWeb, 1, None);
    let some = fields(Some("a"), Tier::LocalWeb, 1, Some("alice"));
    assert_eq!(merge(&none, &some).fields, some);
    assert_eq!(merge(&some, &none).fields, some);
}

#[test]
fn one_side_without_an_id_takes_the_other_sides_id() {
    let with_id = fields(Some("a"), Tier::Local, 0, None);
    let without = fields(None, Tier::Local, 0, None);
    let merged = merge(&without, &with_id);
    assert_eq!(merged.fields.workspace_id.as_deref(), Some("a"));
    assert!(!merged.id_conflict);
}

#[test]
fn no_ids_on_either_side_stays_no_id_without_a_conflict() {
    let merged = merge(
        &fields(None, Tier::Local, 0, None),
        &fields(None, Tier::Local, 0, None),
    );
    assert_eq!(merged.fields.workspace_id, None);
    assert!(!merged.id_conflict);
}

#[test]
fn equal_ids_are_not_a_conflict() {
    let merged = merge(
        &fields(Some("same"), Tier::Local, 0, None),
        &fields(Some("same"), Tier::Local, 0, None),
    );
    assert_eq!(merged.fields.workspace_id.as_deref(), Some("same"));
    assert!(!merged.id_conflict);
}

#[test]
fn two_different_ids_keep_the_smaller_and_flag_a_conflict_in_either_order() {
    let big = fields(Some("f0000000-0000-5000-8000-000000000000"), Tier::Local, 0, None);
    let small = fields(Some("0a000000-0000-5000-8000-000000000000"), Tier::Local, 0, None);
    let one = merge(&big, &small);
    let two = merge(&small, &big);
    assert_eq!(one.fields.workspace_id, two.fields.workspace_id);
    assert_eq!(
        one.fields.workspace_id.as_deref(),
        Some("0a000000-0000-5000-8000-000000000000")
    );
    assert!(one.id_conflict);
    assert!(two.id_conflict);
}

#[test]
fn merging_a_value_with_itself_changes_nothing() {
    let value = fields(Some("a"), Tier::Sharing, 7, Some("alice"));
    assert_eq!(merge(&value, &value).fields, value);
}

fn tier_strategy() -> impl Strategy<Value = Tier> {
    prop_oneof![Just(Tier::Local), Just(Tier::LocalWeb), Just(Tier::Sharing)]
}

fn fields_strategy() -> impl Strategy<Value = TierFields> {
    (
        proptest::option::of(prop_oneof![Just("a".to_owned()), Just("b".to_owned())]),
        tier_strategy(),
        0_u64..4,
        proptest::option::of(prop_oneof![Just("alice".to_owned()), Just("bob".to_owned())]),
    )
        .prop_map(|(workspace_id, tier, tier_epoch, tier_account)| TierFields {
            workspace_id,
            tier,
            tier_epoch,
            tier_account,
        })
}

proptest! {
    #[test]
    fn merge_is_order_independent(a in fields_strategy(), b in fields_strategy()) {
        prop_assert_eq!(merge(&a, &b), merge(&b, &a));
    }

    #[test]
    fn merge_is_idempotent(a in fields_strategy(), b in fields_strategy()) {
        let once = merge(&a, &b).fields;
        prop_assert_eq!(merge(&once, &b).fields, once.clone());
        prop_assert_eq!(merge(&once, &once).fields, once);
    }
}

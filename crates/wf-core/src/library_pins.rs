//! The pure index behind merging pinned shared resources into a screen's own list. Pure.
//! Port of the non-async half of `packages/core/src/features/library/application/parts.ts`.
//! The `loadById` shell stays in TS; it loads the extra rows this index names.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// A library pin, as a screen reads it. Other fields on the JS object are ignored.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "LibraryPinIndexRow"))]
#[serde(rename_all = "camelCase")]
pub struct PinRow {
    /// The shareable type of the pinned resource (`paper`, `experiment`, ...).
    pub resource_type: String,
    /// The id of the pinned resource.
    pub resource_id: String,
    /// The user who owns the pinned resource.
    pub owner_id: String,
    /// The user who made the pin.
    pub user_id: String,
}

/// A share row. An absent or empty `resource_id` is a blanket grant over everything the
/// sharer owns of this type.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ShareIndexRow"))]
#[serde(rename_all = "camelCase")]
pub struct ShareRow {
    /// The shareable type this share covers.
    pub resource_type: String,
    /// The resource this share names, or `None` for a blanket grant.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub resource_id: Option<String>,
    /// The user who shared.
    pub owner_id: String,
    /// The access granted: `view`, `comment` or `edit`.
    pub access: String,
}

/// The input to [`pinned_screen_index`].
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PinnedScreenIndexInput"))]
#[serde(rename_all = "camelCase")]
pub struct PinnedScreenInput {
    /// The shareable type the screen lists.
    pub resource_type: String,
    /// Ids of the screen's own rows. A pin of one of these is not an extra.
    pub owned_ids: Vec<String>,
    /// Every pin the reader has.
    pub pins: Vec<PinRow>,
    /// Every share the reader can see.
    pub shares: Vec<ShareRow>,
}

/// A pinned resource that another user owns, and who owns it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PinnedSharedByEntry"))]
#[serde(rename_all = "camelCase")]
pub struct PinnedSharedBy {
    /// The pinned resource's id.
    pub resource_id: String,
    /// The user who owns it.
    pub owner_id: String,
}

/// One resource's comment or edit right for the reader.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "GrantIndexEntry"))]
#[serde(rename_all = "camelCase")]
pub struct GrantEntry {
    /// The resource's id.
    pub resource_id: String,
    /// Whether the reader holds the right.
    pub granted: bool,
}

/// The pure result of indexing pins and shares for one screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PinnedScreenIndex {
    /// Pinned resource ids that are not among the screen's own rows, each once, in pin order.
    pub extra_ids: Vec<String>,
    /// Each pinned resource owned by another user, with that owner.
    pub pinned_shared_by: Vec<PinnedSharedBy>,
    /// Comment right per resource that a share names, plus each pinned resource.
    pub can_comment: Vec<GrantEntry>,
    /// Edit right per resource that a share names, plus each pinned resource.
    pub can_edit: Vec<GrantEntry>,
}

/// What the shares grant on one resource, or on everything one owner has.
#[derive(Debug, Clone, Copy, Default)]
struct Grants {
    comment: bool,
    edit: bool,
}

/// Fold one share's access into the grants: `edit` implies `comment`.
fn merge_access(grants: &mut Grants, access: &str) {
    grants.comment |= access == "comment" || access == "edit";
    grants.edit |= access == "edit";
}

/// Whether the pin's resource has the right, from its own share or the owner's blanket share.
fn holds(
    exact: &HashMap<&str, Grants>,
    blanket: &HashMap<&str, Grants>,
    owner_of: &HashMap<&str, &str>,
    resource_id: &str,
    edit: bool,
) -> bool {
    let pick = |g: &Grants| if edit { g.edit } else { g.comment };
    let own = exact.get(resource_id).is_some_and(pick);
    match owner_of.get(resource_id) {
        Some(owner) => own || blanket.get(owner).is_some_and(pick),
        None => own,
    }
}

/// Index the reader's pins and shares for one screen type.
///
/// Only pins of another user's resource count: a pin of the reader's own row would make it read as
/// shared and read-only. Rights come from the share that names the resource, and from a blanket
/// share by the pin's owner. Every share of this type that names a resource is reported, pinned or
/// not, so an editor opened from a link still knows its rights.
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn pinned_screen_index(input: &PinnedScreenInput) -> PinnedScreenIndex {
    let kind = input.resource_type.as_str();
    let type_pins: Vec<&PinRow> = input
        .pins
        .iter()
        .filter(|pin| pin.resource_type == kind && pin.owner_id != pin.user_id)
        .collect();

    // A resource pinned twice is one entry; the later pin's owner wins, as with a JS Map.
    let mut pinned_shared_by: Vec<PinnedSharedBy> = Vec::new();
    let mut pinned_at: HashMap<&str, usize> = HashMap::new();
    for pin in &type_pins {
        if let Some(&at) = pinned_at.get(pin.resource_id.as_str()) {
            pinned_shared_by[at].owner_id.clone_from(&pin.owner_id);
        } else {
            let _ = pinned_at.insert(pin.resource_id.as_str(), pinned_shared_by.len());
            pinned_shared_by.push(PinnedSharedBy {
                resource_id: pin.resource_id.clone(),
                owner_id: pin.owner_id.clone(),
            });
        }
    }

    let owned: HashSet<&str> = input.owned_ids.iter().map(String::as_str).collect();
    let mut seen: HashSet<&str> = HashSet::new();
    let extra_ids: Vec<String> = type_pins
        .iter()
        .map(|pin| pin.resource_id.as_str())
        .filter(|id| !owned.contains(id) && seen.insert(*id))
        .map(str::to_owned)
        .collect();

    // Shares by resource (first-seen order kept) or, when no resource is named, by owner.
    let mut exact: HashMap<&str, Grants> = HashMap::new();
    let mut exact_order: Vec<&str> = Vec::new();
    let mut blanket: HashMap<&str, Grants> = HashMap::new();
    for share in &input.shares {
        if share.resource_type != kind {
            continue;
        }
        match share.resource_id.as_deref().filter(|id| !id.is_empty()) {
            Some(id) => {
                if !exact.contains_key(id) {
                    exact_order.push(id);
                }
                merge_access(exact.entry(id).or_default(), &share.access);
            }
            None => merge_access(
                blanket.entry(share.owner_id.as_str()).or_default(),
                &share.access,
            ),
        }
    }

    // The keys a JS Map would hold: every named resource, then the pinned ones not yet listed.
    let owner_of: HashMap<&str, &str> = pinned_shared_by
        .iter()
        .map(|pin| (pin.resource_id.as_str(), pin.owner_id.as_str()))
        .collect();
    let mut keys: Vec<&str> = exact_order;
    for pin in &pinned_shared_by {
        if !exact.contains_key(pin.resource_id.as_str()) {
            keys.push(pin.resource_id.as_str());
        }
    }

    let grants_for = |edit: bool| -> Vec<GrantEntry> {
        keys.iter()
            .map(|key| GrantEntry {
                resource_id: (*key).to_owned(),
                granted: holds(&exact, &blanket, &owner_of, key, edit),
            })
            .collect()
    };

    let can_comment = grants_for(false);
    let can_edit = grants_for(true);
    PinnedScreenIndex {
        extra_ids,
        pinned_shared_by,
        can_comment,
        can_edit,
    }
}

// No TS test found for this module; cases come from the doc comments.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn pin(resource_id: &str, owner_id: &str, user_id: &str) -> PinRow {
        PinRow {
            resource_type: "paper".to_owned(),
            resource_id: resource_id.to_owned(),
            owner_id: owner_id.to_owned(),
            user_id: user_id.to_owned(),
        }
    }

    fn input(pins: Vec<PinRow>, shares: Vec<ShareRow>, owned: &[&str]) -> PinnedScreenInput {
        PinnedScreenInput {
            resource_type: "paper".to_owned(),
            owned_ids: owned.iter().map(|id| (*id).to_owned()).collect(),
            pins,
            shares,
        }
    }

    #[test]
    fn own_pins_are_not_extras_or_shared() {
        let result = pinned_screen_index(&input(vec![pin("p1", "u", "u")], vec![], &[]));
        assert!(result.extra_ids.is_empty());
        assert!(result.pinned_shared_by.is_empty());
    }

    #[test]
    fn extra_ids_are_unique_and_skip_owned_rows() {
        let pins = vec![
            pin("p1", "o", "u"),
            pin("p1", "o", "u"),
            pin("p2", "o", "u"),
        ];
        let result = pinned_screen_index(&input(pins, vec![], &["p2"]));
        assert_eq!(result.extra_ids, vec!["p1".to_owned()]);
    }

    #[test]
    fn later_pin_owner_wins_for_a_twice_pinned_resource() {
        let pins = vec![pin("p1", "a", "u"), pin("p1", "b", "u")];
        let result = pinned_screen_index(&input(pins, vec![], &[]));
        assert_eq!(
            result.pinned_shared_by,
            vec![PinnedSharedBy {
                resource_id: "p1".to_owned(),
                owner_id: "b".to_owned(),
            }]
        );
    }

    #[test]
    fn edit_share_implies_comment() {
        let shares = vec![ShareRow {
            resource_type: "paper".to_owned(),
            resource_id: Some("p1".to_owned()),
            owner_id: "o".to_owned(),
            access: "edit".to_owned(),
        }];
        let result = pinned_screen_index(&input(vec![pin("p1", "o", "u")], shares, &[]));
        let granted = |list: &[GrantEntry]| list.iter().all(|g| g.granted);
        assert!(granted(&result.can_comment));
        assert!(granted(&result.can_edit));
    }

    #[test]
    fn blanket_share_by_pin_owner_grants_pinned_resource() {
        let shares = vec![ShareRow {
            resource_type: "paper".to_owned(),
            resource_id: None,
            owner_id: "o".to_owned(),
            access: "comment".to_owned(),
        }];
        let result = pinned_screen_index(&input(vec![pin("p1", "o", "u")], shares, &[]));
        assert_eq!(
            result.can_comment,
            vec![GrantEntry {
                resource_id: "p1".to_owned(),
                granted: true,
            }]
        );
        assert_eq!(
            result.can_edit,
            vec![GrantEntry {
                resource_id: "p1".to_owned(),
                granted: false,
            }]
        );
    }

    #[test]
    fn shares_of_other_types_are_ignored() {
        let shares = vec![ShareRow {
            resource_type: "note".to_owned(),
            resource_id: Some("p1".to_owned()),
            owner_id: "o".to_owned(),
            access: "edit".to_owned(),
        }];
        let result = pinned_screen_index(&input(vec![], shares, &[]));
        assert!(result.can_comment.is_empty());
        assert!(result.can_edit.is_empty());
    }

    fn share(
        resource_type: &str,
        resource_id: Option<&str>,
        owner_id: &str,
        access: &str,
    ) -> ShareRow {
        ShareRow {
            resource_type: resource_type.to_owned(),
            resource_id: resource_id.map(str::to_owned),
            owner_id: owner_id.to_owned(),
            access: access.to_owned(),
        }
    }

    fn granted_for(list: &[GrantEntry], id: &str) -> Option<bool> {
        list.iter()
            .find(|grant| grant.resource_id == id)
            .map(|grant| grant.granted)
    }

    #[test]
    fn merge_pinned_resource_the_project_does_not_own_joins_the_list() {
        let shares = vec![share("paper", Some("p9"), "alice", "comment")];
        let result = pinned_screen_index(&input(vec![pin("p9", "alice", "me")], shares, &["p1"]));
        assert_eq!(result.extra_ids, vec!["p9".to_owned()]);
        assert_eq!(
            result.pinned_shared_by,
            vec![PinnedSharedBy {
                resource_id: "p9".to_owned(),
                owner_id: "alice".to_owned(),
            }]
        );
    }

    #[test]
    fn merge_blank_edit_share_grants_comment_and_edit_on_pins_by_owner() {
        let shares = vec![share("paper", None, "alice", "edit")];
        let result = pinned_screen_index(&input(vec![pin("p9", "alice", "me")], shares, &[]));
        assert_eq!(granted_for(&result.can_comment, "p9"), Some(true));
        assert_eq!(granted_for(&result.can_edit, "p9"), Some(true));
    }

    #[test]
    fn merge_grants_follow_the_resource_id_named_by_the_share() {
        let shares = vec![share("paper", Some("p9"), "bob", "edit")];
        let result = pinned_screen_index(&input(vec![pin("p9", "alice", "me")], shares, &[]));
        assert_eq!(granted_for(&result.can_edit, "p9"), Some(true));
        assert_eq!(
            result.pinned_shared_by,
            vec![PinnedSharedBy {
                resource_id: "p9".to_owned(),
                owner_id: "alice".to_owned(),
            }]
        );
    }

    #[test]
    fn merge_view_access_is_neither_comment_nor_edit() {
        let shares = vec![share("paper", Some("p9"), "alice", "view")];
        let result = pinned_screen_index(&input(vec![pin("p9", "alice", "me")], shares, &[]));
        assert_eq!(granted_for(&result.can_comment, "p9"), Some(false));
        assert_eq!(granted_for(&result.can_edit, "p9"), Some(false));
    }

    #[test]
    fn merge_pin_the_project_owns_is_reported_but_not_listed_twice() {
        let result = pinned_screen_index(&input(vec![pin("p1", "alice", "me")], vec![], &["p1"]));
        assert!(result.extra_ids.is_empty());
        assert_eq!(
            result.pinned_shared_by,
            vec![PinnedSharedBy {
                resource_id: "p1".to_owned(),
                owner_id: "alice".to_owned(),
            }]
        );
    }

    #[test]
    fn merge_grant_for_another_resource_type_reads_false_on_a_pin() {
        let shares = vec![share("experiment", Some("p9"), "alice", "edit")];
        let result = pinned_screen_index(&input(vec![pin("p9", "alice", "me")], shares, &[]));
        assert_eq!(granted_for(&result.can_comment, "p9"), Some(false));
        assert_eq!(granted_for(&result.can_edit, "p9"), Some(false));
    }

    #[test]
    fn merge_resource_neither_pinned_nor_shared_is_absent() {
        let shares = vec![share("experiment", Some("p9"), "alice", "edit")];
        let result = pinned_screen_index(&input(vec![], shares, &[]));
        assert!(result.can_comment.is_empty());
        assert!(result.can_edit.is_empty());
    }

    #[test]
    fn merge_named_share_is_granted_even_when_not_pinned() {
        let shares = vec![share("paper", Some("p9"), "alice", "comment")];
        let result = pinned_screen_index(&input(vec![], shares, &[]));
        assert_eq!(granted_for(&result.can_comment, "p9"), Some(true));
        assert_eq!(granted_for(&result.can_edit, "p9"), Some(false));
    }
}

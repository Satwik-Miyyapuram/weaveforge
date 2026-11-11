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

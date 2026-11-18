//! Merge rule for the tier fields a folder shares through git (`.weaveforge/settings.json`).
//!
//! Two devices can change the tier of the same folder. The merge must give the same
//! answer whichever side is read first, so every choice here is a total order.

use std::cmp::Ordering;

/// How far a folder is shared. Higher tiers share more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tier {
    /// Stays on this machine.
    Local,
    /// Local, and also served to the web app.
    LocalWeb,
    /// Shared with other accounts.
    Sharing,
}

/// The fields of `settings.json` that decide tier and identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TierFields {
    /// Random UUID v4 of the folder, stamped once at first open (see
    /// `WorkspaceSettings::ensure_workspace_id`). `None` only in a file
    /// written before the stamp.
    pub workspace_id: Option<String>,
    /// The sharing tier.
    pub tier: Tier,
    /// Bumped each time the tier changes. A higher epoch is the newer decision.
    pub tier_epoch: u64,
    /// The account that set the tier, when there is one.
    pub tier_account: Option<String>,
}

/// The result of merging two copies of the fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Merged {
    /// The merged fields.
    pub fields: TierFields,
    /// True when both copies had a different workspace id. The smaller id is kept.
    pub id_conflict: bool,
}

/// Orders the tier decisions: the higher epoch wins; on a tie the lower tier wins;
/// on a tie again a present account beats a missing one, and then the smaller account wins.
/// `Less` means `a` is the better decision.
fn decision_order(a: &TierFields, b: &TierFields) -> Ordering {
    b.tier_epoch
        .cmp(&a.tier_epoch)
        .then_with(|| a.tier.cmp(&b.tier))
        .then_with(|| match (&a.tier_account, &b.tier_account) {
            (Some(x), Some(y)) => x.cmp(y),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        })
}

/// Merges two copies of the tier fields. The result does not depend on argument order.
#[must_use]
pub fn merge(a: &TierFields, b: &TierFields) -> Merged {
    let (workspace_id, id_conflict) = match (&a.workspace_id, &b.workspace_id) {
        (Some(x), Some(y)) if x != y => (Some(x.min(y).clone()), true),
        (Some(x), _) => (Some(x.clone()), false),
        (None, Some(y)) => (Some(y.clone()), false),
        (None, None) => (None, false),
    };
    let winner = if decision_order(a, b) == Ordering::Greater {
        b
    } else {
        a
    };
    Merged {
        fields: TierFields {
            workspace_id,
            tier: winner.tier,
            tier_epoch: winner.tier_epoch,
            tier_account: winner.tier_account.clone(),
        },
        id_conflict,
    }
}

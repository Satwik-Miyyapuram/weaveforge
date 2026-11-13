//! Ports `deletionFor` in `apps/web/src/features/offline-sync/domain/parts-1.ts`:
//! the choice a bulk "mine" or "cloud" pick makes on a delete conflict.

use serde::{Deserialize, Serialize};

/// The two delete conflicts: the row was deleted on the server, or on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum DeleteConflictKind {
    /// Deleted on the server while this device still had edits.
    DeletedRemote,
    /// Deleted on this device while the server still had the row.
    DeletedLocal,
}

/// The side a bulk pick favours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum PickSide {
    /// "mine": what this device did.
    Local,
    /// "cloud": what the server has.
    Remote,
}

/// What to do with the row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum DeletionChoice {
    /// Keep the row.
    Keep,
    /// Delete the row.
    Delete,
}

/// "Mine" keeps what this device did: a remote delete keeps the row, a local
/// delete removes it. The cloud pick is the opposite.
#[must_use]
pub const fn deletion_for(kind: DeleteConflictKind, side: PickSide) -> DeletionChoice {
    let mine = match kind {
        DeleteConflictKind::DeletedRemote => DeletionChoice::Keep,
        DeleteConflictKind::DeletedLocal => DeletionChoice::Delete,
    };
    match side {
        PickSide::Local => mine,
        PickSide::Remote => match mine {
            DeletionChoice::Keep => DeletionChoice::Delete,
            DeletionChoice::Delete => DeletionChoice::Keep,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{DeleteConflictKind, DeletionChoice, PickSide, deletion_for};

    #[test]
    fn mine_keeps_what_this_device_did() {
        assert_eq!(
            deletion_for(DeleteConflictKind::DeletedRemote, PickSide::Local),
            DeletionChoice::Keep
        );
        assert_eq!(
            deletion_for(DeleteConflictKind::DeletedLocal, PickSide::Local),
            DeletionChoice::Delete
        );
    }

    #[test]
    fn cloud_is_the_opposite() {
        assert_eq!(
            deletion_for(DeleteConflictKind::DeletedRemote, PickSide::Remote),
            DeletionChoice::Delete
        );
        assert_eq!(
            deletion_for(DeleteConflictKind::DeletedLocal, PickSide::Remote),
            DeletionChoice::Keep
        );
    }
}

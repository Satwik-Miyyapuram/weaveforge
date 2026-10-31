//! Ports `ImportAction`, `ConflictKind` and the `Record<ImportAction, number>`
//! counts from `packages/core/src/workspace/deserialize-workspace.ts`.

/// What an import would do with one entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ImportAction {
    /// An id nothing has yet.
    Created,
    /// A stored entry the folder moved.
    Updated,
    /// Nothing to change.
    Unchanged,
    /// Both sides moved, or the entry cannot be imported as it is.
    Conflict,
    /// A stored entry the folder no longer lists.
    Removed,
}

impl ImportAction {
    /// Every action, in the order the counts are shown.
    pub const ALL: [Self; 5] = [
        Self::Created,
        Self::Updated,
        Self::Unchanged,
        Self::Conflict,
        Self::Removed,
    ];

    /// The action's name as the TypeScript spells it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Updated => "updated",
            Self::Unchanged => "unchanged",
            Self::Conflict => "conflict",
            Self::Removed => "removed",
        }
    }
}

/// Why an entry conflicts, which decides what may be done about it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ConflictKind {
    /// Both copies are legitimate; the user may pick either.
    BothChanged,
    /// The id belongs to a different kind of entity; only a new entry is safe.
    TypeMismatch,
    /// The file still holds this app's conflict markers.
    Markers,
}

impl ConflictKind {
    /// The kind's name as the TypeScript spells it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BothChanged => "both-changed",
            Self::TypeMismatch => "type-mismatch",
            Self::Markers => "markers",
        }
    }
}

/// `Record<ImportAction, number>`: one count per action.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ActionCounts {
    /// Entries to create.
    pub created: usize,
    /// Entries to update.
    pub updated: usize,
    /// Entries left as they are.
    pub unchanged: usize,
    /// Entries that need a decision.
    pub conflict: usize,
    /// Entries the folder no longer lists.
    pub removed: usize,
}

impl ActionCounts {
    /// The count for one action.
    #[must_use]
    pub const fn get(&self, action: ImportAction) -> usize {
        match action {
            ImportAction::Created => self.created,
            ImportAction::Updated => self.updated,
            ImportAction::Unchanged => self.unchanged,
            ImportAction::Conflict => self.conflict,
            ImportAction::Removed => self.removed,
        }
    }

    /// Adds `n` to the count for one action.
    pub fn add(&mut self, action: ImportAction, n: usize) {
        let slot = match action {
            ImportAction::Created => &mut self.created,
            ImportAction::Updated => &mut self.updated,
            ImportAction::Unchanged => &mut self.unchanged,
            ImportAction::Conflict => &mut self.conflict,
            ImportAction::Removed => &mut self.removed,
        };
        *slot = slot.saturating_add(n);
    }
}

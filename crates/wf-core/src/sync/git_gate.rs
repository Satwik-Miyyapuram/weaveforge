//! Port of `packages/core/src/workspace/git-gate.ts`: whether the workspace
//! folder may be committed to. Pure decision; no process runs `git` here.

/// Refusal reason while folder history is switched off.
pub const GIT_OFF: &str = "Folder history is switched off.";

/// Where the folder sits relative to any git repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultRepoState {
    /// No repository at or above the folder.
    None,
    /// The folder is itself the repository root.
    Own,
    /// The folder sits inside a repository rooted elsewhere.
    Enclosing {
        /// Root of the enclosing repository.
        root: String,
    },
}

/// What the mirror is allowed to do with git.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitAction {
    /// Create a repository in the folder.
    Init,
    /// Commit into the folder's own repository.
    Commit,
}

/// Outcome of `decide_vault_commit`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitVerdict {
    /// Proceed with the action.
    Allowed(GitAction),
    /// Do not touch git; `reason` is shown to the user.
    Refused {
        /// Human-readable refusal reason.
        reason: String,
    },
}

/// Decide whether the folder may be committed to.
///
/// Off unless `enabled`; refused when the folder sits in a repository that is
/// not its own, with no override.
#[must_use]
pub fn decide_vault_commit(enabled: bool, state: &VaultRepoState) -> GitVerdict {
    if !enabled {
        return GitVerdict::Refused {
            reason: GIT_OFF.to_owned(),
        };
    }
    match state {
        VaultRepoState::Own => GitVerdict::Allowed(GitAction::Commit),
        VaultRepoState::None => GitVerdict::Allowed(GitAction::Init),
        // Not an override: enabling the setting means "keep history of my folder",
        // not "commit into whatever repository contains it".
        VaultRepoState::Enclosing { root } => GitVerdict::Refused {
            reason: format!(
                "This folder is inside the repository at {root}, so WeaveForge will not commit here."
            ),
        },
    }
}

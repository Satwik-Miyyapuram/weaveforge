//! Branch read and save rules for a stored sync integration (TS
//! `features/sync/infrastructure/postgrest-integrations-store.ts`). The row reads and the
//! upsert stay in TypeScript.
//!
//! A Mattermost `branch` is a channel id. Rows saved before 33-11 filled a blank channel
//! with `main`, so reading `main` back for Mattermost means "unset".

use serde::Deserialize;

use super::integration_fields::{DEFAULT_GIT_BRANCH, SyncProvider};

/// Input for [`branch_read`]: the provider and the stored `branch` column.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BranchReadInput {
    /// Provider of the stored row.
    pub provider: SyncProvider,
    /// The stored `branch` column, `None` when the row has no value.
    pub branch: Option<String>,
}

/// Input for [`branch_save`]: the provider and the branch the caller wants stored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BranchSaveInput {
    /// Provider of the integration being saved.
    pub provider: SyncProvider,
    /// The integration's branch (Mattermost: channel id).
    pub branch: String,
}

/// The branch an integration reads back from its stored row (TS `readBranch`).
///
/// Git providers fall back to `main` when the column is null. Mattermost reads a stored
/// `main` or a null column as an unset (empty) channel.
#[must_use]
pub fn branch_read(input: &BranchReadInput) -> String {
    match input.provider {
        SyncProvider::Mattermost => match input.branch.as_deref() {
            None => String::new(),
            Some(DEFAULT_GIT_BRANCH) => String::new(),
            Some(channel) => channel.to_owned(),
        },
        SyncProvider::Github | SyncProvider::Gitlab => input
            .branch
            .clone()
            .unwrap_or_else(|| DEFAULT_GIT_BRANCH.to_owned()),
    }
}

/// The branch value written to the stored row (TS `save`).
///
/// Mattermost keeps its channel id as given, blank included. Git providers store `main`
/// when the branch is blank (JS `branch || DEFAULT_GIT_BRANCH`).
#[must_use]
pub fn branch_save(input: &BranchSaveInput) -> String {
    match input.provider {
        SyncProvider::Mattermost => input.branch.clone(),
        SyncProvider::Github | SyncProvider::Gitlab => {
            if input.branch.is_empty() {
                DEFAULT_GIT_BRANCH.to_owned()
            } else {
                input.branch.clone()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(provider: SyncProvider, branch: Option<&str>) -> String {
        branch_read(&BranchReadInput {
            provider,
            branch: branch.map(str::to_owned),
        })
    }

    fn save(provider: SyncProvider, branch: &str) -> String {
        branch_save(&BranchSaveInput {
            provider,
            branch: branch.to_owned(),
        })
    }

    #[test]
    fn git_read_falls_back_to_main_only_when_null() {
        assert_eq!(read(SyncProvider::Github, None), "main");
        assert_eq!(read(SyncProvider::Gitlab, Some("dev")), "dev");
        assert_eq!(read(SyncProvider::Github, Some("")), "");
    }

    #[test]
    fn mattermost_read_maps_null_and_legacy_main_to_unset() {
        assert_eq!(read(SyncProvider::Mattermost, None), "");
        assert_eq!(read(SyncProvider::Mattermost, Some("main")), "");
        assert_eq!(read(SyncProvider::Mattermost, Some("abc123")), "abc123");
    }

    #[test]
    fn git_save_stores_main_for_blank_branch() {
        assert_eq!(save(SyncProvider::Github, ""), "main");
        assert_eq!(save(SyncProvider::Gitlab, "dev"), "dev");
    }

    #[test]
    fn mattermost_save_keeps_blank_channel() {
        assert_eq!(save(SyncProvider::Mattermost, ""), "");
        assert_eq!(save(SyncProvider::Mattermost, "chan"), "chan");
    }
}

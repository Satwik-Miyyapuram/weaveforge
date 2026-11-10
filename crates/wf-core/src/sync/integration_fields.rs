//! Field accessors for a sync integration, ported from
//! `apps/web/src/features/sync/domain/integration-fields.ts`.
//!
//! Storage keeps one shape (`token`, `repo`, `branch`) for every provider, and
//! each provider reads those keys with its own meaning, so these helpers name
//! them. JS `trim` is matched with [`is_js_whitespace`].

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::search::js_text::is_js_whitespace;

/// A stored integration, as far as these accessors read it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Integration {
    /// Whether the person switched this integration on.
    pub enabled: bool,
    /// GitHub/GitLab: API token. Mattermost: bot token.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub token: Option<String>,
    /// GitHub: "owner/name". GitLab: project path or id. Mattermost: server URL.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub repo: Option<String>,
    /// GitHub/GitLab: branch. Mattermost: channel id.
    pub branch: String,
    /// Provider-specific settings, as stored (Mattermost: see `mattermost_options`).
    #[serde(default)]
    #[cfg_attr(
        feature = "specta",
        specta(optional, type = Option<specta_typescript::Unknown>)
    )]
    pub options: Option<Value>,
}

/// GitHub / GitLab: token, repo path and branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GitConnection {
    /// API token, empty when unset.
    pub token: String,
    /// Repo path, empty when unset.
    pub repo: String,
    /// Branch the integration uses.
    pub branch: String,
}

/// Mattermost: bot token, server URL and channel id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostConnection {
    /// Bot token, empty when unset.
    pub bot_token: String,
    /// Server URL, empty when unset.
    pub server_url: String,
    /// Main channel id.
    pub channel_id: String,
}

/// The git fields of an integration: token, repo path and branch.
#[must_use]
pub fn git_connection(i: &Integration) -> GitConnection {
    GitConnection {
        token: i.token.clone().unwrap_or_default(),
        repo: i.repo.clone().unwrap_or_default(),
        branch: i.branch.clone(),
    }
}

/// The Mattermost fields of an integration: bot token, server URL and channel id.
#[must_use]
pub fn mattermost_connection(i: &Integration) -> MattermostConnection {
    MattermostConnection {
        bot_token: i.token.clone().unwrap_or_default(),
        server_url: i.repo.clone().unwrap_or_default(),
        channel_id: i.branch.clone(),
    }
}

/// Switched on, with a non-blank token and repo.
#[must_use]
pub fn git_connection_ready(i: &Integration) -> bool {
    let c = git_connection(i);
    i.enabled && !is_blank(&c.token) && !is_blank(&c.repo)
}

/// Switched on, with a non-blank bot token, server URL and channel id.
#[must_use]
pub fn mattermost_connection_ready(i: &Integration) -> bool {
    let c = mattermost_connection(i);
    i.enabled && !is_blank(&c.bot_token) && !is_blank(&c.server_url) && !is_blank(&c.channel_id)
}

/// True when the text is empty after JS `trim`.
fn is_blank(text: &str) -> bool {
    text.trim_matches(is_js_whitespace).is_empty()
}

/// Default branch for git providers (TS `DEFAULT_GIT_BRANCH`).
pub const DEFAULT_GIT_BRANCH: &str = "main";

/// The sync providers (TS `SyncProvider`), named as the web names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum SyncProvider {
    /// GitHub.
    Github,
    /// GitLab.
    Gitlab,
    /// Mattermost.
    Mattermost,
}

/// An integration with nothing stored yet (TS `emptyIntegration`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EmptyIntegration {
    /// The provider this integration is for.
    pub provider: SyncProvider,
    /// Always false: a new integration starts switched off.
    pub enabled: bool,
    /// The git default branch, or empty for Mattermost (no channel yet).
    pub branch: String,
}

/// The integration a provider starts from before anything is stored.
#[must_use]
pub fn empty_integration(provider: SyncProvider) -> EmptyIntegration {
    let branch = match provider {
        SyncProvider::Mattermost => String::new(),
        SyncProvider::Github | SyncProvider::Gitlab => DEFAULT_GIT_BRANCH.to_owned(),
    };
    EmptyIntegration {
        provider,
        enabled: false,
        branch,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn integration(
        enabled: bool,
        token: Option<&str>,
        repo: Option<&str>,
        branch: &str,
    ) -> Integration {
        Integration {
            enabled,
            token: token.map(str::to_owned),
            repo: repo.map(str::to_owned),
            branch: branch.to_owned(),
            options: Some(json!({})),
        }
    }

    #[test]
    fn git_fields_read_token_repo_and_branch() {
        let i = integration(true, Some("tok"), Some("owner/name"), "main");
        assert_eq!(
            git_connection(&i),
            GitConnection {
                token: "tok".into(),
                repo: "owner/name".into(),
                branch: "main".into(),
            }
        );
    }

    #[test]
    fn missing_token_and_repo_read_as_empty() {
        let i = integration(true, None, None, "main");
        let c = git_connection(&i);
        assert_eq!((c.token.as_str(), c.repo.as_str()), ("", ""));
    }

    #[test]
    fn mattermost_fields_map_onto_the_shared_keys() {
        let i = integration(true, Some("bot"), Some("https://chat.example.com"), "ch-1");
        assert_eq!(
            mattermost_connection(&i),
            MattermostConnection {
                bot_token: "bot".into(),
                server_url: "https://chat.example.com".into(),
                channel_id: "ch-1".into(),
            }
        );
    }

    #[test]
    fn git_ready_needs_enabled_token_and_repo() {
        assert!(git_connection_ready(&integration(
            true,
            Some("t"),
            Some("o/n"),
            "main"
        )));
        assert!(!git_connection_ready(&integration(
            false,
            Some("t"),
            Some("o/n"),
            "main"
        )));
        assert!(!git_connection_ready(&integration(
            true,
            None,
            Some("o/n"),
            "main"
        )));
        assert!(!git_connection_ready(&integration(
            true,
            Some("t"),
            None,
            "main"
        )));
    }

    #[test]
    fn blank_after_trim_is_not_ready() {
        // JS trim strips U+FEFF and NBSP too, so these count as blank.
        assert!(!git_connection_ready(&integration(
            true,
            Some(" \u{feff}\u{a0} "),
            Some("o/n"),
            "main"
        )));
        assert!(!git_connection_ready(&integration(
            true,
            Some("t"),
            Some("\t\n"),
            "main"
        )));
    }

    #[test]
    fn mattermost_ready_needs_bot_token_server_and_channel() {
        assert!(mattermost_connection_ready(&integration(
            true,
            Some("b"),
            Some("https://x"),
            "ch"
        )));
        assert!(!mattermost_connection_ready(&integration(
            true,
            Some("b"),
            Some("https://x"),
            "  "
        )));
        assert!(!mattermost_connection_ready(&integration(
            true,
            Some("b"),
            None,
            "ch"
        )));
        assert!(!mattermost_connection_ready(&integration(
            false,
            Some("b"),
            Some("https://x"),
            "ch"
        )));
    }
}

#[cfg(test)]
mod provider_tests {
    use super::*;

    #[test]
    fn git_providers_start_on_the_default_branch() {
        assert_eq!(empty_integration(SyncProvider::Github).branch, "main");
        assert_eq!(empty_integration(SyncProvider::Gitlab).branch, "main");
    }

    #[test]
    fn mattermost_starts_with_no_channel_and_off() {
        let e = empty_integration(SyncProvider::Mattermost);
        assert_eq!((e.branch.as_str(), e.enabled), ("", false));
    }
}

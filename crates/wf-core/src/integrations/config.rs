//! Integration provider selection from env, ported from
//! `apps/web/src/integrations/config.ts`. Pure: the caller passes the
//! env values and the registered provider ids (from the TS manifest registry).

use serde::{Deserialize, Serialize};

/// The `NEXT_PUBLIC_*` provider env values. Absent means unset.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IntegrationEnv {
    /// `NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER`.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub bibliography_provider: Option<String>,
    /// `NEXT_PUBLIC_NOTIFICATION_PROVIDER`.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub notification_provider: Option<String>,
    /// `NEXT_PUBLIC_LOG_SYNC_PROVIDER`.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub log_sync_provider: Option<String>,
    /// `NEXT_PUBLIC_CITATION_PROVIDER`.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub citation_provider: Option<String>,
    /// `NEXT_PUBLIC_GIT_READ_PROVIDERS` (comma list, or `none`).
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub git_read_providers: Option<String>,
}

/// Registered provider ids per integration kind, from the manifest registry.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProviderIds {
    /// Bibliography provider ids.
    pub bibliography: Vec<String>,
    /// Notification provider ids.
    pub notification: Vec<String>,
    /// Log-sync provider ids.
    pub log_sync: Vec<String>,
    /// Citation provider ids.
    pub citation: Vec<String>,
    /// Git-read provider ids.
    pub git_read: Vec<String>,
}

/// The chosen provider per integration kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IntegrationConfig {
    /// Bibliography provider id, or `none`.
    pub bibliography: String,
    /// Notification provider id, or `none`.
    pub notifications: String,
    /// Log-sync provider id, or `none`.
    pub log_sync: String,
    /// Citation provider id, or `none`.
    pub citation: String,
    /// Git-read provider ids (empty when disabled).
    pub git_read: Vec<String>,
}

/// Defaults used when env is unset or names no registered provider.
const DEFAULT_BIBLIOGRAPHY: &str = "zotero";
const DEFAULT_NOTIFICATIONS: &str = "mattermost";
const DEFAULT_LOG_SYNC: &str = "gitlab";
const DEFAULT_CITATION: &str = "semantic-scholar";
const DEFAULT_GIT_READ: [&str; 2] = ["github", "gitlab"];

/// Resolve the integration config from env and the registered ids.
#[must_use]
pub fn resolve_integration_config(env: &IntegrationEnv, ids: &ProviderIds) -> IntegrationConfig {
    let default_git: Vec<&str> = DEFAULT_GIT_READ.to_vec();
    IntegrationConfig {
        bibliography: pick_provider(
            env.bibliography_provider.as_deref(),
            &ids.bibliography,
            DEFAULT_BIBLIOGRAPHY,
        ),
        notifications: pick_provider(
            env.notification_provider.as_deref(),
            &ids.notification,
            DEFAULT_NOTIFICATIONS,
        ),
        log_sync: pick_provider(
            env.log_sync_provider.as_deref(),
            &ids.log_sync,
            DEFAULT_LOG_SYNC,
        ),
        citation: pick_provider(
            env.citation_provider.as_deref(),
            &ids.citation,
            DEFAULT_CITATION,
        ),
        git_read: parse_git_read_list(
            env.git_read_providers.as_deref(),
            &ids.git_read,
            &default_git,
        ),
    }
}

/// The fallback when `allowed` has it, else the first allowed id, else `none`.
fn safe_fallback(allowed: &[String], fallback: &str) -> String {
    if allowed.iter().any(|id| id == fallback) {
        fallback.to_owned()
    } else {
        allowed
            .first()
            .cloned()
            .unwrap_or_else(|| "none".to_owned())
    }
}

/// One provider id: blank or unset gives the fallback, `none` disables, an
/// unknown id gives the fallback. Matching is exact (no trim), as in the TS.
fn pick_provider(value: Option<&str>, allowed: &[String], fallback: &str) -> String {
    let safe = safe_fallback(allowed, fallback);
    match value {
        Some(v) if !v.trim().is_empty() => {
            if v == "none" {
                "none".to_owned()
            } else if allowed.iter().any(|id| id == v) {
                v.to_owned()
            } else {
                safe
            }
        }
        _ => safe,
    }
}

/// Comma list of git-read ids. Blank gives the allowed defaults, `none` gives an
/// empty list, and a list with no allowed id gives the allowed defaults.
fn parse_git_read_list(raw: Option<&str>, allowed: &[String], fallback: &[&str]) -> Vec<String> {
    let safe: Vec<String> = fallback
        .iter()
        .filter(|id| allowed.iter().any(|a| a.as_str() == **id))
        .map(|id| (*id).to_owned())
        .collect();
    let Some(text) = raw.filter(|r| !r.trim().is_empty()) else {
        return safe;
    };
    let trimmed = text.trim();
    if trimmed.to_lowercase() == "none" {
        return Vec::new();
    }
    let picked: Vec<String> = trimmed
        .split(',')
        .map(str::trim)
        .filter(|s| allowed.iter().any(|a| a.as_str() == *s))
        .map(str::to_owned)
        .collect();
    if picked.is_empty() { safe } else { picked }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> ProviderIds {
        ProviderIds {
            bibliography: vec!["zotero".to_owned()],
            notification: vec!["mattermost".to_owned(), "none-ish".to_owned()],
            log_sync: vec!["gitlab".to_owned(), "github".to_owned()],
            citation: vec!["semantic-scholar".to_owned()],
            git_read: vec!["github".to_owned(), "gitlab".to_owned()],
        }
    }

    #[test]
    fn unset_env_gives_defaults() {
        let c = resolve_integration_config(&IntegrationEnv::default(), &ids());
        assert_eq!(c.bibliography, "zotero");
        assert_eq!(c.notifications, "mattermost");
        assert_eq!(c.log_sync, "gitlab");
        assert_eq!(c.citation, "semantic-scholar");
        assert_eq!(c.git_read, vec!["github", "gitlab"]);
    }

    #[test]
    fn none_and_unknown_provider_values() {
        let env = IntegrationEnv {
            bibliography_provider: Some("none".to_owned()),
            citation_provider: Some("bogus".to_owned()),
            notification_provider: Some(" zotero ".to_owned()),
            ..IntegrationEnv::default()
        };
        let c = resolve_integration_config(&env, &ids());
        assert_eq!(c.bibliography, "none");
        assert_eq!(c.citation, "semantic-scholar");
        // Untrimmed value is not an allowed id, so the fallback applies.
        assert_eq!(c.notifications, "mattermost");
    }

    #[test]
    fn git_read_list_parsing() {
        let c = |raw: &str| {
            let env = IntegrationEnv {
                git_read_providers: Some(raw.to_owned()),
                ..IntegrationEnv::default()
            };
            resolve_integration_config(&env, &ids()).git_read
        };
        assert_eq!(c("NONE"), Vec::<String>::new());
        assert_eq!(c(" github , bogus "), vec!["github"]);
        assert_eq!(c("bogus"), vec!["github", "gitlab"]);
        assert_eq!(c("   "), vec!["github", "gitlab"]);
    }

    #[test]
    fn fallback_is_first_allowed_when_default_not_registered() {
        let ids = ProviderIds {
            log_sync: vec!["github".to_owned()],
            ..ProviderIds::default()
        };
        let c = resolve_integration_config(&IntegrationEnv::default(), &ids);
        assert_eq!(c.log_sync, "github");
        assert_eq!(c.bibliography, "none");
    }
}

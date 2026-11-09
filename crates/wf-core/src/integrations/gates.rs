//! Runtime gates that decide which integration descriptors show, ported from
//! `apps/web/src/integrations/descriptors-resolve.ts`. Pure predicates. The
//! descriptor data and the merge that builds the lists stay in TypeScript.

use serde::{Deserialize, Serialize};

use super::config::IntegrationConfig;

/// A descriptor's runtime gate: the gate kind and the provider it needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RuntimeGate {
    /// Gate kind: `bibliography`, `citation`, `notifications`, `logSync`, `gitRead`.
    /// Any other kind is always open.
    pub kind: String,
    /// The provider id this gate needs selected.
    pub provider_id: String,
}

/// Whether a user-scope descriptor shows. No gate means open.
#[must_use]
pub fn user_gate_open(config: &IntegrationConfig, gate: Option<&RuntimeGate>) -> bool {
    match gate {
        None => true,
        Some(g) => match g.kind.as_str() {
            "bibliography" => config.bibliography == g.provider_id,
            "citation" => config.citation == g.provider_id,
            _ => true,
        },
    }
}

/// Whether a project-scope descriptor shows. Unknown kinds are open.
#[must_use]
pub fn project_gate_open(config: &IntegrationConfig, gate: &RuntimeGate) -> bool {
    match gate.kind.as_str() {
        "notifications" => config.notifications == gate.provider_id,
        "logSync" => config.log_sync == gate.provider_id,
        "gitRead" => config.git_read.contains(&gate.provider_id),
        _ => true,
    }
}

/// True when GitLab is both the git-read and the log-sync provider, so the two
/// GitLab descriptors merge into one combined descriptor.
#[must_use]
pub fn gitlab_combined_active(config: &IntegrationConfig) -> bool {
    config.git_read.iter().any(|id| id == "gitlab") && config.log_sync == "gitlab"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(log_sync: &str, git_read: &[&str]) -> IntegrationConfig {
        IntegrationConfig {
            bibliography: "zotero".to_owned(),
            notifications: "mattermost".to_owned(),
            log_sync: log_sync.to_owned(),
            citation: "semantic-scholar".to_owned(),
            git_read: git_read.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    fn gate(kind: &str, provider: &str) -> RuntimeGate {
        RuntimeGate {
            kind: kind.to_owned(),
            provider_id: provider.to_owned(),
        }
    }

    #[test]
    fn user_gate_checks_bibliography_and_citation_only() {
        let c = config("gitlab", &["github"]);
        assert!(user_gate_open(&c, None));
        assert!(user_gate_open(&c, Some(&gate("bibliography", "zotero"))));
        assert!(!user_gate_open(&c, Some(&gate("citation", "crossref"))));
        assert!(user_gate_open(&c, Some(&gate("other", "x"))));
    }

    #[test]
    fn project_gate_checks_notifications_log_sync_and_git_read() {
        let c = config("github", &["github", "gitlab"]);
        assert!(project_gate_open(&c, &gate("notifications", "mattermost")));
        assert!(!project_gate_open(&c, &gate("logSync", "gitlab")));
        assert!(project_gate_open(&c, &gate("gitRead", "gitlab")));
        assert!(!project_gate_open(&c, &gate("gitRead", "bitbucket")));
        assert!(project_gate_open(&c, &gate("unknown", "x")));
    }

    #[test]
    fn gitlab_combined_needs_both_read_and_log_sync() {
        assert!(gitlab_combined_active(&config(
            "gitlab",
            &["github", "gitlab"]
        )));
        assert!(!gitlab_combined_active(&config("gitlab", &["github"])));
        assert!(!gitlab_combined_active(&config("github", &["gitlab"])));
    }
}

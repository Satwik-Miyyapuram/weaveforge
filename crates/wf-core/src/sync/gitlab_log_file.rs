//! GitLab file rules for a log entry: the `logbook/` path, the markdown file body, the REST
//! file URL, the branch fallback and the commit messages (TS
//! `features/sync/infrastructure/gitlab-log-exporter.ts`). The PUT, the POST fallback and
//! the DELETE request stay in TypeScript.

use serde::{Deserialize, Serialize};

use super::integration_fields::DEFAULT_GIT_BRANCH;
use crate::overleaf_workshop::encode_uri_component;

/// Input for [`gitlab_log_file_plan`]: one log entry and the repository it goes to.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GitlabLogFileInput {
    /// Project path or numeric id, as the integration stores it.
    pub repo: String,
    /// Integration branch. Empty or absent means the default branch.
    pub branch: Option<String>,
    /// Calendar date (`yyyy-mm-dd`) the entry is about.
    pub entry_date: String,
    /// Entry id. Only its first eight characters name the file.
    pub id: String,
    /// Entry kind (`daily` or `weekly`), written into the frontmatter; empty when absent.
    #[serde(default)]
    pub kind: String,
    /// Markdown body of the entry; empty when absent.
    #[serde(default)]
    pub body: String,
}

/// The GitLab writes for one log entry, planned without any request.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GitlabLogFilePlan {
    /// REST URL of the entry's file in the repository.
    pub file_url: String,
    /// Branch to write to: the integration's branch, or `main`.
    pub branch: String,
    /// Repository path of the file (`logbook/<date>-<id8>.md`).
    pub path: String,
    /// File content: a frontmatter block with the date and kind, then the body.
    pub content: String,
    /// Commit message for a put or post.
    pub commit_message: String,
    /// Commit message for a delete.
    pub delete_commit_message: String,
}

/// Plans the GitLab file writes for a log entry. Pure: the caller sends the requests.
#[must_use]
pub fn gitlab_log_file_plan(input: &GitlabLogFileInput) -> GitlabLogFilePlan {
    let path = log_path(&input.entry_date, &input.id);
    GitlabLogFilePlan {
        file_url: gitlab_file_url(&input.repo, &path),
        branch: branch_or_default(input.branch.as_deref()),
        content: log_markdown(&input.entry_date, &input.kind, &input.body),
        commit_message: format!("log: {}", input.entry_date),
        delete_commit_message: format!("log: delete {}", input.entry_date),
        path,
    }
}

/// GitLab REST URL of a file: the project and the file path, each percent-encoded.
#[must_use]
pub fn gitlab_file_url(repo: &str, path: &str) -> String {
    format!(
        "https://gitlab.com/api/v4/projects/{}/repository/files/{}",
        encode_uri_component(repo),
        encode_uri_component(path)
    )
}

/// Repository path of a log entry: `logbook/<date>-<first 8 chars of id>.md`.
#[must_use]
pub fn log_path(entry_date: &str, id: &str) -> String {
    let short: String = id.chars().take(8).collect();
    format!("logbook/{entry_date}-{short}.md")
}

/// File content: a frontmatter block with the date and kind, a blank line, the body, a newline.
#[must_use]
pub fn log_markdown(entry_date: &str, kind: &str, body: &str) -> String {
    format!("---\ndate: {entry_date}\nkind: {kind}\n---\n\n{body}\n")
}

/// The integration's branch, or `main` when it is empty or absent (JS `branch || "main"`).
#[must_use]
pub fn branch_or_default(branch: Option<&str>) -> String {
    match branch {
        Some(name) if !name.is_empty() => name.to_owned(),
        _ => DEFAULT_GIT_BRANCH.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> GitlabLogFileInput {
        GitlabLogFileInput {
            repo: "group/proj".to_owned(),
            branch: Some("dev".to_owned()),
            entry_date: "2026-11-10".to_owned(),
            id: "abcdef0123456789".to_owned(),
            kind: "daily".to_owned(),
            body: "Ran it".to_owned(),
        }
    }

    #[test]
    fn path_uses_first_eight_id_chars() {
        assert_eq!(
            log_path("2026-11-10", "abcdef0123456789"),
            "logbook/2026-11-10-abcdef01.md"
        );
    }

    #[test]
    fn file_url_encodes_repo_and_path() {
        assert_eq!(
            gitlab_file_url("group/proj", "logbook/a.md"),
            "https://gitlab.com/api/v4/projects/group%2Fproj/repository/files/logbook%2Fa.md"
        );
    }

    #[test]
    fn markdown_has_frontmatter_then_body() {
        assert_eq!(
            log_markdown("2026-11-10", "daily", "Ran it"),
            "---\ndate: 2026-11-10\nkind: daily\n---\n\nRan it\n"
        );
    }

    #[test]
    fn empty_or_absent_branch_falls_back_to_main() {
        assert_eq!(branch_or_default(None), "main");
        assert_eq!(branch_or_default(Some("")), "main");
        assert_eq!(branch_or_default(Some("dev")), "dev");
    }

    #[test]
    fn plan_carries_commit_messages_and_branch() {
        let plan = gitlab_log_file_plan(&entry());
        assert_eq!(plan.branch, "dev");
        assert_eq!(plan.path, "logbook/2026-11-10-abcdef01.md");
        assert_eq!(plan.commit_message, "log: 2026-11-10");
        assert_eq!(plan.delete_commit_message, "log: delete 2026-11-10");
        assert!(plan.file_url.ends_with("/logbook%2F2026-11-10-abcdef01.md"));
        assert!(plan.content.starts_with("---\ndate: 2026-11-10\n"));
    }

    #[test]
    fn plan_without_branch_uses_main() {
        let plan = gitlab_log_file_plan(&GitlabLogFileInput {
            branch: None,
            ..entry()
        });
        assert_eq!(plan.branch, "main");
    }
}

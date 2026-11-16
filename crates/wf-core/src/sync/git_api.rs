//! Git read rules (TS `features/sync/infrastructure/git-client.ts`): the commits and
//! branches URL, the not-connected check, the failed-read message and the commit
//! normalising. The fetch and the auth headers stay in TypeScript.

use serde::{Deserialize, Serialize};

use crate::overleaf_workshop::encode_uri_component;
use crate::search::js_text::is_js_whitespace;

/// Which git host an integration reads from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum GitHost {
    /// GitHub (`api.github.com`).
    Github,
    /// GitLab (`gitlab.com` REST API).
    Gitlab,
}

/// What a read asks the host for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum GitReadKind {
    /// The commit list for a branch.
    Commits,
    /// The branch list of the repository.
    Branches,
}

/// Input for [`git_read_plan`]: one read of an integration.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GitReadInput {
    /// The host the integration points at.
    pub host: GitHost,
    /// Commits or branches.
    pub kind: GitReadKind,
    /// API token, empty when unset.
    pub token: String,
    /// Repo path (GitHub `owner/name`, GitLab path or id), empty when unset.
    pub repo: String,
    /// Branch the caller asked for. `None` uses the integration's branch.
    pub branch: Option<String>,
    /// The integration's own branch, used when `branch` is `None`.
    pub default_branch: String,
}

/// The request URL for a git read, or why there is none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GitReadPlan {
    /// Request URL. `None` when the read cannot be made.
    pub url: Option<String>,
    /// Why `url` is `None`. Set exactly when `url` is.
    pub error: Option<String>,
}

/// Message when the token or the repo is missing.
pub const NOT_CONNECTED_MESSAGE: &str = "Connect this provider in Settings first.";

/// The request URL for a read, or the error that stops it (TS `get` URL and check).
///
/// Empty token or repo is "not connected" (JS `!token || !repo`). The branch is the
/// caller's, else the integration's (JS `branch ?? defaultBranch`).
#[must_use]
pub fn git_read_plan(input: &GitReadInput) -> GitReadPlan {
    if input.token.is_empty() || input.repo.is_empty() {
        return GitReadPlan {
            url: None,
            error: Some(NOT_CONNECTED_MESSAGE.to_owned()),
        };
    }
    let branch = input.branch.as_deref().unwrap_or(&input.default_branch);
    GitReadPlan {
        url: Some(git_read_url(input.host, input.kind, &input.repo, branch)),
        error: None,
    }
}

/// The REST URL for one host and read. GitHub takes the repo as is; GitLab encodes it.
#[must_use]
pub fn git_read_url(host: GitHost, kind: GitReadKind, repo: &str, branch: &str) -> String {
    match (host, kind) {
        (GitHost::Github, GitReadKind::Branches) => {
            format!("https://api.github.com/repos/{repo}/branches?per_page=100")
        }
        (GitHost::Github, GitReadKind::Commits) => format!(
            "https://api.github.com/repos/{repo}/commits?sha={}&per_page=30",
            encode_uri_component(branch)
        ),
        (GitHost::Gitlab, GitReadKind::Branches) => format!(
            "https://gitlab.com/api/v4/projects/{}/repository/branches?per_page=100",
            encode_uri_component(repo)
        ),
        (GitHost::Gitlab, GitReadKind::Commits) => format!(
            "https://gitlab.com/api/v4/projects/{}/repository/commits?ref_name={}&per_page=30",
            encode_uri_component(repo),
            encode_uri_component(branch)
        ),
    }
}

/// The message for a failed git read: the status and the response text, trimmed.
#[must_use]
pub fn git_read_failure_message(status: u16, body: &str) -> String {
    format!("Git read failed ({status}). {body}")
        .trim_matches(is_js_whitespace)
        .to_owned()
}

/// A GitHub commit as the commits API returns it. Only the fields the UI reads.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GhCommit {
    /// Full commit sha.
    pub sha: String,
    /// Commit object: message and author.
    pub commit: GhCommitBody,
    /// Web URL of the commit.
    pub html_url: Option<String>,
}

/// The `commit` object of a GitHub commit.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GhCommitBody {
    /// Full commit message.
    pub message: String,
    /// Author name and date, when present.
    pub author: Option<GhAuthor>,
}

/// The author block of a GitHub commit.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GhAuthor {
    /// Author name.
    pub name: Option<String>,
    /// Author date, as the API formats it.
    pub date: Option<String>,
}

/// A GitLab commit as the commits API returns it. Only the fields the UI reads.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GlCommit {
    /// Full commit sha.
    pub id: String,
    /// Full commit message.
    pub message: String,
    /// Author name.
    pub author_name: Option<String>,
    /// Commit date, as the API formats it.
    pub created_at: Option<String>,
    /// Web URL of the commit.
    pub web_url: Option<String>,
}

/// A commit the UI shows, the same for both hosts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    /// Full sha.
    pub sha: String,
    /// First seven characters of the sha.
    pub short_sha: String,
    /// First line of the commit message.
    pub message: String,
    /// Author name, when known.
    pub author: Option<String>,
    /// Author date, when known.
    pub date: Option<String>,
    /// Web URL of the commit, when known.
    pub url: Option<String>,
}

/// Normalises GitHub commits (TS `ghCommit`).
#[must_use]
pub fn github_commits(items: &[GhCommit]) -> Vec<GitCommit> {
    items
        .iter()
        .map(|c| GitCommit {
            sha: c.sha.clone(),
            short_sha: c.sha.chars().take(7).collect(),
            message: first_line(&c.commit.message),
            author: c.commit.author.as_ref().and_then(|a| a.name.clone()),
            date: c.commit.author.as_ref().and_then(|a| a.date.clone()),
            url: c.html_url.clone(),
        })
        .collect()
}

/// Normalises GitLab commits (TS `glCommit`).
#[must_use]
pub fn gitlab_commits(items: &[GlCommit]) -> Vec<GitCommit> {
    items
        .iter()
        .map(|c| GitCommit {
            sha: c.id.clone(),
            short_sha: c.id.chars().take(7).collect(),
            message: first_line(&c.message),
            author: c.author_name.clone(),
            date: c.created_at.clone(),
            url: c.web_url.clone(),
        })
        .collect()
}

/// The text before the first newline (JS `split("\n")[0]`).
fn first_line(message: &str) -> String {
    message.split('\n').next().unwrap_or("").to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(token: &str, repo: &str, branch: Option<&str>) -> GitReadInput {
        GitReadInput {
            host: GitHost::Github,
            kind: GitReadKind::Commits,
            token: token.to_owned(),
            repo: repo.to_owned(),
            branch: branch.map(str::to_owned),
            default_branch: "main".to_owned(),
        }
    }

    #[test]
    fn missing_token_or_repo_is_not_connected() {
        for plan in [
            git_read_plan(&input("", "o/n", None)),
            git_read_plan(&input("t", "", None)),
        ] {
            assert_eq!(plan.url, None);
            assert_eq!(plan.error.as_deref(), Some(NOT_CONNECTED_MESSAGE));
        }
    }

    #[test]
    fn whitespace_token_counts_as_connected_like_js_truthiness() {
        assert!(git_read_plan(&input(" ", "o/n", None)).url.is_some());
    }

    #[test]
    fn caller_branch_beats_integration_branch() {
        let mut i = input("t", "o/n", Some("dev"));
        i.default_branch = "main".to_owned();
        assert!(
            git_read_plan(&i)
                .url
                .is_some_and(|u| u.ends_with("sha=dev&per_page=30"))
        );
        i.branch = None;
        assert!(
            git_read_plan(&i)
                .url
                .is_some_and(|u| u.ends_with("sha=main&per_page=30"))
        );
    }

    #[test]
    fn github_urls_keep_repo_and_encode_branch() {
        assert_eq!(
            git_read_url(GitHost::Github, GitReadKind::Commits, "o/n", "feat/x"),
            "https://api.github.com/repos/o/n/commits?sha=feat%2Fx&per_page=30"
        );
        assert_eq!(
            git_read_url(GitHost::Github, GitReadKind::Branches, "o/n", "main"),
            "https://api.github.com/repos/o/n/branches?per_page=100"
        );
    }

    #[test]
    fn gitlab_urls_encode_repo_and_ref() {
        assert_eq!(
            git_read_url(GitHost::Gitlab, GitReadKind::Commits, "g/p", "dev"),
            "https://gitlab.com/api/v4/projects/g%2Fp/repository/commits?ref_name=dev&per_page=30"
        );
        assert_eq!(
            git_read_url(GitHost::Gitlab, GitReadKind::Branches, "g/p", "dev"),
            "https://gitlab.com/api/v4/projects/g%2Fp/repository/branches?per_page=100"
        );
    }

    #[test]
    fn failure_message_is_trimmed() {
        assert_eq!(
            git_read_failure_message(404, " not found \n"),
            // Only the whole message is trimmed, as in TS, so the body's leading space stays.
            "Git read failed (404).  not found"
        );
        assert_eq!(git_read_failure_message(500, ""), "Git read failed (500).");
    }

    #[test]
    fn github_commit_keeps_first_line_and_short_sha() {
        let raw = GhCommit {
            sha: "abcdef0123456789".to_owned(),
            commit: GhCommitBody {
                message: "Fix it\n\nLong body".to_owned(),
                author: Some(GhAuthor {
                    name: Some("Ada".to_owned()),
                    date: Some("2026-11-10T00:00:00Z".to_owned()),
                }),
            },
            html_url: Some("https://github.com/o/n/commit/abc".to_owned()),
        };
        let out = github_commits(&[raw]);
        assert_eq!(out[0].short_sha, "abcdef0");
        assert_eq!(out[0].message, "Fix it");
        assert_eq!(out[0].author.as_deref(), Some("Ada"));
    }

    #[test]
    fn gitlab_commit_maps_id_and_web_url() {
        let raw = GlCommit {
            id: "0123456789ab".to_owned(),
            message: "Only line".to_owned(),
            author_name: None,
            created_at: Some("2026-11-10".to_owned()),
            web_url: None,
        };
        let out = gitlab_commits(&[raw]);
        assert_eq!(out[0].sha, "0123456789ab");
        assert_eq!(out[0].short_sha, "0123456");
        assert_eq!(out[0].author, None);
        assert_eq!(out[0].date.as_deref(), Some("2026-11-10"));
    }
}

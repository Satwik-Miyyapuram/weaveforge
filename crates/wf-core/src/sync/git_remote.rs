//! Port of the pure parts of `packages/core/src/workspace/parts-2.ts`: the
//! sync branch and author, pull and push outcomes, remote URL checks and token
//! redaction. The async `IWorkspaceGitRemote` port is not here.

use serde::{Deserialize, Serialize};
use url::Url;

use crate::search::js_text::is_js_whitespace;

/// The remote branch every sync uses.
pub const DEFAULT_SYNC_BRANCH: &str = "main";

/// `(name, email)` of the author for commits made before a pull or push when the user is not named.
pub const SYNC_AUTHOR: (&str, &str) = ("WeaveForge", "sync@weaveforge.local");

const REASON_ENTER_URL: &str = "Enter the remote's https URL.";
const REASON_NOT_URL: &str = "That is not a URL.";
const REASON_NOT_HTTPS: &str = "Only https:// remotes are supported.";
const REASON_CREDENTIALS: &str = "Leave the token out of the URL; put it in the token field.";
const REASON_NO_PATH: &str =
    "The URL needs the repository path, e.g. https://github.com/you/notes.git.";

/// Result of a pull. `conflict` leaves the folder as it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GitPullResult {
    /// Nothing new on the remote.
    UpToDate,
    /// The remote's commits were applied directly.
    FastForward {
        /// Commit the branch now points at.
        oid: String,
    },
    /// The remote's commits were merged with local ones.
    Merged {
        /// Commit the branch now points at.
        oid: String,
    },
    /// Nothing was changed locally; these files need resolving by hand.
    Conflict {
        /// Paths changed on both sides.
        files: Vec<String>,
    },
}

/// Result of a push. Never forces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GitPushResult {
    /// The branch was pushed.
    Pushed,
    /// The remote already has every local commit.
    UpToDate,
    /// The remote has commits this folder does not; pull first.
    Rejected {
        /// Why the remote refused.
        reason: String,
    },
}

/// Result of checking a remote URL. Refusal reasons never echo the input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRemoteUrlCheck {
    /// The normalised `https://` URL.
    Accepted {
        /// Normalised URL, as `Url::as_str` renders it.
        url: String,
    },
    /// The URL cannot be used; `reason` is shown to the user.
    Refused {
        /// Text shown to the user.
        reason: &'static str,
    },
}

fn refused(reason: &'static str) -> GitRemoteUrlCheck {
    GitRemoteUrlCheck::Refused { reason }
}

/// Accepts only `https://host/...` with no user or password in it. A token in
/// the URL would be written to `.git/config` in plain text, so it is refused
/// here and passed separately instead. `None` is a non-string input.
#[must_use]
pub fn check_git_remote_url(raw: Option<&str>) -> GitRemoteUrlCheck {
    let Some(raw) = raw else {
        return refused(REASON_ENTER_URL);
    };
    let trimmed = raw.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return refused(REASON_ENTER_URL);
    }
    let Ok(url) = Url::parse(trimmed) else {
        return refused(REASON_NOT_URL);
    };
    if url.scheme() != "https" {
        return refused(REASON_NOT_HTTPS);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return refused(REASON_CREDENTIALS);
    }
    let host_missing = url.host_str().is_none_or(str::is_empty);
    if host_missing || matches!(url.path(), "" | "/") {
        return refused(REASON_NO_PATH);
    }
    GitRemoteUrlCheck::Accepted {
        url: url.as_str().to_owned(),
    }
}

/// Removes a token from text before it is shown or logged, since git echoes
/// URLs and headers in its errors. An absent or empty secret leaves text alone.
#[must_use]
pub fn redact_secret(text: &str, secret: Option<&str>) -> String {
    match secret {
        Some(secret) if !secret.is_empty() => text.replace(secret, "***"),
        _ => text.to_owned(),
    }
}

/// One line for the Settings panel.
#[must_use]
pub fn describe_pull(result: &GitPullResult) -> String {
    match result {
        GitPullResult::UpToDate => "Already up to date.".to_owned(),
        GitPullResult::FastForward { .. } => "Pulled the remote's changes.".to_owned(),
        GitPullResult::Merged { .. } => "Merged the remote's changes with yours.".to_owned(),
        GitPullResult::Conflict { files } => describe_conflict(files),
    }
}

fn describe_conflict(files: &[String]) -> String {
    let count = files.len();
    let plural = if count == 1 { "" } else { "s" };
    let mut listed = files
        .iter()
        .take(5)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    if count > 5 {
        listed.push_str(", …");
    }
    format!(
        "Not pulled: {count} file{plural} changed on both sides ({listed}). Your files were left as they were."
    )
}

/// One line for the Settings panel.
#[must_use]
pub fn describe_push(result: &GitPushResult) -> String {
    match result {
        GitPushResult::Pushed => "Pushed.".to_owned(),
        GitPushResult::UpToDate => "Nothing to push.".to_owned(),
        GitPushResult::Rejected { reason } => format!("Not pushed: {reason}"),
    }
}

/// How the sync remote stands against the local branch, as the Settings panel reads it.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "RemoteStatusInput"))]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    /// The remote's URL; absent or empty when no remote is connected.
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    /// Branch.
    pub branch: String,
    #[serde(default)]
    /// Ahead.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub ahead: u64,
    #[serde(default)]
    /// Behind.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub behind: u64,
}

/// One line for the Settings panel: connection, sync position, or the commits to push and pull.
#[must_use]
pub fn describe_status(status: &RemoteStatus) -> String {
    let connected = status.url.as_deref().is_some_and(|url| !url.is_empty());
    if !connected {
        return "Not connected yet.".to_owned();
    }
    if status.ahead == 0 && status.behind == 0 {
        return format!("In step with the remote on {}.", status.branch);
    }
    let plural = if status.ahead == 1 { "" } else { "s" };
    format!(
        "{} commit{plural} to push, {} to pull on {}.",
        status.ahead, status.behind, status.branch
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pull_result_deserializes_tagged_kebab_case() {
        assert_eq!(
            serde_json::from_str::<GitPullResult>(r#"{"kind":"fast-forward","oid":"abc"}"#)
                .unwrap(),
            GitPullResult::FastForward { oid: "abc".into() }
        );
        assert_eq!(
            serde_json::from_str::<GitPullResult>(r#"{"kind":"up-to-date"}"#).unwrap(),
            GitPullResult::UpToDate
        );
        assert!(serde_json::from_str::<GitPullResult>(r#"{"kind":"bogus"}"#).is_err());
    }

    #[test]
    fn push_result_deserializes_tagged_kebab_case() {
        assert_eq!(
            serde_json::from_str::<GitPushResult>(r#"{"kind":"rejected","reason":"r"}"#).unwrap(),
            GitPushResult::Rejected { reason: "r".into() }
        );
    }
}

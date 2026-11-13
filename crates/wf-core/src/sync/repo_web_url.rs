//! Web links to a git repo and its commits, ported from
//! `apps/web/src/features/sync/infrastructure/parts.ts`.

use url::Url;

use crate::search::js_text::is_js_whitespace;

/// A repo URL safe to render as a link: http(s) only. The URL is user data, so a
/// `javascript:` or `data:` value must never reach an `<a href>`.
///
/// Returns the trimmed URL, or `None` when it is empty, unparseable or not http(s).
#[must_use]
pub fn repo_web_url(repo_url: Option<&str>) -> Option<String> {
    let raw = repo_url.filter(|s| !s.is_empty())?;
    let trimmed = raw.trim_matches(is_js_whitespace);
    let parsed = Url::parse(trimmed).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| trimmed.to_owned())
}

/// A web URL to a commit, built from a repo URL and a sha (best-effort by host).
///
/// GitLab puts commits under `/-/commit/`; GitHub and most others use `/commit/`.
/// Returns `None` when the repo URL is not safe or the sha is empty.
#[must_use]
pub fn commit_url(repo_url: Option<&str>, sha: Option<&str>) -> Option<String> {
    let safe = repo_web_url(repo_url)?;
    let sha = sha.filter(|s| !s.is_empty())?;
    let without_git = safe.strip_suffix(".git").unwrap_or(&safe);
    let base = without_git.strip_suffix('/').unwrap_or(without_git);
    if base.contains("gitlab") {
        Some(format!("{base}/-/commit/{sha}"))
    } else {
        Some(format!("{base}/commit/{sha}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{commit_url, repo_web_url};

    #[test]
    fn repo_web_url_keeps_http_only() {
        assert_eq!(repo_web_url(None), None);
        assert_eq!(repo_web_url(Some("")), None);
        assert_eq!(repo_web_url(Some("   ")), None);
        assert_eq!(repo_web_url(Some("javascript:alert(1)")), None);
        assert_eq!(repo_web_url(Some("data:text/html,hi")), None);
        assert_eq!(repo_web_url(Some("ftp://host/x")), None);
        assert_eq!(
            repo_web_url(Some("  https://github.com/a/b.git  ")),
            Some("https://github.com/a/b.git".to_owned())
        );
    }

    #[test]
    fn commit_url_by_host() {
        assert_eq!(
            commit_url(Some("https://github.com/a/b.git"), Some("abc")),
            Some("https://github.com/a/b/commit/abc".to_owned())
        );
        assert_eq!(
            commit_url(Some("https://gitlab.com/a/b/"), Some("abc")),
            Some("https://gitlab.com/a/b/-/commit/abc".to_owned())
        );
        assert_eq!(commit_url(Some("https://github.com/a/b"), Some("")), None);
        assert_eq!(commit_url(Some("javascript:x"), Some("abc")), None);
        assert_eq!(commit_url(None, Some("abc")), None);
    }
}

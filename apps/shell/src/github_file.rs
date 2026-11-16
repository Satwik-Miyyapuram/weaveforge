//! Serves a PDF from the workspace's GitHub sync repo at `/api/github-file?path=papers/pdf/<id>.pdf`.
//! The token stays in the shell: the page only names a repo path, and only PDFs under `papers/` are served.

use reqwest::Url;

use crate::prefs::{PrefValue, Prefs};
use crate::relay::shared::{Answer, read_capped};
use crate::secrets::Secrets;

/// The same-origin route the reader's GitHub step asks.
pub const ROUTE: &str = "/api/github-file";

/// The branch Git sync pushes to (`DEFAULT_SYNC_BRANCH` in packages/core).
const BRANCH: &str = "main";

/// GitHub's largest file; anything bigger is not a file it would serve.
const MAX_BYTES: usize = 100 * 1024 * 1024;

/// `(owner, repo)` of a `https://github.com/<owner>/<repo>[.git]` remote, else None.
#[must_use]
pub fn github_repo(remote: &str) -> Option<(String, String)> {
    let url = Url::parse(remote.trim()).ok()?;
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return None;
    }
    let mut parts = url.path_segments()?.filter(|part| !part.is_empty());
    let owner = parts.next()?.to_owned();
    let repo = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let repo = repo.strip_suffix(".git").unwrap_or(repo).to_owned();
    let safe = |s: &str| {
        !s.is_empty()
            && s != "."
            && s != ".."
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    (safe(&owner) && safe(&repo)).then_some((owner, repo))
}

/// True for a repo-relative `papers/…/*.pdf` path with no root, `..` or backslash.
#[must_use]
pub fn is_served_path(path: &str) -> bool {
    if !path.starts_with("papers/") || !path.to_ascii_lowercase().ends_with(".pdf") {
        return false;
    }
    !path.contains('\\')
        && !path.contains(':')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// The contents API address for `path` on the sync branch.
#[must_use]
pub fn contents_url(owner: &str, repo: &str, path: &str) -> Option<Url> {
    let mut url = Url::parse("https://api.github.com/repos").ok()?;
    {
        let mut segments = url.path_segments_mut().ok()?;
        let _ = segments
            .extend([owner, repo, "contents"])
            .extend(path.split('/'));
    }
    let _ = url.query_pairs_mut().append_pair("ref", BRANCH);
    Some(url)
}

/// The `path` query value, decoded.
fn query_path(query: Option<&str>) -> Option<String> {
    let url = Url::parse(&format!("http://x/?{}", query?)).ok()?;
    url.query_pairs()
        .find(|(name, _)| name == "path")
        .map(|(_, value)| value.into_owned())
}

fn bare(status: u16) -> Answer {
    Answer {
        status,
        headers: Vec::new(),
        body: Vec::new(),
    }
}

/// `(owner, repo)` of the stored sync remote when it is on GitHub.
fn stored_repo(prefs: &Prefs) -> Option<(String, String)> {
    match prefs.read("vault-git-remote") {
        Ok(Some(PrefValue::Text(text))) => github_repo(&text),
        _ => None,
    }
}

/// The answer to one `/api/github-file` request: the PDF, or a bare status.
/// With no query it only says whether a GitHub remote is set: 204 yes, 404 no.
/// 400 bad path, 404 no GitHub remote or no such file, 502 GitHub failed or sent something else.
pub async fn serve(
    client: &reqwest::Client,
    prefs: &Prefs,
    secrets: &Secrets,
    query: Option<&str>,
) -> Answer {
    if query.is_none_or(str::is_empty) {
        return bare(if stored_repo(prefs).is_some() {
            204
        } else {
            404
        });
    }
    let Some(path) = query_path(query).filter(|p| is_served_path(p)) else {
        return bare(400);
    };
    let Some((owner, repo)) = stored_repo(prefs) else {
        return bare(404);
    };
    let Some(url) = contents_url(&owner, &repo, &path) else {
        return bare(400);
    };
    let mut request = client
        .get(url)
        .header("accept", "application/vnd.github.raw")
        .header("user-agent", "WeaveForge-Desktop");
    // A public repo answers without a token.
    if let Ok(Some(token)) = secrets.read("git-sync-token")
        && !token.is_empty()
    {
        request = request.bearer_auth(token);
    }
    let Ok(response) = request.send().await else {
        return bare(502);
    };
    let status = response.status().as_u16();
    if status == 404 {
        return bare(404);
    }
    if !response.status().is_success() {
        return bare(502);
    }
    let Ok(Some(body)) = read_capped(response, MAX_BYTES).await else {
        return bare(502);
    };
    if !body.starts_with(b"%PDF-") {
        return bare(502);
    }
    Answer {
        status: 200,
        headers: vec![
            ("content-type".to_owned(), "application/pdf".to_owned()),
            ("cache-control".to_owned(), "no-store".to_owned()),
        ],
        body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_repo_reads_owner_and_repo() {
        let want = Some(("me".to_owned(), "notes".to_owned()));
        assert_eq!(github_repo("https://github.com/me/notes"), want);
        assert_eq!(github_repo("https://github.com/me/notes.git"), want);
        assert_eq!(github_repo("https://github.com/me/notes/"), want);
    }

    #[test]
    fn github_repo_refuses_other_remotes() {
        for remote in [
            "http://github.com/me/notes",
            "https://gitlab.com/me/notes",
            "https://github.com/me",
            "https://github.com/me/notes/tree/main",
            "https://github.com/../notes",
            "not a url",
        ] {
            assert_eq!(github_repo(remote), None, "{remote}");
        }
    }

    #[test]
    fn served_paths_are_pdfs_under_papers() {
        assert!(is_served_path("papers/pdf/abc.pdf"));
        assert!(is_served_path("papers/pdf/A B.PDF"));
        for path in [
            "papers/pdf/../secret.pdf",
            "/papers/pdf/a.pdf",
            "notes/a.pdf",
            "papers/pdf/a.md",
            "papers\\pdf\\a.pdf",
            "papers//a.pdf",
            "papers/c:/a.pdf",
        ] {
            assert!(!is_served_path(path), "{path}");
        }
    }

    #[test]
    fn contents_url_encodes_each_segment() {
        let url = contents_url("me", "notes", "papers/pdf/A B#1.pdf").unwrap();
        assert_eq!(
            url.as_str(),
            "https://api.github.com/repos/me/notes/contents/papers/pdf/A%20B%231.pdf?ref=main"
        );
    }

    #[test]
    fn query_path_decodes_the_path() {
        assert_eq!(
            query_path(Some("path=papers%2Fpdf%2Fa.pdf")).as_deref(),
            Some("papers/pdf/a.pdf")
        );
        assert_eq!(query_path(Some("other=1")), None);
        assert_eq!(query_path(None), None);
    }
}

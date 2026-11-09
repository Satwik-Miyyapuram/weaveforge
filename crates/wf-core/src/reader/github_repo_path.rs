//! Where a paper's PDF sits in the workspace's GitHub repo (TS `repoPathOf` and
//! `isSafeRepoPath` in `packages/core/src/reader/github-repo-pdf-resolver.ts`).

use crate::search::js_text::is_js_whitespace;

/// A repo-relative path with no root, drive, scheme, backslash or `.`/`..`/empty segment.
#[must_use]
pub fn is_safe_repo_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains(':') {
        return false;
    }
    path.split('/')
        .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// A paper id that is safe as a file name: letters, digits, `_` and `-`.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The repo path to fetch: the metadata `pdfPath` (trimmed) when it is safe, else
/// `papers/pdf/<id>.pdf` when the id is a safe file name, else none.
#[must_use]
pub fn github_repo_pdf_path(given_pdf_path: Option<&str>, paper_id: &str) -> Option<String> {
    if let Some(given) = given_pdf_path {
        let trimmed = given.trim_matches(is_js_whitespace);
        if is_safe_repo_path(trimmed) {
            return Some(trimmed.to_owned());
        }
    }
    is_safe_id(paper_id).then(|| format!("papers/pdf/{paper_id}.pdf"))
}

#[cfg(test)]
mod tests {
    use super::{github_repo_pdf_path, is_safe_repo_path};

    #[test]
    fn prefers_a_safe_given_path_and_trims_it() {
        assert_eq!(
            github_repo_pdf_path(Some("  papers/pdf/other.pdf "), "p"),
            Some("papers/pdf/other.pdf".to_owned())
        );
    }

    #[test]
    fn unsafe_given_paths_fall_back_to_the_layout_path() {
        for given in [
            "/etc/x.pdf",
            "../x.pdf",
            "papers/../../x.pdf",
            "C:\\x.pdf",
            "https://e.com/x.pdf",
            "",
            "   ",
        ] {
            assert_eq!(
                github_repo_pdf_path(Some(given), "p1"),
                Some("papers/pdf/p1.pdf".to_owned()),
                "{given}"
            );
        }
    }

    #[test]
    fn unsafe_ids_give_no_path() {
        assert_eq!(github_repo_pdf_path(None, "../x"), None);
        assert_eq!(github_repo_pdf_path(None, ""), None);
        assert_eq!(github_repo_pdf_path(None, "a.b"), None);
    }

    #[test]
    fn missing_given_path_uses_the_id() {
        assert_eq!(
            github_repo_pdf_path(None, "abc-123"),
            Some("papers/pdf/abc-123.pdf".to_owned())
        );
    }

    #[test]
    fn safe_repo_path_rules() {
        assert!(is_safe_repo_path("a/b.pdf"));
        assert!(!is_safe_repo_path("a/"));
        assert!(!is_safe_repo_path("a/./b"));
    }
}

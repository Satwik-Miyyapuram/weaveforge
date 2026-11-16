//! Which GitHub repo error reports go to (ports `reportRepo` in
//! `apps/web/src/lib/error-report/parts.ts`). The build environment supplies the
//! configured value; this picks the default when it is missing or not `owner/repo`.

/// Where reports go when nothing overrides it; the server route uses the same repo.
pub const DEFAULT_REPORT_REPO: &str = "Satwik-Miyyapuram/weaveforge";

/// Whether `value` is `owner/repo` with word characters, `.` or `-` on each side.
fn is_owner_repo(value: &str) -> bool {
    let Some((owner, repo)) = value.split_once('/') else {
        return false;
    };
    let part_ok = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    };
    part_ok(owner) && part_ok(repo) && !repo.contains('/')
}

/// The repo to file reports to: `configured` trimmed when it is `owner/repo`,
/// otherwise [`DEFAULT_REPORT_REPO`].
#[must_use]
pub fn report_repo(configured: Option<&str>) -> String {
    configured
        .map(str::trim)
        .filter(|value| is_owner_repo(value))
        .unwrap_or(DEFAULT_REPORT_REPO)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_REPORT_REPO, report_repo};
    use crate::error_report::issue_url::new_issue_url;

    #[test]
    fn a_missing_or_bad_value_falls_back_to_the_default() {
        assert_eq!(report_repo(None), DEFAULT_REPORT_REPO);
        for bad in [
            "",
            "   ",
            "no-slash",
            "a/b/c",
            "/repo",
            "owner/",
            "own er/repo",
        ] {
            assert_eq!(report_repo(Some(bad)), DEFAULT_REPORT_REPO, "{bad:?}");
        }
    }

    #[test]
    fn a_valid_value_is_used_trimmed() {
        assert_eq!(report_repo(Some("  o.w-1/r_2  ")), "o.w-1/r_2");
    }

    #[test]
    fn the_default_repo_gets_the_prefilled_address() {
        let url = new_issue_url("Papers failed", "boom", &report_repo(None));
        assert_eq!(
            url,
            "https://github.com/Satwik-Miyyapuram/weaveforge/issues/new?title=%5Bapp%5D+Papers+failed&body=boom&labels=bug%2Cfrom-app"
        );
    }
}

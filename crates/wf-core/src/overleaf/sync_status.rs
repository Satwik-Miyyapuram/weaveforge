//! The one-line status the Overleaf folder panel shows when no pull or push just ran
//! (TS `describeOverleafSync`, status branch). Pull and push lines come from `sync::git_remote`.

/// Where a synced Overleaf folder stands (TS `DesktopOverleafSync.status`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OverleafSyncStatus {
    /// The Overleaf git URL; absent or empty when none is set.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub url: Option<String>,
    /// Branch name.
    #[serde(default)]
    pub branch: String,
    /// Commits the local branch has that Overleaf does not.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub ahead: u64,
    /// Commits Overleaf has that the local branch does not.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub behind: u64,
}

/// One line for the status branch. `None` (no status reported) gives an empty line.
#[must_use]
pub fn describe_overleaf_status(status: Option<&OverleafSyncStatus>) -> String {
    let Some(status) = status else {
        return String::new();
    };
    let has_url = status.url.as_deref().is_some_and(|url| !url.is_empty());
    if !has_url {
        return "Not pulled yet.".to_owned();
    }
    if status.ahead == 0 && status.behind == 0 {
        return "In step with Overleaf.".to_owned();
    }
    let plural = if status.ahead == 1 { "" } else { "s" };
    format!(
        "{} commit{plural} to push, {} to pull.",
        status.ahead, status.behind
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(url: Option<&str>, ahead: u64, behind: u64) -> OverleafSyncStatus {
        OverleafSyncStatus {
            url: url.map(str::to_owned),
            branch: "master".to_owned(),
            ahead,
            behind,
        }
    }

    #[test]
    fn no_status_is_empty() {
        assert_eq!(describe_overleaf_status(None), "");
    }

    #[test]
    fn missing_or_empty_url_is_not_pulled() {
        assert_eq!(
            describe_overleaf_status(Some(&status(None, 0, 0))),
            "Not pulled yet."
        );
        assert_eq!(
            describe_overleaf_status(Some(&status(Some(""), 2, 1))),
            "Not pulled yet."
        );
    }

    #[test]
    fn zero_both_ways_is_in_step() {
        assert_eq!(
            describe_overleaf_status(Some(&status(Some("https://git"), 0, 0))),
            "In step with Overleaf."
        );
    }

    #[test]
    fn counts_use_singular_for_one() {
        assert_eq!(
            describe_overleaf_status(Some(&status(Some("https://git"), 1, 0))),
            "1 commit to push, 0 to pull."
        );
        assert_eq!(
            describe_overleaf_status(Some(&status(Some("https://git"), 2, 3))),
            "2 commits to push, 3 to pull."
        );
        assert_eq!(
            describe_overleaf_status(Some(&status(Some("https://git"), 0, 1))),
            "0 commits to push, 1 to pull."
        );
    }
}

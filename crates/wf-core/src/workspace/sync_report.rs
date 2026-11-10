//! The one-line report shown after a folder sync (ports `describeSync` in
//! `apps/web/src/features/workspace/application/workspace-folder.ts`). The counts
//! and the commit outcome come in; the sentence comes out. Writing the folder and
//! making the commit stay in TS.

use serde::{Deserialize, Serialize};

/// What a folder sync did, reduced to the counts and the commit outcome the report needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SyncReport {
    /// How many files the sync wrote to the folder.
    pub written: u32,
    /// How many files the sync removed from the folder.
    pub removed: u32,
    /// The commit message, when a commit was made.
    pub commit_message: Option<String>,
    /// Why no commit was made, when git refused or failed. An empty reason counts as none.
    pub commit_error: Option<String>,
}

/// The line the panel shows after a sync. A failed commit is said, not read as "up to date".
#[must_use]
pub fn describe_sync(report: &SyncReport) -> String {
    let plural = if report.written == 1 { "" } else { "s" };
    let wrote = format!("Wrote {} file{plural}", report.written);
    let removed = if report.removed > 0 {
        format!(", removed {}", report.removed)
    } else {
        String::new()
    };
    if let Some(message) = &report.commit_message {
        return format!("{wrote}{removed} · committed \"{message}\".");
    }
    if let Some(error) = report.commit_error.as_deref().filter(|e| !e.is_empty()) {
        return format!("{wrote}{removed} · not committed: {error}");
    }
    let tail = if report.written == 0 {
        " — already up to date"
    } else {
        "."
    };
    format!("{wrote}{removed}{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(written: u32, removed: u32) -> SyncReport {
        SyncReport {
            written,
            removed,
            commit_message: None,
            commit_error: None,
        }
    }

    #[test]
    fn a_failed_commit_is_said_not_read_as_up_to_date() {
        let r = SyncReport {
            commit_error: Some("fatal: adding files failed".to_owned()),
            ..report(0, 0)
        };
        assert_eq!(
            describe_sync(&r),
            "Wrote 0 files · not committed: fatal: adding files failed"
        );
    }

    #[test]
    fn nothing_written_and_no_commit_is_up_to_date() {
        assert_eq!(
            describe_sync(&report(0, 0)),
            "Wrote 0 files — already up to date"
        );
    }

    #[test]
    fn one_file_is_singular() {
        assert_eq!(describe_sync(&report(1, 0)), "Wrote 1 file.");
    }

    #[test]
    fn removals_are_counted_and_suppress_up_to_date() {
        assert_eq!(describe_sync(&report(0, 2)), "Wrote 0 files, removed 2");
        assert_eq!(describe_sync(&report(3, 1)), "Wrote 3 files, removed 1.");
    }

    #[test]
    fn a_commit_names_its_message() {
        let r = SyncReport {
            commit_message: Some("Sync 2026-11-10".to_owned()),
            ..report(2, 0)
        };
        assert_eq!(
            describe_sync(&r),
            "Wrote 2 files · committed \"Sync 2026-11-10\"."
        );
    }

    #[test]
    fn a_commit_wins_over_a_stale_error() {
        let r = SyncReport {
            commit_message: Some("m".to_owned()),
            commit_error: Some("boom".to_owned()),
            ..report(1, 0)
        };
        assert_eq!(describe_sync(&r), "Wrote 1 file · committed \"m\".");
    }

    #[test]
    fn an_empty_error_is_no_error() {
        let r = SyncReport {
            commit_error: Some(String::new()),
            ..report(0, 0)
        };
        assert_eq!(describe_sync(&r), "Wrote 0 files — already up to date");
    }

    #[test]
    fn json_uses_camel_case_fields() {
        let r: SyncReport =
            serde_json::from_str(r#"{"written":1,"removed":0,"commitMessage":"m"}"#).unwrap();
        assert_eq!(r.commit_message.as_deref(), Some("m"));
        assert_eq!(r.commit_error, None);
    }
}

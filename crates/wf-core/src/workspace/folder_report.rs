//! Triage of the folder changes the watcher reports (`reportFolderChanges` in
//! `apps/web/.../workspace/application/workspace-folder.ts`).
//!
//! MCP suggestions go to the review queue, the app's own machinery is never an edit,
//! and when scoped to a project the changes that belong to another project's subfolder
//! are ignored. What is left is a candidate the caller then reads from the folder.

use serde::{Deserialize, Serialize};

use crate::ai::folder_draft::FOLDER_DRAFTS_DIR;
use crate::sync::folder_layout::id_suffix;
use crate::sync::json_entities::is_app_owned_path;

/// The reported paths and the current project id (`None` or empty when unscoped).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageInput {
    /// Paths the watcher reported, in order.
    #[serde(default)]
    pub paths: Vec<String>,
    /// The project the folder is scoped to, if any.
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Whether a suggestion landed in the drafts folder, and the paths still to check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageVerdict {
    /// A path under the drafts folder was reported.
    pub drafts: bool,
    /// Paths to read and, if they changed, list as outside edits.
    pub candidates: Vec<String>,
}

/// The id suffix a project subfolder carries (`name--SUFFIX/`), when the segment has one.
fn subfolder_suffix(path: &str) -> Option<&str> {
    let slash = path.find('/')?;
    let segment = &path[..slash];
    // The segment is `[^/]+--` then 1 to 8 letters or digits up to the slash.
    let dash = segment.rfind("--")?;
    if dash == 0 {
        return None;
    }
    let tail = &segment[dash + 2..];
    let ok = (1..=8).contains(&tail.len()) && tail.bytes().all(|b| b.is_ascii_alphanumeric());
    ok.then_some(tail)
}

/// Sort the reported paths for the caller: drafts, app machinery, other projects, and candidates.
#[must_use]
pub fn triage_reported_paths(input: &TriageInput) -> TriageVerdict {
    let suffix = input
        .project_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .map(id_suffix);
    let draft_prefix = format!("{FOLDER_DRAFTS_DIR}/");

    let mut drafts = false;
    let mut candidates = Vec::new();
    for path in &input.paths {
        if path.starts_with(&draft_prefix) {
            drafts = true;
            continue;
        }
        if is_app_owned_path(path) {
            continue;
        }
        if let (Some(suffix), Some(found)) = (&suffix, subfolder_suffix(path))
            && found != suffix
        {
            continue;
        }
        candidates.push(path.clone());
    }
    TriageVerdict { drafts, candidates }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn triage(paths: &[&str], project_id: Option<&str>) -> TriageVerdict {
        triage_reported_paths(&TriageInput {
            paths: paths.iter().map(|p| (*p).to_owned()).collect(),
            project_id: project_id.map(str::to_owned),
        })
    }

    #[test]
    fn a_suggestion_in_the_drafts_folder_is_not_a_candidate() {
        let verdict = triage(&[".weaveforge/proposals/abc.json", "notes/a.note.md"], None);
        assert!(verdict.drafts);
        assert_eq!(verdict.candidates, vec!["notes/a.note.md"]);
    }

    #[test]
    fn the_apps_own_machinery_is_never_reported() {
        let verdict = triage(&["README.md", ".git/config", "notes/a.note.md"], None);
        assert!(!verdict.drafts);
        assert_eq!(verdict.candidates, vec!["notes/a.note.md"]);
    }

    #[test]
    fn scoped_to_a_project_another_projects_subfolder_is_ignored() {
        let suffix = id_suffix("p-one-id");
        let mine = format!("notes--{suffix}/a.note.md");
        let theirs = "notes--Zz99Zz99/b.note.md";
        let verdict = triage(
            &[mine.as_str(), theirs, "plain/c.note.md"],
            Some("p-one-id"),
        );
        assert_eq!(verdict.candidates, vec![mine, "plain/c.note.md".to_owned()]);
    }

    #[test]
    fn unscoped_every_subfolder_is_a_candidate() {
        let verdict = triage(&["notes--Zz99Zz99/b.note.md", "plain/c.note.md"], None);
        assert_eq!(verdict.candidates.len(), 2);
    }

    #[test]
    fn an_empty_project_id_is_unscoped() {
        let verdict = triage(&["notes--Zz99Zz99/b.note.md"], Some(""));
        assert_eq!(verdict.candidates, vec!["notes--Zz99Zz99/b.note.md"]);
    }

    #[test]
    fn a_subfolder_suffix_is_one_to_eight_letters_or_digits_before_the_slash() {
        assert_eq!(subfolder_suffix("name--Ab12/x.md"), Some("Ab12"));
        assert_eq!(subfolder_suffix("a---bc/x.md"), Some("bc"));
        assert_eq!(subfolder_suffix("name--Ab12"), None);
        assert_eq!(subfolder_suffix("--Ab12/x.md"), None);
        assert_eq!(subfolder_suffix("name--toolongsuf/x.md"), None);
        assert_eq!(subfolder_suffix("name--Ab-2/x.md"), None);
        assert_eq!(subfolder_suffix("plain/x.md"), None);
    }
}

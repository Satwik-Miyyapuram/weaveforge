//! The projects the MCP answers about. Ported from apps/shell/sidecar/src/local-mcp-projects.ts.

use serde_json::Value;

use crate::vault::{EntryKindPayload, VaultSession};

/// One project as the MCP sees it: a top-level folder of the workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRef {
    /// Project id: the folder name, as the app keys projects.
    pub id: Option<String>,
    /// Display name of the project, the folder name too.
    pub name: String,
    /// Folder under the root.
    pub dir: String,
}

/// The projects to answer about: every top-level folder whose name does not start with ".",
/// as the app lists them. The root itself is the workspace, never a project.
#[must_use]
pub fn resolve_projects(session: &VaultSession) -> Vec<ProjectRef> {
    let mut dirs = folder_dirs(session);
    dirs.sort();
    dirs.into_iter()
        .map(|dir| ProjectRef {
            id: Some(dir.clone()),
            name: dir.clone(),
            dir,
        })
        .collect()
}

/// A name as matching reads it: trimmed, lowercased, whitespace runs folded to one space.
#[must_use]
pub fn norm(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// By id, name or folder, then a unique partial name; a miss lists what there is.
///
/// # Errors
/// No match, or more than one. The message is the TS one.
pub fn pick_project(projects: &[ProjectRef], needle: &Value) -> Result<ProjectRef, String> {
    let wanted = needle.as_str().map(norm).unwrap_or_default();
    let names = projects
        .iter()
        .map(|p| p.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let matches_wanted = |value: &str| !value.is_empty() && norm(value) == wanted;
    let exact: Vec<&ProjectRef> = projects
        .iter()
        .filter(|p| {
            matches_wanted(p.id.as_deref().unwrap_or(""))
                || matches_wanted(p.name.as_str())
                || matches_wanted(p.dir.as_str())
        })
        .collect();
    let found: Vec<&ProjectRef> = if exact.is_empty() {
        projects
            .iter()
            .filter(|p| !wanted.is_empty() && norm(&p.name).contains(wanted.as_str()))
            .collect()
    } else {
        exact
    };
    match found.as_slice() {
        [only] => Ok((*only).clone()),
        [] => Err(format!("No project matches '{wanted}'. Projects: {names}.")),
        _ => Err(format!(
            "'{wanted}' matches more than one project. Projects: {names}."
        )),
    }
}

/// Folders directly under the root that are not hidden, as the app lists them.
/// A failed listing reads as no folders, as in TS.
fn folder_dirs(session: &VaultSession) -> Vec<String> {
    session
        .list(None)
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry.kind == EntryKindPayload::Dir)
        .map(|entry| entry.path)
        .filter(|path| !path.starts_with('.'))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::{Path, PathBuf};

    /// Removes the test workspace when a test ends.
    struct TempRoot(PathBuf);

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn workspace(name: &str, dirs: &[&str]) -> (VaultSession, TempRoot) {
        let root = std::env::temp_dir().join(format!(
            "wf-shell-mcp-projects-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".weaveforge")).expect("create workspace");
        for dir in dirs {
            std::fs::create_dir_all(root.join(dir)).expect("create folder");
        }
        let mut session = VaultSession::new();
        let _ = session
            .adopt(Some(Path::new(&root)))
            .expect("adopt workspace");
        (session, TempRoot(root))
    }

    fn project(id: Option<&str>, name: &str, dir: &str) -> ProjectRef {
        ProjectRef {
            id: id.map(str::to_owned),
            name: name.to_owned(),
            dir: dir.to_owned(),
        }
    }

    fn sample() -> Vec<ProjectRef> {
        vec![
            project(Some("aaaaaa-1"), "Proj A", "proj-a--aaaaaa"),
            project(Some("bbbbbb-2"), "Proj B", "proj-b--bbbbbb"),
            project(Some("cccccc-3"), "Empty", "empty--cccccc"),
        ]
    }

    #[test]
    fn every_plain_top_level_folder_is_a_project() {
        let (session, _guard) = workspace(
            "folders",
            &["Thesis", "proj-a--aaaaaa", "empty", ".git", "Thesis/papers"],
        );
        assert_eq!(
            resolve_projects(&session),
            vec![
                project(Some("Thesis"), "Thesis", "Thesis"),
                project(Some("empty"), "empty", "empty"),
                project(Some("proj-a--aaaaaa"), "proj-a--aaaaaa", "proj-a--aaaaaa"),
            ]
        );
    }

    #[test]
    fn the_root_is_never_a_project() {
        let (session, _guard) = workspace("none", &[]);
        assert_eq!(resolve_projects(&session), Vec::<ProjectRef>::new());
    }

    #[test]
    fn norm_trims_lowercases_and_folds_whitespace() {
        assert_eq!(norm("  Proj \t  B \n"), "proj b");
        assert_eq!(norm("   "), "");
    }

    #[test]
    fn pick_by_exact_id() {
        assert_eq!(
            pick_project(&sample(), &json!("aaaaaa-1")).map(|p| p.name),
            Ok("Proj A".to_owned())
        );
    }

    #[test]
    fn pick_by_name_ignoring_case_and_spacing() {
        assert_eq!(
            pick_project(&sample(), &json!("  proj   b ")).map(|p| p.dir),
            Ok("proj-b--bbbbbb".to_owned())
        );
    }

    #[test]
    fn pick_by_exact_dir() {
        assert_eq!(
            pick_project(&sample(), &json!("proj-b--bbbbbb")).map(|p| p.name),
            Ok("Proj B".to_owned())
        );
    }

    #[test]
    fn pick_by_unique_partial_name() {
        assert_eq!(
            pick_project(&sample(), &json!("empt")).map(|p| p.name),
            Ok("Empty".to_owned())
        );
    }

    #[test]
    fn pick_ambiguous_partial_lists_the_candidates() {
        let projects = vec![
            project(None, "Alpha Beta", "x--1"),
            project(None, "Alpha Gamma", "y--2"),
        ];
        assert_eq!(
            pick_project(&projects, &json!("alpha")),
            Err(
                "'alpha' matches more than one project. Projects: Alpha Beta, Alpha Gamma."
                    .to_owned()
            )
        );
    }

    #[test]
    fn pick_ambiguous_exact_name_is_refused() {
        let projects = vec![project(None, "Dup", "a--1"), project(None, "Dup", "b--2")];
        assert_eq!(
            pick_project(&projects, &json!("dup")),
            Err("'dup' matches more than one project. Projects: Dup, Dup.".to_owned())
        );
    }

    #[test]
    fn pick_miss_lists_the_projects() {
        assert_eq!(
            pick_project(&sample(), &json!("zzz")),
            Err("No project matches 'zzz'. Projects: Proj A, Proj B, Empty.".to_owned())
        );
    }

    #[test]
    fn pick_non_string_needle_matches_nothing() {
        assert_eq!(
            pick_project(&sample(), &json!(5)),
            Err("No project matches ''. Projects: Proj A, Proj B, Empty.".to_owned())
        );
    }

    #[test]
    fn pick_empty_needle_matches_nothing_even_with_an_empty_dir() {
        let projects = vec![project(None, "workspace", "")];
        assert_eq!(
            pick_project(&projects, &json!("")),
            Err("No project matches ''. Projects: workspace.".to_owned())
        );
    }
}

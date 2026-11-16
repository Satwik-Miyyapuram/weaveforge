//! The projects the MCP answers about. Ported from apps/shell/sidecar/src/local-mcp-projects.ts.

use serde_json::Value;
use wf_core::sync::folder_layout::{WorkspaceProject, id_suffix, project_dir};

use crate::vault::{EntryKindPayload, VaultSession};

/// One project as the MCP sees it: `dir` is its folder under the root, "" for a pre-project layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRef {
    /// Project id from the app's rows, `None` for a folder-only project.
    pub id: Option<String>,
    /// Display name of the project.
    pub name: String,
    /// Folder under the root, `""` for a pre-project layout.
    pub dir: String,
}

/// The projects to answer about. With the app's rows, each gets the folder the app itself
/// would pick (exact `project_dir`, else the one folder ending in its id suffix); folders no
/// project claims are left out. Without rows, each `slug--id` folder is a project.
#[must_use]
pub fn resolve_projects(session: &VaultSession, rows: &[WorkspaceProject]) -> Vec<ProjectRef> {
    let dirs = folder_dirs(session);
    if !rows.is_empty() {
        return rows
            .iter()
            .map(|project| {
                let exact = project_dir(project);
                let suffix = format!("--{}", id_suffix(&project.id));
                let tail: Vec<String> = dirs
                    .iter()
                    .filter(|d| d.ends_with(suffix.as_str()))
                    .cloned()
                    .collect();
                // No folder yet is fine: a draft for an empty project still names it.
                let dir = if dirs.contains(&exact) {
                    exact
                } else {
                    match tail.as_slice() {
                        [only] => only.clone(),
                        _ => exact,
                    }
                };
                ProjectRef {
                    id: Some(project.id.clone()),
                    name: project.name.clone(),
                    dir,
                }
            })
            .collect();
    }
    let folders: Vec<ProjectRef> = dirs
        .iter()
        .filter_map(|dir| {
            let at = folder_suffix_start(dir)?;
            Some(ProjectRef {
                id: None,
                name: dir[..at].to_owned(),
                dir: dir.clone(),
            })
        })
        .collect();
    if folders.is_empty() {
        vec![ProjectRef {
            id: None,
            name: "workspace".to_owned(),
            dir: String::new(),
        }]
    } else {
        folders
    }
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

/// Where the `--xxxxxx` suffix starts: the leftmost `--` followed by 1 to 6 ASCII letters or digits
/// running to the end (TS `PROJECT_FOLDER`).
fn folder_suffix_start(dir: &str) -> Option<usize> {
    let bytes = dir.as_bytes();
    (0..bytes.len().saturating_sub(1)).find(|&at| {
        bytes[at] == b'-' && bytes[at + 1] == b'-' && {
            let tail = &bytes[at + 2..];
            (1..=6).contains(&tail.len()) && tail.iter().all(u8::is_ascii_alphanumeric)
        }
    })
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

    fn row(id: &str, name: &str) -> WorkspaceProject {
        WorkspaceProject {
            id: id.to_owned(),
            name: name.to_owned(),
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
    fn resolve_without_rows_uses_suffix_folders() {
        let (session, _guard) = workspace(
            "no-rows",
            &[
                "proj-a--aaaaaa",
                "thesis--e88ade",
                "assets",
                "notes",
                ".git",
            ],
        );
        assert_eq!(
            resolve_projects(&session, &[]),
            vec![
                project(None, "proj-a", "proj-a--aaaaaa"),
                project(None, "thesis", "thesis--e88ade"),
            ]
        );
    }

    #[test]
    fn resolve_without_rows_and_folders_is_the_workspace() {
        let (session, _guard) = workspace("plain", &["notes", "papers"]);
        assert_eq!(
            resolve_projects(&session, &[]),
            vec![project(None, "workspace", "")]
        );
    }

    #[test]
    fn resolve_with_rows_takes_the_exact_dir() {
        let (session, _guard) = workspace("exact", &["proj-a--aaaaaa"]);
        assert_eq!(
            resolve_projects(&session, &[row("aaaaaa-1", "Proj A")]),
            vec![project(Some("aaaaaa-1"), "Proj A", "proj-a--aaaaaa")]
        );
    }

    #[test]
    fn resolve_with_rows_takes_the_one_suffix_folder() {
        let (session, _guard) = workspace("suffix", &["renamed--bbbbbb"]);
        assert_eq!(
            resolve_projects(&session, &[row("bbbbbb-2", "Proj B")]),
            vec![project(Some("bbbbbb-2"), "Proj B", "renamed--bbbbbb")]
        );
    }

    #[test]
    fn resolve_with_rows_and_two_suffix_folders_keeps_the_exact_name() {
        let (session, _guard) = workspace("two", &["x--bbbbbb", "y--bbbbbb"]);
        assert_eq!(
            resolve_projects(&session, &[row("bbbbbb-2", "Proj B")]),
            vec![project(Some("bbbbbb-2"), "Proj B", "proj-b--bbbbbb")]
        );
    }

    #[test]
    fn resolve_with_rows_and_no_folder_still_names_the_project() {
        let (session, _guard) = workspace("empty", &[]);
        let row = row("cccccc-3", "Empty");
        let exact = project_dir(&row);
        assert_eq!(
            resolve_projects(&session, &[row]),
            vec![project(Some("cccccc-3"), "Empty", &exact)]
        );
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

    #[test]
    fn folder_suffix_needs_one_to_six_alphanumerics_at_the_end() {
        assert_eq!(folder_suffix_start("proj-a--aaaaaa"), Some(6));
        assert_eq!(folder_suffix_start("a---b"), Some(2));
        assert_eq!(folder_suffix_start("x--abcdefg"), None);
        assert_eq!(folder_suffix_start("x--"), None);
        assert_eq!(folder_suffix_start("plain"), None);
    }
}

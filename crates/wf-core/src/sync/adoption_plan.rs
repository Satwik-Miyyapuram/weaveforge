//! Ports `Adoption.rename` in `apps/web/src/features/offline-sync/domain/adoption.ts`:
//! which local projects collide with names the account already holds, and what
//! each one is renamed to. The SQL that reads the rows and applies the renames
//! stays in TS, and the caller must pass the local projects in the order the
//! query returns them (`order by name`).

use serde::{Deserialize, Serialize};

use super::panel_labels::unique_device_name;

/// A local project as the rename sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LocalProject {
    /// The project's row id.
    pub id: String,
    /// The project's current name.
    pub name: String,
}

/// One rename to apply: a project, the name it had, and the name it takes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Rename {
    /// The project's row id.
    pub id: String,
    /// The name before the rename.
    pub from: String,
    /// The name after the rename.
    pub to: String,
}

/// The renames adoption needs. Each collision is renamed in turn, and the new
/// name joins the taken set, so a later project cannot take it. No remote names
/// means no renames.
#[must_use]
pub fn plan_renames(
    local: &[LocalProject],
    remote_names: &[String],
    device_label: &str,
) -> Vec<Rename> {
    if remote_names.is_empty() {
        return Vec::new();
    }
    let mut taken: Vec<String> = remote_names.to_vec();
    let mut renames = Vec::new();
    for project in local {
        if !taken.contains(&project.name) {
            continue;
        }
        let to = unique_device_name(&project.name, device_label, &taken);
        taken.push(to.clone());
        renames.push(Rename {
            id: project.id.clone(),
            from: project.name.clone(),
            to,
        });
    }
    renames
}

#[cfg(test)]
mod tests {
    use super::{LocalProject, Rename, plan_renames};

    fn project(id: &str, name: &str) -> LocalProject {
        LocalProject {
            id: id.to_owned(),
            name: name.to_owned(),
        }
    }

    #[test]
    fn no_remote_names_means_no_renames() {
        let local = [project("a", "Thesis")];
        assert!(plan_renames(&local, &[], "Mac").is_empty());
    }

    #[test]
    fn only_colliding_projects_are_renamed() {
        let local = [project("a", "Thesis"), project("b", "Notes")];
        let remote = ["Thesis".to_owned()];
        assert_eq!(
            plan_renames(&local, &remote, "Mac"),
            vec![Rename {
                id: "a".to_owned(),
                from: "Thesis".to_owned(),
                to: "Thesis (Mac)".to_owned(),
            }]
        );
    }

    #[test]
    fn a_rename_joins_the_taken_set() {
        // "Thesis (Mac)" is a remote name, so the local "Thesis" must count up.
        let local = [project("a", "Thesis")];
        let remote = ["Thesis".to_owned(), "Thesis (Mac)".to_owned()];
        let plan = plan_renames(&local, &remote, "Mac");
        assert_eq!(plan[0].to, "Thesis (Mac 2)");
    }
}

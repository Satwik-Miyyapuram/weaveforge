//! Picks one project for an MCP request by id, name or folder, then a unique partial name.
//! Port of `pickProject` and `norm` in `apps/shell/sidecar/src/local-mcp-projects.ts`.

use serde::Deserialize;

/// A project as the MCP sees it: only the fields matching reads.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PickableProject"))]
pub struct ProjectRef {
    /// The app's project id, when the project has one.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub id: Option<String>,
    /// The project's name.
    pub name: String,
    /// The project's folder under the root; "" for a pre-project layout.
    pub dir: String,
}

/// The index of the one project `needle` picks. `needle` is `None` when the request gave no
/// string, which matches nothing. Errors carry the message the TypeScript side throws.
pub fn pick_project(projects: &[ProjectRef], needle: Option<&str>) -> Result<usize, String> {
    let wanted = needle.map(norm).unwrap_or_default();
    let matches = |value: &str| !value.is_empty() && norm(value) == wanted;
    let exact: Vec<usize> = projects
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            p.id.as_deref().is_some_and(matches) || matches(&p.name) || matches(&p.dir)
        })
        .map(|(i, _)| i)
        .collect();
    let found = if exact.is_empty() {
        projects
            .iter()
            .enumerate()
            .filter(|(_, p)| !wanted.is_empty() && norm(&p.name).contains(&wanted))
            .map(|(i, _)| i)
            .collect()
    } else {
        exact
    };
    if let [only] = found.as_slice() {
        return Ok(*only);
    }
    let names = projects
        .iter()
        .map(|p| p.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let problem = if found.is_empty() {
        format!("No project matches '{wanted}'")
    } else {
        format!("'{wanted}' matches more than one project")
    };
    Err(format!("{problem}. Projects: {names}."))
}

/// JS `value.trim().toLowerCase().replace(/\s+/g, " ")`: trimmed, lowercased, whitespace runs
/// folded to one space.
#[must_use]
pub fn norm(value: &str) -> String {
    let lowered = value.trim_matches(is_js_space).to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut in_space = false;
    for c in lowered.chars() {
        if is_js_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// The characters JS `\s` matches. Rust's `char::is_whitespace` differs (it has U+0085 and not
/// U+FEFF), so the list is spelled out.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: Option<&str>, name: &str, dir: &str) -> ProjectRef {
        ProjectRef {
            id: id.map(str::to_owned),
            name: name.to_owned(),
            dir: dir.to_owned(),
        }
    }

    #[test]
    fn norm_trims_lowercases_and_folds_whitespace() {
        assert_eq!(norm("  My   Thesis\tDraft \n"), "my thesis draft");
        assert_eq!(norm(""), "");
        assert_eq!(norm("   "), "");
        assert_eq!(norm("Ünïcode  NAME"), "ünïcode name");
        assert_eq!(norm("\u{feff}x\u{85}"), "x\u{85}");
    }

    #[test]
    fn exact_id_name_or_folder_wins() {
        let projects = [
            project(Some("p1"), "Alpha", "alpha--p1"),
            project(None, "Beta", "beta"),
        ];
        assert_eq!(pick_project(&projects, Some("P1")), Ok(0));
        assert_eq!(pick_project(&projects, Some("  beta ")), Ok(1));
        assert_eq!(pick_project(&projects, Some("alpha--P1")), Ok(0));
    }

    #[test]
    fn a_unique_partial_name_is_picked() {
        let projects = [
            project(None, "My  Thesis", "projects/my-thesis"),
            project(None, "Other", "o"),
        ];
        assert_eq!(pick_project(&projects, Some("  my thesis ")), Ok(0));
        assert_eq!(pick_project(&projects, Some("thes")), Ok(0));
    }

    #[test]
    fn an_ambiguous_partial_name_names_the_problem() {
        let projects = [
            project(None, "Draft one", "a"),
            project(None, "Draft two", "b"),
        ];
        assert_eq!(
            pick_project(&projects, Some("draft")),
            Err(
                "'draft' matches more than one project. Projects: Draft one, Draft two.".to_owned()
            )
        );
    }

    #[test]
    fn a_miss_lists_the_projects() {
        let projects = [project(None, "Alpha", "a")];
        assert_eq!(
            pick_project(&projects, Some("zeta")),
            Err("No project matches 'zeta'. Projects: Alpha.".to_owned())
        );
        assert_eq!(
            pick_project(&projects, None),
            Err("No project matches ''. Projects: Alpha.".to_owned())
        );
    }

    #[test]
    fn an_empty_needle_matches_only_a_blank_value() {
        let blank = [project(None, "   ", "x")];
        assert_eq!(pick_project(&blank, Some("")), Ok(0));
        let named = [project(None, "Alpha", "a")];
        assert!(pick_project(&named, Some("")).is_err());
    }
}

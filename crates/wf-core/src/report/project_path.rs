//! Normalizes paths inside a report project. Port of
//! `packages/core/src/features/report/domain/project-path.ts`.

/// A path inside a report project, written the one way: `/` separators, no `.`
/// parts, `..` folded in.
///
/// # Errors
///
/// Returns `None` for a path that climbs out of the project.
#[must_use]
pub fn normalize_project_path(path: &str) -> Option<String> {
    let slashed = path.replace('\\', "/");
    let mut normalized: Vec<&str> = Vec::new();
    for part in slashed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            let _ = normalized.pop()?;
        } else {
            normalized.push(part);
        }
    }
    Some(normalized.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_empty_and_dot_parts() {
        assert_eq!(
            normalize_project_path("./a//b/./c.bib"),
            Some("a/b/c.bib".to_owned())
        );
    }

    #[test]
    fn folds_parent_segments() {
        assert_eq!(
            normalize_project_path("sub/../refs.bib"),
            Some("refs.bib".to_owned())
        );
    }

    #[test]
    fn accepts_backslash_separators() {
        assert_eq!(
            normalize_project_path("sub\\more.bib"),
            Some("sub/more.bib".to_owned())
        );
    }

    #[test]
    fn rejects_a_path_that_climbs_out() {
        assert_eq!(normalize_project_path("../refs.bib"), None);
        assert_eq!(normalize_project_path("a/../../x"), None);
    }

    #[test]
    fn dot_alone_is_the_project_root() {
        assert_eq!(normalize_project_path("./"), Some(String::new()));
    }
}

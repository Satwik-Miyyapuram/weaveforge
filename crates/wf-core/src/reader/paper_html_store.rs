//! Where kept paper pages go in the workspace folder. The file's own path is
//! `papers/html/<paperId>.html` (`sync::folder_layout::paper_html_path`); this module adds the
//! directory the store creates before writing it. The IndexedDB rows and the file I/O stay in TS
//! (`apps/web/src/features/reader/infrastructure/paper-html-store.ts`).

use crate::sync::folder_layout::{WorkspaceEntityType, entity_dir};

/// The folder kept paper pages are written to: `papers/html` inside a project.
#[must_use]
pub fn paper_html_dir(project_root: &str) -> String {
    format!(
        "{}/html",
        entity_dir(WorkspaceEntityType::Paper, project_root)
    )
}

#[cfg(test)]
mod tests {
    use super::paper_html_dir;
    use crate::sync::folder_layout::paper_html_path;

    #[test]
    fn dir_is_papers_html_at_the_root_or_inside_a_project() {
        assert_eq!(paper_html_dir(""), "papers/html");
        assert_eq!(paper_html_dir("p"), "p/papers/html");
    }

    #[test]
    fn each_kept_page_file_sits_directly_in_that_dir() {
        let file = paper_html_path("id1", "p");
        assert_eq!(file, "p/papers/html/id1.html");
        assert_eq!(
            file.rsplit_once('/').map(|(dir, _)| dir),
            Some(paper_html_dir("p").as_str())
        );
    }
}

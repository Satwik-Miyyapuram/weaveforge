//! Which top-level folders a folder import preview reads (TS `readsFolder` in
//! `apps/web/src/features/workspace/application/folder-preview-read.ts`). Pure: the
//! caller lists the folder and reads what this says to read.

use super::folder_layout::{ASSET_DIR, WORKSPACE_META_DIR};

/// Whether a top-level folder can hold anything the preview reads. Git's own folder
/// never can. A folder that is the project's own, or the shared assets, is always read.
/// When the connected folder has a project folder, nothing else is read. A legacy flat
/// folder reads everything except the metadata folder and other projects' folders.
#[must_use]
pub fn reads_folder(name: &str, project_root: &str, has_project_dir: bool) -> bool {
    if name == ".git" {
        return false;
    }
    if name == project_root || name == ASSET_DIR {
        return true;
    }
    if has_project_dir {
        return false;
    }
    name != WORKSPACE_META_DIR && !is_project_folder(name)
}

/// A top-level `<slug>--<id>` folder: a slug of at least one character, then `--`, then
/// 1 to 8 ASCII alphanumerics (JS `/^[^/]+--[a-zA-Z0-9]{1,8}$/`). The id has no dash, so
/// only the last `--` can qualify.
fn is_project_folder(name: &str) -> bool {
    match name.rfind("--") {
        Some(at) if at >= 1 => {
            let tail = &name[at + 2..];
            (1..=8).contains(&tail.len()) && tail.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{is_project_folder, reads_folder};

    #[test]
    fn git_folder_is_never_read() {
        assert!(!reads_folder(".git", "notes--ab12cd", false));
        assert!(!reads_folder(".git", ".git", true));
    }

    #[test]
    fn own_project_and_assets_are_always_read() {
        assert!(reads_folder("notes--ab12cd", "notes--ab12cd", true));
        assert!(reads_folder("notes--ab12cd", "notes--ab12cd", false));
        assert!(reads_folder("assets", "notes--ab12cd", true));
        assert!(reads_folder("assets", "notes--ab12cd", false));
    }

    #[test]
    fn project_folder_only_reads_its_own() {
        assert!(!reads_folder("papers", "notes--ab12cd", true));
        assert!(!reads_folder("other--zz99zz", "notes--ab12cd", true));
    }

    #[test]
    fn legacy_flat_folder_skips_metadata_and_other_projects() {
        assert!(reads_folder("papers", "notes--ab12cd", false));
        assert!(!reads_folder(".weaveforge", "notes--ab12cd", false));
        assert!(!reads_folder("other--zz99zz", "notes--ab12cd", false));
    }

    #[test]
    fn project_folder_shape_matches_the_js_pattern() {
        assert!(is_project_folder("a--b"));
        assert!(is_project_folder("a--ABCDEFGH"));
        assert!(is_project_folder("a---abc"));
        assert!(!is_project_folder("--ab12"));
        assert!(!is_project_folder("a--"));
        assert!(!is_project_folder("a--123456789"));
        assert!(!is_project_folder("a--b-c"));
        assert!(!is_project_folder("plain"));
    }
}

//! Project folder names without a project list (TS `apps/shell/sidecar/src/local-mcp-projects.ts`, the
//! `PROJECT_FOLDER` pattern). A project's folder ends in `--` and up to six letters or digits (its id
//! suffix); the MCP reads the name from the folder alone when the app's project list is not open.

/// The project name a folder stands for: the folder minus a trailing `--xxxxxx` id suffix, where the
/// suffix is 1 to 6 ASCII letters or digits (either case). `None` when the folder carries no suffix.
/// Matches TS `/--[a-z0-9]{1,6}$/i` and the `replace` that strips it.
#[must_use]
pub fn project_folder_name(dir: &str) -> Option<&str> {
    let at = dir.rfind("--")?;
    let suffix = &dir[at + 2..];
    let valid =
        (1..=6).contains(&suffix.len()) && suffix.chars().all(|c| c.is_ascii_alphanumeric());
    valid.then(|| &dir[..at])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_a_six_character_id_suffix() {
        assert_eq!(project_folder_name("Thesis--a1b2c3"), Some("Thesis"));
    }

    #[test]
    fn accepts_one_to_six_characters_in_either_case() {
        assert_eq!(project_folder_name("Notes--A"), Some("Notes"));
        assert_eq!(project_folder_name("Notes--ABCDEF"), Some("Notes"));
    }

    #[test]
    fn rejects_folders_without_a_valid_suffix() {
        assert_eq!(project_folder_name("Notes"), None);
        assert_eq!(project_folder_name("Notes--"), None);
        assert_eq!(project_folder_name("Notes--ABCDEFG"), None);
        assert_eq!(project_folder_name("Notes--a_b"), None);
        assert_eq!(project_folder_name("Notes-a1"), None);
    }

    #[test]
    fn uses_the_last_double_dash() {
        assert_eq!(project_folder_name("a--b--c1"), Some("a--b"));
        assert_eq!(project_folder_name("a--b--c-1"), None);
    }
}

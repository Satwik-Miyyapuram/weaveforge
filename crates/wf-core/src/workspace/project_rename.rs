//! Which folder a renamed project's files come from (`followProjectRename` in
//! `apps/web/src/features/workspace/application/parts-3.ts`).
//!
//! A renamed project keeps its id, so its old folder ends with the same `--id6` tail as the
//! new name. Listing, moving and rekeying the manifest stay in TypeScript and Rust
//! `folder_mirror`; this is only the pick.

/// The one directory whose name ends with `tail`, or `None` when there are none or several
/// (two folders sharing an id suffix have no safe pick).
#[must_use]
pub fn pick_renamed_folder(dirs: &[String], tail: &str) -> Option<String> {
    let mut found = dirs.iter().filter(|dir| dir.ends_with(tail));
    let first = found.next()?;
    if found.next().is_some() {
        return None;
    }
    Some(first.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    // it: "a renamed project carries its folder and manifest to the new name"
    #[test]
    fn a_renamed_project_picks_its_old_folder_by_id_tail() {
        let found = pick_renamed_folder(&dirs(&["old-name--abc123", "other--zzz999"]), "--abc123");
        assert_eq!(found.as_deref(), Some("old-name--abc123"));
    }

    // Rust-only: with no candidate folder there is nothing to pick.
    #[test]
    fn no_candidate_folder_picks_nothing() {
        assert_eq!(pick_renamed_folder(&dirs(&["other--zzz999"]), "--abc123"), None);
    }

    // it: "following a rename leaves two candidate folders alone"
    #[test]
    fn two_candidate_folders_pick_nothing() {
        let names = dirs(&["a--abc123", "b--abc123"]);
        assert_eq!(pick_renamed_folder(&names, "--abc123"), None);
    }
}

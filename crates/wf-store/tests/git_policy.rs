#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for `wf_store::git::policy`: which paths enter folder history and when a folder may be committed to.

use wf_store::git::policy::{
    CommitAction, FileState, GIT_OFF, IGNORED_DIRS, IGNORED_EXTENSIONS, IGNORED_FILES,
    MAX_FILE_BYTES, RepoState, SkipReason, decide_commit, decide_path, describe_changes,
    is_under_ignored_folder,
};

const MB: u64 = 1024 * 1024;
const SMALL: u64 = 1024;

fn decide(path: &str) -> Result<(), SkipReason> {
    decide_path(path, Some(SMALL), MAX_FILE_BYTES)
}

fn included(path: &str) -> bool {
    decide(path).is_ok()
}

fn reason_for(path: &str) -> SkipReason {
    decide(path).unwrap_err()
}

#[test]
fn the_size_cap_is_25_mb_and_the_ignore_lists_are_as_specified() {
    assert_eq!(MAX_FILE_BYTES, 25 * MB);
    assert_eq!(IGNORED_DIRS.len(), 9);
    assert_eq!(IGNORED_FILES, ["desktop.ini"]);
    assert_eq!(
        IGNORED_EXTENSIONS,
        [".aux", ".fdb_latexmk", ".fls", ".synctex.gz"]
    );
}

#[test]
fn ordinary_notes_latex_and_markdown_are_synced() {
    for path in [
        "notes/a.note.md",
        "report/main.tex",
        "papers/attention.paper.md",
        "logbook/2026-10-29.md",
    ] {
        assert!(included(path), "{path}");
    }
}

#[test]
fn generic_user_folder_names_are_synced_so_a_notes_folder_called_build_or_out_keeps_syncing() {
    for path in [
        "build/plan.md",
        "notes/out/x.html",
        "notes/caches/readme.md",
        "caches/thumb.png",
    ] {
        assert!(included(path), "{path}");
    }
}

#[test]
fn dependency_folders_are_ignored_at_any_depth() {
    assert_eq!(
        reason_for("node_modules/left-pad/index.js"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(
        reason_for("notes/tools/node_modules/a.js"),
        SkipReason::IgnoredDirectory
    );
}

#[test]
fn nested_git_directories_and_files_are_ignored_so_no_repo_is_committed_inside_the_repo() {
    assert_eq!(
        reason_for("papers/sub/.git/config"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(reason_for("notes/.git"), SkipReason::IgnoredDirectory);
    assert_eq!(reason_for(".git/HEAD"), SkipReason::IgnoredDirectory);
}

#[test]
fn build_outputs_and_framework_caches_are_ignored() {
    for path in [
        "dist/app.js",
        "apps/web/.next/cache/x.pack",
        ".cache/x",
        "notes/.cache/y",
    ] {
        assert_eq!(reason_for(path), SkipReason::IgnoredDirectory, "{path}");
    }
}

#[test]
fn pdf_and_other_render_caches_are_ignored() {
    assert_eq!(
        reason_for("pdf-cache/abc.bin"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(
        reason_for("notes/pdf-cache/abc.bin"),
        SkipReason::IgnoredDirectory
    );
}

#[test]
fn folder_names_are_matched_case_insensitively_as_windows_folders_are() {
    assert_eq!(
        reason_for("Node_Modules/a.js"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(reason_for("DIST/app.js"), SkipReason::IgnoredDirectory);
    assert_eq!(
        reason_for("notes/.GIT/config"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(reason_for("NODE_MODULES/x"), SkipReason::IgnoredDirectory);
}

#[test]
fn file_names_are_matched_case_insensitively() {
    assert_eq!(reason_for("Desktop.ini"), SkipReason::IgnoredFile);
    assert_eq!(reason_for("notes/DESKTOP.INI"), SkipReason::IgnoredFile);
}

#[test]
fn latex_build_byproducts_are_ignored_by_extension() {
    for ext in IGNORED_EXTENSIONS {
        assert_eq!(
            reason_for(&format!("report/main{ext}")),
            SkipReason::IgnoredFile,
            "{ext}"
        );
    }
    assert!(included("report/main.tex"));
}

#[test]
fn extensions_are_matched_case_insensitively() {
    assert_eq!(reason_for("paper.SYNCTEX.GZ"), SkipReason::IgnoredFile);
}

#[test]
fn the_root_weaveforge_folder_is_this_machines_database_and_is_never_synced() {
    assert_eq!(
        reason_for(".weaveforge/workspace.db"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(
        reason_for("/.weaveforge/workspace.db"),
        SkipReason::IgnoredDirectory
    );
}

#[test]
fn a_weaveforge_folder_below_the_root_is_not_the_apps_folder_and_is_left_to_the_size_cap() {
    assert!(included("notes/.weaveforge/readme.md"));
    assert!(included("notes/.weaveforge/a.md"));
    assert_eq!(reason_for(".weaveforge/a.md"), SkipReason::IgnoredDirectory);
    assert_eq!(reason_for("./.weaveforge/a"), SkipReason::IgnoredDirectory);
}

#[test]
fn desktop_ini_is_ignored_wherever_it_appears() {
    assert_eq!(reason_for("desktop.ini"), SkipReason::IgnoredFile);
    assert_eq!(reason_for("notes/desktop.ini"), SkipReason::IgnoredFile);
}

#[test]
fn a_file_named_like_an_ignored_folder_is_synced_only_paths_through_such_a_folder_are_ignored() {
    assert!(included("notes/dist"));
    assert!(included("notes/node_modules"));
    assert_eq!(reason_for("notes/dist/x.md"), SkipReason::IgnoredDirectory);
}

#[test]
fn backslash_paths_from_windows_are_matched_the_same_as_slash_paths() {
    assert_eq!(
        reason_for("notes\\node_modules\\a.md"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(
        reason_for("notes\\.git\\config"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(
        reason_for("notes\\dist\\a.md"),
        SkipReason::IgnoredDirectory
    );
    assert!(included("notes\\a.md"));
}

#[test]
fn a_leading_slash_or_dot_slash_does_not_hide_an_ignored_folder() {
    assert_eq!(
        reason_for("/node_modules/a.js"),
        SkipReason::IgnoredDirectory
    );
    assert_eq!(reason_for("./dist/a.js"), SkipReason::IgnoredDirectory);
}

#[test]
fn an_empty_or_dot_path_is_an_invalid_path_not_an_ignored_file() {
    assert_eq!(reason_for(""), SkipReason::InvalidPath);
    assert_eq!(reason_for("."), SkipReason::InvalidPath);
    assert_eq!(reason_for("./"), SkipReason::InvalidPath);
    assert_eq!(reason_for("/"), SkipReason::InvalidPath);
}

#[test]
fn size_exactly_the_cap_is_kept_one_byte_over_is_skipped_as_too_large() {
    assert_eq!(
        decide_path("papers/scan.pdf", Some(MAX_FILE_BYTES), MAX_FILE_BYTES),
        Ok(())
    );
    assert_eq!(
        decide_path("papers/scan.pdf", Some(MAX_FILE_BYTES + 1), MAX_FILE_BYTES),
        Err(SkipReason::TooLarge)
    );
}

#[test]
fn size_a_cap_can_be_passed_in_so_the_rule_is_testable_without_a_25_mb_fixture() {
    assert_eq!(
        decide_path("notes/a.md", Some(11), 10),
        Err(SkipReason::TooLarge)
    );
    assert_eq!(decide_path("notes/a.md", Some(10), 10), Ok(()));
}

#[test]
fn size_an_empty_file_is_kept() {
    assert_eq!(
        decide_path("notes/empty.md", Some(0), MAX_FILE_BYTES),
        Ok(())
    );
}

#[test]
fn size_an_unknown_size_is_not_trusted_so_the_file_is_skipped() {
    assert_eq!(
        decide_path("notes/a.md", None, MAX_FILE_BYTES),
        Err(SkipReason::TooLarge)
    );
}

#[test]
fn ignore_rules_win_over_size_an_ignored_path_is_reported_as_ignored_even_when_huge() {
    assert_eq!(
        decide_path("node_modules/big.bin", Some(100 * MB), MAX_FILE_BYTES),
        Err(SkipReason::IgnoredDirectory)
    );
}

#[test]
fn is_under_ignored_folder_is_true_only_for_paths_below_an_ignored_folder() {
    assert!(is_under_ignored_folder("node_modules/left-pad/index.js"));
    assert!(is_under_ignored_folder("node_modules/left-pad"));
    assert!(!is_under_ignored_folder("node_modules"));
    assert!(!is_under_ignored_folder("notes/dist"));
    assert!(!is_under_ignored_folder("notes/a.md"));
    assert!(is_under_ignored_folder(".weaveforge/x.db"));
}

#[test]
fn describe_changes_on_an_empty_list_says_no_changes() {
    assert_eq!(describe_changes(&[]), "No changes");
}

#[test]
fn describe_changes_with_only_deleted_says_one_removed() {
    assert_eq!(describe_changes(&[FileState::Deleted]), "1 removed");
}

#[test]
fn describe_changes_lists_counts_in_fixed_order_whatever_the_input_order() {
    let states = [
        FileState::Deleted,
        FileState::Modified,
        FileState::Added,
        FileState::Added,
    ];
    assert_eq!(describe_changes(&states), "2 added, 1 changed, 1 removed");
    assert_eq!(
        describe_changes(&[FileState::Modified, FileState::Added]),
        "1 added, 1 changed"
    );
}

#[test]
fn nothing_is_committed_while_the_setting_is_off() {
    for state in [RepoState::Own, RepoState::None] {
        assert_eq!(decide_commit(false, &state), Err(GIT_OFF.to_owned()));
    }
    assert_eq!(
        decide_commit(
            false,
            &RepoState::Enclosing {
                root: "/home/me/thesis".to_owned()
            }
        ),
        Err(GIT_OFF.to_owned())
    );
}

#[test]
fn off_text_is_exact() {
    assert_eq!(GIT_OFF, "Folder history is switched off.");
}

#[test]
fn a_folder_that_is_its_own_repository_is_committed_to() {
    assert_eq!(
        decide_commit(true, &RepoState::Own),
        Ok(CommitAction::Commit)
    );
}

#[test]
fn a_folder_with_no_repository_gets_one() {
    assert_eq!(
        decide_commit(true, &RepoState::None),
        Ok(CommitAction::Init)
    );
}

#[test]
fn a_folder_inside_someone_elses_repository_is_refused_and_says_whose() {
    let verdict = decide_commit(
        true,
        &RepoState::Enclosing {
            root: "/home/me/thesis".to_owned(),
        },
    );
    assert_eq!(
        verdict,
        Err(
            "This folder is inside the repository at /home/me/thesis, so WeaveForge will not commit here."
                .to_owned()
        )
    );
}

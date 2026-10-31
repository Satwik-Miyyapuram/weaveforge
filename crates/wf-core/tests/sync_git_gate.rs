//! Ported and property tests for `sync::git_gate` and `sync::stamp_workspace_id`.
//! Cases come from `packages/core/test/workspace/{git-gate,stamp-workspace-id}.test.ts`.
//! The TS round-trip through `parseWorkspaceFile` is not ported: the workspace
//! parser is not in the Rust crate yet.

use proptest::prelude::*;
use wf_core::sync::git_gate::{
    GIT_OFF, GitAction, GitVerdict, VaultRepoState, decide_vault_commit,
};
use wf_core::sync::stamp_workspace_id::stamp_workspace_id;

#[test]
fn nothing_is_committed_while_the_setting_is_off() {
    for state in [VaultRepoState::Own, VaultRepoState::None] {
        assert_eq!(
            decide_vault_commit(false, &state),
            GitVerdict::Refused {
                reason: GIT_OFF.to_owned()
            },
            "state {state:?}"
        );
    }
}

#[test]
fn a_folder_that_is_its_own_repository_is_committed_to() {
    assert_eq!(
        decide_vault_commit(true, &VaultRepoState::Own),
        GitVerdict::Allowed(GitAction::Commit)
    );
}

#[test]
fn a_folder_with_no_repository_gets_one() {
    assert_eq!(
        decide_vault_commit(true, &VaultRepoState::None),
        GitVerdict::Allowed(GitAction::Init)
    );
}

#[test]
fn a_folder_inside_someone_elses_repository_is_refused_and_says_whose() {
    let state = VaultRepoState::Enclosing {
        root: "/home/me/thesis".to_owned(),
    };
    let GitVerdict::Refused { reason } = decide_vault_commit(true, &state) else {
        panic!("expected refusal for {state:?}");
    };
    assert!(reason.contains("/home/me/thesis"), "reason was {reason:?}");
}

#[test]
fn a_hand_written_file_with_frontmatter_keeps_it_plus_an_id() {
    let stamped = stamp_workspace_id("---\ntitle: My idea\ntags:\n  - a\n---\n\nthe body\n", "n1");
    assert_eq!(
        stamped.as_deref(),
        Some("---\nweaveforge-id: n1\ntitle: My idea\ntags:\n  - a\n---\n\nthe body\n")
    );
}

#[test]
fn a_file_with_no_frontmatter_gets_one_and_keeps_every_word_of_its_body() {
    let stamped = stamp_workspace_id("# My idea\n\nthe body\n", "n1");
    assert_eq!(
        stamped.as_deref(),
        Some("---\nweaveforge-id: n1\n---\n\n# My idea\n\nthe body\n")
    );
}

#[test]
fn a_file_that_already_claims_an_id_is_left_alone() {
    let content = "---\nweaveforge-id: n9\ntitle: Mine\n---\n\nbody\n";
    assert_eq!(stamp_workspace_id(content, "n1"), None);
}

#[test]
fn an_unclosed_fence_is_body_not_frontmatter_to_edit() {
    let stamped = stamp_workspace_id("---\nnot really frontmatter\n", "n1");
    let stamped = stamped.expect("unclosed fence is stamped as body");
    assert!(
        stamped.starts_with("---\nweaveforge-id: n1\n---\n\n---\n"),
        "got {stamped:?}"
    );
}

#[test]
fn crlf_stays_crlf() {
    let stamped = stamp_workspace_id("---\r\ntitle: Mine\r\n---\r\n\r\nbody\r\n", "n1");
    let stamped = stamped.expect("CRLF file is stamped");
    assert_eq!(
        stamped,
        "---\r\nweaveforge-id: n1\r\ntitle: Mine\r\n---\r\n\r\nbody\r\n"
    );
    assert!(!stamped.contains("\n\n"));
}

#[test]
fn a_bom_prefixed_file_gets_new_frontmatter_in_front_as_in_the_ts() {
    // The TS does not look past a byte-order mark, so the existing block is
    // treated as body. Matched on purpose; plan §10 tracks the fix.
    let bom = "\u{feff}";
    assert_eq!(
        stamp_workspace_id(&format!("{bom}---\ntitle: Mine\n---\n\nbody\n"), "n1").as_deref(),
        Some(
            format!("---\nweaveforge-id: n1\n---\n\n{bom}---\ntitle: Mine\n---\n\nbody\n").as_str()
        )
    );
    assert_eq!(
        stamp_workspace_id(&format!("{bom}# Idea\n"), "n1").as_deref(),
        Some(format!("---\nweaveforge-id: n1\n---\n\n{bom}# Idea\n").as_str())
    );
}

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn stamping_twice_equals_stamping_once_or_both_none(
        content in "\u{feff}?(---\r?\n)?[a-z :\n\r-]{0,40}",
        id in "[a-z0-9]{1,8}",
    ) {
        let once = stamp_workspace_id(&content, &id).unwrap_or_else(|| content.clone());
        let twice = stamp_workspace_id(&once, &id).unwrap_or_else(|| once.clone());
        prop_assert_eq!(twice, once);
    }
}

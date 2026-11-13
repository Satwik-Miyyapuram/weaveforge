#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::HashMap;

use wf_core::sync::change_origin::digest_text;
use wf_core::sync::folder_layout::{folder_title_from_path, pick_project_folder};
use wf_core::sync::folder_mirror::json_edit_since;

#[test]
fn title_drops_md_kind_and_id_suffix() {
    assert_eq!(folder_title_from_path("notes/My idea.md"), "My idea");
    assert_eq!(
        folder_title_from_path("notes/My idea--ab12cd.md"),
        "My idea"
    );
    assert_eq!(folder_title_from_path("a/b--ab12cd.note"), "b");
    assert_eq!(folder_title_from_path("x.ink"), "x");
    assert_eq!(folder_title_from_path("Plain"), "Plain");
}

#[test]
fn title_strips_only_the_last_id_suffix() {
    assert_eq!(folder_title_from_path("a--x--ab12.md"), "a--x");
}

#[test]
fn title_keeps_a_dashed_or_long_tail() {
    // Tail has a dash, so it is not an id.
    assert_eq!(folder_title_from_path("a--b-c.md"), "a--b-c");
    // Nine alphanumerics: over the 1 to 8 limit.
    assert_eq!(
        folder_title_from_path("a--toolongsuffix.md"),
        "a--toolongsuffix"
    );
}

#[test]
fn title_trims_and_falls_back_to_untitled() {
    assert_eq!(folder_title_from_path("notes/  spaced  .md"), "spaced");
    assert_eq!(folder_title_from_path("--abc"), "Untitled");
    assert_eq!(folder_title_from_path("dir/   .md"), "Untitled");
    assert_eq!(folder_title_from_path(""), "Untitled");
}

#[test]
fn pick_prefers_the_exact_folder() {
    let dirs = vec!["Alpha--ab12cd".to_owned(), "Alpha".to_owned()];
    assert_eq!(
        pick_project_folder(&dirs, "Alpha", "--ab12cd"),
        Some("Alpha".to_owned())
    );
}

#[test]
fn pick_takes_the_single_suffix_match() {
    let dirs = vec!["Renamed--ab12cd".to_owned(), "Other".to_owned()];
    assert_eq!(
        pick_project_folder(&dirs, "Alpha", "--ab12cd"),
        Some("Renamed--ab12cd".to_owned())
    );
}

#[test]
fn pick_refuses_two_suffix_matches_or_none() {
    let two = vec!["One--ab12cd".to_owned(), "Two--ab12cd".to_owned()];
    assert_eq!(pick_project_folder(&two, "Alpha", "--ab12cd"), None);
    let none = vec!["Other".to_owned()];
    assert_eq!(pick_project_folder(&none, "Alpha", "--ab12cd"), None);
}

#[test]
fn json_edit_since_is_true_without_a_record() {
    let base: HashMap<String, String> = HashMap::new();
    assert!(json_edit_since(&base, "relations.json", "[]"));
}

#[test]
fn json_edit_since_is_false_when_the_digest_matches() {
    let text = "[{\"id\":\"r1\"}]";
    let mut base = HashMap::new();
    let _ = base.insert("relations.json".to_owned(), digest_text(text));
    assert!(!json_edit_since(&base, "relations.json", text));
    assert!(json_edit_since(&base, "relations.json", "[]"));
}

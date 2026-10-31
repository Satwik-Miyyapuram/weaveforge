//! Ported tests for `sync::merge_vault_page`. Ports
//! `packages/core/test/workspace/merge-vault-page.test.ts` (8 cases) plus the
//! `vault_page_base` / `vault_page_side` checks.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use serde_json::{Map, Value, json};
use wf_core::sync::change_origin::digest_text;
use wf_core::sync::merge::Conflict;
use wf_core::sync::merge_vault_page::{
    VaultPageBase, VaultPageSide, merge_vault_page, vault_page_base, vault_page_side,
};

fn fields(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("not a row: {other}"),
    }
}

fn side(value: Value, body: &str) -> VaultPageSide {
    VaultPageSide {
        fields: fields(value),
        body: body.to_owned(),
    }
}

fn base() -> VaultPageBase {
    VaultPageBase {
        fields: fields(json!({"title": "Draft", "tags": ["a"], "status": "open"})),
        body_digest: digest_text("the original body"),
    }
}

fn unchanged() -> VaultPageSide {
    side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "the original body",
    )
}

fn conflict(field: &str, base: Value, local: Value, remote: Value) -> Conflict {
    Conflict {
        field: field.to_owned(),
        base,
        local,
        remote,
    }
}

#[test]
fn a_tag_added_out_there_and_a_paragraph_rewritten_in_here_both_survive() {
    let base = base();
    let folder = side(
        json!({"title": "Draft", "tags": ["a", "b"], "status": "open"}),
        "the original body",
    );
    let workspace = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "a rewritten body",
    );

    let merged = merge_vault_page(&base, &folder, &workspace);

    assert!(merged.conflicts.is_empty());
    assert_eq!(merged.fields["tags"], json!(["a", "b"]));
    assert_eq!(merged.body, "a rewritten body");
}

#[test]
fn a_body_only_the_folder_changed_is_taken_from_the_folder() {
    let base = base();
    let folder = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "edited in Obsidian",
    );

    let merged = merge_vault_page(&base, &folder, &unchanged());

    assert!(merged.conflicts.is_empty());
    assert_eq!(merged.body, "edited in Obsidian");
}

#[test]
fn a_body_neither_side_changed_stays_put() {
    let base = base();

    let merged = merge_vault_page(&base, &unchanged(), &unchanged());

    assert!(merged.conflicts.is_empty());
    assert_eq!(merged.body, "the original body");
}

#[test]
fn both_sides_writing_the_same_new_body_is_agreement_not_a_conflict() {
    let base = base();
    let folder = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "same new text",
    );
    let workspace = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "same new text",
    );

    let merged = merge_vault_page(&base, &folder, &workspace);

    assert!(merged.conflicts.is_empty());
    assert_eq!(merged.body, "same new text");
}

#[test]
fn a_body_both_sides_rewrote_differently_is_left_for_a_person() {
    let base = base();
    let folder = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "their rewrite",
    );
    let workspace = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "our rewrite",
    );

    let merged = merge_vault_page(&base, &folder, &workspace);

    assert_eq!(merged.conflicts.len(), 1);
    let found = &merged.conflicts[0];
    assert_eq!(found.field, "body");
    assert_eq!(found.base, Value::String(base.body_digest.clone()));
    assert_eq!(found.local, Value::String(digest_text("their rewrite")));
    assert_eq!(found.remote, Value::String(digest_text("our rewrite")));
    // Unsettled keeps what the app already has, as everywhere else here.
    assert_eq!(merged.body, "our rewrite");
}

#[test]
fn a_field_both_sides_moved_differently_is_reported_with_all_three_sides() {
    let base = base();
    let folder = side(
        json!({"title": "Draft", "tags": ["a"], "status": "done"}),
        "the original body",
    );
    let workspace = side(
        json!({"title": "Draft", "tags": ["a"], "status": "archived"}),
        "the original body",
    );

    let merged = merge_vault_page(&base, &folder, &workspace);

    assert_eq!(
        merged.conflicts,
        vec![conflict(
            "status",
            json!("open"),
            json!("done"),
            json!("archived")
        )]
    );
    assert_eq!(merged.fields["status"], json!("archived"));
}

#[test]
fn field_and_body_conflicts_are_reported_together() {
    let base = base();
    let folder = side(
        json!({"title": "Draft", "tags": ["a"], "status": "done"}),
        "their rewrite",
    );
    let workspace = side(
        json!({"title": "Draft", "tags": ["a"], "status": "archived"}),
        "our rewrite",
    );

    let merged = merge_vault_page(&base, &folder, &workspace);

    let fields_in_order: Vec<&str> = merged.conflicts.iter().map(|c| c.field.as_str()).collect();
    assert_eq!(fields_in_order, vec!["status", "body"]);
}

#[test]
fn a_base_with_no_known_body_digest_treats_the_body_as_changed_on_both_sides() {
    // What a version 1 manifest yields. It must not read as "nobody touched it".
    let base = VaultPageBase {
        fields: base().fields,
        body_digest: String::new(),
    };
    let folder = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "theirs",
    );
    let workspace = side(
        json!({"title": "Draft", "tags": ["a"], "status": "open"}),
        "ours",
    );

    let merged = merge_vault_page(&base, &folder, &workspace);

    let fields_in_order: Vec<&str> = merged.conflicts.iter().map(|c| c.field.as_str()).collect();
    assert_eq!(fields_in_order, vec!["body"]);
}

const VAULT_NOTE: &str = "---\nweaveforge-id: note-1\nweaveforge-type: vault_page\ntitle: Draft\ntags: [a, b]\n---\n\nBody text here.\n";

#[test]
fn vault_page_base_reads_a_vault_note_with_title_and_digest() {
    let base = vault_page_base("Notes/Draft.md", VAULT_NOTE).expect("vault page base");
    let side = vault_page_side("Notes/Draft.md", VAULT_NOTE).expect("vault page side");

    assert_eq!(base.fields["title"], json!("Draft"));
    assert_eq!(base.fields["tags"], json!(["a", "b"]));
    assert_eq!(base.body_digest, digest_text(&side.body));
    assert_eq!(side.fields["title"], json!("Draft"));
    assert_eq!(side.fields["tags"], json!(["a", "b"]));
}

#[test]
fn vault_page_side_keeps_the_body_text() {
    let side = vault_page_side("Notes/Draft.md", VAULT_NOTE).expect("vault page side");
    assert!(side.body.contains("Body text here."));
}

#[test]
fn vault_page_base_and_side_return_none_for_a_paper_file() {
    let paper =
        "---\nweaveforge-id: paper-1\nweaveforge-type: paper\ntitle: A paper\n---\n\nAbstract.\n";
    assert!(vault_page_base("papers/A paper.md", paper).is_none());
    assert!(vault_page_side("papers/A paper.md", paper).is_none());
}

#[test]
fn vault_page_base_and_side_return_none_for_a_readme() {
    assert!(vault_page_base("README.md", VAULT_NOTE).is_none());
    assert!(vault_page_side("README.md", VAULT_NOTE).is_none());
}

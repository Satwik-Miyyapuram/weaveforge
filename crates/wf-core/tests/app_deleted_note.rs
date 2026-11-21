//! A note deleted in the app may leave its file in the folder (the move to the
//! trash failed). The next folder import must not offer it back as a new note,
//! while a file someone added outside the app still imports as one.

use serde_json::Map;
use wf_core::sync::change_origin::{ChangeOrigin, ChangeSide, changed_side};
use wf_core::sync::deserialize::{ParsedEntity, diff_workspace};
use wf_core::sync::folder_layout::WorkspaceEntityType;
use wf_core::sync::import_action::ImportAction;

fn note_file(path: &str) -> ParsedEntity {
    ParsedEntity {
        id: Some("n1".to_owned()),
        entity_type: WorkspaceEntityType::VaultPage,
        title: "Deleted".to_owned(),
        body: "gone in the app".to_owned(),
        path: path.to_owned(),
        fields: Map::new(),
        kind: None,
        canvas_map_broken: false,
    }
}

fn import_action(origin: ChangeOrigin<'_>) -> ImportAction {
    let side = changed_side(origin);
    let by_path: &dyn Fn(&str) -> ChangeSide = &|_| side;
    let diff = diff_workspace(&[note_file("notes/Deleted.md")], &[], Some(by_path));
    diff.entries[0].action
}

#[test]
fn a_note_deleted_in_the_app_is_not_offered_back_by_the_folder() {
    // The file is exactly what the app last wrote (folder == base); the app no
    // longer has the note, so the workspace would write nothing at that path.
    let origin = ChangeOrigin {
        base: Some("d1"),
        folder: Some("d1"),
        workspace: None,
    };
    assert_eq!(
        changed_side(origin),
        ChangeSide::Workspace,
        "the app side removed it"
    );
    assert_eq!(import_action(origin), ImportAction::Unchanged);
}

#[test]
fn a_new_file_made_outside_the_app_is_still_created() {
    // No manifest base: the app never wrote this file.
    let origin = ChangeOrigin {
        base: None,
        folder: Some("d1"),
        workspace: None,
    };
    assert_eq!(changed_side(origin), ChangeSide::Unknown);
    assert_eq!(import_action(origin), ImportAction::Created);
}

#[test]
fn a_deleted_note_edited_in_the_folder_is_offered_back() {
    // The folder copy moved after the app last wrote it: someone kept working on it.
    let origin = ChangeOrigin {
        base: Some("d1"),
        folder: Some("d2"),
        workspace: None,
    };
    assert_eq!(import_action(origin), ImportAction::Created);
}

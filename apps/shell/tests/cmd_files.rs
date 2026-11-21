#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! The pure parts of the files-first commands: replies and the index build.
use crate::common;

use std::fs;

use weaveforge_shell_lib::cmd_files::{
    ChangedFile, FileWriteReply, IndexItem, IndexSlot, build_index, indexable,
};
use wf_store::checked_write::WriteOutcome;
use wf_store::vault::Vault;

use common::TempDir;

#[test]
fn write_outcomes_map_to_replies() {
    let written = FileWriteReply::from(WriteOutcome::Written { hash: "h".into() });
    assert_eq!(written.hash.as_deref(), Some("h"));
    assert!(written.changed.is_none());
    let changed = FileWriteReply::from(WriteOutcome::Changed {
        disk_hash: "d".into(),
    });
    assert!(changed.hash.is_none());
    assert_eq!(
        changed.changed,
        Some(ChangedFile {
            disk_hash: "d".into()
        })
    );
}

#[test]
fn only_notes_canvases_and_relation_tables_are_indexed() {
    assert!(indexable("notes/a.md"));
    assert!(indexable("p/board.canvas"));
    assert!(indexable("p/.weaveforge/relations.json"));
    assert!(!indexable("p/paper.pdf"));
    assert!(!indexable("p/a.annotations.json"));
}

#[test]
fn the_index_reads_workspace_notes_and_skips_device_files() {
    let dir = TempDir::new();
    let root = dir.path();
    fs::create_dir_all(root.join("p")).unwrap();
    fs::create_dir_all(root.join(".weaveforge/local")).unwrap();
    fs::write(
        root.join("p/a.md"),
        "---\nweaveforge-id: n1\nweaveforge-type: note\ntitle: A\n---\nbody [[n2]]\n",
    )
    .unwrap();
    fs::write(
        root.join(".weaveforge/local/x.md"),
        "---\nweaveforge-id: hidden\nweaveforge-type: note\n---\n",
    )
    .unwrap();
    let store = build_index(&Vault::new(root.to_path_buf()));
    let entry = store.get("n1").map(IndexItem::from).unwrap();
    assert_eq!(entry.path, "p/a.md");
    assert_eq!(entry.links, ["n2"]);
    assert!(store.get("hidden").is_none());
    IndexSlot::default().invalidate();
}

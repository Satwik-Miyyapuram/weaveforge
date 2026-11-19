//! Guard: the 0.8 Electron copy at startup is gone. Code only: the old 0.8 data on disk is never
//! deleted, renamed or moved by the app, and nothing in the source copies or renames it aside.

use std::fs;
use std::path::Path;

fn sources(dir: &Path, out: &mut Vec<(String, String)>) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let text = fs::read_to_string(&path).unwrap();
            out.push((path.display().to_string(), text));
        }
    }
}

#[test]
fn the_shell_source_has_no_electron_copy_or_rename_aside() {
    let mut files = Vec::new();
    sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let banned = [
        "migrate_from_electron",
        "stage_and_publish",
        "marker_allows_retry",
        "migration_blocker",
        "write_done_marker",
        "copy_tree",
        "pre-migration",
        "migrated-from-electron",
    ];
    for (path, text) in &files {
        for name in banned {
            assert!(!text.contains(name), "{path} still refers to {name}");
        }
    }
}

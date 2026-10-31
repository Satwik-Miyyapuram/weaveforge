//! Ports of the serializer cases in `packages/core/test/workspace/{obsidian-interop,
//! workspace-roundtrip,workspace-snapshot}.test.ts` and `packages/core/test/ink/ink-note.test.ts`
//! (~L305, serialize half). Cases that parse the output back belong to `sync_deserialize.rs`.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use serde_json::{Value, json};
use wf_core::sync::folder_layout::{WORKSPACE_META_DIR, WorkspaceProject, log_path, project_dir};
use wf_core::sync::frontmatter::read_frontmatter;
use wf_core::sync::ink_note::{InkNoteMeta, default_ink_note_meta, write_ink_note_body};
use wf_core::sync::serialize::{WORKSPACE_SCHEMA_VERSION, obsidian_tags, serialize_workspace};
use wf_core::sync::workspace_snapshot::{
    SnapshotExperiment, SnapshotLogEntry, SnapshotPaper, SnapshotReadingList, SnapshotVaultPage,
    WorkspaceSnapshot, WorkspaceSnapshotCounts, workspace_snapshot_counts,
};

const NOW: &str = "2026-08-05T00:00:00.000Z";

fn project() -> WorkspaceProject {
    WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    }
}

fn snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        collected_at: NOW.to_owned(),
        ..WorkspaceSnapshot::default()
    }
}

fn note(id: &str, title: &str, body: &str) -> SnapshotVaultPage {
    SnapshotVaultPage {
        id: id.to_owned(),
        title: title.to_owned(),
        body: body.to_owned(),
        created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-02-01T00:00:00.000Z".to_owned(),
        ..SnapshotVaultPage::default()
    }
}

fn paper(id: &str, title: &str) -> SnapshotPaper {
    SnapshotPaper {
        id: id.to_owned(),
        title: title.to_owned(),
        authors: vec!["Vaswani".to_owned()],
        status: Some("unread".to_owned()),
        created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-02-01T00:00:00.000Z".to_owned(),
        ..SnapshotPaper::default()
    }
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

fn file<'a>(files: &'a [(String, String)], path: &str) -> &'a str {
    files
        .iter()
        .find(|entry| entry.0.as_str() == path)
        .map(|entry| entry.1.as_str())
        .unwrap_or_else(|| panic!("missing {path}"))
}

fn first_content(files: &[(String, String)]) -> &str {
    files
        .first()
        .map_or_else(|| panic!("no files"), |entry| entry.1.as_str())
}

// --------------------------------------------------------------- obsidian-interop

#[test]
fn every_mirrored_file_declares_its_title_as_an_alias() {
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            vault_pages: vec![note("n1", "Method Notes", "Body text.")],
            ..snapshot()
        },
        &project(),
    );
    let (path, content) = out.files.first().expect("note is written first");
    assert!(path.ends_with(".note.md"));
    assert_eq!(
        read_frontmatter(content).frontmatter.get("aliases"),
        Some(&json!(["Method Notes"]))
    );
}

#[test]
fn papers_carry_an_alias_too() {
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            papers: vec![paper("p1", "Attention")],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(
        read_frontmatter(first_content(&out.files))
            .frontmatter
            .get("aliases"),
        Some(&json!(["Attention"]))
    );
}

#[test]
fn empty_title_writes_no_aliases_key() {
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            vault_pages: vec![note("n1", "", "Body.")],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(
        read_frontmatter(first_content(&out.files))
            .frontmatter
            .get("aliases"),
        None
    );
}

#[test]
fn tags_with_spaces_are_hyphenated() {
    assert_eq!(
        obsidian_tags(&strings(&["machine learning", "nlp"])),
        Some(strings(&["machine-learning", "nlp"]))
    );
}

#[test]
fn hyphenating_can_collide_and_the_collision_is_deduped() {
    assert_eq!(
        obsidian_tags(&strings(&["deep learning", "deep-learning"])),
        Some(strings(&["deep-learning"]))
    );
}

#[test]
fn no_tags_means_no_key_not_an_empty_list() {
    assert_eq!(obsidian_tags(&[]), None);
}

#[test]
fn whitespace_runs_trim_and_drop_like_the_typescript() {
    assert_eq!(
        obsidian_tags(&strings(&["  a b ", "a-b", " "])),
        Some(strings(&["a-b"]))
    );
}

#[test]
fn a_papers_tags_reach_the_file_in_their_safe_form() {
    let mut p = paper("p1", "Attention");
    p.tags = strings(&["machine learning"]);
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            papers: vec![p],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(
        read_frontmatter(first_content(&out.files))
            .frontmatter
            .get("tags"),
        Some(&json!(["machine-learning"]))
    );
}

// ---------------------------------------------------------------- roundtrip

#[test]
fn serializing_twice_is_byte_identical() {
    let input = WorkspaceSnapshot {
        vault_pages: vec![
            note("n1", "Method", "Body text."),
            note("n2", "Other", "Body text."),
        ],
        ..snapshot()
    };
    assert_eq!(
        serialize_workspace(&input, &project()),
        serialize_workspace(&input, &project())
    );
}

#[test]
fn metadata_and_readme_are_written_beside_the_project() {
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            vault_pages: vec![note("n1", "Method", "Body text.")],
            ..snapshot()
        },
        &project(),
    );
    let manifest_path = format!(
        "{}/{WORKSPACE_META_DIR}/manifest.json",
        project_dir(&project())
    );
    assert!(out.files.iter().any(|entry| entry.0 == manifest_path));
    assert!(
        out.files
            .iter()
            .any(|entry| entry.0.as_str() == "README.md")
    );
}

#[test]
fn manifest_stamps_schema_version_app_and_counts() {
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            vault_pages: vec![note("n1", "Method", "Body text.")],
            ..snapshot()
        },
        &project(),
    );
    let manifest_path = format!(
        "{}/{WORKSPACE_META_DIR}/manifest.json",
        project_dir(&project())
    );
    let manifest: Value =
        serde_json::from_str(file(&out.files, &manifest_path)).expect("manifest is JSON");
    assert_eq!(manifest["schemaVersion"], json!(WORKSPACE_SCHEMA_VERSION));
    assert_eq!(manifest["app"], json!("WeaveForge"));
    assert_eq!(manifest["generatedAt"], json!(NOW));
    assert_eq!(manifest["counts"]["notes"], json!(1));
}

#[test]
fn manifest_bytes_match_json_stringify_in_written_key_order() {
    let out = serialize_workspace(&snapshot(), &project());
    let manifest_path = format!(
        "{}/{WORKSPACE_META_DIR}/manifest.json",
        project_dir(&project())
    );
    let expected = format!(
        "{{\n  \"schemaVersion\": {WORKSPACE_SCHEMA_VERSION},\n  \"generatedAt\": \"{NOW}\",\n  \"app\": \"WeaveForge\",\n  \"counts\": {{\n    \"papers\": 0,\n    \"notes\": 0,\n    \"readingLists\": 0,\n    \"reportSections\": 0,\n    \"experiments\": 0,\n    \"milestones\": 0,\n    \"logEntries\": 0,\n    \"relations\": 0,\n    \"tags\": 0\n  }}\n}}\n"
    );
    assert_eq!(file(&out.files, &manifest_path), expected);
}

#[test]
fn data_rows_keep_key_order_and_print_numbers_as_js_does() {
    // JSON.stringify of {z:1.0,a:1e21,m:0.5,b:-0} with 2-space indent.
    let row: Value =
        serde_json::from_str(r#"{"z": 1.0, "a": 1e21, "m": 0.5, "b": -0.0, "n": [2.0]}"#)
            .expect("row is JSON");
    let Value::Object(row) = row else {
        panic!("row is an object")
    };
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            relations: vec![row],
            ..snapshot()
        },
        &project(),
    );
    let relations = format!(
        "{}/{WORKSPACE_META_DIR}/relations.json",
        project_dir(&project())
    );
    assert_eq!(
        file(&out.files, &relations),
        "[\n  {\n    \"z\": 1,\n    \"a\": 1e+21,\n    \"m\": 0.5,\n    \"b\": 0,\n    \"n\": [\n      2\n    ]\n  }\n]\n"
    );
}

#[test]
fn empty_json_data_is_an_empty_array_with_a_newline() {
    let out = serialize_workspace(&snapshot(), &project());
    let relations = format!(
        "{}/{WORKSPACE_META_DIR}/relations.json",
        project_dir(&project())
    );
    assert_eq!(file(&out.files, &relations), "[]\n");
}

#[test]
fn readme_opens_with_the_title_and_the_export_time() {
    let out = serialize_workspace(&snapshot(), &project());
    let readme = file(&out.files, "README.md");
    assert_eq!(readme.lines().next(), Some("# WeaveForge workspace"));
    assert!(
        readme
            .lines()
            .any(|line| line == "Exported 2026-08-05T00:00:00.000Z.")
    );
}

#[test]
fn a_repeated_path_overwrites_in_place() {
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            vault_pages: vec![
                note("n1", "First", "first body"),
                note("n1", "Second", "second body"),
            ],
            ..snapshot()
        },
        &project(),
    );
    let notes: Vec<&(String, String)> = out
        .files
        .iter()
        .filter(|entry| entry.0.ends_with(".note.md"))
        .collect();
    assert_eq!(notes.len(), 1);
    assert!(notes[0].1.contains("second body"));
    assert!(!notes[0].1.contains("first body"));
    assert_eq!(out.files.first().map(|entry| &entry.0), Some(&notes[0].0));
}

#[test]
fn one_asset_referenced_twice_is_listed_once() {
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            vault_pages: vec![
                note("n1", "A", "![](vault:user-1/n1/diagram.png)"),
                note("n2", "B", "![](vault:user-1/n1/diagram.png)"),
            ],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(out.assets.len(), 1);
    assert_eq!(out.assets[0].storage_path, "user-1/n1/diagram.png");
}

#[test]
fn a_paper_with_only_a_summary_is_its_summary_as_body() {
    let mut p = paper("p1", "Attention");
    p.summary = Some("My notes.".to_owned());
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            papers: vec![p],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(
        read_frontmatter(first_content(&out.files)).body.trim(),
        "My notes."
    );
}

#[test]
fn a_paper_joins_abstract_then_summary() {
    let mut p = paper("p1", "Attention");
    p.abstract_text = Some("A.".to_owned());
    p.summary = Some("S.".to_owned());
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            papers: vec![p],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(
        read_frontmatter(first_content(&out.files)).body.trim(),
        "## Abstract\n\nA.\n\nS."
    );
}

#[test]
fn an_experiment_body_joins_hypothesis_and_result() {
    let experiment = SnapshotExperiment {
        id: "e1".to_owned(),
        name: "Run".to_owned(),
        hypothesis: Some("H".to_owned()),
        result_note: Some("R".to_owned()),
        created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        ..SnapshotExperiment::default()
    };
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            experiments: vec![experiment],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(
        read_frontmatter(first_content(&out.files)).body.trim(),
        "## Hypothesis\n\nH\n\n## Result\n\nR"
    );
}

#[test]
fn a_log_entry_is_written_at_its_dated_path() {
    let entry = SnapshotLogEntry {
        id: "l1".to_owned(),
        entry_date: "2026-03-14".to_owned(),
        kind: "daily".to_owned(),
        body: "Ran it.".to_owned(),
        created_at: "2026-03-14T00:00:00.000Z".to_owned(),
    };
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            log_entries: vec![entry],
            ..snapshot()
        },
        &project(),
    );
    let expected = log_path("l1", "2026-03-14", &project_dir(&project()));
    let content = file(&out.files, &expected);
    assert!(content.contains("weaveforge-id: l1\n"));
    assert!(content.contains("weaveforge-type: log_entry\n"));
    assert!(content.ends_with("---\nRan it."));
}

#[test]
fn a_non_finite_number_is_omitted_and_a_finite_one_is_written_bare() {
    let mut nan = paper("p1", "Attention");
    nan.year = Some(f64::NAN);
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            papers: vec![nan],
            ..snapshot()
        },
        &project(),
    );
    assert_eq!(
        read_frontmatter(first_content(&out.files))
            .frontmatter
            .get("year"),
        None
    );

    let mut finite = paper("p1", "Attention");
    finite.year = Some(2017.0);
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            papers: vec![finite],
            ..snapshot()
        },
        &project(),
    );
    assert!(first_content(&out.files).contains("\nyear: 2017\n"));
}

#[test]
fn an_ink_note_is_mirrored_as_ink_md_with_its_header_in_frontmatter() {
    let meta = InkNoteMeta {
        page_order: vec!["01JABCDEFGHJKMNPQRSTVWXYZ0".to_owned()],
        recognised: 0.5,
        ..default_ink_note_meta()
    };
    let body = write_ink_note_body(&meta, "hello");
    let out = serialize_workspace(
        &WorkspaceSnapshot {
            vault_pages: vec![note("n1", "Ink", &body)],
            ..snapshot()
        },
        &project(),
    );
    let ink = out.files.iter().find(|entry| entry.0.ends_with(".ink.md"));
    let content = ink.map_or_else(
        || panic!("an ink note is written as .ink.md"),
        |entry| entry.1.as_str(),
    );
    assert!(content.contains("weaveforge-type: ink_page"));
    assert!(content.contains("ink-page-order"));
    assert!(
        !content.contains("weaveforge-ink"),
        "the header line does not leak into the file"
    );
    assert_eq!(read_frontmatter(content).body.trim(), "hello");
}

// ---------------------------------------------------------- workspace-snapshot

#[test]
fn counts_summarise_the_snapshot_for_the_export_manifest() {
    let snap = WorkspaceSnapshot {
        papers: vec![paper("p1", "Attention")],
        vault_pages: vec![note("n1", "Method", "full body")],
        reading_lists: vec![SnapshotReadingList {
            id: "l1".to_owned(),
            name: "To read".to_owned(),
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            ..SnapshotReadingList::default()
        }],
        ..snapshot()
    };
    assert_eq!(
        workspace_snapshot_counts(&snap),
        WorkspaceSnapshotCounts {
            papers: 1,
            notes: 1,
            reading_lists: 1,
            report_sections: 0,
            experiments: 0,
            milestones: 0,
            log_entries: 0,
            relations: 0,
            tags: 0,
        }
    );
}

//! Golden, ported and property tests for `sync::folder_layout`. Goldens were
//! printed by `packages/core/src/workspace/folder-layout.ts` through
//! `tests/goldens/sync-text.mjs`. Ported from `packages/core/test/workspace/`:
//! `kind-suffix.test.ts`, `project-layout.test.ts` and `entity-types.test.ts`.
//! The folder-reader and frontmatter-reader cases in those files need
//! `parseWorkspaceFolder` / `parseWorkspaceFile`, which are not ported here.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use std::collections::HashSet;

use proptest::prelude::*;
use serde_json::Value;
use wf_core::search::js_text::utf16_len;
use wf_core::sync::folder_layout::{
    ASSET_DIR, AssetScope, ENTITY_DIRS, FolderNode, KIND_SUFFIX, PAPER_HTML_DIR, PAPER_PDF_DIR,
    WORKSPACE_META_DIR, WorkspaceEntityType, WorkspaceProject, asset_path, entity_dir,
    entity_dir_name, flat_path, id_suffix, kind_suffix, log_path, paper_html_path, paper_pdf_path,
    parse_kind_suffix, project_dir, project_meta_dir, slug_for, strip_kind_suffix, tree_paths,
};

const GOLDEN: &str = include_str!("goldens/sync-layout.json");

const THESIS_ROOT: &str = "msc-thesis--8d7317";

fn golden() -> Value {
    serde_json::from_str(GOLDEN).expect("sync-layout.json parses")
}

fn cases<'a>(golden: &'a Value, section: &str) -> &'a [Value] {
    golden[section].as_array().expect(section).as_slice()
}

fn text(v: &Value) -> &str {
    v.as_str().expect("golden string")
}

fn kind(name: &str) -> WorkspaceEntityType {
    ENTITY_DIRS
        .iter()
        .map(|(t, _)| *t)
        .find(|t| t.as_str() == name)
        .expect(name)
}

fn node(id: &str, title: &str, parent: Option<&str>) -> FolderNode {
    FolderNode {
        id: id.to_owned(),
        title: title.to_owned(),
        parent_id: parent.map(str::to_owned),
    }
}

fn nodes_of(v: &Value) -> Vec<FolderNode> {
    v.as_array()
        .expect("nodes")
        .iter()
        .map(|n| FolderNode {
            id: text(&n["id"]).to_owned(),
            title: text(&n["title"]).to_owned(),
            parent_id: n["parentId"].as_str().map(str::to_owned),
        })
        .collect()
}

fn thesis() -> WorkspaceProject {
    WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    }
}

#[test]
fn golden_slugs() {
    let g = golden();
    for case in cases(&g, "slugs") {
        let title = text(&case[0]);
        assert_eq!(slug_for(title, "untitled"), text(&case[1]), "slugs {case}");
        assert_eq!(slug_for(title, "project"), text(&case[2]), "slugs {case}");
    }
}

#[test]
fn golden_ids() {
    let g = golden();
    for case in cases(&g, "ids") {
        assert_eq!(id_suffix(text(&case[0])), text(&case[1]), "ids {case}");
    }
}

#[test]
fn golden_kinds() {
    let g = golden();
    for case in cases(&g, "kinds") {
        let name = text(&case[0]);
        let parsed = parse_kind_suffix(name).map(WorkspaceEntityType::as_str);
        assert_eq!(parsed, case[1].as_str(), "kinds {case}");
        assert_eq!(strip_kind_suffix(name), text(&case[2]), "kinds {case}");
    }
}

#[test]
fn golden_project() {
    let g = golden();
    for case in cases(&g, "project") {
        let project = WorkspaceProject {
            id: text(&case[0]["id"]).to_owned(),
            name: text(&case[0]["name"]).to_owned(),
        };
        assert_eq!(project_dir(&project), text(&case[1]), "project {case}");
    }
}

#[test]
fn golden_dirs() {
    let g = golden();
    for case in cases(&g, "dirs") {
        let t = kind(text(&case[0]));
        assert_eq!(entity_dir_name(t), text(&case[1]), "dirs {case}");
        assert_eq!(kind_suffix(t), text(&case[2]), "dirs {case}");
        assert_eq!(entity_dir(t, ""), text(&case[3]), "dirs {case}");
        assert_eq!(entity_dir(t, "proj--abc"), text(&case[4]), "dirs {case}");
        assert_eq!(
            flat_path(t, "id-123456789", "A Title", ""),
            text(&case[5]),
            "dirs {case}"
        );
        assert_eq!(
            flat_path(t, "id", "", "root"),
            text(&case[6]),
            "dirs {case}"
        );
    }
}

#[test]
fn golden_logs() {
    let g = golden();
    for case in cases(&g, "logs") {
        let got = log_path(text(&case[0]), text(&case[1]), text(&case[2]));
        assert_eq!(got, text(&case[3]), "logs {case}");
    }
}

#[test]
fn golden_tree() {
    let g = golden();
    for case in cases(&g, "tree") {
        let nodes = nodes_of(&case[0]);
        let got = tree_paths(&nodes, kind(text(&case[1])), text(&case[2]));
        let want: Vec<(String, String)> = case[3]
            .as_array()
            .expect("paths")
            .iter()
            .map(|p| (text(&p[0]).to_owned(), text(&p[1]).to_owned()))
            .collect();
        assert_eq!(got, want, "tree {case}");
    }
}

#[test]
fn golden_misc() {
    let g = golden();
    let m = &g["misc"];
    assert_eq!(WORKSPACE_META_DIR, text(&m["metaDir"]), "misc metaDir");
    assert_eq!(ASSET_DIR, text(&m["assetDir"]), "misc assetDir");
    assert_eq!(PAPER_PDF_DIR, text(&m["pdfDir"]), "misc pdfDir");
    assert_eq!(PAPER_HTML_DIR, text(&m["htmlDir"]), "misc htmlDir");
    assert_eq!(
        project_meta_dir("p"),
        text(&m["projectMeta"]),
        "misc projectMeta"
    );
    assert_eq!(paper_pdf_path("id1", ""), text(&m["pdf"][0]), "misc pdf");
    assert_eq!(paper_pdf_path("id1", "p"), text(&m["pdf"][1]), "misc pdf");
    assert_eq!(paper_html_path("id1", ""), text(&m["html"][0]), "misc html");
    assert_eq!(
        paper_html_path("id1", "p"),
        text(&m["html"][1]),
        "misc html"
    );
    assert_eq!(
        asset_path(AssetScope::Notes, "u/p/f.png"),
        text(&m["asset"][0]),
        "misc asset"
    );
    assert_eq!(
        asset_path(AssetScope::Papers, "x"),
        text(&m["asset"][1]),
        "misc asset"
    );
    assert_eq!(
        asset_path(AssetScope::Report, ""),
        text(&m["asset"][2]),
        "misc asset"
    );
}

#[test]
fn every_built_path_spells_its_kind_into_the_filename() {
    assert!(flat_path(WorkspaceEntityType::Paper, "p1", "Attention", "").ends_with(".paper.md"));
    assert!(log_path("l1", "2026-03-14", "").ends_with(".log.md"));
    let paths = tree_paths(
        &[node("s1", "Results", None)],
        WorkspaceEntityType::ReportSection,
        "",
    );
    assert!(paths[0].1.ends_with(".report.md"));
}

#[test]
fn a_suffix_is_read_back_off_the_path_and_an_unknown_one_is_not_invented() {
    assert_eq!(
        parse_kind_suffix("notes/method--a1b2c3.note.md"),
        Some(WorkspaceEntityType::VaultPage)
    );
    assert_eq!(
        parse_kind_suffix("report/results.report.md"),
        Some(WorkspaceEntityType::ReportSection)
    );
    assert_eq!(parse_kind_suffix("notes/plain.md"), None);
    assert_eq!(parse_kind_suffix("notes/holiday.snapshot.md"), None);
}

#[test]
fn the_title_never_keeps_the_suffix_and_a_dotted_title_keeps_itself() {
    assert_eq!(
        strip_kind_suffix("method--a1b2c3.note.md"),
        "method--a1b2c3"
    );
    assert_eq!(strip_kind_suffix("plain.md"), "plain");
    // "v2" is not a kind, so it belongs to the title.
    assert_eq!(strip_kind_suffix("draft.v2.md"), "draft.v2");
}

#[test]
fn every_entity_type_names_its_dir_and_its_suffix_at_the_root_and_in_a_project() {
    assert_eq!(ENTITY_DIRS.len(), 8);
    assert_eq!(KIND_SUFFIX.len(), 8);
    for &(t, dir) in ENTITY_DIRS {
        assert_eq!(entity_dir(t, ""), dir, "{t:?}");
        assert_eq!(
            entity_dir(t, THESIS_ROOT),
            format!("{THESIS_ROOT}/{dir}"),
            "{t:?}"
        );
        let name = format!("x.{}.md", kind_suffix(t));
        assert_eq!(parse_kind_suffix(&name), Some(t), "{t:?}");
        assert_eq!(strip_kind_suffix(&name), "x", "{t:?}");
    }
}

#[test]
fn a_project_folder_is_a_slug_plus_a_short_id_so_names_may_repeat() {
    assert_eq!(project_dir(&thesis()), THESIS_ROOT);
    let same_name = WorkspaceProject {
        id: "aaaaaaaa-1111-2222-3333-444444444444".to_owned(),
        name: "MSc Thesis".to_owned(),
    };
    assert_ne!(project_dir(&same_name), THESIS_ROOT);
    let unnamed = WorkspaceProject {
        id: "b2c3d4e5-0000-0000-0000-000000000000".to_owned(),
        name: "???".to_owned(),
    };
    assert_eq!(project_dir(&unnamed), "project--b2c3d4");
}

#[test]
fn every_path_an_entity_can_have_is_inside_its_project() {
    let dir = project_dir(&thesis());
    assert_eq!(
        flat_path(
            WorkspaceEntityType::Paper,
            "p1",
            "Attention Is All You Need",
            &dir
        ),
        format!("{THESIS_ROOT}/papers/attention-is-all-you-need--p1.paper.md"),
    );
    assert_eq!(
        flat_path(WorkspaceEntityType::Experiment, "e1", "ROME sweep", &dir),
        format!("{THESIS_ROOT}/experiments/rome-sweep--e1.experiment.md"),
    );
    assert_eq!(
        flat_path(WorkspaceEntityType::Milestone, "m1", "Submit", &dir),
        format!("{THESIS_ROOT}/plan/submit--m1.milestone.md"),
    );
    assert_eq!(
        log_path("l1", "2026-03-14", &dir),
        format!("{THESIS_ROOT}/logbook/2026/03/2026-03-14--l1.log.md"),
    );
    assert_eq!(
        paper_pdf_path("p1", &dir),
        format!("{THESIS_ROOT}/papers/pdf/p1.pdf")
    );
    assert_eq!(
        paper_html_path("p1", &dir),
        format!("{THESIS_ROOT}/papers/html/p1.html")
    );
    let report = tree_paths(
        &[node("s1", "Results", None)],
        WorkspaceEntityType::ReportSection,
        &dir,
    );
    assert_eq!(
        report[0].1,
        format!("{THESIS_ROOT}/report/results.report.md")
    );
    assert_eq!(
        entity_dir(WorkspaceEntityType::VaultPage, &dir),
        format!("{THESIS_ROOT}/notes")
    );
    assert_eq!(project_meta_dir(&dir), format!("{THESIS_ROOT}/.weaveforge"));
}

#[test]
fn a_projects_bookkeeping_sits_beside_its_files() {
    let dir = project_dir(&thesis());
    assert_eq!(
        format!("{}/mirror.json", project_meta_dir(&dir)),
        format!("{THESIS_ROOT}/.weaveforge/mirror.json")
    );
    assert_eq!(
        format!("{}/relations.json", project_meta_dir(&dir)),
        format!("{THESIS_ROOT}/.weaveforge/relations.json")
    );
}

#[test]
fn with_no_project_the_old_paths_are_what_they_always_were() {
    assert_eq!(
        flat_path(WorkspaceEntityType::Paper, "p1", "Attention", ""),
        "papers/attention--p1.paper.md"
    );
    assert_eq!(
        log_path("l1", "2026-03-14", ""),
        "logbook/2026/03/2026-03-14--l1.log.md"
    );
    assert_eq!(paper_pdf_path("p1", ""), "papers/pdf/p1.pdf");
    let paths = tree_paths(
        &[node("s1", "Results", None)],
        WorkspaceEntityType::ReportSection,
        "",
    );
    assert_eq!(paths[0].1, "report/results.report.md");
    assert_eq!(entity_dir(WorkspaceEntityType::VaultPage, ""), "notes");
}

#[test]
fn a_slug_drops_a_char_that_straddles_the_80_unit_cut() {
    // U+10000 is two UTF-16 units; the cut at 80 would split it.
    let title = format!("{}\u{10000}", "a".repeat(79));
    assert_eq!(slug_for(&title, "untitled"), "a".repeat(79));
}

#[test]
fn a_slug_keeps_a_dash_the_cut_lands_after_as_the_ts_does() {
    // The TS trims dashes before the cut, so a cut after a dash keeps it.
    // Changing that would rename existing files; plan §10 tracks it.
    let title = format!("{} b", "a".repeat(79));
    assert_eq!(slug_for(&title, "untitled"), format!("{}-", "a".repeat(79)));
}

#[test]
fn a_slug_of_only_separators_falls_back_and_reserved_names_get_a_suffix() {
    assert_eq!(slug_for("---", "untitled"), "untitled");
    assert_eq!(slug_for("", "project"), "project");
    assert_eq!(slug_for("LPT9", "untitled"), "lpt9-file");
    assert_eq!(slug_for("com0", "untitled"), "com0");
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn slug_is_nonempty_clean_bounded_and_idempotent(title in "\\PC{0,200}") {
        let slug = slug_for(&title, "untitled");
        prop_assert!(!slug.is_empty());
        prop_assert!(!slug.starts_with('-'));
        prop_assert!(utf16_len(&slug) <= 80);
        // Only a cut can leave a trailing dash, and reslugging trims it.
        if !slug.ends_with('-') {
            prop_assert_eq!(slug_for(&slug, "untitled"), slug.clone());
        }
    }

    #[test]
    fn tree_paths_are_unique_for_random_parent_forests(
        picks in proptest::collection::vec(any::<Option<usize>>(), 0..24),
    ) {
        // Titles are distinct, so slugs are distinct and no two files share a name.
        let nodes: Vec<FolderNode> = picks
            .iter()
            .enumerate()
            .map(|(i, pick)| FolderNode {
                id: format!("n{i}"),
                title: format!("t{i}"),
                parent_id: (*pick).filter(|_| i > 0).map(|p| format!("n{}", p % i)),
            })
            .collect();
        let paths = tree_paths(&nodes, WorkspaceEntityType::VaultPage, "");
        prop_assert_eq!(paths.len(), nodes.len());
        let unique: HashSet<&str> = paths.iter().map(|(_, p)| p.as_str()).collect();
        prop_assert_eq!(unique.len(), nodes.len(), "{:?}", paths);
    }
}

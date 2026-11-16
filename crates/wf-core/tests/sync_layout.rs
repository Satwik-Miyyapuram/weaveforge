//! Table, ported and property tests for `sync::folder_layout`. The tables keep
//! every case the old TypeScript-printed golden of
//! `packages/core/src/workspace/parts-1.ts` covered. Ported from `packages/core/test/workspace/`:
//! `kind-suffix.test.ts`, `project-layout.test.ts` and `entity-types.test.ts`.
//! The folder-reader and frontmatter-reader cases in those files need
//! `parseWorkspaceFolder` / `parseWorkspaceFile`, which are not ported here.

use std::collections::HashSet;

use proptest::prelude::*;
use wf_core::search::js_text::utf16_len;
use wf_core::sync::folder_layout::{
    ASSET_DIR, AssetScope, ENTITY_DIRS, FolderNode, KIND_SUFFIX, PAPER_HTML_DIR, PAPER_PDF_DIR,
    WORKSPACE_META_DIR, WorkspaceEntityType, WorkspaceProject, asset_path, entity_dir,
    entity_dir_name, flat_path, id_suffix, kind_suffix, log_path, paper_html_path, paper_pdf_path,
    parse_kind_suffix, project_dir, project_meta_dir, slug_for, strip_kind_suffix, tree_paths,
};

const THESIS_ROOT: &str = "msc-thesis--8d7317";

fn node(id: &str, title: &str, parent: Option<&str>) -> FolderNode {
    FolderNode {
        id: id.to_owned(),
        title: title.to_owned(),
        parent_id: parent.map(str::to_owned),
    }
}

fn thesis() -> WorkspaceProject {
    WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    }
}

/// Title, slug with the `untitled` fallback, slug with the `project` fallback.
/// Slugs fold to ASCII where they can, cut at 80 UTF-16 units and dodge
/// Windows device names.
#[test]
fn slug_cases() {
    let (a100, a80, a79) = ("a".repeat(100), "a".repeat(80), "a".repeat(79));
    let (e_acute100, e80) = ("\u{e9}".repeat(100), "e".repeat(80));
    let a79_emoji = format!("{a79}\u{1f600}");
    let (a100, a80, a79) = (a100.as_str(), a80.as_str(), a79.as_str());
    let (e_acute100, e80, a79_emoji) = (e_acute100.as_str(), e80.as_str(), a79_emoji.as_str());
    let cases = [
        ("", "untitled", "project"),
        ("Hello World", "hello-world", "hello-world"),
        ("  --Hello--  ", "hello", "hello"),
        ("Café Ångström", "cafe-angstrom", "cafe-angstrom"),
        ("日本語のタイトル", "日本語のタイトル", "日本語のタイトル"),
        ("con", "con-file", "con-file"),
        ("CON", "con-file", "con-file"),
        ("aux", "aux-file", "aux-file"),
        ("com1", "com1-file", "com1-file"),
        ("com0", "com0", "com0"),
        ("lpt9", "lpt9-file", "lpt9-file"),
        ("nul.txt", "nul-txt", "nul-txt"),
        (a100, a80, a80),
        (e_acute100, e80, e80),
        ("😀 emoji", "emoji", "emoji"),
        ("x😀y", "x-y", "x-y"),
        ("\u{fb01}le", "file", "file"),
        ("\u{216b}", "xii", "xii"),
        ("ΣΑΣ", "σας", "σας"),
        ("İstanbul", "istanbul", "istanbul"),
        ("a_b-c.d", "a-b-c-d", "a-b-c-d"),
        ("---", "untitled", "project"),
        ("😀", "untitled", "project"),
        (a79_emoji, a79, a79),
        ("\u{ff21}\u{ff42}\u{ff43}", "abc", "abc"),
        ("x\u{301}y", "xy", "xy"),
        ("Straße", "straße", "straße"),
        ("\u{1c5}", "dz", "dz"),
    ];
    for (title, untitled, project) in cases {
        assert_eq!(slug_for(title, "untitled"), untitled, "slug of {title:?}");
        assert_eq!(slug_for(title, "project"), project, "slug of {title:?}");
    }
}

/// An id suffix keeps the first six ASCII alphanumerics, or `x` when there are none.
#[test]
fn id_cases() {
    let cases = [
        ("", "x"),
        ("abc", "abc"),
        ("a-b-c-d-e-f-g", "abcdef"),
        ("1234567890", "123456"),
        ("--", "x"),
        ("日本", "x"),
        ("AbC_dE.fGh", "AbCdEf"),
    ];
    for (id, want) in cases {
        assert_eq!(id_suffix(id), want, "id suffix of {id:?}");
    }
}

/// File name, the kind its suffix names, the name with the suffix stripped.
#[test]
fn kind_cases() {
    use WorkspaceEntityType::*;
    let cases = [
        (
            "methods--a1b2c3.note.md",
            Some(VaultPage),
            "methods--a1b2c3",
        ),
        ("x.ink.md", Some(InkPage), "x"),
        ("x.md", None, "x"),
        ("x.foo.md", None, "x.foo"),
        ("x.paper.md", Some(Paper), "x"),
        ("dir/y.list.md", Some(ReadingList), "dir/y"),
        ("x.Note.md", None, "x.Note"),
        ("x.note.md.bak", None, "x.note.md.bak"),
        (".note.md", Some(VaultPage), ""),
        ("x.log", None, "x"),
        ("a.b.c.report.md", Some(ReportSection), "a.b.c"),
        ("x.experiment.md", Some(Experiment), "x"),
        ("x.milestone.md", Some(Milestone), "x"),
        ("x.log.md", Some(LogEntry), "x"),
        ("x.list.MD", None, "x.list.MD"),
        ("x.my_kind.md", None, "x.my_kind"),
    ];
    for (name, want, stripped) in cases {
        assert_eq!(parse_kind_suffix(name), want, "kind of {name:?}");
        assert_eq!(strip_kind_suffix(name), stripped, "stripped {name:?}");
    }
}

#[test]
fn project_cases() {
    let cases = [
        ("abcdef123", "My Project", "my-project--abcdef"),
        ("", "", "project--x"),
        ("p-1", "con", "con-file--p1"),
    ];
    for (id, name, want) in cases {
        let project = WorkspaceProject {
            id: id.to_owned(),
            name: name.to_owned(),
        };
        assert_eq!(
            project_dir(&project),
            want,
            "project dir of {id:?} {name:?}"
        );
    }
}

/// Kind, dir name, suffix, dir at the root, dir in `proj--abc`, then
/// `flat_path(kind, "id-123456789", "A Title", "")` and
/// `flat_path(kind, "id", "", "root")`.
#[test]
#[allow(clippy::too_many_lines, reason = "one table of cases")]
fn dir_cases() {
    use WorkspaceEntityType::*;
    let cases = [
        (
            VaultPage,
            "notes",
            "note",
            "notes",
            "proj--abc/notes",
            "notes/a-title--id1234.note.md",
            "root/notes/untitled--id.note.md",
        ),
        (
            InkPage,
            "notes",
            "ink",
            "notes",
            "proj--abc/notes",
            "notes/a-title--id1234.ink.md",
            "root/notes/untitled--id.ink.md",
        ),
        (
            Paper,
            "papers",
            "paper",
            "papers",
            "proj--abc/papers",
            "papers/a-title--id1234.paper.md",
            "root/papers/untitled--id.paper.md",
        ),
        (
            ReadingList,
            "reading-lists",
            "list",
            "reading-lists",
            "proj--abc/reading-lists",
            "reading-lists/a-title--id1234.list.md",
            "root/reading-lists/untitled--id.list.md",
        ),
        (
            ReportSection,
            "report",
            "report",
            "report",
            "proj--abc/report",
            "report/a-title--id1234.report.md",
            "root/report/untitled--id.report.md",
        ),
        (
            Experiment,
            "experiments",
            "experiment",
            "experiments",
            "proj--abc/experiments",
            "experiments/a-title--id1234.experiment.md",
            "root/experiments/untitled--id.experiment.md",
        ),
        (
            Milestone,
            "plan",
            "milestone",
            "plan",
            "proj--abc/plan",
            "plan/a-title--id1234.milestone.md",
            "root/plan/untitled--id.milestone.md",
        ),
        (
            LogEntry,
            "logbook",
            "log",
            "logbook",
            "proj--abc/logbook",
            "logbook/a-title--id1234.log.md",
            "root/logbook/untitled--id.log.md",
        ),
    ];
    for (kind, name, suffix, root_dir, project_dir, flat, untitled) in cases {
        assert_eq!(entity_dir_name(kind), name, "dir name of {kind:?}");
        assert_eq!(kind_suffix(kind), suffix, "suffix of {kind:?}");
        assert_eq!(entity_dir(kind, ""), root_dir, "root dir of {kind:?}");
        assert_eq!(
            entity_dir(kind, "proj--abc"),
            project_dir,
            "project dir of {kind:?}"
        );
        assert_eq!(
            flat_path(kind, "id-123456789", "A Title", ""),
            flat,
            "flat path of {kind:?}"
        );
        assert_eq!(
            flat_path(kind, "id", "", "root"),
            untitled,
            "untitled path of {kind:?}"
        );
    }
}

/// Id, date, root, expected path. A date without a month files under `00`.
#[test]
fn log_cases() {
    let cases = [
        (
            "abc",
            "2026-03-14",
            "",
            "logbook/2026/03/2026-03-14--abc.log.md",
        ),
        ("abc", "2026", "", "logbook/2026/00/2026--abc.log.md"),
        ("abc", "", "", "logbook//00/--abc.log.md"),
        (
            "abc",
            "2026-03-14",
            "proj",
            "proj/logbook/2026/03/2026-03-14--abc.log.md",
        ),
        ("x", "a-b-c", "", "logbook/a/b/a-b-c--x.log.md"),
    ];
    for (id, date, root, want) in cases {
        assert_eq!(
            log_path(id, date, root),
            want,
            "log path of {id:?} {date:?} {root:?}"
        );
    }
}

/// Nodes as (id, title, parent), then the (id, path) pairs for notes at the
/// root and for ink notes under `proj`. A node with children is a folder; a
/// repeated title gets an id suffix; a missing or empty parent counts as the
/// root, and a parent cycle is broken so every node still gets one path.
type TreeCase<'a> = (
    &'a [(&'a str, &'a str, Option<&'a str>)],
    &'a [(&'a str, &'a str)],
    &'a [(&'a str, &'a str)],
);

#[test]
#[allow(clippy::too_many_lines, reason = "one table of cases")]
fn tree_cases() {
    let cases: [TreeCase; 10] = [
        (&[], &[], &[]),
        (
            &[("a", "Alpha", None)],
            &[("a", "notes/alpha.note.md")],
            &[("a", "proj/notes/alpha.ink.md")],
        ),
        (
            &[
                ("a", "Alpha", None),
                ("b", "Beta", Some("a")),
                ("c", "Gamma", Some("b")),
            ],
            &[
                ("a", "notes/alpha/alpha.note.md"),
                ("b", "notes/alpha/beta/beta.note.md"),
                ("c", "notes/alpha/beta/gamma.note.md"),
            ],
            &[
                ("a", "proj/notes/alpha/alpha.ink.md"),
                ("b", "proj/notes/alpha/beta/beta.ink.md"),
                ("c", "proj/notes/alpha/beta/gamma.ink.md"),
            ],
        ),
        (
            &[
                ("a", "Same", None),
                ("b", "Same", None),
                ("c", "Same", None),
            ],
            &[
                ("a", "notes/same.note.md"),
                ("b", "notes/same--b.note.md"),
                ("c", "notes/same--c.note.md"),
            ],
            &[
                ("a", "proj/notes/same.ink.md"),
                ("b", "proj/notes/same--b.ink.md"),
                ("c", "proj/notes/same--c.ink.md"),
            ],
        ),
        (
            &[
                ("a", "Same", Some("p")),
                ("b", "Same", None),
                ("p", "Parent", None),
            ],
            &[
                ("a", "notes/parent/same.note.md"),
                ("b", "notes/same.note.md"),
                ("p", "notes/parent/parent.note.md"),
            ],
            &[
                ("a", "proj/notes/parent/same.ink.md"),
                ("b", "proj/notes/same.ink.md"),
                ("p", "proj/notes/parent/parent.ink.md"),
            ],
        ),
        (
            &[("a", "A", Some("b")), ("b", "B", Some("a"))],
            &[("a", "notes/a/a.note.md"), ("b", "notes/a/b/b.note.md")],
            &[
                ("a", "proj/notes/a/a.ink.md"),
                ("b", "proj/notes/a/b/b.ink.md"),
            ],
        ),
        (
            &[("a", "A", Some("a"))],
            &[("a", "notes/a/a.note.md")],
            &[("a", "proj/notes/a/a.ink.md")],
        ),
        (
            &[("a", "A", Some("missing"))],
            &[("a", "notes/a.note.md")],
            &[("a", "proj/notes/a.ink.md")],
        ),
        (
            &[
                ("x1", "Dup", None),
                ("x2", "Dup", None),
                ("c", "Child", Some("x2")),
            ],
            &[
                ("x1", "notes/dup.note.md"),
                ("x2", "notes/dup--x2/dup--x2.note.md"),
                ("c", "notes/dup--x2/child.note.md"),
            ],
            &[
                ("x1", "proj/notes/dup.ink.md"),
                ("x2", "proj/notes/dup--x2/dup--x2.ink.md"),
                ("c", "proj/notes/dup--x2/child.ink.md"),
            ],
        ),
        (
            &[("a", "A", Some(""))],
            &[("a", "notes/a.note.md")],
            &[("a", "proj/notes/a.ink.md")],
        ),
    ];
    for (nodes, notes, inks) in cases {
        let nodes: Vec<FolderNode> = nodes
            .iter()
            .map(|(id, title, parent)| node(id, title, *parent))
            .collect();
        for (kind, root, want) in [
            (WorkspaceEntityType::VaultPage, "", notes),
            (WorkspaceEntityType::InkPage, "proj", inks),
        ] {
            let want: Vec<(String, String)> = want
                .iter()
                .map(|(id, path)| ((*id).to_owned(), (*path).to_owned()))
                .collect();
            assert_eq!(
                tree_paths(&nodes, kind, root),
                want,
                "tree {nodes:?} as {kind:?}"
            );
        }
    }
}

#[test]
fn fixed_dirs_and_paper_and_asset_paths() {
    assert_eq!(WORKSPACE_META_DIR, ".weaveforge");
    assert_eq!(ASSET_DIR, "assets");
    assert_eq!(PAPER_PDF_DIR, "papers/pdf");
    assert_eq!(PAPER_HTML_DIR, "papers/html");
    assert_eq!(project_meta_dir("p"), "p/.weaveforge");
    assert_eq!(paper_pdf_path("id1", ""), "papers/pdf/id1.pdf");
    assert_eq!(paper_pdf_path("id1", "p"), "p/papers/pdf/id1.pdf");
    assert_eq!(paper_html_path("id1", ""), "papers/html/id1.html");
    assert_eq!(paper_html_path("id1", "p"), "p/papers/html/id1.html");
    assert_eq!(
        asset_path(AssetScope::Notes, "u/p/f.png"),
        "assets/notes/u/p/f.png"
    );
    assert_eq!(asset_path(AssetScope::Papers, "x"), "assets/papers/x");
    assert_eq!(asset_path(AssetScope::Report, ""), "assets/report/");
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
    #![proptest_config(ProptestConfig::default())]

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

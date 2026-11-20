//! Tests for the 0.9.2 to files migration. Files and the server are fakes.

use std::cell::RefCell;
use std::collections::BTreeMap;

use serde_json::json;
use wf_core::sync::folder_layout::{annotations_path, comments_path, pins_path, trash_path};

use super::export::{
    AnnotationRow, CommentRow, PaperExport, PaperFacts, PaperScreening, PinRow, Screening,
    ScreeningDecision, annotations_document, apply_paper_facts, comments_document, export_paper,
    paper_path, pick_screening, pins_document, plan_exports, read_annotations, read_comments,
    read_paper_facts, read_pins, verify_paper,
};
use super::rules::{
    Decision, LegacyShare, ShareSink, Stored, decide, is_trashed, migrated_copy_path,
    parse_rfc3339, run_shares, share_to_grant,
};
use super::{MigrateState, REPORT_PATH, WorkspaceFiles, apply, status_of};

#[derive(Default)]
struct FakeFiles {
    files: RefCell<BTreeMap<String, String>>,
    trash: Vec<String>,
}

impl FakeFiles {
    fn with(files: &[(&str, &str)]) -> Self {
        let fake = Self::default();
        for (rel, text) in files {
            let _previous = fake
                .files
                .borrow_mut()
                .insert((*rel).into(), (*text).into());
        }
        fake
    }

    fn text(&self, rel: &str) -> Option<String> {
        self.files.borrow().get(rel).cloned()
    }
}

impl WorkspaceFiles for FakeFiles {
    fn read(&self, rel: &str) -> Result<Option<String>, String> {
        Ok(self.text(rel))
    }

    fn write_if(&self, rel: &str, text: &str, expected: Option<&str>) -> Result<bool, String> {
        let mut files = self.files.borrow_mut();
        if files.get(rel).map(String::as_str) != expected {
            return Ok(false);
        }
        let _previous = files.insert(rel.into(), text.into());
        Ok(true)
    }

    fn trash_entries(&self) -> Result<Vec<String>, String> {
        Ok(self.trash.clone())
    }
}

#[derive(Default)]
struct RecordingSink {
    calls: Vec<String>,
}

impl ShareSink for RecordingSink {
    fn insert_grant(&mut self, grant: &super::rules::GrantRow) -> Result<(), String> {
        self.calls
            .push(format!("grant:{}:{}", grant.target_id, grant.permission));
        Ok(())
    }

    fn publish_shared_doc(&mut self, item_id: &str) -> Result<(), String> {
        self.calls.push(format!("publish:{item_id}"));
        Ok(())
    }
}

#[test]
fn newer_updated_at_wins() {
    let files = FakeFiles::with(&[("papers/a.md", "old text")]);
    let existing = Stored {
        updated_at: "2026-11-18T10:00:00.000Z".into(),
        text: "old text".into(),
    };
    let decision = decide(
        "papers/a.md",
        "2026-11-19T10:00:00.000Z",
        "new text",
        Some(&existing),
        false,
    );
    assert_eq!(
        apply(&files, "papers/a.md", "new text", &decision),
        Ok(true)
    );
    assert_eq!(files.text("papers/a.md").as_deref(), Some("new text"));
    // The older text is kept beside it, never lost.
    assert_eq!(
        files.text(&migrated_copy_path("papers/a.md")).as_deref(),
        Some("old text")
    );
}

#[test]
fn second_device_newer_row_wins_in_file() {
    // Device 2 already pushed a wf: 3 file at 12:00.
    let device_two = Stored {
        updated_at: "2026-11-19T12:00:00.000Z".into(),
        text: "edited on device 2".into(),
    };

    // The 0.9.2 row is older (10:00): the file stays, the row becomes the copy.
    let files = FakeFiles::with(&[("notes/x.md", "edited on device 2")]);
    let older = decide(
        "notes/x.md",
        "2026-11-19T10:00:00.000Z",
        "row from 0.9.2",
        Some(&device_two),
        false,
    );
    assert_eq!(
        apply(&files, "notes/x.md", "row from 0.9.2", &older),
        Ok(true)
    );
    assert_eq!(
        files.text("notes/x.md").as_deref(),
        Some("edited on device 2")
    );
    assert_eq!(
        files.text(&migrated_copy_path("notes/x.md")).as_deref(),
        Some("row from 0.9.2")
    );

    // A row newer than the file (14:00) does win in the file.
    let files = FakeFiles::with(&[("notes/x.md", "edited on device 2")]);
    let newer = decide(
        "notes/x.md",
        "2026-11-19T14:00:00.000Z",
        "row from 0.9.2",
        Some(&device_two),
        false,
    );
    assert_eq!(
        apply(&files, "notes/x.md", "row from 0.9.2", &newer),
        Ok(true)
    );
    assert_eq!(files.text("notes/x.md").as_deref(), Some("row from 0.9.2"));
}

#[test]
fn second_device_never_revives_trashed_id() {
    let mut files = FakeFiles::default();
    files.trash.push(trash_path("papers/gone.md", "2026-11-18"));
    let trashed = is_trashed("papers/gone.md", &files.trash_entries().unwrap());
    assert!(
        trashed,
        "a path under .weaveforge/trash/<date>/ counts as trashed"
    );

    let decision = decide(
        "papers/gone.md",
        "2026-11-19T10:00:00.000Z",
        "row",
        None,
        trashed,
    );
    assert_eq!(decision, Decision::SkipTrashed);
    assert_eq!(apply(&files, "papers/gone.md", "row", &decision), Ok(false));
    assert_eq!(files.text("papers/gone.md"), None, "nothing is recreated");

    // Only the same path is trashed: a different name is still written.
    assert!(!is_trashed("papers/other.md", &files.trash));
}

#[test]
fn legacy_share_becomes_grant_before_publish() {
    let shares = vec![
        LegacyShare {
            owner: "owner-1".into(),
            recipient: "reader-2".into(),
            resource_type: "paper".into(),
            resource_id: Some("paper-9".into()),
            access: "comment".into(),
        },
        LegacyShare {
            owner: "owner-1".into(),
            recipient: "reader-3".into(),
            resource_type: "vault_page".into(),
            resource_id: Some("page-4".into()),
            access: "view".into(),
        },
        // Share-all has no single item to grant: reported, not granted.
        LegacyShare {
            owner: "owner-1".into(),
            recipient: "reader-4".into(),
            resource_type: "paper".into(),
            resource_id: None,
            access: "view".into(),
        },
    ];
    assert!(share_to_grant(&shares[2]).is_err());

    let mut sink = RecordingSink::default();
    let report = run_shares(&mut sink, &shares).expect("shares run");

    assert_eq!(
        sink.calls,
        vec![
            "grant:paper-9:comment",
            "grant:page-4:view",
            "publish:paper-9",
            "publish:page-4",
        ],
        "every grant row is written before any shared_docs publish"
    );
    assert_eq!(report.granted, 2);
    assert_eq!(report.skipped.len(), 1);
}

// ---- Times, copy names and write checks ----

#[test]
fn rfc3339_compares_instants_not_text() {
    assert_eq!(
        parse_rfc3339("2026-11-19T10:00:00Z"),
        parse_rfc3339("2026-11-19T10:00:00.000+00:00")
    );
    assert_eq!(
        parse_rfc3339("2026-11-19T12:00:00+02:00"),
        parse_rfc3339("2026-11-19T10:00:00Z")
    );
    // As text ".5Z" sorts before "Z"; as instants it is later.
    assert!(parse_rfc3339("2026-11-19T10:00:00.5Z") > parse_rfc3339("2026-11-19T10:00:00Z"));
    for bad in [
        "",
        "yesterday",
        "2026-13-01T00:00:00Z",
        "2026-11-19T10:00:00",
        "2026-11-19T10:00:00.Z",
    ] {
        assert_eq!(parse_rfc3339(bad), None, "{bad} is not RFC 3339");
    }
}

#[test]
fn decide_compares_parsed_times() {
    let file = Stored {
        updated_at: "2026-11-19T10:00:00.5Z".into(),
        text: "file".into(),
    };
    // The row is half a second older than the file: the file wins, even though its text sorts later.
    let older = decide(
        "notes/t.md",
        "2026-11-19T10:00:00Z",
        "row",
        Some(&file),
        false,
    );
    assert!(matches!(older, Decision::KeepFile { .. }));
    let newer = decide(
        "notes/t.md",
        "2026-11-19T10:00:01+00:00",
        "row",
        Some(&file),
        false,
    );
    assert!(matches!(newer, Decision::Replace { .. }));
    // A time that does not parse keeps both: the file stays, the row is copied beside it.
    let unparsed = decide("notes/t.md", "not a time", "row", Some(&file), false);
    assert_eq!(
        unparsed,
        Decision::KeepFile {
            conflict_path: migrated_copy_path("notes/t.md"),
        }
    );
}

#[test]
fn migrated_copy_keeps_its_kind_suffix() {
    assert_eq!(migrated_copy_path("x.ink.md"), "x.migrated-0.9.4.ink.md");
    assert_eq!(
        migrated_copy_path("papers/Title.paper.md"),
        "papers/Title.migrated-0.9.4.paper.md"
    );
    assert_eq!(
        migrated_copy_path("papers/Title.paper.annotations.json"),
        "papers/Title.paper.migrated-0.9.4.annotations.json"
    );
    assert_eq!(
        migrated_copy_path("notes/plain.md"),
        "notes/plain.migrated-0.9.4.md"
    );
}

#[test]
fn replace_refuses_a_backup_holding_other_text() {
    let copy = migrated_copy_path("notes/x.md");
    let files = FakeFiles::with(&[
        ("notes/x.md", "file text"),
        (copy.as_str(), "someone else's backup"),
    ]);
    let decision = Decision::Replace {
        previous: "file text".into(),
        copy_to: copy.clone(),
    };
    assert!(apply(&files, "notes/x.md", "row text", &decision).is_err());
    assert_eq!(
        files.text("notes/x.md").as_deref(),
        Some("file text"),
        "the file is not replaced"
    );
    assert_eq!(files.text(&copy).as_deref(), Some("someone else's backup"));
}

#[test]
fn replace_rerun_with_its_backup_in_place_proceeds() {
    let copy = migrated_copy_path("notes/x.md");
    let files = FakeFiles::with(&[("notes/x.md", "file text"), (copy.as_str(), "file text")]);
    let decision = Decision::Replace {
        previous: "file text".into(),
        copy_to: copy,
    };
    assert_eq!(apply(&files, "notes/x.md", "row text", &decision), Ok(true));
    assert_eq!(files.text("notes/x.md").as_deref(), Some("row text"));
}

#[test]
fn write_refused_when_file_changed_underneath() {
    let files = FakeFiles::with(&[("notes/y.md", "appeared meanwhile")]);
    assert!(apply(&files, "notes/y.md", "row", &Decision::Create).is_err());
    assert_eq!(
        files.text("notes/y.md").as_deref(),
        Some("appeared meanwhile")
    );
}

#[test]
fn keep_file_is_idempotent_and_refuses_other_text() {
    let conflict = migrated_copy_path("notes/z.md");
    let decision = Decision::KeepFile {
        conflict_path: conflict.clone(),
    };
    let same = FakeFiles::with(&[("notes/z.md", "file"), (conflict.as_str(), "row text")]);
    assert_eq!(
        apply(&same, "notes/z.md", "row text", &decision),
        Ok(false),
        "same copy already there"
    );

    let other = FakeFiles::with(&[("notes/z.md", "file"), (conflict.as_str(), "older row")]);
    assert!(apply(&other, "notes/z.md", "row text", &decision).is_err());
    assert_eq!(other.text(&conflict).as_deref(), Some("older row"));

    let empty = FakeFiles::with(&[("notes/z.md", "file")]);
    assert_eq!(apply(&empty, "notes/z.md", "row text", &decision), Ok(true));
}

#[test]
fn status_is_incomplete_until_a_verified_report_exists() {
    let files = FakeFiles::default();
    assert_eq!(
        status_of(&files).map(|reply| reply.state),
        Ok(MigrateState::NotStarted)
    );

    let report = FakeFiles::with(&[(REPORT_PATH, "{\"state\":\"incomplete\"}")]);
    let reply = status_of(&report).expect("status");
    assert_eq!(reply.state, MigrateState::Incomplete);
    assert_eq!(reply.report_path.as_deref(), Some(REPORT_PATH));

    let done = FakeFiles::with(&[(REPORT_PATH, "{\"state\":\"verified\"}")]);
    assert_eq!(
        status_of(&done).map(|reply| reply.state),
        Ok(MigrateState::Verified)
    );

    let garbled = FakeFiles::with(&[(REPORT_PATH, "not json")]);
    assert_eq!(
        status_of(&garbled).map(|reply| reply.state),
        Ok(MigrateState::Incomplete)
    );
}

// ---- Export of annotations, highlights, comments, pins and screening ----

fn sample_annotation() -> AnnotationRow {
    AnnotationRow {
        kind: "highlight".into(),
        color: "#ffd400".into(),
        text: "a quoted line".into(),
        comment: "check this".into(),
        tags: vec!["method".into(), "key".into()],
        page_index: 3,
        sort_index: "1".into(),
        anchor: json!({"rects": [[10, 20, 30, 40]]}),
        updated_at: "2026-11-18T09:00:00.000Z".into(),
    }
}

fn sample_comment() -> CommentRow {
    CommentRow {
        body: "second look at fig 2".into(),
        created_at: "2026-11-17T08:30:00.000Z".into(),
    }
}

fn sample_export() -> PaperExport {
    PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![sample_annotation()],
        comments: vec![sample_comment()],
        pins: Vec::new(),
        facts: PaperFacts {
            pinned: true,
            screening: Some(PaperScreening {
                screening: Screening::Include,
                reason: None,
            }),
        },
    }
}

#[test]
fn annotations_round_trip() {
    let note = AnnotationRow {
        kind: "note".into(),
        text: String::new(),
        comment: "plain note".into(),
        tags: vec![],
        page_index: 0,
        sort_index: "2".into(),
        ..sample_annotation()
    };
    let rows = vec![sample_annotation(), note];
    assert_eq!(read_annotations(&annotations_document(&rows)), Ok(rows));
}

#[test]
fn comments_round_trip() {
    let rows = vec![sample_comment()];
    assert_eq!(read_comments(&comments_document(&rows)), Ok(rows));
}

#[test]
fn paper_properties_round_trip() {
    let note = "---\ntitle: Attention\n---\nThe body stays.\n";
    let facts = PaperFacts {
        pinned: true,
        screening: Some(PaperScreening {
            screening: Screening::Include,
            reason: Some("rct, n=40".into()),
        }),
    };
    let written = apply_paper_facts(note, &facts);
    assert!(
        written.contains("pinned: true"),
        "pin written as a property: {written}"
    );
    assert!(
        written.contains("screening: include"),
        "screening written: {written}"
    );
    assert!(
        written.contains("screening_reason:"),
        "reason written: {written}"
    );
    assert!(
        written.ends_with("The body stays.\n"),
        "body untouched: {written}"
    );
    assert_eq!(read_paper_facts(&written), Ok(facts.clone()));
    assert_eq!(
        apply_paper_facts(&written, &facts),
        written,
        "same facts, same text"
    );
}

#[test]
fn screening_mapping() {
    let decisions = vec![
        ScreeningDecision {
            decided_at: "2026-11-01T10:00:00Z".into(),
            state: "included".into(),
            reason: Some("old".into()),
        },
        ScreeningDecision {
            decided_at: "2026-11-10T10:00:00Z".into(),
            state: "excluded".into(),
            reason: Some("too small".into()),
        },
        ScreeningDecision {
            decided_at: "2026-11-05T10:00:00Z".into(),
            state: "unsure".into(),
            reason: None,
        },
    ];
    // The latest decision wins; the others are not written.
    assert_eq!(
        pick_screening(&decisions),
        Ok(Some(PaperScreening {
            screening: Screening::Exclude,
            reason: Some("too small".into()),
        }))
    );
    let unsure = vec![ScreeningDecision {
        decided_at: "2026-11-05T10:00:00Z".into(),
        state: "unsure".into(),
        reason: None,
    }];
    assert_eq!(
        pick_screening(&unsure).map(|found| found.map(|p| p.screening)),
        Ok(Some(Screening::Maybe))
    );
    assert_eq!(pick_screening(&[]), Ok(None));
    let unknown = vec![ScreeningDecision {
        decided_at: "2026-11-05T10:00:00Z".into(),
        state: "maybe-ish".into(),
        reason: None,
    }];
    assert!(
        pick_screening(&unknown).is_err(),
        "an unknown state is refused, not guessed"
    );
    let bad_date = vec![ScreeningDecision {
        decided_at: "last tuesday".into(),
        state: "included".into(),
        reason: None,
    }];
    assert!(
        pick_screening(&bad_date).is_err(),
        "a decision time that does not parse is refused"
    );
}

#[test]
fn plan_pairs_rows_by_id_and_refuses_shared_titles() {
    let papers = vec![
        json!({"id": "p1", "title": "Attention"}),
        json!({"id": "p2", "title": "Dup"}),
        json!({"id": "p3", "title": "Dup"}),
        json!({"id": "p4", "title": "Lonely"}),
    ];
    let annotations = vec![
        json!({"paper_id": "p1", "type": "highlight", "color": "#ffd400", "text": "t", "comment": "c",
               "tags": ["key"], "page_index": 2, "sort_index": "1", "anchor": {"rects": []},
               "updated_at": "2026-11-18T09:00:00Z"}),
        json!({"paper_id": "p2", "type": "note", "color": "#ffffff", "text": "", "comment": "x",
               "tags": [], "page_index": 0, "sort_index": "1", "anchor": {},
               "updated_at": "2026-11-18T09:00:00Z"}),
    ];
    let comments = vec![
        json!({"resource_id": "p1", "body": "second look", "created_at": "2026-11-17T08:30:00Z"}),
    ];
    let pins = vec![json!({"resource_id": "p4"})];
    let screening = vec![
        json!({"paper_id": "p1", "decided_at": "2026-11-01T10:00:00Z", "state": "included", "reason": null}),
        json!({"paper_id": "p4", "decided_at": "2026-11-01T10:00:00Z", "state": "maybe-ish", "reason": null}),
    ];

    let plan = plan_exports(&papers, &annotations, &comments, &pins, &screening, &[]);

    let written: Vec<String> = plan.papers.iter().map(|(rel, _)| rel.clone()).collect();
    assert_eq!(written, vec![paper_path("Attention"), paper_path("Lonely")]);

    let attention = &plan.papers[0].1;
    assert_eq!(attention.annotations.len(), 1);
    assert_eq!(attention.annotations[0].sort_index, "1");
    assert_eq!(attention.comments.len(), 1);
    assert!(!attention.facts.pinned);
    assert_eq!(
        attention.facts.screening,
        Some(PaperScreening {
            screening: Screening::Include,
            reason: None,
        })
    );

    let lonely = &plan.papers[1].1;
    assert!(lonely.facts.pinned, "the pin is carried over");
    assert_eq!(
        lonely.facts.screening, None,
        "an unknown state is not written"
    );

    // The shared title (Dup) and the unknown screening state are reported, not exported.
    assert_eq!(plan.skipped.len(), 2, "skipped: {:?}", plan.skipped);
}

#[test]
fn export_rerun_is_idempotent() {
    let paper = "papers/attention.paper.md";
    let files = FakeFiles::with(&[(paper, "---\ntitle: Attention\n---\nbody\n")]);
    let first = export_paper(&files, paper, &sample_export()).expect("first run");
    assert!(first > 0, "first run writes sidecars and properties");
    let after_first = files.files.borrow().clone();

    let second = export_paper(&files, paper, &sample_export()).expect("second run");
    assert_eq!(second, 0, "second run writes nothing");
    assert_eq!(
        *files.files.borrow(),
        after_first,
        "second run leaves every file as it was"
    );
}

#[test]
fn sidecar_pairs_by_stem() {
    let paper = "papers/attention.paper.md";
    let files = FakeFiles::with(&[(paper, "---\ntitle: Attention\n---\nbody\n")]);
    let _ = export_paper(&files, paper, &sample_export()).expect("export");

    let annotations = annotations_path(paper);
    let comments = comments_path(paper);
    assert_eq!(
        annotations.strip_suffix(".annotations.json"),
        comments.strip_suffix(".comments.json"),
        "both sidecars share the paper's stem"
    );
    let stored = files
        .text(&annotations)
        .expect("annotations sidecar written");
    assert_eq!(read_annotations(&stored), Ok(vec![sample_annotation()]));
    assert!(files.text(&comments).is_some(), "comments sidecar written");
}

#[test]
fn trashed_paper_gets_no_export() {
    let paper = "papers/gone.paper.md";
    let mut files = FakeFiles::with(&[(paper, "body\n")]);
    files.trash.push(trash_path(paper, "2026-11-18"));
    assert_eq!(export_paper(&files, paper, &sample_export()), Ok(0));
    assert!(
        files.text(&annotations_path(paper)).is_none(),
        "nothing revived beside it"
    );
    assert_eq!(files.text(paper).as_deref(), Some("body\n"));
}

#[test]
fn export_with_data_needs_its_paper_file() {
    let files = FakeFiles::default();
    assert!(export_paper(&files, "papers/none.paper.md", &sample_export()).is_err());
    assert!(
        files
            .text(&annotations_path("papers/none.paper.md"))
            .is_none(),
        "no sidecar without its paper"
    );
    let empty = PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![],
        comments: vec![],
        pins: vec![],
        facts: PaperFacts::default(),
    };
    assert_eq!(export_paper(&files, "papers/none.paper.md", &empty), Ok(0));
}

#[test]
fn edited_sidecar_is_kept_and_the_export_lands_beside_it() {
    let paper = "papers/attention.paper.md";
    let sidecar = annotations_path(paper);
    let files = FakeFiles::with(&[
        (paper, "---\ntitle: Attention\n---\nbody\n"),
        (sidecar.as_str(), "[]"),
    ]);
    let _ = export_paper(&files, paper, &sample_export()).expect("export");
    assert_eq!(
        files.text(&sidecar).as_deref(),
        Some("[]"),
        "the file the user has is kept"
    );
    assert_eq!(
        files.text(&migrated_copy_path(&sidecar)),
        Some(annotations_document(&[sample_annotation()]))
    );
    assert_eq!(
        export_paper(&files, paper, &sample_export()),
        Ok(0),
        "a re-run adds nothing"
    );
}

#[test]
fn verify_reads_back_what_was_written() {
    let paper = "papers/attention.paper.md";
    let files = FakeFiles::with(&[(paper, "---\ntitle: Attention\n---\nbody\n")]);
    let _ = export_paper(&files, paper, &sample_export()).expect("export");
    assert_eq!(verify_paper(&files, paper, &sample_export()), Ok(()));

    let _previous = files
        .files
        .borrow_mut()
        .insert(annotations_path(paper), "[]".into());
    assert!(
        verify_paper(&files, paper, &sample_export()).is_err(),
        "a sidecar that differs fails the check"
    );
}

// ---- Annotation pins ----

fn sample_pin(key: &str) -> PinRow {
    PinRow {
        annotation_key: key.into(),
        report_section_id: Some("sec-1".into()),
        created_at: "2026-11-18T09:30:00.000Z".into(),
    }
}

#[test]
fn pins_round_trip() {
    let rows = vec![
        sample_pin("a"),
        PinRow {
            report_section_id: None,
            ..sample_pin("b")
        },
    ];
    assert_eq!(read_pins(&pins_document(&rows)), Ok(rows));
}

#[test]
fn pins_export_and_verify() {
    let paper = "papers/x.paper.md";
    let files = FakeFiles::with(&[(paper, "---\ntitle: X\n---\nbody\n")]);
    let export = PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![sample_annotation()],
        comments: vec![],
        pins: vec![sample_pin("a"), sample_pin("b")],
        facts: PaperFacts::default(),
    };
    let _ = export_paper(&files, paper, &export).expect("export");
    assert_eq!(verify_paper(&files, paper, &export), Ok(()));
    let stored = files.text(&pins_path(paper)).expect("pins sidecar written");
    assert_eq!(read_pins(&stored), Ok(export.pins.clone()));
}

#[test]
fn no_pins_no_pins_file() {
    let paper = "papers/x.paper.md";
    let files = FakeFiles::with(&[(paper, "body\n")]);
    let export = PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![sample_annotation()],
        comments: vec![],
        pins: vec![],
        facts: PaperFacts::default(),
    };
    let _ = export_paper(&files, paper, &export).expect("export");
    assert!(
        files.text(&pins_path(paper)).is_none(),
        "no pins file without pins"
    );
    assert_eq!(verify_paper(&files, paper, &export), Ok(()));
}

#[test]
fn many_pins() {
    let paper = "papers/x.paper.md";
    let files = FakeFiles::with(&[(paper, "body\n")]);
    let rows: Vec<PinRow> = (0..500).map(|i| sample_pin(&format!("k{i}"))).collect();
    let export = PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![sample_annotation()],
        comments: vec![],
        pins: rows.clone(),
        facts: PaperFacts::default(),
    };
    let _ = export_paper(&files, paper, &export).expect("export");
    assert_eq!(verify_paper(&files, paper, &export), Ok(()));
    let stored = files.text(&pins_path(paper)).expect("pins sidecar written");
    assert_eq!(read_pins(&stored), Ok(rows));
}

#[test]
fn pins_only_paper() {
    let paper = "papers/x.paper.md";
    let files = FakeFiles::with(&[(paper, "body\n")]);
    let export = PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![],
        comments: vec![],
        pins: vec![sample_pin("a")],
        facts: PaperFacts::default(),
    };
    assert!(
        export_paper(&files, paper, &export).expect("export") > 0,
        "a pin alone is data"
    );
    assert!(files.text(&pins_path(paper)).is_some(), "pins file written");
    assert_eq!(verify_paper(&files, paper, &export), Ok(()));
}

#[test]
fn pins_on_trashed_paper() {
    let paper = "papers/x.paper.md";
    let mut files = FakeFiles::with(&[(paper, "body\n")]);
    files.trash.push(trash_path(paper, "2026-11-18"));
    let export = PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![],
        comments: vec![],
        pins: vec![sample_pin("a")],
        facts: PaperFacts::default(),
    };
    assert_eq!(export_paper(&files, paper, &export), Ok(0));
    assert!(
        files.text(&pins_path(paper)).is_none(),
        "no pins file beside a trashed paper"
    );
    assert_eq!(verify_paper(&files, paper, &export), Ok(()));
}

#[test]
fn pins_on_deleted_paper() {
    let papers: Vec<serde_json::Value> = vec![];
    let annotation_pins = vec![json!({
        "paper_id": "p9",
        "annotation_key": "k",
        "report_section_id": null,
        "created_at": "2026-11-18T09:30:00Z"
    })];
    let plan = plan_exports(&papers, &[], &[], &[], &[], &annotation_pins);
    assert!(plan.papers.is_empty(), "no paper, no export");
    assert_eq!(plan.skipped.len(), 1, "skipped: {:?}", plan.skipped);
    assert!(
        plan.skipped[0].contains("annotation pin"),
        "skipped: {:?}",
        plan.skipped
    );
}

#[test]
fn missing_pins_file_fails_verify() {
    let paper = "papers/x.paper.md";
    let files = FakeFiles::with(&[(paper, "body\n")]);
    let export = PaperExport {
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        annotations: vec![],
        comments: vec![],
        pins: vec![sample_pin("a")],
        facts: PaperFacts::default(),
    };
    let _ = export_paper(&files, paper, &export).expect("export");
    let _removed = files.files.borrow_mut().remove(&pins_path(paper));
    let err = verify_paper(&files, paper, &export).expect_err("missing pins file must fail");
    assert!(
        err.contains(&pins_path(paper)),
        "error names the file: {err}"
    );
}

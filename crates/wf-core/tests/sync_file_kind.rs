//! Tests for file kinds, file headers, canonical text and workspace path rules.

use wf_core::sync::folder_layout::{
    annotations_path, checked_trash_path, compact_stamp, conflict_copy_path, day_stamp,
    numbered_path, trash_path,
};
use wf_core::sync::frontmatter::{
    FileKind, bytes_digest, canonical_digest, canonical_eq, canonical_text, file_header, file_kind,
    is_conflict_copy,
};

#[test]
fn canonical_compare_nfc_lf() {
    let nfd = "Cafe\u{301}\r\nline\rend";
    let nfc = "Caf\u{e9}\nline\nend";
    assert!(canonical_eq(nfd, nfc));
    assert_eq!(canonical_digest(nfd), canonical_digest(nfc));
    assert_eq!(canonical_text(nfd), nfc);
    assert_eq!(
        bytes_digest(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn unknown_wf_version_read_only() {
    let md4 = file_header("p/a.md", "---\nwf: 4\nweaveforge-id: n1\n---\nbody");
    assert_eq!(md4.wf, Some(4));
    assert!(md4.read_only);
    assert_eq!(md4.id.as_deref(), Some("n1"));

    let md3 = file_header("p/a.md", "---\nwf: 3\n---\nbody");
    assert_eq!(md3.wf, Some(3));
    assert!(!md3.read_only);

    let canvas = file_header("p/a.canvas", r#"{"wf":4,"id":"c1"}"#);
    assert!(canvas.read_only);
    assert_eq!(canvas.id.as_deref(), Some("c1"));

    let bare = file_header("p/a.md", "no header");
    assert_eq!(bare.wf, None);
    assert!(!bare.read_only);
}

#[test]
fn conflict_of_read_from_header() {
    let md = file_header("p/a.md", "---\nconflict_of: n1\n---\nbody");
    assert_eq!(md.conflict_of.as_deref(), Some("n1"));

    let canvas = file_header("p/a.canvas", r#"{"conflict_of":"c1"}"#);
    assert_eq!(canvas.conflict_of.as_deref(), Some("c1"));
}

#[test]
fn file_kind_by_path() {
    assert_eq!(
        file_kind("p/papers/x.annotations.json"),
        FileKind::Annotations
    );
    assert_eq!(file_kind("p/notes/x.comments.json"), FileKind::Comments);
    assert_eq!(file_kind("e/.overleaf.json"), FileKind::Overleaf);
    assert_eq!(file_kind("p/.ink/n1/0001.inkb"), FileKind::Ink);
    assert_eq!(file_kind("p/notes/foo.ink/0001.inkb"), FileKind::Ink);
    assert_ne!(file_kind("p/notes/foo.inkb"), FileKind::Ink);
    assert_ne!(file_kind("p/notes/foo.ink.md/0001.inkb"), FileKind::Ink);
    // A user's folder that only ends in `.ink`: a page must sit directly in a strokes folder.
    assert_ne!(file_kind("p/research.ink/deep/0001.inkb"), FileKind::Ink);
    assert_eq!(
        file_kind("p/research.ink/chapter.ink/0001.inkb"),
        FileKind::Ink
    );
    assert_eq!(
        file_kind(".weaveforge/ai/audit/2026-11/b1.jsonl"),
        FileKind::AiAudit
    );
    assert_eq!(file_kind("e/metrics/run1/b1.csv"), FileKind::MetricsChunk);
    assert_eq!(file_kind("metrics/run1/b1.csv"), FileKind::MetricsChunk);
    assert_eq!(
        file_kind(".weaveforge/settings.json"),
        FileKind::WorkspaceMeta
    );
    assert_eq!(
        file_kind(".weaveforge/ai/proposals/x.json"),
        FileKind::Other
    );
    assert_eq!(file_kind("p/notes/a.md"), FileKind::Markdown);
    assert_eq!(file_kind("p/a.canvas"), FileKind::Canvas);
    assert_eq!(file_kind("p/a.pdf"), FileKind::Other);
}

#[test]
fn layout_paths() {
    assert_eq!(
        conflict_copy_path("p/notes/a.md", "20261118T101502Z"),
        "p/notes/a.conflict-20261118T101502Z.md"
    );
    assert_eq!(
        conflict_copy_path("v1.2/readme", "S"),
        "v1.2/readme.conflict-S"
    );
    assert_eq!(numbered_path("a/b.md", 2), "a/b-2.md");
    assert_eq!(numbered_path("a/b.md", 1), "a/b.md");
    assert_eq!(
        trash_path("p/notes/a.md", "2026-11-18"),
        ".weaveforge/trash/2026-11-18/p/notes/a.md"
    );
    assert_eq!(compact_stamp(0), "19700101T000000Z");
    assert_eq!(day_stamp(0), "1970-01-01");
    assert_eq!(
        annotations_path("p/papers/x.pdf"),
        "p/papers/x.annotations.json"
    );
    assert!(is_conflict_copy("p/a.conflict-20261118T101502Z.md"));
    assert!(is_conflict_copy("p/a.migrated-0.9.4.md"));
    assert!(!is_conflict_copy("p/a.md"));
}

#[test]
fn f97_p2_14_a_trash_path_never_leaves_the_trash() {
    for rel in [
        "../a.md",
        "p/../../a.md",
        "/etc/a.md",
        "C:/a.md",
        "c:\\a.md",
        "..\\a.md",
        "",
    ] {
        assert!(checked_trash_path(rel, "2026-11-18").is_err(), "{rel:?}");
    }
    assert_eq!(
        checked_trash_path("p/notes/a.md", "2026-11-18").as_deref(),
        Ok(".weaveforge/trash/2026-11-18/p/notes/a.md")
    );
}

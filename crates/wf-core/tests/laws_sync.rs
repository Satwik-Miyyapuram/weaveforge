//! The file-safety laws of the sync layer as property tests: what reading a file may and may
//! not change. The catalogue is `docs/building/core/laws.md`; each test names its law.

use proptest::prelude::*;
use serde_json::Value;
use wf_core::sync::deserialize::parse_workspace_file;
use wf_core::sync::frontmatter::{read_frontmatter, write_frontmatter};
use wf_core::sync::stamp_workspace_id::stamp_workspace_id;

/// A field name that is not one of the keys the sync layer reserves.
fn key() -> impl Strategy<Value = String> {
    "[a-z][a-z-]{0,10}".prop_filter("reserved keys are written by the tests themselves", |k| {
        !matches!(
            k.as_str(),
            "weaveforge-id" | "weaveforge-type" | "title" | "created-at"
        )
    })
}

/// Any value the writer emits: text, a whole number, a flag or a list of text.
fn value() -> impl Strategy<Value = Value> {
    prop_oneof![
        "\\PC{0,20}".prop_map(Value::String),
        any::<i64>().prop_map(Value::from),
        any::<bool>().prop_map(Value::from),
        prop::collection::vec(
            // Known limit, as in sync_frontmatter.rs: a list item ending in `\` reads back
            // as an escaped quote (the TypeScript reader did the same).
            "[ -~]{1,12}".prop_filter("trailing backslash", |t| !t.ends_with('\\')),
            1..4,
        )
        .prop_map(|items| Value::Array(items.into_iter().map(Value::String).collect())),
    ]
}

fn fields() -> impl Strategy<Value = Vec<(String, Value)>> {
    fields_in(0..6)
}

/// At least one field: the app never writes an empty `---` block, and the reader takes an
/// empty one as body text, so S1 covers only blocks with a field in them.
fn some_fields() -> impl Strategy<Value = Vec<(String, Value)>> {
    fields_in(1..6)
}

fn fields_in(size: std::ops::Range<usize>) -> impl Strategy<Value = Vec<(String, Value)>> {
    prop::collection::btree_map(key(), value(), size).prop_map(|map| map.into_iter().collect())
}

/// An id as the app mints them, or as a person might type one.
fn id() -> impl Strategy<Value = String> {
    prop_oneof!["[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}", "[A-Za-z0-9_-]{1,24}"]
}

/// An ISO instant, the form `created-at` is written in.
fn instant() -> impl Strategy<Value = String> {
    (
        2000u32..2100,
        1u32..13,
        1u32..29,
        0u32..24,
        0u32..60,
        0u32..1000,
    )
        .prop_map(|(y, mo, d, h, mi, ms)| {
            format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:00.{ms:03}Z")
        })
}

/// A note file as older versions wrote it: id, type, title, created-at, then other fields.
fn note(id: &str, created: &str, extra: &[(String, Value)], body: &str) -> String {
    let mut all = vec![
        ("weaveforge-id".to_owned(), Value::from(id)),
        ("weaveforge-type".to_owned(), Value::from("vault_page")),
        ("title".to_owned(), Value::from("A note")),
        ("created-at".to_owned(), Value::from(created)),
    ];
    all.extend_from_slice(extra);
    write_frontmatter(&all, body)
}

proptest! {
    /// Law S1: a canonical file survives a read and a re-render byte for byte.
    #[test]
    fn s1_canonical_file_round_trips(fields in some_fields(), body in "\\PC{0,40}(\n\\PC{0,40}){0,3}") {
        let file = write_frontmatter(&fields, &body);
        let parsed = read_frontmatter(&file);
        let again: Vec<(String, Value)> = parsed.frontmatter.into_iter().collect();
        prop_assert_eq!(write_frontmatter(&again, &parsed.body), file);
    }

    /// Law S2: a file is known by its path. Reading it never mints an id, and never changes
    /// one it read: a file without an id stays without one.
    #[test]
    fn s2_parse_never_mints_an_id(id in id(), created in instant(), extra in fields(), body in "\\PC{0,40}") {
        let bare = write_frontmatter(&extra, &body);
        let parsed = parse_workspace_file("notes/a.md", &bare).unwrap();
        prop_assert_eq!(parsed.path.as_str(), "notes/a.md");
        prop_assert_eq!(parsed.id, None);

        // An older file that still declares an id reads back with that id, unchanged.
        let with_id = note(&id, &created, &extra, &body);
        let parsed = parse_workspace_file("notes/a.md", &with_id).unwrap();
        prop_assert_eq!(parsed.path.as_str(), "notes/a.md");
        prop_assert_eq!(parsed.id, Some(id));
    }

    /// Law S3: `created-at` comes from the file, unchanged.
    #[test]
    fn s3_created_at_comes_from_the_file(id in id(), created in instant(), extra in fields(), body in "\\PC{0,40}") {
        let parsed = parse_workspace_file("notes/a.md", &note(&id, &created, &extra, &body)).unwrap();
        prop_assert_eq!(parsed.fields.get("created-at"), Some(&Value::from(created)));
    }

    /// Law S4: stamping never changes an id it did not read: a file that declares one is left
    /// alone, whatever its line endings or byte-order mark.
    #[test]
    fn s4_stamp_never_changes_a_read_id(
        id in id(),
        other in id(),
        created in instant(),
        extra in fields(),
        body in "\\PC{0,40}",
        crlf in any::<bool>(),
        bom in any::<bool>(),
    ) {
        let mut file = note(&id, &created, &extra, &body);
        if crlf {
            file = file.replace('\n', "\r\n");
        }
        if bom {
            file.insert(0, '\u{feff}');
        }
        prop_assert_eq!(stamp_workspace_id(&file, &other), None);
    }
}

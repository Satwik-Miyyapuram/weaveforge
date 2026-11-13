//! Ported and property tests for the ink note frontmatter and body header.
//! Ports `packages/core/test/ink/ink-note.test.ts` lines 46, 70, 84, 106, 159
//! (the `isInkChunkId` assertion), 272, 289 and 299. The stroke, packing, page
//! and sidecar cases, and line 305 (which needs serialize), are not ported.

#![allow(clippy::float_cmp)]

use proptest::prelude::*;
use serde_json::{Map, Value};
use wf_core::sync::frontmatter::{read_frontmatter, write_frontmatter};
use wf_core::sync::ink_note::{
    INK_BODY_HEADER, INK_NOTE_MAX_PAGES, INK_NOTE_TYPE, InkHand, InkNoteMeta, InkPaper,
    default_ink_note_meta, ink_keys, is_ink_chunk_id, is_ink_note_body, is_ink_note_frontmatter,
    read_ink_note_body, read_ink_note_meta, write_ink_note_body, write_ink_note_meta,
};

/// Chunk ids that are valid by construction (26 Crockford characters).
const CHUNK_A: &str = "01JABC0DEF0GH0JK0MN0PQ0RST";
const CHUNK_B: &str = "01JABC0DEF0GH0JK0MN0PQ0RSV";

fn note_fields(pairs: &[(&str, &str)]) -> Vec<(String, Value)> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), Value::from(*value)))
        .collect()
}

fn field(fields: &[(String, Value)], key: &str) -> Value {
    fields
        .iter()
        .find(|(k, _)| k.as_str() == key)
        .map_or(Value::Null, |(_, v)| v.clone())
}

fn fm_with(key: &str, value: &str) -> Map<String, Value> {
    let mut fm = Map::new();
    let _ = fm.insert(key.to_owned(), Value::from(value));
    fm
}

fn expected_text(text: &str) -> &str {
    text.strip_prefix("\r\n")
        .or_else(|| text.strip_prefix('\n'))
        .unwrap_or(text)
}

#[test]
fn ink_metadata_round_trips_through_frontmatter() {
    let meta = InkNoteMeta {
        pages: 3,
        paper: InkPaper::Dotted,
        page_order: vec![CHUNK_A.to_owned(), CHUNK_B.to_owned()],
        recognised: 0.94,
        engine: Some("windows-ink@1".to_owned()),
        hand: InkHand::Left,
    };
    let mut fields = note_fields(&[
        ("weaveforge-id", "01JNOTE"),
        ("weaveforge-type", INK_NOTE_TYPE),
        ("title", "Supervisor meeting 11 Feb"),
    ]);
    fields.extend(write_ink_note_meta(&meta));
    let file = write_frontmatter(&fields, "Drop the β sweep.\n");
    let doc = read_frontmatter(&file);
    assert!(is_ink_note_frontmatter(&doc.frontmatter));
    assert_eq!(read_ink_note_meta(&doc.frontmatter), meta);
    assert_eq!(doc.body, "Drop the β sweep.\n");
}

#[test]
fn a_note_with_no_ink_keys_is_a_valid_empty_ink_note_one_blank_page() {
    let fields = note_fields(&[("weaveforge-type", INK_NOTE_TYPE), ("title", "Untitled")]);
    let doc = read_frontmatter(&write_frontmatter(&fields, ""));
    let meta = read_ink_note_meta(&doc.frontmatter);
    assert_eq!(meta, default_ink_note_meta());
    assert_eq!(meta.pages, 1);
    assert!(
        meta.page_order.is_empty(),
        "the chunk list is empty until a page is written"
    );
    assert_eq!(meta.engine, None);
}

#[test]
fn nonsense_in_the_ink_keys_is_read_as_the_default_rather_than_trusted() {
    let page_order = format!("ink-page-order: [{CHUNK_A}, not-a-ulid, ../../etc/passwd]");
    let text = [
        "---",
        "weaveforge-type: ink_page",
        "ink-pages: -4",
        "ink-paper: vellum",
        page_order.as_str(),
        "ink-recognised: 7",
        "ink-hand: ambidextrous",
        "---",
        "",
    ]
    .join("\n");
    let doc = read_frontmatter(&text);
    let meta = read_ink_note_meta(&doc.frontmatter);
    assert_eq!(meta.pages, 1);
    assert_eq!(meta.paper, InkPaper::Blank);
    assert_eq!(
        meta.page_order,
        vec![CHUNK_A.to_owned()],
        "only ids shaped like chunk ids survive"
    );
    assert_eq!(meta.recognised, 0.0);
    assert_eq!(meta.hand, InkHand::Right);
}

#[test]
fn the_page_count_is_capped_at_the_fifty_pages_a_note_may_hold() {
    let text = [
        "---".to_owned(),
        "weaveforge-type: ink_page".to_owned(),
        format!("ink-pages: {}", INK_NOTE_MAX_PAGES + 20),
        "---".to_owned(),
        String::new(),
    ]
    .join("\n");
    let doc = read_frontmatter(&text);
    assert_eq!(
        read_ink_note_meta(&doc.frontmatter).pages,
        INK_NOTE_MAX_PAGES
    );
}

#[test]
fn a_chunk_id_is_twenty_six_crockford_characters() {
    assert!(is_ink_chunk_id(CHUNK_A));
    assert!(is_ink_chunk_id("01JABCDEFGHJKMNPQRSTVWXYZ0"));
    assert!(!is_ink_chunk_id("not-a-ulid"));
    assert!(!is_ink_chunk_id(&CHUNK_A[1..]), "twenty-five characters");
    assert!(
        !is_ink_chunk_id(&format!("{CHUNK_A}0")),
        "twenty-seven characters"
    );
    assert!(
        !is_ink_chunk_id("01JABCDEFGHIKMNPQRSTVWXYZ0"),
        "I is not Crockford"
    );
    assert!(
        !is_ink_chunk_id("01jabcdefghjkmnpqrstvwxyz0"),
        "lowercase is refused"
    );
    assert!(!is_ink_chunk_id("../../etc/passwd"));
}

#[test]
fn the_body_header_round_trips_the_ink_metadata_and_leaves_the_text_alone() {
    let meta = InkNoteMeta {
        pages: 2,
        paper: InkPaper::Dotted,
        page_order: vec![
            "01JABCDEFGHJKMNPQRSTVWXYZ0".to_owned(),
            "01JABCDEFGHJKMNPQRSTVWXYZ1".to_owned(),
        ],
        recognised: 0.94,
        engine: Some("windows-ink@1".to_owned()),
        hand: InkHand::Left,
    };
    let body = write_ink_note_body(&meta, "first page\n\n<!-- page 2 -->\n\nsecond\n");
    assert!(is_ink_note_body(&body));
    assert!(!is_ink_note_body("first page"));
    let (read, text) = read_ink_note_body(&body);
    assert_eq!(read, meta);
    assert_eq!(text, "first page\n\n<!-- page 2 -->\n\nsecond\n");
}

#[test]
fn a_stray_header_line_at_the_top_of_the_text_layer_is_damage_not_text() {
    let meta = InkNoteMeta {
        page_order: vec!["01JABCDEFGHJKMNPQRSTVWXYZ0".to_owned()],
        ..default_ink_note_meta()
    };
    let cut_off = "<!-- weaveforge-ink ink-pages=9 ink-paper=blank ink-page-order=01M2B9Q6KR";
    let text = format!("{cut_off}\n<!-- weaveforge-ink ink-pages=1 -->\nhello\n");
    let (read, rest) = read_ink_note_body(&write_ink_note_body(&meta, &text));
    assert_eq!(read, meta);
    assert_eq!(rest, "hello\n");
    // A body whose text is only the damage reads as empty, and saves clean.
    let (_, rest) = read_ink_note_body(&write_ink_note_body(&meta, cut_off));
    assert_eq!(rest, "");
}

#[test]
fn a_plain_body_reads_as_an_empty_ink_note_which_is_what_a_note_never_inked_is() {
    let (meta, text) = read_ink_note_body("just words");
    assert_eq!(meta, default_ink_note_meta());
    assert_eq!(text, "just words");
}

#[test]
fn chunk_ids_are_checked_on_the_way_in_not_only_written() {
    let body = format!("{INK_BODY_HEADER} ink-pages=1 ink-page-order={CHUNK_A},../x -->\nhi");
    let (meta, text) = read_ink_note_body(&body);
    assert_eq!(meta.page_order, vec![CHUNK_A.to_owned()]);
    assert_eq!(text, "hi");
}

#[test]
fn recognised_is_written_rounded_like_js_to_fixed() {
    let cases = [
        (0.125, 0.13),
        (0.375, 0.38),
        (0.015, 0.01),
        (0.005, 0.01),
        (0.555, 0.56),
        (0.94, 0.94),
        (0.0, 0.0),
    ];
    for (input, expected) in cases {
        let meta = InkNoteMeta {
            recognised: input,
            ..default_ink_note_meta()
        };
        let got = field(&write_ink_note_meta(&meta), ink_keys::RECOGNISED);
        assert_eq!(got, Value::from(expected), "case {input}");
    }
}

#[test]
fn empty_optional_fields_are_written_as_null() {
    let fields = write_ink_note_meta(&default_ink_note_meta());
    assert_eq!(field(&fields, ink_keys::PAGE_ORDER), Value::Null);
    assert_eq!(field(&fields, ink_keys::ENGINE), Value::Null);
    assert_eq!(field(&fields, ink_keys::PAGES), Value::from(1_u32));
}

#[test]
fn stored_numbers_follow_js_number_rules() {
    let pages = [
        ("0x10", 16),
        ("0X10", 16),
        ("0o17", 15),
        ("0b101", 5),
        ("1e1", 10),
        ("2.9", 2),
        ("0x", 1),
        ("-0x10", 1),
        ("+0x10", 1),
        ("inf", 1),
        ("1_0", 1),
        ("", 1),
        ("0.5", 0),
    ];
    for (text, expected) in pages {
        let meta = read_ink_note_meta(&fm_with(ink_keys::PAGES, text));
        assert_eq!(meta.pages, expected, "ink-pages {text:?}");
    }
    let recognised = [
        ("0.5", 0.5),
        ("Infinity", 0.0),
        ("1.5", 0.0),
        ("0x0", 0.0),
        ("nan", 0.0),
    ];
    for (text, expected) in recognised {
        let meta = read_ink_note_meta(&fm_with(ink_keys::RECOGNISED, text));
        assert_eq!(meta.recognised, expected, "ink-recognised {text:?}");
    }
}

fn chunk_id() -> impl Strategy<Value = String> {
    r"[0-9A-HJKMNP-TV-Z]{26}"
}

fn meta_strategy() -> impl Strategy<Value = InkNoteMeta> {
    (
        1_u32..=INK_NOTE_MAX_PAGES,
        prop::sample::select(vec![
            InkPaper::Blank,
            InkPaper::Dotted,
            InkPaper::Ruled,
            InkPaper::Grid,
            InkPaper::Wide,
        ]),
        prop::collection::vec(chunk_id(), 0..4),
        0_u32..=100,
        prop::option::of(r"[A-Za-z0-9@._-]{1,12}"),
        prop::sample::select(vec![InkHand::Right, InkHand::Left]),
    )
        .prop_map(
            |(pages, paper, page_order, recognised, engine, hand)| InkNoteMeta {
                pages,
                paper,
                page_order,
                recognised: f64::from(recognised) / 100.0,
                engine,
                hand,
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn body_round_trips_the_meta_and_the_text_minus_one_leading_newline(
        meta in meta_strategy(),
        text in r"[a-zA-Z0-9 \n\r.]{0,60}",
    ) {
        let body = write_ink_note_body(&meta, &text);
        let (read, rest) = read_ink_note_body(&body);
        prop_assert_eq!(&read, &meta);
        prop_assert_eq!(rest.as_str(), expected_text(&text));
    }

    #[test]
    fn frontmatter_round_trips_the_meta(meta in meta_strategy()) {
        let file = write_frontmatter(&write_ink_note_meta(&meta), "");
        let doc = read_frontmatter(&file);
        prop_assert_eq!(read_ink_note_meta(&doc.frontmatter), meta);
    }
}

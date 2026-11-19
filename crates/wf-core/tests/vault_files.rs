//! Laws for workspace entity files (notes, report sections, experiments,
//! milestones, log entries): `wf_core::sync::entity_file`.

use proptest::prelude::*;
use serde_json::{Map, Value};
use wf_core::sync::entity_file::{EntityFile, parse_entity_file, render_entity_file, replace_body};

fn note(fields: Map<String, Value>, body: &str) -> EntityFile {
    EntityFile {
        id: "abc123-0000".to_owned(),
        entity_type: "vault_page".to_owned(),
        wf: Some(3),
        fields,
        body: body.to_owned(),
    }
}

/// A field value the frontmatter can hold on one line, already NFC.
fn scalar() -> impl Strategy<Value = String> {
    "[ -~\u{e4}\u{f6}\u{20ac}\u{4e2d}]{0,24}".prop_map(|s| s.trim().to_owned())
}

/// A body in canonical form (LF, NFC).
fn body() -> impl Strategy<Value = String> {
    "[ -~\n\t\u{e4}\u{f6}\u{20ac}\u{4e2d}]{0,200}"
}

fn fields() -> impl Strategy<Value = Map<String, Value>> {
    prop::collection::vec(("[a-z][a-z0-9-]{0,10}", scalar()), 0..6).prop_map(|pairs| {
        pairs
            .into_iter()
            .filter(|(key, _)| !key.starts_with("weaveforge-") && key != "wf")
            .map(|(key, value)| (key, Value::String(value)))
            .collect()
    })
}

proptest! {
    /// Law: parse(render(file)) == file for single-line string fields.
    #[test]
    fn round_trip(fields in fields(), body in body()) {
        let file = note(fields.clone(), &body);
        let text = render_entity_file(&file);
        let back = parse_entity_file(&text);
        prop_assert_eq!(back, Some(note(fields, &body)));
    }

    /// Law: CRLF is normalised once; a second render changes nothing.
    #[test]
    fn crlf_normalised_once(fields in fields(), body in body()) {
        let lf = render_entity_file(&note(fields, &body));
        let crlf = lf.replace('\n', "\r\n");
        let parsed = parse_entity_file(&crlf);
        prop_assert!(parsed.is_some());
        let once = parsed.map(|file| render_entity_file(&file)).unwrap_or_default();
        prop_assert_eq!(&once, &lf);
        let twice = parse_entity_file(&once).map(|file| render_entity_file(&file));
        prop_assert_eq!(twice.as_deref(), Some(once.as_str()));
    }

    /// Law: a body save changes only the body; frontmatter bytes stay.
    #[test]
    fn body_save_keeps_frontmatter(fields in fields(), old in body(), new in body()) {
        let text = render_entity_file(&note(fields.clone(), &old));
        let saved = replace_body(&text, &new);
        let head_len = text.len() - old.len();
        prop_assert_eq!(saved.get(..head_len), text.get(..head_len));
        prop_assert_eq!(parse_entity_file(&saved), Some(note(fields, &new)));
    }

    /// Law: the id never changes on a save, whatever the body says.
    #[test]
    fn id_stable(new in body()) {
        let text = render_entity_file(&note(Map::new(), "x"));
        let saved = replace_body(&text, &new);
        prop_assert_eq!(parse_entity_file(&saved).map(|f| f.id), Some("abc123-0000".to_owned()));
    }

    /// Law: a parsed body is exactly the bytes after the fence, even when it
    /// starts with its own `---` line.
    #[test]
    fn body_kept_exactly(body in body()) {
        let fenced = format!("---\n{body}");
        let text = render_entity_file(&note(Map::new(), &fenced));
        prop_assert_eq!(parse_entity_file(&text).map(|f| f.body), Some(fenced));
    }
}

#[test]
fn unknown_fields_kept_in_file_order() {
    let text = "---\nweaveforge-id: n1\nweaveforge-type: vault_page\nzeta: 1\nmy-tag: \"a b\"\nalpha: [x, y]\n---\nBody\n";
    let file = parse_entity_file(text);
    let keys: Vec<String> = file
        .as_ref()
        .map(|f| f.fields.keys().cloned().collect())
        .unwrap_or_default();
    assert_eq!(keys, ["zeta", "my-tag", "alpha"]);
    let again = file.map(|f| render_entity_file(&f));
    assert_eq!(again.as_deref(), Some(text));
}

#[test]
fn created_at_comes_from_the_file() {
    let text = "---\nweaveforge-id: n1\nweaveforge-type: vault_page\ncreated-at: \"2024-01-02T03:04:05Z\"\n---\n";
    let file = parse_entity_file(text);
    assert_eq!(
        file.and_then(|f| f.created_at()),
        Some("2024-01-02T03:04:05Z".to_owned())
    );
}

#[test]
fn empty_note_round_trips() {
    let file = note(Map::new(), "");
    let text = render_entity_file(&file);
    assert_eq!(
        text,
        "---\nweaveforge-id: abc123-0000\nweaveforge-type: vault_page\nwf: 3\n---\n"
    );
    assert_eq!(parse_entity_file(&text), Some(file));
}

#[test]
fn file_without_id_is_not_an_entity() {
    assert_eq!(parse_entity_file("# just markdown\n"), None);
    assert_eq!(parse_entity_file("---\ntitle: x\n---\nbody"), None);
}

#[test]
fn replace_body_on_plain_markdown_replaces_all() {
    assert_eq!(replace_body("old\r\ntext", "new"), "new");
}

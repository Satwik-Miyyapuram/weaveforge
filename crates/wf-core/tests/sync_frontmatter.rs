//! Table, ported and property tests for the frontmatter writer and reader.
//! The tables keep every case the old TypeScript-printed golden of
//! `packages/core/src/workspace/parts.ts` covered; ported cases come from
//! `packages/core/test/workspace/workspace-roundtrip.test.ts` and
//! `packages/core/test/workspace/obsidian-interop.test.ts`.

use std::collections::BTreeMap;

use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use serde_json::{Map, Value, json};
use wf_core::sync::frontmatter::{
    frontmatter_list, frontmatter_string, read_frontmatter, write_frontmatter,
};

fn field(key: &str, value: Value) -> (String, Value) {
    (key.to_owned(), value)
}

type WrittenCase = (Vec<(String, Value)>, &'static str, &'static str);

/// `write_frontmatter` cases: fields in write order, body, then the expected text.
/// A field set to null or an empty list is left out.
fn written_cases() -> Vec<WrittenCase> {
    vec![
        (vec![], "", "---\n---\n"),
        (
            vec![field("title", Value::from("Hello"))],
            "body",
            "---\ntitle: Hello\n---\nbody",
        ),
        (
            vec![
                field("a", Value::from("")),
                field("b", Value::from("x y")),
                field("c", Value::from("true")),
                field("d", Value::from("False")),
                field("e", Value::from("null")),
                field("f", Value::from("~")),
                field("g", Value::from("12")),
                field("h", Value::from("-1")),
                field("i", Value::from("a\"b")),
                field("j", Value::from("a\\b")),
            ],
            "\n",
            "---\na: \"\"\nb: \"x y\"\nc: \"true\"\nd: \"False\"\ne: \"null\"\nf: \"~\"\ng: \"12\"\nh: \"-1\"\ni: \"a\\\"b\"\nj: \"a\\\\b\"\n---\n\n",
        ),
        (
            vec![
                field("n", Value::from(1)),
                field("m", Value::from(-2.5)),
                field("z", Value::from(0)),
                field("big", Value::from(1e21)),
                field("small", Value::from(1e-7)),
                field("neg0", Value::from(-0.0)),
                field("f", Value::from(0.1 + 0.2)),
                field("t", Value::from(true)),
                field("ff", Value::from(false)),
            ],
            "b",
            "---\nn: 1\nm: -2.5\nz: 0\nbig: 1e+21\nsmall: 1e-7\nneg0: 0\nf: 0.30000000000000004\nt: true\nff: false\n---\nb",
        ),
        (
            vec![
                field("l", json!([])),
                field("m", json!(["a"])),
                field("k", json!(["a b", "c,d", "", "1", "x\"y"])),
                field("u", Value::Null),
                field("v", json!("ok")),
            ],
            "x",
            "---\nm: [a]\nk: [\"a b\", \"c,d\", \"\", \"1\", \"x\\\"y\"]\nv: ok\n---\nx",
        ),
        (
            vec![field("weird key", json!("v")), field("k:", json!("v"))],
            "",
            "---\nweird key: v\nk:: v\n---\n",
        ),
        (
            vec![field("e", json!("é")), field("p", json!("a.b/c@d+e-f_g"))],
            "",
            "---\ne: \"é\"\np: a.b/c@d+e-f_g\n---\n",
        ),
        (
            vec![field("s", json!(" lead"))],
            "",
            "---\ns: \" lead\"\n---\n",
        ),
    ]
}

#[test]
fn written_cases_match() {
    for (fields, body, want) in written_cases() {
        assert_eq!(
            write_frontmatter(&fields, body),
            want,
            "written {body:?} / {fields:?}"
        );
    }
}

/// `read_frontmatter` cases: input, expected frontmatter, expected body.
#[test]
#[allow(clippy::too_many_lines, reason = "one table of cases")]
fn read_cases() {
    let cases = [
        ("", json!({}), ""),
        ("no frontmatter", json!({}), "no frontmatter"),
        ("---\n---\nbody", json!({}), "---\n---\nbody"),
        ("---\ntitle: x\n---\nbody", json!({"title": "x"}), "body"),
        (
            "\u{feff}---\ntitle: x\n---\nbody",
            json!({"title": "x"}),
            "body",
        ),
        (
            "---\r\ntitle: x\r\n---\r\nbody",
            json!({"title": "x"}),
            "body",
        ),
        ("---\ntitle: x\n---", json!({"title": "x"}), ""),
        ("---\ntitle: x\n---body", json!({"title": "x"}), "body"),
        (
            "---\na: 1\nb: -2.5\nc: 1.\nd: 01\ne: true\nf: TRUE\ng: \"q\\\"x\"\nh: 'it''s'\ni: \"\"\n---\n",
            json!({"a": 1, "b": -2.5, "c": "1.", "d": 1, "e": true, "f": true, "g": "q\"x", "h": "it's", "i": ""}),
            "",
        ),
        (
            "---\nl: [a, \"b, c\", '', d ]\nm: []\nn: [ ]\no: [\"x\\\"y\", z]\np: [a,,b]\n---\n",
            json!({"l": ["a", "b, c", "d"], "m": [], "n": [], "o": ["x\"y", "z"], "p": ["a", "b"]}),
            "",
        ),
        (
            "---\nlist:\n  - a\n  - \"b\"\n\n  - \n- c\n---\n",
            json!({"list": ["a", "b"]}),
            "",
        ),
        (
            "---\nmap:\n  k: v\n  - a\nnext: 1\n---\n",
            json!({"next": 1}),
            "",
        ),
        (
            "---\nempty:\nafter: 2\n---\n",
            json!({"empty": "", "after": 2}),
            "",
        ),
        (
            "---\n  indented: 1\nkey with space: 2\nok_key-1: 3\n---\n",
            json!({"ok_key-1": 3}),
            "",
        ),
        (
            "---\nx: [unclosed\ny: a: b\n---\n",
            json!({"x": "[unclosed", "y": "a: b"}),
            "",
        ),
        ("---\ndup: 1\ndup: 2\n---\n", json!({"dup": 2}), ""),
        (
            "---\ntitle: x\n---\n---\ny: 2\n---\n",
            json!({"title": "x"}),
            "---\ny: 2\n---\n",
        ),
        ("---\nt: x\n---\r\nrest", json!({"t": "x"}), "rest"),
        ("---\nlist:\n\t- a\n---\n", json!({"list": ["a"]}), ""),
        (
            "---\nk: \"unterminated\n---\n",
            json!({"k": "\"unterminated"}),
            "",
        ),
        (
            "---\nk: [\"a\" , \"b\"]\n---\n",
            json!({"k": ["a", "b"]}),
            "",
        ),
    ];
    for (input, frontmatter, body) in cases {
        let parsed = read_frontmatter(input);
        assert_eq!(
            Value::Object(parsed.frontmatter),
            frontmatter,
            "frontmatter for {input:?}"
        );
        assert_eq!(parsed.body, body, "body for {input:?}");
    }
}

/// Getter cases over one frontmatter: key, `frontmatter_string`, `frontmatter_list`.
/// Blank strings read as absent; a scalar string is a one-item list.
#[test]
fn getter_cases() {
    let fm = json!({
        "s": " x ", "e": "", "n": 3, "b": false, "l": ["a", "b"], "le": [], "w": "  "
    });
    let fm = fm.as_object().expect("object");
    let cases: [(&str, Option<&str>, &[&str]); 8] = [
        ("s", Some("x"), &["x"]),
        ("e", None, &[]),
        ("n", Some("3"), &[]),
        ("b", Some("false"), &[]),
        ("l", None, &["a", "b"]),
        ("le", None, &[]),
        ("w", None, &[]),
        ("missing", None, &[]),
    ];
    for (key, string, list) in cases {
        assert_eq!(
            frontmatter_string(fm, key).as_deref(),
            string,
            "string getter for {key:?}"
        );
        assert_eq!(frontmatter_list(fm, key), list, "list getter for {key:?}");
    }
}

#[test]
fn frontmatter_round_trips_scalars_and_lists() {
    let text = write_frontmatter(
        &[
            field("weaveforge-id", Value::from("n1")),
            field("title", Value::from("A, B")),
            field("tags", json!(["x", "y"])),
            field("year", Value::from(2017)),
            field("done", Value::from(true)),
        ],
        "Body",
    );
    let parsed = read_frontmatter(&text);

    assert_eq!(parsed.frontmatter["weaveforge-id"], "n1");
    assert_eq!(parsed.frontmatter["title"], "A, B");
    assert_eq!(parsed.frontmatter["tags"], json!(["x", "y"]));
    assert_eq!(parsed.frontmatter["year"], 2017);
    assert_eq!(parsed.frontmatter["done"], true);
    assert_eq!(parsed.body.trim(), "Body");
}

#[test]
fn a_file_with_no_frontmatter_is_all_body() {
    let parsed = read_frontmatter("Just prose.");

    assert!(parsed.frontmatter.is_empty());
    assert_eq!(parsed.body, "Just prose.");
}

#[test]
fn empty_lists_and_undefined_fields_are_omitted() {
    let text = write_frontmatter(
        &[
            field("a", Value::from("x")),
            field("b", Value::Null),
            field("c", json!([])),
        ],
        "",
    );

    assert!(text.contains("a: x"));
    assert!(!text.contains("b:"));
    assert!(!text.contains("c:"));
}

#[test]
fn a_block_list_reads_as_items() {
    let text = [
        "---",
        "title: Method",
        "tags:",
        "  - alpha",
        "  - beta",
        "---",
        "Body.",
    ]
    .join("\n");
    let parsed = read_frontmatter(&text);

    assert_eq!(parsed.frontmatter["tags"], json!(["alpha", "beta"]));
    assert_eq!(parsed.frontmatter["title"], "Method");
    assert_eq!(parsed.body, "Body.");
}

#[test]
fn quoted_block_items_are_unquoted() {
    let text = [
        "---",
        "aliases:",
        "  - \"Method, revised\"",
        "  - 'Method v2'",
        "---",
        "Body",
    ]
    .join("\n");
    let parsed = read_frontmatter(&text);

    assert_eq!(
        parsed.frontmatter["aliases"],
        json!(["Method, revised", "Method v2"])
    );
}

#[test]
fn a_single_quoted_scalar_unescapes_doubled_quotes() {
    let parsed = read_frontmatter("---\ntitle: 'It''s here'\n---\n");

    assert_eq!(parsed.frontmatter["title"], "It's here");
}

#[test]
fn a_nested_map_leaves_no_key_behind() {
    let text = ["---", "cssclasses:", "  wide: true", "---", "Body"].join("\n");
    let parsed = read_frontmatter(&text);

    assert!(!parsed.frontmatter.contains_key("cssclasses"));
    assert_eq!(parsed.body, "Body");
}

#[test]
fn a_key_after_a_block_list_is_still_read() {
    let text = ["---", "tags:", "  - alpha", "weaveforge-id: n1", "---", ""].join("\n");
    let parsed = read_frontmatter(&text);

    assert_eq!(parsed.frontmatter["tags"], json!(["alpha"]));
    assert_eq!(parsed.frontmatter["weaveforge-id"], "n1");
}

#[test]
fn an_inline_list_reads_as_items() {
    let parsed = read_frontmatter("---\ntags: [alpha, beta]\n---\n");

    assert_eq!(parsed.frontmatter["tags"], json!(["alpha", "beta"]));
}

#[test]
fn a_read_then_rewrite_is_byte_identical() {
    // Map keys are sorted, so the input lists `aliases` first to match the rewrite.
    let text = write_frontmatter(
        &[
            field("aliases", json!(["Method"])),
            field("weaveforge-id", Value::from("n1")),
        ],
        "Body.",
    );
    let parsed = read_frontmatter(&text);
    let fields: Vec<(String, Value)> = parsed.frontmatter.into_iter().collect();

    assert_eq!(write_frontmatter(&fields, &parsed.body), text);
}

#[test]
fn a_value_with_a_line_break_keeps_its_field() {
    // A raw line break inside quotes made the reader drop the field (and with `\n`, start a new key).
    for value in [
        "a\u{2028}b",
        "a\u{2029}b",
        "a\nb: x",
        "a\r\nb",
        "\\n stays \\u2028 text",
        "\\\"",
    ] {
        let text = write_frontmatter(&[field("k", Value::from(value))], "Body.");
        let parsed = read_frontmatter(&text);

        assert_eq!(parsed.frontmatter.len(), 1, "{text:?}");
        assert_eq!(parsed.frontmatter["k"], Value::from(value), "{text:?}");
        assert_eq!(parsed.body, "Body.");
    }
}

#[test]
fn js_number_text_matches_string_of_the_number() {
    let cases: [(f64, &str); 7] = [
        (-0.0, "0"),
        (1e20, "100000000000000000000"),
        (1e21, "1e+21"),
        (1e-7, "1e-7"),
        (1.5e-7, "1.5e-7"),
        (1e-6, "0.000001"),
        (1.2345678901234568e20, "123456789012345680000"),
    ];
    for (number, want) in cases {
        let text = write_frontmatter(&[field("v", Value::from(number))], "");
        assert_eq!(text, format!("---\nv: {want}\n---\n"), "String({number:?})");
    }
}

#[test]
fn a_list_item_ending_in_backslash_swallows_the_rest_as_ts_does() {
    // Kept on purpose: the closing quote after `\` reads as escaped, so the list stays open.
    let parsed = read_frontmatter("---\nk: [\"a\\\\\", b]\n---\n");

    assert_eq!(parsed.frontmatter["k"], json!(["\"a\\\\\", b"]));
}

#[test]
fn an_empty_map_is_written_but_not_read_back_as_frontmatter() {
    // Kept on purpose: the TS fence regex needs a newline before the first closing fence.
    let text = write_frontmatter(&[], "");

    assert_eq!(text, "---\n---\n");
    assert_eq!(read_frontmatter(&text).body, text);
}

fn list_item() -> impl Strategy<Value = String> {
    "[ -~]{1,12}".prop_filter(
        "TS reads a trailing backslash as an escaped quote",
        |text| !text.ends_with('\\'),
    )
}

fn list_value(items: Vec<String>) -> Value {
    Value::Array(items.into_iter().map(Value::String).collect())
}

fn assert_round_trip(map: BTreeMap<String, Value>) -> Result<(), TestCaseError> {
    let fields: Vec<(String, Value)> = map.clone().into_iter().collect();
    let parsed = read_frontmatter(&write_frontmatter(&fields, ""));
    let want: Map<String, Value> = map.into_iter().collect();

    prop_assert_eq!(parsed.frontmatter, want);
    prop_assert_eq!(parsed.body, "");
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn string_fields_round_trip(
        map in prop::collection::btree_map("[a-z]{1,8}", "[ -~]{0,20}".prop_map(Value::String), 1..6)
    ) {
        assert_round_trip(map)?;
    }

    #[test]
    fn integer_fields_round_trip(
        map in prop::collection::btree_map("[a-z]{1,8}", any::<i64>().prop_map(Value::from), 1..6)
    ) {
        assert_round_trip(map)?;
    }

    #[test]
    fn bool_fields_round_trip(
        map in prop::collection::btree_map("[a-z]{1,8}", any::<bool>().prop_map(Value::from), 1..6)
    ) {
        assert_round_trip(map)?;
    }

    #[test]
    fn list_fields_round_trip(
        map in prop::collection::btree_map(
            "[a-z]{1,8}",
            prop::collection::vec(list_item(), 1..4).prop_map(list_value),
            1..6,
        )
    ) {
        assert_round_trip(map)?;
    }
}

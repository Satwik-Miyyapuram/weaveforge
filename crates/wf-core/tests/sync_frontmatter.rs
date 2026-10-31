//! Golden, ported and property tests for the frontmatter writer and reader.
//! Goldens were printed by `packages/core/src/workspace/frontmatter.ts` through
//! `node crates/wf-core/tests/goldens/sync-text.mjs`; ported cases come from
//! `packages/core/test/workspace/workspace-roundtrip.test.ts` and
//! `packages/core/test/workspace/obsidian-interop.test.ts`.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;

use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use serde_json::{Map, Value, json};
use wf_core::sync::frontmatter::{
    frontmatter_list, frontmatter_string, read_frontmatter, write_frontmatter,
};

const GOLDEN: &str = include_str!("goldens/sync-frontmatter.json");

fn golden() -> Value {
    serde_json::from_str(GOLDEN).expect("golden parses")
}

fn field(key: &str, value: Value) -> (String, Value) {
    (key.to_owned(), value)
}

/// The generator's `written` inputs in its key order; serde_json maps sort keys, so the order lives here.
fn written_inputs() -> Vec<(Vec<(String, Value)>, &'static str)> {
    vec![
        (vec![], ""),
        (vec![field("title", Value::from("Hello"))], "body"),
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
        ),
        (
            vec![field("weird key", json!("v")), field("k:", json!("v"))],
            "",
        ),
        (
            vec![field("e", json!("é")), field("p", json!("a.b/c@d+e-f_g"))],
            "",
        ),
        (vec![field("s", json!(" lead"))], ""),
    ]
}

#[test]
fn golden_written_cases_match_typescript() {
    let golden = golden();
    let cases = golden["written"].as_array().expect("written");
    let inputs = written_inputs();
    assert_eq!(inputs.len(), cases.len(), "golden case count");
    for ((fields, body), case) in inputs.iter().zip(cases) {
        assert_eq!(case[1].as_str(), Some(*body), "body of golden case {case}");
        let want = case[2].as_str().expect("output");
        assert_eq!(
            write_frontmatter(fields, body),
            want,
            "written {body:?} / {fields:?}"
        );
    }
}

#[test]
fn golden_read_cases_match_typescript() {
    let golden = golden();
    let cases = golden["read"].as_array().expect("read");
    assert!(!cases.is_empty(), "golden has read cases");
    for case in cases {
        let input = case[0].as_str().expect("input");
        let want = &case[1];
        let parsed = read_frontmatter(input);
        assert_eq!(
            Value::Object(parsed.frontmatter),
            want["frontmatter"],
            "frontmatter for {input:?}"
        );
        assert_eq!(
            parsed.body.as_str(),
            want["body"].as_str().expect("body"),
            "body for {input:?}"
        );
    }
}

#[test]
fn golden_getters_match_typescript() {
    let golden = golden();
    let fm = json!({
        "s": " x ", "e": "", "n": 3, "b": false, "l": ["a", "b"], "le": [], "w": "  "
    });
    let fm = fm.as_object().expect("object");
    let cases = golden["getters"].as_array().expect("getters");
    assert_eq!(cases.len(), 8, "golden case count");
    for case in cases {
        let key = case[0].as_str().expect("key");
        assert_eq!(
            frontmatter_string(fm, key).as_deref(),
            case[1].as_str(),
            "string getter for {key:?}"
        );
        let want: Vec<&str> = case[2]
            .as_array()
            .expect("list")
            .iter()
            .map(|entry| entry.as_str().expect("entry"))
            .collect();
        assert_eq!(frontmatter_list(fm, key), want, "list getter for {key:?}");
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

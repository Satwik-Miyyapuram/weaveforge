//! Ported cases from `apps/shell/sidecar/test/wire.test.ts`: request parsing,
//! line routing, answer lines, tagged values and reply shapes. The cases that
//! need a running handler table, a peer's timers, or the readline loop stay in
//! the TS test file.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use serde_json::{Value, json};
use wf_core::wire::{
    MAX_LINE, Route, WireTag, error_reply, ok_reply_head, parse_answer, parse_request, route_line,
    unknown_method_error, wire_tag,
};

const SHAPE_ERROR: &str = "bad request: needs an integer id and a method";

fn parse_value(text: &str) -> Value {
    serde_json::from_str(text).expect("golden JSON")
}

#[test]
fn max_line_is_thirty_two_mebibytes() {
    assert_eq!(MAX_LINE, 32 * 1024 * 1024);
}

#[test]
fn parse_request_accepts_a_valid_line() {
    let request = parse_request(r#"{"id":1,"method":"query","params":{"a":1}}"#).expect("valid");
    assert_eq!(request.id, 1);
    assert_eq!(request.method, "query");
    assert_eq!(request.params, Some(json!({"a": 1})));
}

#[test]
fn parse_request_omits_params_when_not_sent() {
    let request = parse_request(r#"{"id":1,"method":"query"}"#).expect("valid");
    assert_eq!(request.params, None);
}

#[test]
fn parse_request_keeps_null_params_as_present() {
    let request = parse_request(r#"{"id":1,"method":"query","params":null}"#).expect("valid");
    assert_eq!(request.params, Some(Value::Null));
}

#[test]
fn parse_request_reports_non_json() {
    assert_eq!(
        parse_request("nope"),
        Err("bad request: not JSON".to_owned())
    );
}

#[test]
fn parse_request_reports_wrong_shape() {
    for line in [
        "[]",
        "null",
        r#"{"id":-1,"method":"a"}"#,
        r#"{"id":1.5,"method":"a"}"#,
        r#"{"id":1,"method":""}"#,
        r#"{"method":"a"}"#,
        r#"{"id":1}"#,
        r#"{"id":"1","method":"a"}"#,
    ] {
        assert_eq!(parse_request(line), Err(SHAPE_ERROR.to_owned()), "{line}");
    }
}

#[test]
fn parse_request_refuses_an_id_above_the_safe_integer_range() {
    assert_eq!(
        parse_request(r#"{"id":9007199254740992,"method":"a"}"#),
        Err(SHAPE_ERROR.to_owned())
    );
    let edge = parse_request(r#"{"id":9007199254740991,"method":"a"}"#).expect("max safe id");
    assert_eq!(edge.id, 9_007_199_254_740_991);
}

#[test]
fn route_skips_blank_lines() {
    assert_eq!(route_line("", true), Route::Skip);
    assert_eq!(route_line("   ", false), Route::Skip);
}

#[test]
fn route_reports_bad_json_with_null_id() {
    assert_eq!(
        route_line("nope", false),
        Route::Reply(json!({"id": null, "ok": false, "error": "bad request: not JSON"}))
    );
}

#[test]
fn route_sends_a_method_name_through_as_a_call_for_the_table_to_judge() {
    // `__proto__` and `toString` are for the TS handler table to refuse; Rust only passes them on.
    match route_line(r#"{"id":3,"method":"__proto__"}"#, false) {
        Route::Call(request) => assert_eq!(request.method, "__proto__"),
        other => panic!("expected a call, got {other:?}"),
    }
}

#[test]
fn unknown_method_error_names_the_method() {
    assert_eq!(
        unknown_method_error(4, "toString"),
        json!({"id": 4, "ok": false, "error": "unknown method: toString"})
    );
}

#[test]
fn route_refuses_a_line_over_max_line_without_parsing() {
    let line = "x".repeat(MAX_LINE + 1);
    assert_eq!(
        route_line(&line, false),
        Route::Reply(json!({"id": null, "ok": false, "error": "bad request: line too long"}))
    );
}

#[test]
fn route_counts_length_in_utf16_units_as_js_does() {
    // Each U+1F600 is two UTF-16 units and four UTF-8 bytes.
    let emoji = "\u{1F600}".repeat(MAX_LINE / 2 + 1);
    assert_eq!(
        route_line(&emoji, false),
        Route::Reply(json!({"id": null, "ok": false, "error": "bad request: line too long"}))
    );
}

#[test]
fn route_settles_an_answer_line_when_a_peer_is_listening() {
    match route_line(r#"{"answer":1,"ok":true,"value":{"on":true}}"#, true) {
        Route::Settle(answer) => {
            assert_eq!(answer.answer, 1);
            assert_eq!(answer.result, Ok(json!({"on": true})));
        }
        other => panic!("expected a settle, got {other:?}"),
    }
}

#[test]
fn route_reads_an_answer_line_as_a_request_when_no_peer_listens() {
    // Without a peer the line is an ordinary request, and it has no method.
    assert_eq!(
        route_line(r#"{"answer":1,"ok":true}"#, false),
        Route::Reply(json!({"id": null, "ok": false, "error": SHAPE_ERROR}))
    );
}

#[test]
fn route_flags_a_malformed_answer_line() {
    assert_eq!(
        route_line(r#"{"answer":0,"ok":true}"#, true),
        Route::BadAnswer
    );
}

#[test]
fn parse_answer_reads_success_and_error() {
    let ok = parse_answer(r#"{"answer":2,"ok":true,"value":"two"}"#).expect("ok answer");
    assert_eq!(ok.answer, 2);
    assert_eq!(ok.result, Ok(json!("two")));

    let failed =
        parse_answer(r#"{"answer":1,"ok":false,"error":"refused"}"#).expect("error answer");
    assert_eq!(failed.result, Err("refused".to_owned()));
}

#[test]
fn parse_answer_without_a_value_gives_null() {
    let answer = parse_answer(r#"{"answer":1,"ok":true}"#).expect("answer");
    assert_eq!(answer.result, Ok(Value::Null));
}

#[test]
fn malformed_answer_lines_are_not_answers() {
    for line in [
        "nope",
        "[]",
        r#"{"answer":0,"ok":true}"#,
        r#"{"answer":1.5,"ok":true}"#,
        r#"{"answer":"1","ok":true}"#,
        r#"{"answer":1}"#,
        r#"{"answer":1,"ok":false}"#,
        r#"{"answer":1,"ok":"yes"}"#,
    ] {
        assert_eq!(parse_answer(line), None, "{line}");
    }
}

#[test]
fn an_answer_line_over_max_line_is_not_parsed() {
    let line = format!(
        r#"{{"answer":1,"ok":true,"value":"big"}}{}"#,
        " ".repeat(MAX_LINE)
    );
    assert_eq!(parse_answer(&line), None);
}

#[test]
fn wire_tag_reads_a_bigint_tag() {
    assert_eq!(
        wire_tag(&json!({"$bigint": "-12"})),
        Some(WireTag::Bigint("-12".to_owned()))
    );
}

#[test]
fn wire_tag_reads_a_bytes_tag_still_encoded() {
    assert_eq!(
        wire_tag(&json!({"$bytes": "AQI="})),
        Some(WireTag::Bytes("AQI=".to_owned()))
    );
}

#[test]
fn wire_tag_leaves_look_alike_objects_alone() {
    for value in [
        json!({"$bigint": "1", "x": 1}),
        json!({"$bigint": "1.5"}),
        json!({"$bigint": "-"}),
        json!({"$bigint": 1}),
        json!({"$bytes": 3}),
        json!({"$bigint": ""}),
        json!({}),
        json!(["$bytes"]),
        json!("$bytes"),
        json!(null),
    ] {
        assert_eq!(wire_tag(&value), None, "{value}");
    }
}

#[test]
fn request_params_keep_tags_for_the_shim_to_revive() {
    let request =
        parse_request(r#"{"id":1,"method":"m","params":[{"$bytes":"AQI="}]}"#).expect("valid");
    let params = request.params.expect("params");
    let first = params
        .as_array()
        .and_then(|items| items.first())
        .expect("first item");
    assert_eq!(wire_tag(first), Some(WireTag::Bytes("AQI=".to_owned())));
}

#[test]
fn error_reply_keeps_wire_key_order() {
    let reply = error_reply(Some(7), "boom");
    assert_eq!(
        serde_json::to_string(&reply).expect("serialise"),
        r#"{"id":7,"ok":false,"error":"boom"}"#
    );
    assert_eq!(error_reply(None, "x")["id"], Value::Null);
}

#[test]
fn ok_reply_head_is_id_then_ok_for_the_shim_to_add_value() {
    let head = ok_reply_head(5);
    assert_eq!(
        serde_json::to_string(&head).expect("serialise"),
        r#"{"id":5,"ok":true}"#
    );
    assert_eq!(parse_value(r#"{"id":5,"ok":true}"#), head);
}

//! Request building and reply reading for the sync transport: the paths, headers,
//! bodies and feed rows that `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`
//! sends and reads. Pure. The fetch, the retry and conflict decisions, the chunking
//! loop and the app log stay in TypeScript.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::postgrest_wire::writable;

/// The `prefer` header of every write: the server answers with the row it stored.
pub const RETURN_REPRESENTATION: &str = "return=representation";

/// One request the transport sends: its method, its path under the REST root, and the
/// body and `prefer` header when it has them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestSpec {
    /// The HTTP method.
    pub method: String,
    /// The path under the REST root.
    pub path: String,
    /// The request body, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// The `prefer` header value, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefer: Option<String>,
}

/// A request ready for `fetch`: the path to append to the REST root, the headers, and the body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RequestInit {
    /// The HTTP method.
    pub method: String,
    /// The path to append to the REST root.
    pub path: String,
    /// The headers to send.
    pub headers: BTreeMap<String, String>,
    /// The request body, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// A feed row as the sync engine reads it (`RemoteChange` in TS).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullChange {
    /// The table the change belongs to.
    pub table: String,
    /// The id of the changed row.
    pub row_id: String,
    /// The server sequence number of the change.
    pub server_seq: f64,
    /// When the row was deleted, or null if it was not.
    pub deleted_at: Value,
    /// The version of the row after the change.
    pub row_version: f64,
    /// The row's contents.
    pub row: Value,
}

/// The request for one queued write. `insert` posts, `delete` removes, anything else patches.
/// Updates and deletes are guarded by the version they were based on, but only when one is
/// held: no version means unguarded, never a guard on zero.
#[must_use]
pub fn write_request(
    op: &str,
    table: &str,
    row_id: &str,
    base_version: Option<f64>,
    payload: Option<Map<String, Value>>,
) -> RequestSpec {
    let path_table = encode_component(table);
    if op == "insert" {
        return RequestSpec {
            method: "POST".to_owned(),
            path: format!("/{path_table}"),
            body: Some(json_body(writable(table, payload))),
            prefer: Some(RETURN_REPRESENTATION.to_owned()),
        };
    }
    let path = format!("/{path_table}{}", row_guard(row_id, base_version));
    if op == "delete" {
        return RequestSpec {
            method: "DELETE".to_owned(),
            path,
            body: None,
            prefer: Some(RETURN_REPRESENTATION.to_owned()),
        };
    }
    RequestSpec {
        method: "PATCH".to_owned(),
        path,
        body: Some(json_body(writable(table, payload))),
        prefer: Some(RETURN_REPRESENTATION.to_owned()),
    }
}

/// Whether the row is still on the server: the read behind a guarded write that matched nothing.
#[must_use]
pub fn gone_request(table: &str, row_id: &str) -> RequestSpec {
    get(format!(
        "/{}?id=eq.{}&select=id",
        encode_component(table),
        encode_component(row_id)
    ))
}

/// The server's copy of the row, read back to merge against.
#[must_use]
pub fn conflict_request(table: &str, row_id: &str) -> RequestSpec {
    get(format!(
        "/{}?id=eq.{}&select=*",
        encode_component(table),
        encode_component(row_id)
    ))
}

/// Whether the server records deleting this one row.
#[must_use]
pub fn tombstone_request(table: &str, row_id: &str) -> RequestSpec {
    get(format!(
        "/sync_tombstones?table_name=eq.{}&row_id=eq.{}&select=row_id",
        encode_component(table),
        encode_component(row_id)
    ))
}

/// Which of these ids the server holds, in the table.
#[must_use]
pub fn presence_request(table: &str, ids: &[String]) -> RequestSpec {
    get(format!(
        "/{}?id=in.({})&select=id",
        encode_component(table),
        id_list(ids)
    ))
}

/// Which of these ids the server records deleting, in the table.
#[must_use]
pub fn tombstones_for_request(table: &str, ids: &[String]) -> RequestSpec {
    get(format!(
        "/sync_tombstones?table_name=eq.{}&row_id=in.({})&select=row_id",
        encode_component(table),
        id_list(ids)
    ))
}

/// The change feed, read through the `sync_changes` RPC from `since`, `limit` rows at most.
#[must_use]
pub fn changes_request(since: i64, limit: i64) -> RequestSpec {
    RequestSpec {
        method: "POST".to_owned(),
        path: "/rpc/sync_changes".to_owned(),
        body: Some(json!({ "p_since": since, "p_limit": limit }).to_string()),
        prefer: None,
    }
}

/// The headers and body for `fetch`: the key always, the session only when there is one.
#[must_use]
pub fn request_init(spec: &RequestSpec, api_key: &str, token: Option<&str>) -> RequestInit {
    let mut headers = BTreeMap::new();
    let _ = headers.insert("content-type".to_owned(), "application/json".to_owned());
    let _ = headers.insert("apikey".to_owned(), api_key.to_owned());
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        let _ = headers.insert("authorization".to_owned(), format!("Bearer {token}"));
    }
    if let Some(prefer) = spec.prefer.as_deref().filter(|prefer| !prefer.is_empty()) {
        let _ = headers.insert("prefer".to_owned(), prefer.to_owned());
    }
    RequestInit {
        method: spec.method.clone(),
        path: spec.path.clone(),
        headers,
        body: spec.body.clone(),
    }
}

/// The rows of a reply: `None` for an empty body, a body that is not JSON, or JSON that is not an array.
#[must_use]
pub fn parse_rows(text: &str) -> Option<Vec<Value>> {
    if text.is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(text).ok()? {
        Value::Array(rows) => Some(rows),
        _ => None,
    }
}

/// The `id` of each row, as JS `String(row.id)` reads it.
#[must_use]
pub fn held_ids(rows: &[Value]) -> Vec<String> {
    rows.iter().map(|row| js_string(field(row, "id"))).collect()
}

/// The `row_id` of each tombstone row, as JS `String(row.row_id)` reads it.
#[must_use]
pub fn deleted_ids(rows: &[Value]) -> Vec<String> {
    rows.iter().map(|row| js_string(field(row, "row_id"))).collect()
}

/// One feed row mapped to a change. A missing `deleted_at` is `null`; a missing `row_data` is `{}`.
#[must_use]
pub fn to_change(row: &Value) -> PullChange {
    PullChange {
        table: js_string(field(row, "table_name")),
        row_id: js_string(field(row, "row_id")),
        server_seq: js_number(field(row, "server_seq")),
        deleted_at: match field(row, "deleted_at") {
            None | Some(Value::Null) => Value::Null,
            Some(value) => value.clone(),
        },
        row_version: js_number(field(row, "row_version")),
        row: match field(row, "row_data") {
            None | Some(Value::Null) => json!({}),
            Some(value) => value.clone(),
        },
    }
}

fn get(path: String) -> RequestSpec {
    RequestSpec {
        method: "GET".to_owned(),
        path,
        body: None,
        prefer: None,
    }
}

fn json_body(body: Map<String, Value>) -> String {
    Value::Object(body).to_string()
}

fn row_guard(row_id: &str, base_version: Option<f64>) -> String {
    let row = format!("?id=eq.{}", encode_component(row_id));
    match base_version {
        Some(version) => format!("{row}&row_version=eq.{version}"),
        None => row,
    }
}

fn id_list(ids: &[String]) -> String {
    ids.iter()
        .map(|id| encode_component(id.as_str()))
        .collect::<Vec<_>>()
        .join(",")
}

fn field<'a>(row: &'a Value, key: &str) -> Option<&'a Value> {
    match row {
        Value::Object(object) => object.get(key),
        _ => None,
    }
}

/// `String(value)` for a value read from JSON. A missing value reads as `"undefined"`.
fn js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => js_number_text(number.as_f64().unwrap_or(f64::NAN)),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| if item.is_null() { String::new() } else { js_string(Some(item)) })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_owned(),
    }
}

/// `Number(value)` for a value read from JSON. A missing value or an unreadable string is `NaN`.
fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                0.0
            } else if trimmed.chars().all(|c| c.is_ascii_digit() || "+-.eE".contains(c)) {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            } else {
                f64::NAN
            }
        }
        Some(_) => f64::NAN,
    }
}

/// A number as JS prints it: whole numbers without a fraction.
fn js_number_text(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e21 {
        format!("{number:.0}")
    } else {
        number.to_string()
    }
}

/// Percent-encodes like JS `encodeURIComponent`: every byte outside its unreserved set.
fn encode_component(input: &str) -> String {
    let mut out = String::new();
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    use crate::sync::send_verdict::absent_ids;

    const ROW: &str = "11111111-1111-4111-8111-111111111111";
    const OTHER: &str = "22222222-2222-4222-8222-222222222222";

    fn name_payload() -> Option<Map<String, Value>> {
        json!({ "name": "Renamed" }).as_object().cloned()
    }

    // it: "an update is guarded by the version it was based on"
    #[test]
    fn an_update_is_guarded_by_its_base_version() {
        let spec = write_request("update", "projects", ROW, Some(3.0), name_payload());
        assert_eq!(spec.method, "PATCH");
        assert!(spec.path.contains("row_version=eq.3"));
        assert_eq!(spec.prefer.as_deref(), Some(RETURN_REPRESENTATION));
    }

    // it: "a delete removes the row, guarded by its version"
    #[test]
    fn a_delete_is_guarded_by_its_version_and_sends_no_body() {
        let spec = write_request("delete", "projects", ROW, Some(3.0), None);
        assert_eq!(spec.method, "DELETE");
        assert!(spec.path.contains("row_version=eq.3"));
        assert_eq!(spec.body, None);
    }

    // it: "an op with no base version is sent unguarded, not guarded on zero"
    #[test]
    fn an_op_with_no_base_version_is_unguarded() {
        let spec = write_request("update", "projects", ROW, None, name_payload());
        assert!(spec.path.contains("id=eq."));
        assert!(!spec.path.contains("row_version"));
    }

    // it: "a conflict on a row the server deleted says it was deleted"
    #[test]
    fn a_conflict_checks_the_tombstone_for_this_row() {
        assert_eq!(
            tombstone_request("projects", ROW).path,
            "/sync_tombstones?table_name=eq.projects&row_id=eq.11111111-1111-4111-8111-111111111111&select=row_id"
        );
    }

    // it: "a guarded write that matched no row is a conflict, with the server's version"
    #[test]
    fn a_conflict_reads_the_whole_row() {
        assert!(conflict_request("projects", ROW).path.ends_with("select=*"));
    }

    // it: "a delete of a row the server no longer has is done, not a conflict"
    #[test]
    fn a_gone_check_reads_the_row_by_id() {
        let spec = gone_request("projects", ROW);
        assert_eq!(spec.method, "GET");
        assert!(spec.path.ends_with("&select=id"));
    }

    // it: "the feed is read through the RPC and mapped to changes"
    #[test]
    fn the_feed_is_read_through_the_rpc_and_mapped() {
        let spec = changes_request(4, 100);
        assert_eq!(spec.method, "POST");
        assert_eq!(spec.path, "/rpc/sync_changes");
        let body: Value = serde_json::from_str(spec.body.as_deref().unwrap_or_default())
            .unwrap_or(Value::Null);
        assert_eq!(body, json!({ "p_since": 4, "p_limit": 100 }));

        let change = to_change(&json!({
            "table_name": "projects",
            "row_id": ROW,
            "server_seq": 12,
            "deleted_at": null,
            "row_version": 2,
            "row_data": { "id": ROW, "name": "P" },
        }));
        assert_eq!(change.server_seq, 12.0);
        assert_eq!(change.row, json!({ "id": ROW, "name": "P" }));
        assert_eq!(change.deleted_at, Value::Null);
    }

    // it: "missingIds names the ids the server does not hold"
    #[test]
    fn missing_ids_names_the_ids_the_server_does_not_hold() {
        let ids = [ROW.to_owned(), OTHER.to_owned()];
        let spec = presence_request("papers", &ids);
        assert_eq!(spec.method, "GET");
        assert!(spec.path.starts_with("/papers?id=in.("));
        assert!(spec.path.ends_with("&select=id"));
        let held = held_ids(&[json!({ "id": ROW })]);
        assert_eq!(absent_ids(&ids, &held), vec![OTHER.to_owned()]);
    }

    // it: "missingIds leaves out rows another device deleted, so they are not brought back"
    #[test]
    fn missing_ids_asks_the_tombstones_about_the_absent_ids() {
        let absent = [OTHER.to_owned()];
        let spec = tombstones_for_request("papers", &absent);
        assert!(spec.path.starts_with("/sync_tombstones?table_name=eq.papers&row_id=in.("));
        assert_eq!(deleted_ids(&[json!({ "row_id": OTHER })]), vec![OTHER.to_owned()]);
    }

    // it: "missingIds asks about tombstones only when something is absent"
    // (Covers the absent-list half only: with every id held, nothing is absent to ask about.
    // The tombstone ask itself is `tombstones_for_request`.)
    #[test]
    fn nothing_is_absent_when_every_id_is_held() {
        let ids = [ROW.to_owned()];
        assert!(absent_ids(&ids, &held_ids(&[json!({ "id": ROW })])).is_empty());
    }

    #[test]
    fn the_session_token_is_sent_only_when_there_is_one() {
        let spec = RequestSpec {
            method: "GET".to_owned(),
            path: "/x".to_owned(),
            body: None,
            prefer: None,
        };
        let with = request_init(&spec, "anon", Some("jwt"));
        assert_eq!(with.headers.get("authorization").map(String::as_str), Some("Bearer jwt"));
        let without = request_init(&spec, "anon", Some(""));
        assert!(!without.headers.contains_key("authorization"));
        assert!(!without.headers.contains_key("prefer"));
    }

    #[test]
    fn a_reply_is_read_only_as_an_array() {
        assert_eq!(parse_rows(""), None);
        assert_eq!(parse_rows("{\"message\":\"x\"}"), None);
        assert_eq!(parse_rows("not json"), None);
        assert_eq!(parse_rows("[{\"id\":\"a\"}]").map(|rows| rows.len()), Some(1));
    }

    #[test]
    fn encoding_matches_encode_uri_component() {
        assert_eq!(encode_component("a b/c"), "a%20b%2Fc");
        assert_eq!(encode_component("ok-_.!~*'()"), "ok-_.!~*'()");
    }
}

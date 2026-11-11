//! The `crdt_updates` log and the CRDT snapshot watermark as Rust-planned queries.
//!
//! Ported from `PostgrestCrdtUpdateStore` and `CrdtSnapshotStore` in
//! `apps/web/src/features/collab/infrastructure/parts.ts`. `payload` is bytea: it is stored as
//! `\x` hex through [`encode_bytea`] and read back through [`decode_bytea`], the codecs the TS
//! used. `compact` calls the `compact_crdt_log` RPC, which moves the watermark and deletes the
//! covered rows in one transaction.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::bytea::{decode_bytea, encode_bytea};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "crdt_updates";

/// The columns a [`CrdtRow`] is read as, named rather than starred.
const CRDT_COLUMNS: &str =
    "id,resource_type,resource_id,project_id,epoch,payload,author_id,created_at";

/// A `crdt_updates` row as read.
#[derive(Deserialize)]
struct CrdtRow {
    id: i64,
    resource_type: String,
    resource_id: String,
    project_id: Option<String>,
    epoch: i64,
    payload: String,
    author_id: Option<String>,
    created_at: String,
}

/// A stored update as the TS `CrdtUpdateRecord` (camelCase; `payload` as bytes).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CrdtUpdateRecord {
    id: i64,
    resource_type: String,
    resource_id: String,
    project_id: Option<String>,
    epoch: i64,
    payload: Vec<u8>,
    author_id: Option<String>,
    created_at: String,
}

/// `append(input)` as the TS sends it (camelCase).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendInput {
    resource_type: String,
    resource_id: String,
    project_id: Option<String>,
    epoch: i64,
    payload: Vec<u8>,
    author_id: String,
}

/// `compact(input)` as the TS sends it (camelCase).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactInput {
    resource_type: String,
    resource_id: String,
    upto_id: i64,
    current_upto: Option<i64>,
}

/// The `snapshot_upto` column of a CRDT-backed entity row.
#[derive(Deserialize)]
struct SnapshotRow {
    snapshot_upto: Option<i64>,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "append" => append(call),
        "listAfter" => list_after(call),
        "deleteUpTo" => delete_up_to(call),
        "countAfter" => count_after(call),
        "compact" => compact(call),
        _ => return None,
    })
}

/// The next step of `CrdtSnapshotStore` `method`, or `None` for an unknown method. A separate
/// entry point because the snapshot store is its own repository.
#[must_use]
pub fn snapshot_step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getSnapshotUpto" => get_snapshot_upto(call),
        _ => return None,
    })
}

/// The domain record for a stored row (TS `mapRow`); nulls stay null.
fn to_domain(row: &CrdtRow) -> CrdtUpdateRecord {
    CrdtUpdateRecord {
        id: row.id,
        resource_type: row.resource_type.clone(),
        resource_id: row.resource_id.clone(),
        project_id: row.project_id.clone(),
        epoch: row.epoch,
        payload: decode_bytea(&row.payload),
        author_id: row.author_id.clone(),
        created_at: row.created_at.clone(),
    }
}

/// The `after_id` argument, `0` when absent (TS default).
fn after_id(call: &RepoCall, i: usize) -> i64 {
    call.arg(i).as_i64().unwrap_or(0)
}

/// `append(input)`: inserts one update and returns the stored record.
fn append(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_row(call, 0, to_domain);
    }
    let input: AppendInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let body = json!({
        "resource_type": input.resource_type,
        "resource_id": input.resource_id,
        "project_id": input.project_id,
        "epoch": input.epoch,
        "payload": encode_bytea(&input.payload),
        "author_id": input.author_id,
    });
    RepoStep::send(
        RepoQuery::insert(TABLE, body)
            .returning(CRDT_COLUMNS)
            .single(),
    )
}

/// `listAfter(resourceType, resourceId, afterId = 0)`: the updates after `afterId`, by id.
fn list_after(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_domain);
    }
    RepoStep::send(
        RepoQuery::select(TABLE, CRDT_COLUMNS)
            .eq("resource_type", call.text(0))
            .eq("resource_id", call.text(1))
            .filter("gt", "id", after_id(call, 2))
            .order("id", true),
    )
}

/// `deleteUpTo(resourceType, resourceId, uptoId)`: deletes the updates up to and including `uptoId`.
fn delete_up_to(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::delete(TABLE)
                .eq("resource_type", call.text(0))
                .eq("resource_id", call.text(1))
                .filter("lte", "id", call.arg(2).clone()),
        );
    }
    RepoStep::unit()
}

/// `countAfter(resourceType, resourceId, afterId = 0)`: how many updates follow `afterId`.
fn count_after(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::count(TABLE)
                .eq("resource_type", call.text(0))
                .eq("resource_id", call.text(1))
                .filter("gt", "id", after_id(call, 2)),
        );
    }
    match call.reply::<Option<u64>>(0) {
        Some(Ok(count)) => RepoStep::done(&count.unwrap_or(0)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `compact(input)`: runs `compact_crdt_log`. Stale input is a no-op without a query; the two
/// refusals (`42501`, `P0002`) are outcomes, and any other error fails with its message.
fn compact(call: &RepoCall) -> RepoStep {
    let input: CompactInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    if input
        .current_upto
        .is_some_and(|current| input.upto_id <= current)
    {
        return RepoStep::done(&json!({ "status": "no-op", "reason": "stale" }));
    }
    let Some(reply) = call.replies.first() else {
        return RepoStep::send(
            RepoQuery::rpc(
                "compact_crdt_log",
                json!({
                    "p_resource_type": input.resource_type,
                    "p_resource_id": input.resource_id,
                    "p_upto_id": input.upto_id,
                }),
            )
            .soft(),
        );
    };
    if let Some(error) = reply.get("error") {
        return match error.get("code").and_then(Value::as_str) {
            Some("42501") => RepoStep::done(&json!({ "status": "not-permitted" })),
            Some("P0002") => RepoStep::done(&json!({ "status": "no-op", "reason": "missing" })),
            _ => RepoStep::fail(
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("compact_crdt_log failed"),
            ),
        };
    }
    RepoStep::done(&json!({ "status": "compacted", "deleted": reply.as_u64().unwrap_or(0) }))
}

/// `getSnapshotUpto(resourceType, resourceId)`: the entity's watermark, `0` when unknown or absent.
fn get_snapshot_upto(call: &RepoCall) -> RepoStep {
    let table = match call.text(0) {
        "vault_page" => "vault_pages",
        "report_section" => "report_sections",
        "log_entry" => "log_entries",
        _ => return RepoStep::done(&0_i64),
    };
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(table, "snapshot_upto")
                .eq("id", call.text(1))
                .maybe_single(),
        );
    }
    match call.reply::<Option<SnapshotRow>>(0) {
        Some(Ok(row)) => RepoStep::done(&row.and_then(|r| r.snapshot_upto).unwrap_or(0)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx::default(),
        }
    }

    fn sent(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } => queries.remove(0),
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn row() -> Value {
        json!({
            "id": 5, "resource_type": "vault_page", "resource_id": "v1", "project_id": null,
            "epoch": 2, "payload": "\\x0aff", "author_id": "u1", "created_at": "2026-11-01T10:00:00Z"
        })
    }

    fn append_input() -> Value {
        json!({
            "resourceType": "vault_page", "resourceId": "v1", "projectId": null, "epoch": 2,
            "payload": [10, 255], "authorId": "u1"
        })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
        assert!(snapshot_step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn append_inserts_the_hex_payload_and_returns_the_row() {
        let q = sent(step("append", &call(vec![append_input()], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Insert);
        assert_eq!(q.table, TABLE);
        assert_eq!(q.columns.as_deref(), Some(CRDT_COLUMNS));
        assert_eq!(q.single, crate::repo_query::RepoSingle::One);
        let body = q.body.unwrap();
        assert_eq!(body["payload"], "\\x0aff");
        assert_eq!(body["project_id"], Value::Null);
        assert_eq!(body["author_id"], "u1");
        let value = done(step("append", &call(vec![append_input()], vec![row()])).unwrap());
        assert_eq!(value["payload"], json!([10, 255]));
        assert_eq!(value["resourceType"], "vault_page");
        assert_eq!(value["projectId"], Value::Null);
        assert_eq!(value["authorId"], "u1");
    }

    #[test]
    fn append_rejects_a_bad_input() {
        let s = step("append", &call(vec![json!({"epoch": "x"})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn list_after_defaults_to_zero_and_orders_by_id() {
        let q = sent(
            step(
                "listAfter",
                &call(vec![json!("vault_page"), json!("v1")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.filters[2].op, "gt");
        assert_eq!(q.filters[2].column, "id");
        assert_eq!(q.filters[2].value, json!(0));
        assert_eq!(q.order[0].column, "id");
        assert!(q.order[0].ascending);
    }

    #[test]
    fn list_after_maps_rows() {
        let s = step(
            "listAfter",
            &call(
                vec![json!("vault_page"), json!("v1"), json!(4)],
                vec![json!([row()])],
            ),
        )
        .unwrap();
        let value = done(s);
        assert_eq!(value[0]["id"], 5);
        assert_eq!(value[0]["payload"], json!([10, 255]));
    }

    #[test]
    fn delete_up_to_deletes_through_the_id() {
        let q = sent(
            step(
                "deleteUpTo",
                &call(vec![json!("vault_page"), json!("v1"), json!(5)], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[2].op, "lte");
        assert_eq!(q.filters[2].value, json!(5));
        let s = step(
            "deleteUpTo",
            &call(
                vec![json!("vault_page"), json!("v1"), json!(5)],
                vec![Value::Null],
            ),
        );
        assert_eq!(s, Some(RepoStep::unit()));
    }

    #[test]
    fn count_after_reads_the_count() {
        let q = sent(
            step(
                "countAfter",
                &call(vec![json!("vault_page"), json!("v1"), json!(1)], vec![]),
            )
            .unwrap(),
        );
        assert!(q.count);
        assert_eq!(q.filters[2].value, json!(1));
        let s = step(
            "countAfter",
            &call(vec![json!("vault_page"), json!("v1")], vec![json!(4)]),
        )
        .unwrap();
        assert_eq!(done(s), json!(4));
        let s = step(
            "countAfter",
            &call(vec![json!("vault_page"), json!("v1")], vec![Value::Null]),
        )
        .unwrap();
        assert_eq!(done(s), json!(0));
    }

    #[test]
    fn compact_stale_input_is_a_no_op_without_a_query() {
        let input = json!({"resourceType": "vault_page", "resourceId": "v1", "uptoId": 3, "currentUpto": 3});
        assert_eq!(
            done(step("compact", &call(vec![input], vec![])).unwrap()),
            json!({"status": "no-op", "reason": "stale"})
        );
    }

    #[test]
    fn compact_calls_the_rpc_softly() {
        let input = json!({"resourceType": "vault_page", "resourceId": "v1", "uptoId": 7});
        let q = sent(step("compact", &call(vec![input], vec![])).unwrap());
        assert_eq!(q.rpc.as_deref(), Some("compact_crdt_log"));
        assert!(q.soft);
        let body = q.body.unwrap();
        assert_eq!(body["p_resource_type"], "vault_page");
        assert_eq!(body["p_upto_id"], 7);
    }

    #[test]
    fn compact_maps_the_outcomes() {
        let input = || json!({"resourceType": "vault_page", "resourceId": "v1", "uptoId": 7});
        let denied = call(
            vec![input()],
            vec![json!({"error": {"code": "42501", "message": "no"}})],
        );
        assert_eq!(
            done(step("compact", &denied).unwrap()),
            json!({"status": "not-permitted"})
        );
        let gone = call(
            vec![input()],
            vec![json!({"error": {"code": "P0002", "message": "gone"}})],
        );
        assert_eq!(
            done(step("compact", &gone).unwrap()),
            json!({"status": "no-op", "reason": "missing"})
        );
        let ok = call(vec![input()], vec![json!(7)]);
        assert_eq!(
            done(step("compact", &ok).unwrap()),
            json!({"status": "compacted", "deleted": 7})
        );
    }

    #[test]
    fn compact_fails_on_other_errors() {
        let input = json!({"resourceType": "vault_page", "resourceId": "v1", "uptoId": 7});
        let missing_fn = call(
            vec![input],
            vec![json!({"error": {"code": "PGRST202", "message": "not found"}})],
        );
        let s = step("compact", &missing_fn).unwrap();
        assert_eq!(s, RepoStep::fail("not found"));
    }

    #[test]
    fn snapshot_of_an_unknown_type_is_zero_without_a_query() {
        let s = snapshot_step(
            "getSnapshotUpto",
            &call(vec![json!("nope"), json!("x")], vec![]),
        )
        .unwrap();
        assert_eq!(done(s), json!(0));
    }

    #[test]
    fn snapshot_reads_the_watermark_of_the_table() {
        let q = sent(
            snapshot_step(
                "getSnapshotUpto",
                &call(vec![json!("report_section"), json!("s1")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.table, "report_sections");
        assert_eq!(q.columns.as_deref(), Some("snapshot_upto"));
        let s = snapshot_step(
            "getSnapshotUpto",
            &call(
                vec![json!("report_section"), json!("s1")],
                vec![json!({"snapshot_upto": 9})],
            ),
        )
        .unwrap();
        assert_eq!(done(s), json!(9));
        let s = snapshot_step(
            "getSnapshotUpto",
            &call(
                vec![json!("report_section"), json!("s1")],
                vec![Value::Null],
            ),
        )
        .unwrap();
        assert_eq!(done(s), json!(0));
    }
}

//! The `screening_decisions` repository as Rust-planned queries, with its row mapping.
//!
//! Ported from `PostgrestScreeningRepository` in
//! `apps/web/src/features/reading-lists/infrastructure/parts.ts`. No reviewer filter: every
//! reviewer's row comes back, because the policies already decide which rows a caller may see.
//! Row mapping is [`decision_from_row`] and [`decision_to_row`].

use serde_json::json;

use crate::reading_lists::screening::{
    ScreeningDecision, ScreeningDecisionRow, decision_from_row, decision_to_row,
};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep};

const TABLE: &str = "screening_decisions";

/// The columns a [`ScreeningDecisionRow`] is read as, named rather than starred.
const SCREENING_DECISION_COLUMNS: &str = "id,item_id,reviewer_id,stage,state,reason,decided_at";

/// `record` conflicts on the natural key, so a changed answer replaces the reviewer's row.
const RECORD_CONFLICT: &str = "item_id,reviewer_id,stage";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "listForItems" => list_for_items(call),
        "record" => record(call),
        "remove" => remove(call),
        _ => return None,
    })
}

/// `listForItems(itemIds)`: every reviewer's decisions on these items, oldest first. No query
/// when there are no items.
fn list_for_items(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return decisions(call);
    }
    let item_ids: Vec<String> = match call.parse(0) {
        Ok(ids) => ids,
        Err(e) => return RepoStep::fail(e),
    };
    if item_ids.is_empty() {
        return RepoStep::done(&Vec::<ScreeningDecision>::new());
    }
    RepoStep::send(
        RepoQuery::select(TABLE, SCREENING_DECISION_COLUMNS)
            .filter("in", "item_id", json!(item_ids))
            .order("decided_at", true),
    )
}

/// Maps the reply rows to decisions; fails on the first row a stored value does not fit.
fn decisions(call: &RepoCall) -> RepoStep {
    match call.reply::<Vec<ScreeningDecisionRow>>(0) {
        Some(Ok(rows)) => match rows
            .iter()
            .map(decision_from_row)
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(found) => RepoStep::done(&found),
            Err(e) => RepoStep::fail(e),
        },
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `record(decision)`: upserts the decision on its natural key.
fn record(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let decision: ScreeningDecision = match call.parse(0) {
        Ok(decision) => decision,
        Err(e) => return RepoStep::fail(e),
    };
    match serde_json::to_value(decision_to_row(&decision)) {
        Ok(row) => {
            RepoStep::send(RepoQuery::upsert(TABLE, row).on_conflict(RECORD_CONFLICT, false))
        }
        Err(e) => RepoStep::fail(e),
    }
}

/// `remove(id)`: deletes the decision with this id.
fn remove(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};
    use serde_json::Value;

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

    fn row(state: &str) -> Value {
        json!({
            "id": "d1", "item_id": "i1", "reviewer_id": "u1", "stage": "title_abstract",
            "state": state, "reason": null, "decided_at": "2026-11-01T10:00:00Z"
        })
    }

    fn decision_input() -> Value {
        json!({
            "id": "d1", "itemId": "i1", "reviewerId": "u1", "stage": "full_text",
            "state": "excluded", "reason": "no data", "decidedAt": "2026-11-01T10:00:00Z"
        })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn list_for_items_reads_the_items_oldest_first() {
        let q = sent(step("listForItems", &call(vec![json!(["i1", "i2"])], vec![])).unwrap());
        assert_eq!(q.table, TABLE);
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.columns.as_deref(), Some(SCREENING_DECISION_COLUMNS));
        assert_eq!(q.filters[0].op, "in");
        assert_eq!(q.filters[0].column, "item_id");
        assert_eq!(q.filters[0].value, json!(["i1", "i2"]));
        assert_eq!(q.order[0].column, "decided_at");
        assert!(q.order[0].ascending);
    }

    #[test]
    fn list_for_items_without_items_sends_nothing() {
        let s = step("listForItems", &call(vec![json!([])], vec![])).unwrap();
        assert_eq!(done(s), json!([]));
    }

    #[test]
    fn list_for_items_maps_rows_to_decisions() {
        let s = step(
            "listForItems",
            &call(vec![], vec![json!([row("included")])]),
        )
        .unwrap();
        let value = done(s);
        assert_eq!(value[0]["itemId"], "i1");
        assert_eq!(value[0]["reviewerId"], "u1");
        assert_eq!(value[0]["stage"], "title_abstract");
        assert_eq!(value[0]["state"], "included");
    }

    #[test]
    fn list_for_items_fails_on_an_unknown_state() {
        let s = step("listForItems", &call(vec![], vec![json!([row("maybe")])])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn record_upserts_on_the_natural_key() {
        let q = sent(step("record", &call(vec![decision_input()], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some(RECORD_CONFLICT));
        assert!(!q.ignore_duplicates);
        let body = q.body.unwrap();
        assert_eq!(body["item_id"], "i1");
        assert_eq!(body["stage"], "full_text");
        assert_eq!(body["state"], "excluded");
    }

    #[test]
    fn record_finishes_after_the_reply() {
        assert_eq!(
            step("record", &call(vec![decision_input()], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn record_rejects_a_bad_decision() {
        let s = step("record", &call(vec![json!({"itemId": 1})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn remove_deletes_by_id() {
        let q = sent(step("remove", &call(vec![json!("d1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.filters[0].value, json!("d1"));
        assert_eq!(
            step("remove", &call(vec![json!("d1")], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }
}

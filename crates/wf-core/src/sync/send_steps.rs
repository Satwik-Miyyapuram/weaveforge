//! The decisions behind each PostgREST step of `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`.
//!
//! TS performs every fetch and hands the reply back here. A fetch that never
//! answered is passed as status `0` with an empty body, which every step reads
//! as "not answered" (the same results the old catch branches gave).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::postgrest_transport::{PullChange, RequestSpec, conflict_request, gone_request, held_ids, deleted_ids, parse_rows, to_change, tombstone_request, tombstones_for_request};
use super::postgrest_wire::error_info;
use super::send_verdict::{SendVerdict, absent_ids, classify_send, is_link_insert, missing_ids};

/// Ids per `in.(...)` read; a hundred uuids keep the URL well under any limit.
pub const MISSING_IDS_CHUNK: usize = 100;

/// The result of one write, as `SendOutcome` in `domain/parts.ts`. A `serverRow`
/// that is `None` is left out of the JSON (unknown); `Some(None)` is `null` (absent).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SendOutcome {
    /// The write was accepted, with its new version when the server gave one.
    Accepted {
        /// The new row version, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        new_version: Option<f64>,
    },
    /// The write could not reach the server.
    Offline,
    /// The server holds a different version of the row.
    Conflict {
        /// The version the server holds.
        server_version: Option<f64>,
        /// The server's copy of the row, when it was read.
        #[serde(skip_serializing_if = "Option::is_none")]
        server_row: Option<Option<Value>>,
        /// Whether the row was deleted on the server.
        #[serde(skip_serializing_if = "Option::is_none")]
        deleted_elsewhere: Option<bool>,
    },
    /// The write was refused.
    Refused {
        /// Why the write was refused.
        reason: String,
        /// Whether the write waits for its parent row.
        #[serde(skip_serializing_if = "Option::is_none")]
        awaiting_parent: Option<bool>,
    },
}

/// Which follow-up read is in flight.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// The follow-up read is checking whether the row is gone.
    Gone,
    /// The follow-up read is checking the conflicting row.
    Conflict,
    /// The follow-up read is checking for a tombstone.
    Tombstone,
}

/// What TS hands back, opaque to it, with the reply to the read in flight.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadState {
    table: String,
    row_id: String,
    /// A paper_tags insert whose conflict row is present is accepted (xlog link rule).
    link: bool,
    phase: Phase,
}

/// The next move after a write or a read: finished, or one more read.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "next", rename_all = "snake_case")]
pub enum SendStep {
    /// The write is finished with this outcome.
    Done {
        /// The outcome of the write.
        outcome: SendOutcome,
    },
    /// One more read is needed.
    Read {
        /// The read to send.
        request: RequestSpec,
        /// The state to resume from with the reply.
        state: ReadState,
    },
}

/// The step for a missing-id chunk after its presence read.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "next", rename_all = "snake_case")]
pub enum PresenceStep {
    /// The read could not be used: the whole `missingIds` answer is null.
    Failed,
    /// The missing ids are known.
    Done {
        /// The ids that are missing.
        missing: Vec<String>,
    },
    /// Tombstones must be read for the held ids.
    Tombstones {
        /// The read to send.
        request: RequestSpec,
        /// The ids held back until the tombstones are read.
        held: Vec<String>,
    },
}

/// A row is truthy as JS reads it: not null, false, 0, or an empty string.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `row.row_version` when it is a number.
fn row_version(row: &Value) -> Option<f64> {
    row.get("row_version")?.as_f64()
}

fn request_for(phase: Phase, table: &str, row_id: &str) -> RequestSpec {
    match phase {
        Phase::Gone => gone_request(table, row_id),
        Phase::Conflict => conflict_request(table, row_id),
        Phase::Tombstone => tombstone_request(table, row_id),
    }
}

fn read(table: &str, row_id: &str, link: bool, phase: Phase) -> SendStep {
    SendStep::Read {
        request: request_for(phase, table, row_id),
        state: ReadState {
            table: table.to_owned(),
            row_id: row_id.to_owned(),
            link,
            phase,
        },
    }
}

fn done(outcome: SendOutcome) -> SendStep {
    SendStep::Done { outcome }
}

fn refused(reason: String) -> SendOutcome {
    SendOutcome::Refused {
        reason,
        awaiting_parent: None,
    }
}

/// A paper_tags link whose conflict row is present is the same link another device made: accepted.
fn settle(link: bool, outcome: SendOutcome) -> SendOutcome {
    match outcome {
        SendOutcome::Conflict {
            server_version,
            server_row: Some(Some(_)),
            ..
        } if link => SendOutcome::Accepted {
            new_version: server_version,
        },
        other => other,
    }
}

/// The first step after a write's answer: the verdict, and any follow-up read it needs.
#[must_use]
pub fn send_start(status: u16, body: &str, op: &str, table: &str, row_id: &str) -> SendStep {
    let (code, first_line) = if status >= 400 {
        let info = error_info(body);
        (info.code, info.first_line)
    } else {
        (None, String::new())
    };
    let parsed = parse_rows(body);
    let rows = parsed.as_ref().map(Vec::len);
    match classify_send(status, code.as_deref(), rows) {
        SendVerdict::AwaitingParent => done(SendOutcome::Refused {
            reason: first_line,
            awaiting_parent: Some(true),
        }),
        SendVerdict::Conflict => read(table, row_id, is_link_insert(op, table), Phase::Conflict),
        SendVerdict::Offline => done(SendOutcome::Offline),
        SendVerdict::RlsRefused | SendVerdict::Refused => done(refused(first_line)),
        // A delete whose row is already gone is the outcome it wanted; anything else is a conflict.
        SendVerdict::GuardMissed if op == "delete" => read(table, row_id, false, Phase::Gone),
        SendVerdict::GuardMissed => read(table, row_id, false, Phase::Conflict),
        SendVerdict::Accepted => done(SendOutcome::Accepted {
            new_version: parsed.as_ref().and_then(|rows| rows.first()).and_then(row_version),
        }),
    }
}

/// The next step once the read in `state` has answered with `status` and `body`.
#[must_use]
pub fn send_advance(state: &ReadState, status: u16, body: &str) -> SendStep {
    let rows = parse_rows(body);
    let row = rows.as_ref().and_then(|rows| rows.first());
    match state.phase {
        Phase::Gone => {
            let gone = status < 400 && rows.as_ref().is_some_and(Vec::is_empty);
            if gone {
                done(SendOutcome::Accepted { new_version: None })
            } else {
                read(&state.table, &state.row_id, false, Phase::Conflict)
            }
        }
        Phase::Conflict => {
            let server_version = row.and_then(row_version);
            if status >= 400 || rows.is_none() {
                return done(settle(
                    state.link,
                    SendOutcome::Conflict {
                        server_version,
                        server_row: None,
                        deleted_elsewhere: None,
                    },
                ));
            }
            match row.filter(|row| truthy(row)) {
                Some(row) => done(settle(
                    state.link,
                    SendOutcome::Conflict {
                        server_version,
                        server_row: Some(Some(row.clone())),
                        deleted_elsewhere: None,
                    },
                )),
                None => read(&state.table, &state.row_id, state.link, Phase::Tombstone),
            }
        }
        Phase::Tombstone => {
            let deleted_elsewhere = if status >= 400 {
                None
            } else {
                rows.as_ref().map(|rows| !rows.is_empty())
            };
            done(SendOutcome::Conflict {
                server_version: None,
                server_row: Some(None),
                deleted_elsewhere,
            })
        }
    }
}

/// The chunks `missingIds` reads, in order.
#[must_use]
pub fn missing_id_chunks(ids: &[String]) -> Vec<Vec<String>> {
    ids.chunks(MISSING_IDS_CHUNK).map(<[String]>::to_vec).collect()
}

/// The step for one chunk after its presence read: done, or the tombstone read it needs.
#[must_use]
pub fn missing_after_presence(table: &str, chunk: &[String], status: u16, body: &str) -> PresenceStep {
    if status >= 400 {
        return PresenceStep::Failed;
    }
    let Some(rows) = parse_rows(body) else {
        return PresenceStep::Failed;
    };
    let held = held_ids(&rows);
    let absent = absent_ids(chunk, &held);
    if absent.is_empty() {
        return PresenceStep::Done { missing: Vec::new() };
    }
    PresenceStep::Tombstones {
        request: tombstones_for_request(table, &absent),
        held,
    }
}

/// The missing ids of one chunk after its tombstone read. `None` when that read cannot be used.
#[must_use]
pub fn missing_after_tombstones(chunk: &[String], held: &[String], status: u16, body: &str) -> Option<Vec<String>> {
    if status >= 400 {
        return None;
    }
    let rows = parse_rows(body)?;
    Some(missing_ids(chunk, held, &deleted_ids(&rows)))
}

/// The reply to `changesSince`: the changes, or the error text when the read failed.
#[derive(Debug, Clone, Serialize)]
pub struct ChangesReply {
    /// The error text when the read failed.
    pub error: Option<String>,
    /// The changes read from the feed.
    pub changes: Vec<PullChange>,
}

/// Builds the `changesSince` reply from the HTTP status and body.
#[must_use]
pub fn changes_from_reply(status: u16, body: &str) -> ChangesReply {
    if status >= 400 {
        let info = error_info(body);
        return ChangesReply {
            error: Some(format!("sync_changes failed ({status}): {}", info.first_line)),
            changes: Vec::new(),
        };
    }
    let changes = parse_rows(body)
        .unwrap_or_default()
        .iter()
        .map(to_change)
        .collect();
    ChangesReply { error: None, changes }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const ROW: &str = "11111111-1111-4111-8111-111111111111";
    const OTHER: &str = "22222222-2222-4222-8222-222222222222";

    fn done_outcome(step: SendStep) -> SendOutcome {
        match step {
            SendStep::Done { outcome } => outcome,
            SendStep::Read { .. } => panic!("expected a finished step"),
        }
    }

    #[test]
    fn a_missing_parent_is_refused_and_kept() {
        let body = r#"{"code":"23503","message":"parent missing"}"#;
        assert_eq!(
            done_outcome(send_start(409, body, "insert", "notes", ROW)),
            SendOutcome::Refused {
                reason: "parent missing".to_owned(),
                awaiting_parent: Some(true),
            }
        );
    }

    #[test]
    fn a_session_failure_is_offline() {
        assert_eq!(done_outcome(send_start(401, "", "update", "notes", ROW)), SendOutcome::Offline);
    }

    #[test]
    fn a_guarded_write_that_matched_nothing_reads_the_row() {
        let step = send_start(200, "[]", "update", "notes", ROW);
        let SendStep::Read { request, state } = step else {
            panic!("expected a read");
        };
        assert!(request.path.ends_with("select=*"));
        assert!(!state.link);
    }

    #[test]
    fn a_delete_whose_row_is_gone_is_accepted() {
        let step = send_start(200, "[]", "delete", "notes", ROW);
        let SendStep::Read { state, .. } = step else {
            panic!("expected the gone read");
        };
        assert_eq!(done_outcome(send_advance(&state, 200, "[]")), SendOutcome::Accepted { new_version: None });
    }

    #[test]
    fn a_conflict_with_a_row_carries_the_server_row_and_version() {
        let step = send_start(409, r#"{"code":"23505"}"#, "update", "notes", ROW);
        let SendStep::Read { state, .. } = step else {
            panic!("expected the conflict read");
        };
        let body = format!(r#"[{{"id":"{ROW}","row_version":4}}]"#);
        assert_eq!(
            done_outcome(send_advance(&state, 200, &body)),
            SendOutcome::Conflict {
                server_version: Some(4.0),
                server_row: Some(Some(json!({"id": ROW, "row_version": 4}))),
                deleted_elsewhere: None,
            }
        );
    }

    #[test]
    fn an_unreadable_conflict_read_says_nothing_about_the_row() {
        let step = send_start(409, r#"{"code":"23505"}"#, "update", "notes", ROW);
        let SendStep::Read { state, .. } = step else {
            panic!("expected the conflict read");
        };
        assert_eq!(
            done_outcome(send_advance(&state, 0, "")),
            SendOutcome::Conflict {
                server_version: None,
                server_row: None,
                deleted_elsewhere: None,
            }
        );
    }

    #[test]
    fn a_paper_tag_link_already_present_is_accepted() {
        let step = send_start(409, r#"{"code":"23505"}"#, "insert", "paper_tags", ROW);
        let SendStep::Read { state, .. } = step else {
            panic!("expected the conflict read");
        };
        let body = format!(r#"[{{"id":"{ROW}","row_version":2}}]"#);
        assert_eq!(
            done_outcome(send_advance(&state, 200, &body)),
            SendOutcome::Accepted { new_version: Some(2.0) }
        );
    }

    #[test]
    fn a_row_absent_with_a_tombstone_says_deleted_elsewhere() {
        let step = send_start(409, r#"{"code":"23505"}"#, "update", "notes", ROW);
        let SendStep::Read { state, .. } = step else {
            panic!("expected the conflict read");
        };
        let SendStep::Read { state, .. } = send_advance(&state, 200, "[]") else {
            panic!("expected the tombstone read");
        };
        assert_eq!(
            done_outcome(send_advance(&state, 200, r#"[{"row_id":"x"}]"#)),
            SendOutcome::Conflict {
                server_version: None,
                server_row: Some(None),
                deleted_elsewhere: Some(true),
            }
        );
    }

    #[test]
    fn a_chunk_plan_keeps_order_and_splits_at_the_limit() {
        let ids: Vec<String> = (0..250).map(|n| n.to_string()).collect();
        let chunks = missing_id_chunks(&ids);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[2].len(), 50);
        assert!(missing_id_chunks(&[]).is_empty());
    }

    #[test]
    fn a_presence_read_with_every_id_held_is_done_without_a_tombstone_read() {
        let chunk = [ROW.to_owned()];
        let body = format!(r#"[{{"id":"{ROW}"}}]"#);
        assert!(matches!(
            missing_after_presence("papers", &chunk, 200, &body),
            PresenceStep::Done { missing } if missing.is_empty()
        ));
    }

    #[test]
    fn a_presence_read_with_an_absent_id_asks_the_tombstones() {
        let chunk = [ROW.to_owned(), OTHER.to_owned()];
        let body = format!(r#"[{{"id":"{ROW}"}}]"#);
        let PresenceStep::Tombstones { request, held } = missing_after_presence("papers", &chunk, 200, &body) else {
            panic!("expected the tombstone read");
        };
        assert!(request.path.starts_with("/sync_tombstones?table_name=eq.papers&row_id=in.("));
        assert_eq!(held, vec![ROW.to_owned()]);
        assert_eq!(
            missing_after_tombstones(&chunk, &held, 200, &format!(r#"[{{"row_id":"{OTHER}"}}]"#)),
            Some(Vec::new())
        );
        assert_eq!(missing_after_tombstones(&chunk, &held, 200, "[]"), Some(vec![OTHER.to_owned()]));
        assert_eq!(missing_after_tombstones(&chunk, &held, 500, "[]"), None);
    }

    #[test]
    fn an_unreadable_changes_reply_names_the_status_and_reason() {
        let reply = changes_from_reply(500, r#"{"message":"boom"}"#);
        assert_eq!(reply.error.as_deref(), Some("sync_changes failed (500): boom"));
        assert!(reply.changes.is_empty());
    }
}

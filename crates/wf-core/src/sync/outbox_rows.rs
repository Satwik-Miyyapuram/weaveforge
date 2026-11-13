//! Ports `toEntry` in `apps/web/src/features/offline-sync/domain/parts-2.ts`: a
//! `sync_outbox` row as the local database returns it, mapped to the entry the
//! sync engine works with. The SQL that reads and writes the outbox stays in TS;
//! this is the row shape only, and it maps a whole result set in one call.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A number the database may send as text (a `bigint` or `numeric`), read the way
/// JavaScript's `Number()` reads it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum JsNumber {
    /// A value the driver already sent as a number.
    Number(f64),
    /// A value the driver sent as text.
    Text(String),
}

impl JsNumber {
    /// `Number(value)`: blank text is zero, text that is not a decimal is NaN.
    #[must_use]
    pub fn to_number(&self) -> f64 {
        match self {
            Self::Number(value) => *value,
            Self::Text(text) => js_number_from_text(text),
        }
    }
}

/// `Number(text)` for the decimal text the database sends. Words JavaScript
/// refuses (`inf`, `nan`) are NaN here too.
fn js_number_from_text(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("inf") || lower.contains("nan") {
        return f64::NAN;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

/// One `sync_outbox` row as the local database returns it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct OutboxRow {
    /// The queue position, a bigint the driver may send as text.
    pub seq: JsNumber,
    /// The op's id, shared by every retry of it.
    pub op_id: String,
    /// The synced table the op writes.
    pub table_name: String,
    /// The row the op writes.
    pub row_id: String,
    /// `insert`, `update` or `delete`.
    pub op: String,
    /// The whole row (insert, update) or the id (delete).
    pub payload: Value,
    /// The row as the server held it when the edit was made, if known.
    #[serde(default)]
    pub base_payload: Option<Value>,
    /// The server version the edit was based on, if known.
    pub base_version: Option<i64>,
    /// How many times the op has been tried.
    pub attempts: i64,
    /// Why the last attempt failed.
    pub last_error: Option<String>,
}

/// An outbox op as the sync engine reads it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxEntry {
    /// The queue position, as a number.
    pub seq: f64,
    /// The op's id.
    pub op_id: String,
    /// The synced table the op writes.
    pub table: String,
    /// The row the op writes.
    pub row_id: String,
    /// `insert`, `update` or `delete`.
    pub op: String,
    /// The payload the op carries.
    pub payload: Value,
    /// The server version the edit was based on.
    pub base_version: Option<i64>,
    /// The row as the server held it, if known.
    pub base_payload: Option<Value>,
    /// How many times the op has been tried.
    pub attempts: i64,
    /// Why the last attempt failed.
    pub last_error: Option<String>,
}

/// `toEntry` for one row.
#[must_use]
pub fn outbox_entry(row: &OutboxRow) -> OutboxEntry {
    OutboxEntry {
        seq: row.seq.to_number(),
        op_id: row.op_id.clone(),
        table: row.table_name.clone(),
        row_id: row.row_id.clone(),
        op: row.op.clone(),
        payload: row.payload.clone(),
        base_version: row.base_version,
        base_payload: row.base_payload.clone(),
        attempts: row.attempts,
        last_error: row.last_error.clone(),
    }
}

/// `toEntry` for every row of a result set, in the same order.
#[must_use]
pub fn outbox_entries(rows: &[OutboxRow]) -> Vec<OutboxEntry> {
    rows.iter().map(outbox_entry).collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{JsNumber, OutboxRow, outbox_entries, outbox_entry};

    fn row(seq: JsNumber) -> OutboxRow {
        OutboxRow {
            seq,
            op_id: "op-1".to_owned(),
            table_name: "papers".to_owned(),
            row_id: "row-1".to_owned(),
            op: "update".to_owned(),
            payload: json!({ "title": "A" }),
            base_payload: None,
            base_version: Some(4),
            attempts: 2,
            last_error: Some("boom".to_owned()),
        }
    }

    // it: "carries the payload and the version the edit was based on"
    #[test]
    fn carries_payload_and_base_version() {
        let entry = outbox_entry(&row(JsNumber::Number(7.0)));
        assert_eq!(entry.payload, json!({ "title": "A" }));
        assert_eq!(entry.base_version, Some(4));
        assert_eq!(entry.base_payload, None);
        assert_eq!(entry.table, "papers");
        assert_eq!(entry.row_id, "row-1");
        assert_eq!(entry.attempts, 2);
        assert_eq!(entry.last_error.as_deref(), Some("boom"));
    }

    #[test]
    fn text_seq_reads_as_a_number() {
        assert_eq!(
            outbox_entry(&row(JsNumber::Text("12".to_owned()))).seq,
            12.0
        );
        assert_eq!(
            outbox_entry(&row(JsNumber::Text(" 3 ".to_owned()))).seq,
            3.0
        );
        assert_eq!(outbox_entry(&row(JsNumber::Text(String::new()))).seq, 0.0);
    }

    #[test]
    fn text_seq_that_is_not_a_decimal_is_nan() {
        assert!(
            outbox_entry(&row(JsNumber::Text("x1".to_owned())))
                .seq
                .is_nan()
        );
        assert!(
            outbox_entry(&row(JsNumber::Text("inf".to_owned())))
                .seq
                .is_nan()
        );
    }

    #[test]
    fn entries_keep_row_order() {
        let rows = [row(JsNumber::Number(2.0)), row(JsNumber::Number(1.0))];
        let seqs: Vec<f64> = outbox_entries(&rows).iter().map(|e| e.seq).collect();
        assert_eq!(seqs, vec![2.0, 1.0]);
    }

    #[test]
    fn empty_result_set_is_empty() {
        assert!(outbox_entries(&[]).is_empty());
    }
}

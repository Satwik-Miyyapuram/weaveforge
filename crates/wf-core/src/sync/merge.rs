//! Port of `packages/core/src/shared/three-way-merge.ts`: a per-field three-way
//! merge of rows. Missing keys read as JS `undefined`, which is `null` in
//! conflicts and absent from the merged row.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::sync::instant::parse_instant;

/// Columns the sync machinery owns; the server is the only author of them.
const RESERVED: [&str; 4] = ["id", "server_seq", "row_version", "created_at"];

/// A field that both sides moved to different values.
#[derive(Debug, Clone, PartialEq)]
pub struct Conflict {
    /// Column name.
    pub field: String,
    /// Value in the common base, `null` when absent.
    pub base: Value,
    /// Value on this device, `null` when absent.
    pub local: Value,
    /// Value on the server, `null` when absent.
    pub remote: Value,
}

/// A merged row and the conflicts the reader has to decide.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeResult {
    /// The row with the server's values, overridden by local-only edits.
    pub merged: Map<String, Value>,
    /// Conflicts, sorted by field name.
    pub conflicts: Vec<Conflict>,
}

/// Merges `local` and `remote` against their common `base`, field by field.
#[must_use]
pub fn merge_rows(
    base: &Map<String, Value>,
    local: &Map<String, Value>,
    remote: &Map<String, Value>,
) -> MergeResult {
    let mut merged = remote.clone();
    let mut conflicts = Vec::new();
    let fields: BTreeSet<&str> = local
        .keys()
        .chain(remote.keys())
        .map(String::as_str)
        .collect();

    for field in fields {
        if RESERVED.contains(&field) {
            continue;
        }
        let b = base.get(field);
        let l = local.get(field);
        let r = remote.get(field);

        // Nobody touched it, or only one side did: there is nothing to decide.
        if same_value(&or_null(b), &or_null(l)) {
            continue;
        }
        if same_value(&or_null(b), &or_null(r)) {
            set_field(&mut merged, field, l);
            continue;
        }
        // Both moved it to the same place. Agreement is not a conflict.
        if same_value(&or_null(l), &or_null(r)) {
            set_field(&mut merged, field, l);
            continue;
        }
        // An edit stamp is not work: the later one wins.
        if field == "updated_at" {
            set_field(&mut merged, field, later_stamp(l, r));
            continue;
        }
        // The server's value stands so this device agrees with it until the reader decides.
        conflicts.push(Conflict {
            field: field.to_owned(),
            base: or_null(b),
            local: or_null(l),
            remote: or_null(r),
        });
    }

    MergeResult { merged, conflicts }
}

/// Equality as the database means it: a missing value equals `null`, and
/// timestamps are the same when they are the same instant.
#[must_use]
pub fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, _) | (_, Value::Null) => matches!((a, b), (Value::Null, Value::Null)),
        (Value::String(x), Value::String(y)) => {
            x == y || matches!((instant_text(x), instant_text(y)), (Some(p), Some(q)) if p == q)
        }
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Object(_) | Value::Array(_), Value::Object(_) | Value::Array(_)) => {
            json_equal(a, b)
        }
        _ => false,
    }
}

/// Structural equality; key order is ignored, nested strings compare exactly.
fn json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| json_equal(v, w)))
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(v, w)| json_equal(v, w))
        }
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}

/// Sets `field` to `value`, or removes it when `value` is absent (JS `undefined`).
fn set_field(merged: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    match value {
        Some(v) => {
            let _ = merged.insert(field.to_owned(), v.clone());
        }
        None => {
            let _ = merged.remove(field);
        }
    }
}

/// The later `updated_at`; the remote one when either side is not an instant.
fn later_stamp<'a>(local: Option<&'a Value>, remote: Option<&'a Value>) -> Option<&'a Value> {
    match (instant_of(local), instant_of(remote)) {
        (Some(l), Some(r)) if l > r => local,
        _ => remote,
    }
}

fn or_null(value: Option<&Value>) -> Value {
    value.cloned().unwrap_or(Value::Null)
}

fn instant_of(value: Option<&Value>) -> Option<i64> {
    value?.as_str().and_then(instant_text)
}

/// Epoch ms for a timestamp string; the TS gate accepts only `T` or a space as separator.
fn instant_text(text: &str) -> Option<i64> {
    if text.as_bytes().get(10) == Some(&b't') {
        return None;
    }
    parse_instant(text)
}

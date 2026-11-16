//! Two devices saving one note body, against an in-memory table that behaves
//! like the server: every write bumps `row_version`, and a write filtered on a
//! version it no longer has changes nothing and returns no rows.

#![allow(clippy::expect_used, clippy::panic)]

use serde_json::{Value, json};
use wf_core::repo_query::{RepoAction, RepoCall, RepoCtx, RepoQuery, RepoStep};
use wf_core::repos::vault_pages::step;
use wf_core::sync::instant::{format_instant, parse_instant};

#[derive(Default)]
struct Table {
    rows: Vec<Value>,
}

impl Table {
    fn with_page(body: &str) -> Self {
        Self {
            rows: vec![json!({
                "id": "p1", "title": "Plan", "body": body, "body_preview": null,
                "parent_id": null, "pinned": false, "folder": false, "sort_order": 1.0,
                "created_at": "2026-01-01T00:00:00Z",
                // Microseconds, as Postgres keeps them; reads see milliseconds.
                "updated_at": "2026-01-01T00:00:00.000456Z",
                "row_version": 1
            })],
        }
    }

    fn matches(row: &Value, query: &RepoQuery) -> bool {
        query
            .filters
            .iter()
            .filter(|f| f.column != "project_id")
            .all(|f| match f.op.as_str() {
                "eq" => row.get(&f.column) == Some(&f.value),
                "gte" | "lt" => {
                    let at = |v: Option<&Value>| v.and_then(Value::as_str).and_then(parse_instant);
                    let (Some(have), Some(bound)) = (at(row.get(&f.column)), at(Some(&f.value)))
                    else {
                        return false;
                    };
                    if f.op == "gte" {
                        have >= bound
                    } else {
                        have < bound
                    }
                }
                other => panic!("unexpected filter {other}"),
            })
    }

    /// A row as the local database hands it out: times cut to milliseconds.
    fn read(row: &Value) -> Value {
        let mut row = row.clone();
        if let Some(ms) = row["updated_at"].as_str().and_then(parse_instant) {
            row["updated_at"] = json!(format_instant(ms));
        }
        row
    }

    fn answer(&mut self, query: &RepoQuery) -> Value {
        match query.action {
            RepoAction::Select => self
                .rows
                .iter()
                .find(|row| Self::matches(row, query))
                .map_or(Value::Null, Self::read),
            RepoAction::Update => {
                let patch = query.body.clone().unwrap_or_default();
                let mut hit = Vec::new();
                for row in &mut self.rows {
                    if !Self::matches(row, query) {
                        continue;
                    }
                    for (k, v) in patch.as_object().into_iter().flatten() {
                        row[k] = v.clone();
                    }
                    let next = row["row_version"].as_i64().unwrap_or(0) + 1;
                    row["row_version"] = json!(next);
                    hit.push(json!({ "id": row["id"] }));
                }
                Value::Array(hit)
            }
            RepoAction::Upsert => {
                let mut row = query.body.clone().unwrap_or_default();
                row["row_version"] = json!(1);
                self.rows.push(row);
                Value::Null
            }
            ref other => panic!("unexpected {other:?}"),
        }
    }

    fn body(&self, id: &str) -> String {
        self.rows
            .iter()
            .find(|row| row["id"] == id)
            .and_then(|row| row["body"].as_str())
            .unwrap_or_default()
            .to_owned()
    }
}

/// One device's save in progress: its arguments and the replies so far.
struct Save {
    call: RepoCall,
}

impl Save {
    fn new(device: &str, base: &str, mine: &str) -> Self {
        Self {
            call: RepoCall {
                args: vec![json!("p1"), json!({ "body": mine, "baseBody": base })],
                replies: Vec::new(),
                ctx: RepoCtx {
                    project_id: Some("proj".into()),
                    id_seed: Some(device.into()),
                    now: Some("2026-11-16T10:00:00.000Z".into()),
                    ..RepoCtx::default()
                },
            },
        }
    }

    /// Answers one query; `Some` once the save has finished.
    fn tick(&mut self, table: &mut Table) -> Option<RepoStep> {
        match step("update", &self.call).expect("a known method") {
            RepoStep::Send { queries } => {
                for query in &queries {
                    self.call.replies.push(table.answer(query));
                }
                None
            }
            finished => Some(finished),
        }
    }

    fn finish(&mut self, table: &mut Table) -> Value {
        loop {
            if let Some(step) = self.tick(table) {
                match step {
                    RepoStep::Done { value } => return value,
                    other => panic!("save failed: {other:?}"),
                }
            }
        }
    }
}

const BASE: &str = "# Plan\n\nintro\n\nmethods\n\nresults";

#[test]
fn a_save_made_from_a_stale_body_merges_instead_of_overwriting() {
    let mut table = Table::with_page(BASE);
    // Both devices opened version 1. A reads, then B saves, then A writes.
    let mut laptop = Save::new(
        "laptop",
        BASE,
        "# Plan\n\nintro, rewritten\n\nmethods\n\nresults",
    );
    let mut phone = Save::new("phone", BASE, "# Plan\n\nintro\n\nmethods\n\nresults: 42%");
    assert!(laptop.tick(&mut table).is_none()); // laptop has read version 1
    let _ = phone.finish(&mut table);
    let saved = laptop.finish(&mut table);

    let both = "# Plan\n\nintro, rewritten\n\nmethods\n\nresults: 42%";
    assert_eq!(table.body("p1"), both);
    assert_eq!(saved["body"], both, "the editor learns what was stored");
    assert_eq!(table.rows.len(), 1, "no copy for edits that fit together");
}

#[test]
fn clashing_saves_keep_both_texts() {
    let mut table = Table::with_page(BASE);
    let mut laptop = Save::new("laptop", BASE, "# Plan\n\nintro\n\nmethods\n\nresults: 40%");
    let mut phone = Save::new("phone", BASE, "# Plan\n\nintro\n\nmethods\n\nresults: 42%");
    let _ = phone.finish(&mut table);
    let saved = laptop.finish(&mut table);

    assert_eq!(
        table.body("p1"),
        "# Plan\n\nintro\n\nmethods\n\nresults: 40%"
    );
    let copy_id = saved["conflictCopyId"].as_str().expect("a conflict copy");
    assert_eq!(
        table.body(copy_id),
        "# Plan\n\nintro\n\nmethods\n\nresults: 42%"
    );
    let copy = table.rows.iter().find(|r| r["id"] == copy_id).unwrap();
    assert!(
        copy["title"]
            .as_str()
            .unwrap()
            .starts_with("Plan (conflict copy ")
    );
}

#[test]
fn a_save_with_no_one_else_writing_lands_in_one_read_and_one_write() {
    let mut table = Table::with_page(BASE);
    let mut laptop = Save::new("laptop", BASE, "changed");
    let _ = laptop.finish(&mut table);
    assert_eq!(laptop.call.replies.len(), 2);
    assert_eq!(table.body("p1"), "changed");
    assert_eq!(table.rows[0]["row_version"], 2);
}

#[test]
fn an_edit_between_read_and_write_survives_the_version_coming_back() {
    let mut table = Table::with_page(BASE);
    let mut laptop = Save::new(
        "laptop",
        BASE,
        "# Plan\n\nintro, rewritten\n\nmethods\n\nresults",
    );
    assert!(laptop.tick(&mut table).is_none()); // laptop has read version 1
    // Another writer on this device saves (version 2), then the sync's ack sets
    // the version back to the one the server gave: 1 again (ABA).
    table.rows[0]["body"] = json!("# Plan\n\nintro\n\nmethods\n\nresults: 42%");
    table.rows[0]["updated_at"] = json!("2026-11-16T09:59:00.500123Z");
    table.rows[0]["row_version"] = json!(1);
    let saved = laptop.finish(&mut table);

    let both = "# Plan\n\nintro, rewritten\n\nmethods\n\nresults: 42%";
    assert_eq!(table.body("p1"), both, "the other edit is merged, not lost");
    assert_eq!(saved["body"], both);
}

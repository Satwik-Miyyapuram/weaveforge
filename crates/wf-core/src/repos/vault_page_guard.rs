//! A note-body save that cannot overwrite an edit it never saw.
//!
//! `vaultPages.update(id, { body, baseBody })` names the body the editor started
//! from. The page is read with its `row_version`, and the write only lands if
//! the version is unchanged. What is written depends on what the page holds
//! (`theirs`) next to the editor's `base` and its new text (`mine`):
//!
//! - `theirs == base`, or `theirs` is a body this editor's live session already
//!   saved (`sessionDigests`): nobody else wrote, so `mine` is written.
//! - `theirs == mine`: nothing to write.
//! - otherwise the three are merged line by line ([`merge_text`]); a clean
//!   merge is written. When both sides changed the same lines, `mine` is
//!   written and `theirs` is first kept as a new page beside it, the
//!   "conflict copy", so neither edit is lost. A canvas note merges the same
//!   way, but a merge that no longer parses as a canvas counts as a clash.
//!
//! A write that misses the version (someone saved in between) reads again and
//! decides again, up to [`ATTEMPTS`] times. The write also names the
//! `updated_at` it read (to the millisecond, all a local read gives): the
//! sync's ack can set `row_version` back to the server's number, so an edit
//! made in between could leave the version as it was read (ABA), never the time. A retry that clashes again reuses
//! the same copy, and a copy made on any attempt is reported. Titles are
//! unique per project, so a copy whose title is taken (a second copy in the
//! same second, here or on another device) ends in a tag from its own id. A missed write
//! whose re-read shows the same version was refused by the row policy.

use serde::Deserialize;
use serde_json::{Value, json};

use super::vault_pages::{TABLE, VAULT_PAGE_COLUMNS, save, scoped};
use crate::canvas::parse_canvas;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep};
use crate::sync::change_origin::digest_text;
use crate::sync::instant::{format_instant, parse_instant};
use crate::sync::text_merge::{TextMerge, merge_text};
use crate::vault::page::{CANVAS_KIND, NewVaultPageInput, VaultPage, create_vault_page};
use crate::vault::page_row::{VaultPageRow, to_domain};

/// How many times a save re-reads after losing the version race.
pub const ATTEMPTS: usize = 3;

/// The input of a guarded body save: only these fields, nothing else.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GuardedBody {
    body: String,
    base_body: String,
    #[serde(default)]
    session_digests: Vec<String>,
}

/// What one read of the page decided.
enum Plan {
    /// The page already holds this body.
    Keep,
    /// Write this body.
    Write(String),
    /// Keep the page's body as a new page, then write `mine`.
    CopyThenWrite,
}

fn plan(base: &str, mine: &str, theirs: &str, session: &[String], canvas: bool) -> Plan {
    if theirs == mine {
        return Plan::Keep;
    }
    if theirs == base || session.iter().any(|d| *d == digest_text(theirs)) {
        return Plan::Write(mine.to_owned());
    }
    match merge_text(base, mine, theirs) {
        TextMerge::Clean(merged) if merged == theirs => Plan::Keep,
        // Lines merged cleanly can still break the JSON (a comma, a bracket).
        TextMerge::Clean(merged) if canvas && parse_canvas(&merged).is_err() => Plan::CopyThenWrite,
        TextMerge::Clean(merged) => Plan::Write(merged),
        TextMerge::Conflict => Plan::CopyThenWrite,
    }
}

/// The next query, or the reply at `at` when it is in.
fn reply_or_send(call: &RepoCall, at: usize, query: RepoQuery) -> Result<&Value, RepoStep> {
    call.replies.get(at).ok_or_else(|| RepoStep::send(query))
}

/// Postgres: a row with the same unique key already exists.
const UNIQUE_VIOLATION: &str = "23505";

/// The title of the copy that keeps the other side's text. `tag` tells apart
/// copies made in the same second (empty for the first try).
fn copy_title(title: &str, now: &str, tag: &str) -> String {
    let when = now.get(..19).unwrap_or(now).replace('T', " ");
    if tag.is_empty() {
        return format!("{title} (conflict copy {when})");
    }
    format!("{title} (conflict copy {when}) {tag}")
}

/// The tag for try `level` of the copy with `id`: none, its first 8 characters,
/// then the whole id, which no other page has.
fn copy_tag(id: &str, level: usize) -> &str {
    match level {
        0 => "",
        1 => id.get(..8).unwrap_or(id),
        _ => id,
    }
}

/// Saves the `n`th conflict copy from reply `at`; `Ok` holds the next reply
/// offset and the copy's id. The unique title index refuses a title another
/// page holds (23505), e.g. a copy another device made in the same second:
/// the copy is then saved again with a tag from its own id.
fn keep_copy(
    call: &RepoCall,
    mut at: usize,
    existing: &VaultPage,
    n: usize,
) -> Result<(usize, Value), RepoStep> {
    let id = call.id(n);
    // A later copy in one call shares the first one's second: tag it at once.
    let mut level = usize::from(n > 0);
    loop {
        let copy = conflict_copy(call, existing, &id, copy_tag(&id, level))?;
        let Some(reply) = call.replies.get(at) else {
            return Err(soft(save(&call.sub(vec![copy], at))));
        };
        at += 1;
        let Some(error) = reply.get("error") else {
            return Ok((at, json!(id)));
        };
        if level < 2 && call.reply_error_code(at - 1) == Some(UNIQUE_VIOLATION) {
            level += 1;
            continue;
        }
        let message = error.get("message").and_then(Value::as_str).unwrap_or("");
        return Err(RepoStep::fail(message));
    }
}

/// `step` with its queries made soft, so a refusal comes back as a reply.
fn soft(step: RepoStep) -> RepoStep {
    match step {
        RepoStep::Send { queries } => RepoStep::Send {
            queries: queries.into_iter().map(RepoQuery::soft).collect(),
        },
        other => other,
    }
}

/// `update(id, { body, baseBody })` as a guarded save; `None` when the input is
/// not exactly that, so the plain update handles it.
#[must_use]
pub fn update(call: &RepoCall) -> Option<RepoStep> {
    let input: GuardedBody = call.parse(1).ok()?;
    Some(run(call, &input))
}

fn run(call: &RepoCall, input: &GuardedBody) -> RepoStep {
    let id = call.text(0).to_owned();
    let mut at = 0;
    // The ids of the copies this save made, oldest first.
    let mut copy_ids: Vec<Value> = Vec::new();
    // The bodies kept as copies so far: a retry copies only text not yet kept.
    let mut copied: Vec<String> = Vec::new();
    let mut missed: Option<Stamp> = None;
    for _ in 0..ATTEMPTS {
        let (stamp, existing) = match read(call, at, &id) {
            Ok(read) => read,
            Err(step) => return step,
        };
        at += 1;
        // Without a version the write is unconditional, so an empty reply was
        // the row policy refusing it, never a lost race: the same as when the
        // version did not move.
        if missed == Some(stamp) {
            return RepoStep::fail_named(
                "VaultPagePermissionError",
                format!("You may not edit the vault page \"{id}\"."),
            );
        }
        let text = match plan(
            &input.base_body,
            &input.body,
            &existing.body,
            &input.session_digests,
            existing.summary.kind.as_deref() == Some(CANVAS_KIND),
        ) {
            Plan::Keep => return finish(&existing, &copy_ids),
            Plan::Write(text) => text,
            Plan::CopyThenWrite => {
                if !copied.contains(&existing.body) {
                    let (next, id) = match keep_copy(call, at, &existing, copied.len()) {
                        Ok(kept) => kept,
                        Err(step) => return step,
                    };
                    at = next;
                    copied.push(existing.body.clone());
                    copy_ids.push(id);
                }
                input.body.clone()
            }
        };
        let now = call.now().to_owned();
        let write = scoped(
            RepoQuery::update(TABLE, json!({ "body": text, "updated_at": now })),
            call,
        )
        .eq("id", id.as_str());
        let write = unchanged_since(write, stamp);
        let written = match reply_or_send(call, at, write.returning("id")) {
            Ok(written) => written,
            Err(step) => return step,
        };
        at += 1;
        if written.as_array().is_some_and(Vec::is_empty) {
            missed = Some(stamp);
            continue; // Someone saved in between, or the policy refused: read again.
        }
        let mut page = existing;
        page.body = text;
        page.summary.updated_at = now;
        return finish(&page, &copy_ids);
    }
    RepoStep::fail_named(
        "VaultPageConflictError",
        "This note kept changing while it was being saved; your text is still in the editor.",
    )
}

/// What a write checks is unchanged: `row_version`, and `updated_at` in epoch
/// milliseconds. Either is `None` when the row does not have it.
type Stamp = (Option<i64>, Option<i64>);

/// Narrows `write` to the row only while it still has `stamp`.
fn unchanged_since(mut write: RepoQuery, stamp: Stamp) -> RepoQuery {
    if let Some(version) = stamp.0 {
        write = write.eq("row_version", version);
    }
    if let Some(ms) = stamp.1 {
        write = write
            .filter("gte", "updated_at", format_instant(ms))
            .filter("lt", "updated_at", format_instant(ms + 1));
    }
    write
}

/// The page at reply `at` with its [`Stamp`], or the step that reads it.
fn read(call: &RepoCall, at: usize, id: &str) -> Result<(Stamp, VaultPage), RepoStep> {
    let query = scoped(
        RepoQuery::select(TABLE, &format!("{VAULT_PAGE_COLUMNS},row_version")),
        call,
    )
    .eq("id", id)
    .maybe_single();
    let row = reply_or_send(call, at, query)?;
    if row.is_null() {
        return Err(RepoStep::fail_named(
            "NotFoundError",
            format!("No vault page with id \"{id}\"."),
        ));
    }
    let version = row.get("row_version").and_then(Value::as_i64);
    let updated = row
        .get("updated_at")
        .and_then(Value::as_str)
        .and_then(parse_instant);
    let row = serde_json::from_value::<VaultPageRow>(row.clone()).map_err(RepoStep::fail)?;
    Ok(((version, updated), to_domain(&row)))
}

/// The saved page, naming the conflict copies when any were made:
/// `conflictCopyId` is the last, `conflictCopyIds` all of them (F97-P2-12).
fn finish(page: &VaultPage, copy_ids: &[Value]) -> RepoStep {
    let mut value = match serde_json::to_value(page) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    if let (Some(last), Some(obj)) = (copy_ids.last(), value.as_object_mut()) {
        let _ = obj.insert("conflictCopyId".into(), last.clone());
        let _ = obj.insert("conflictCopyIds".into(), Value::Array(copy_ids.to_vec()));
    }
    RepoStep::Done { value }
}

/// A new page `id` beside `existing` holding the body it had, as `save` takes
/// it. The id is fixed per copy, so a replayed step names the same copy.
/// A retry that meets other clashing text makes another copy rather than
/// overwrite this one: the newer text need not be built on the older (a plain
/// update writes the body without a base).
fn conflict_copy(
    call: &RepoCall,
    existing: &VaultPage,
    id: &str,
    tag: &str,
) -> Result<Value, RepoStep> {
    let input = NewVaultPageInput {
        title: copy_title(&existing.summary.title, call.now(), tag),
        body: Some(existing.body.clone()),
        parent_id: existing.summary.parent_id.clone(),
        folder: None,
        kind: existing.summary.kind.clone(),
        sort_order: Some(existing.summary.sort_order),
        id: None,
        created_at: None,
    };
    let page = create_vault_page(&input, id, call.now())
        .map_err(|e| RepoStep::fail_named("VaultPageValidationError", e))?;
    serde_json::to_value(page).map_err(RepoStep::fail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

    const NOW: &str = "2026-11-12T09:00:00.000Z";

    fn call(input: Value, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args: vec![json!("p1"), input],
            replies,
            ctx: RepoCtx {
                project_id: Some("proj".into()),
                id_seed: Some("seed".into()),
                now: Some(NOW.into()),
                ..RepoCtx::default()
            },
        }
    }

    fn input(base: &str, body: &str) -> Value {
        json!({ "body": body, "baseBody": base })
    }

    fn row(body: &str, version: i64) -> Value {
        json!({
            "id": "p1", "title": "Home", "body": body, "body_preview": null,
            "parent_id": "f1", "pinned": false, "folder": false, "sort_order": 2.0,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z",
            "row_version": version
        })
    }

    fn step(input: Value, replies: Vec<Value>) -> RepoStep {
        update(&call(input, replies)).expect("a guarded save")
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn filters(query: &RepoQuery) -> Vec<(String, Value)> {
        query
            .filters
            .iter()
            .map(|f| (f.column.clone(), f.value.clone()))
            .collect()
    }

    #[test]
    fn any_other_input_is_left_to_the_plain_update() {
        let plain = call(json!({ "body": "x" }), vec![]);
        assert!(update(&plain).is_none());
        let with_title = call(json!({ "body": "x", "baseBody": "", "title": "T" }), vec![]);
        assert!(update(&with_title).is_none());
    }

    #[test]
    fn reads_the_page_with_its_version_in_the_project() {
        let read = only(step(input("a", "b"), vec![]));
        assert_eq!(read.action, RepoAction::Select);
        assert!(read.columns.as_deref().unwrap().ends_with(",row_version"));
        assert_eq!(
            filters(&read),
            vec![
                ("project_id".into(), json!("proj")),
                ("id".into(), json!("p1"))
            ]
        );
    }

    #[test]
    fn writes_only_if_the_version_and_time_are_unchanged() {
        let write = only(step(input("a", "b"), vec![row("a", 7)]));
        assert_eq!(write.action, RepoAction::Update);
        assert_eq!(write.body, Some(json!({ "body": "b", "updated_at": NOW })));
        assert_eq!(
            filters(&write),
            vec![
                ("project_id".into(), json!("proj")),
                ("id".into(), json!("p1")),
                ("row_version".into(), json!(7)),
                ("updated_at".into(), json!("2026-01-02T00:00:00.000Z")),
                ("updated_at".into(), json!("2026-01-02T00:00:00.001Z")),
            ]
        );
        let ops: Vec<&str> = write.filters.iter().map(|f| f.op.as_str()).collect();
        assert_eq!(ops[3..], ["gte", "lt"]);
        assert_eq!(write.columns.as_deref(), Some("id"));
        let page = done(step(
            input("a", "b"),
            vec![row("a", 7), json!([{ "id": "p1" }])],
        ));
        assert_eq!(page["body"], "b");
        assert_eq!(page["updatedAt"], NOW);
        assert!(page.get("conflictCopyId").is_none());
    }

    #[test]
    fn a_row_without_a_version_is_written_without_the_guard() {
        let mut unversioned = row("a", 0);
        unversioned["row_version"] = Value::Null;
        let write = only(step(input("a", "b"), vec![unversioned]));
        assert!(filters(&write).iter().all(|(col, _)| col != "row_version"));
    }

    #[test]
    fn a_missing_page_is_not_found() {
        match step(input("a", "b"), vec![Value::Null]) {
            RepoStep::Fail { name, .. } => assert_eq!(name.as_deref(), Some("NotFoundError")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_same_body_or_a_merge_that_changes_nothing_is_not_written() {
        assert_eq!(done(step(input("a", "b"), vec![row("b", 3)]))["body"], "b");
        // Mine undid nothing theirs did: base a, mine a, theirs b keeps b.
        assert_eq!(done(step(input("a", "a"), vec![row("b", 3)]))["body"], "b");
    }

    #[test]
    fn someone_elses_edit_to_other_lines_is_merged_in() {
        let base = "one\ntwo\nthree";
        let write = only(step(
            input(base, "ONE\ntwo\nthree"),
            vec![row("one\ntwo\nTHREE", 4)],
        ));
        assert_eq!(write.body.unwrap()["body"], "ONE\ntwo\nTHREE");
    }

    #[test]
    fn a_body_this_session_saved_is_not_someone_elses_edit() {
        let theirs = "a\nX";
        let session = json!({
            "body": "a\nXY", "baseBody": "a", "sessionDigests": [digest_text(theirs)]
        });
        let write = only(step(session, vec![row(theirs, 5)]));
        assert_eq!(write.body.unwrap()["body"], "a\nXY");
    }

    #[test]
    fn clashing_edits_keep_theirs_as_a_copy_then_write_mine() {
        let replies = vec![row("a\nTHEIRS", 4)];
        let copy = only(step(input("a\nb", "a\nMINE"), replies.clone()));
        assert_eq!(copy.action, RepoAction::Upsert);
        let body = copy.body.unwrap();
        assert_eq!(body["title"], "Home (conflict copy 2026-11-12 09:00:00)");
        assert_eq!(body["body"], "a\nTHEIRS");
        assert_eq!(body["parent_id"], "f1");
        assert_eq!(body["project_id"], "proj");
        let copy_id = body["id"].clone();
        assert_ne!(copy_id, json!("p1"));

        let mut replies = replies;
        replies.push(Value::Null);
        let write = only(step(input("a\nb", "a\nMINE"), replies.clone()));
        assert_eq!(write.body.unwrap()["body"], "a\nMINE");
        replies.push(json!([{ "id": "p1" }]));
        let page = done(step(input("a\nb", "a\nMINE"), replies));
        assert_eq!(page["body"], "a\nMINE");
        assert_eq!(page["conflictCopyId"], copy_id);
    }

    fn canvas_row(body: &str, version: i64) -> Value {
        let mut row = row(body, version);
        row["kind"] = json!("canvas");
        row
    }

    #[test]
    fn a_canvas_conflict_copy_is_a_canvas() {
        let theirs = "{\"nodes\":[{\"id\":\"t\"}]}";
        let mine = "{\"nodes\":[{\"id\":\"m\"}]}";
        let base = "{\"nodes\":[]}";
        let copy = only(step(input(base, mine), vec![canvas_row(theirs, 4)]));
        assert_eq!(copy.action, RepoAction::Upsert);
        let body = copy.body.unwrap();
        assert_eq!(body["kind"], "canvas");
        assert_eq!(body["body"], theirs);
    }

    #[test]
    fn a_canvas_merge_that_breaks_the_json_keeps_theirs_as_a_copy() {
        // Mine wraps the middle in an object; theirs puts a node there. The edits
        // touch different lines, so they merge cleanly, into a node with no key.
        let base = "{\"nodes\":[



]}";
        let mine = "{\"nodes\":[],\"x\":{



}}";
        let theirs = "{\"nodes\":[

{\"id\":\"a\"}

]}";
        let TextMerge::Clean(merged) = merge_text(base, mine, theirs) else {
            panic!("the lines must merge cleanly for this case to test the guard");
        };
        assert!(parse_canvas(&merged).is_err(), "{merged}");
        // As a note the clean merge is written; as a canvas theirs is kept first.
        let note = only(step(input(base, mine), vec![row(theirs, 4)]));
        assert_eq!(note.action, RepoAction::Update);
        let copy = only(step(input(base, mine), vec![canvas_row(theirs, 4)]));
        assert_eq!(copy.action, RepoAction::Upsert);
        assert_eq!(copy.body.unwrap()["body"], theirs);
    }

    #[test]
    fn a_canvas_merge_that_stays_a_canvas_is_written() {
        let base = "{\"nodes\":[
{\"id\":\"a\"},
{\"id\":\"b\"},
{\"id\":\"c\"}
]}";
        let mine = "{\"nodes\":[
{\"id\":\"A\"},
{\"id\":\"b\"},
{\"id\":\"c\"}
]}";
        let theirs = "{\"nodes\":[
{\"id\":\"a\"},
{\"id\":\"b\"},
{\"id\":\"C\"}
]}";
        let write = only(step(input(base, mine), vec![canvas_row(theirs, 4)]));
        assert_eq!(write.action, RepoAction::Update);
        assert_eq!(
            write.body.unwrap()["body"],
            "{\"nodes\":[
{\"id\":\"A\"},
{\"id\":\"b\"},
{\"id\":\"C\"}
]}"
        );
    }

    #[test]
    fn a_lost_race_reads_again_and_merges_with_the_newer_body() {
        let base = "one\nmid\ntwo";
        let mut replies = vec![row(base, 1), json!([])];
        let reread = only(step(input(base, "ONE\nmid\ntwo"), replies.clone()));
        assert_eq!(reread.action, RepoAction::Select);
        replies.push(row("one\nmid\nTWO", 2));
        let write = only(step(input(base, "ONE\nmid\ntwo"), replies));
        assert_eq!(write.body.as_ref().unwrap()["body"], "ONE\nmid\nTWO");
        assert!(filters(&write).contains(&("row_version".into(), json!(2))));
    }

    #[test]
    fn a_retry_that_meets_newer_clashing_text_keeps_both_their_texts() {
        let (base, mine) = (
            "a
b", "a
MINE",
        );
        let mut replies = vec![row(
            "a
THEIRS", 4,
        )];
        let first = only(step(input(base, mine), replies.clone()));
        let first = first.body.unwrap();
        assert_eq!(
            first["body"],
            "a
THEIRS"
        );
        replies.extend([Value::Null, json!([])]); // copy saved, write lost the race
        replies.push(row(
            "a
THEIRS2",
            5,
        ));
        let second = only(step(input(base, mine), replies.clone()));
        assert_eq!(second.action, RepoAction::Upsert);
        let second = second.body.unwrap();
        assert_eq!(
            second["body"],
            "a
THEIRS2"
        );
        assert_ne!(
            second["id"], first["id"],
            "a second copy: overwriting the first would lose THEIRS"
        );
        replies.extend([Value::Null, json!([{ "id": "p1" }])]);
        assert_eq!(
            done(step(input(base, mine), replies))["conflictCopyId"],
            second["id"]
        );
    }

    #[test]
    fn f97_p2_12_two_copies_in_one_save_are_both_reported() {
        let (base, mine) = ("a\nb", "a\nMINE");
        let mut replies = vec![row("a\nTHEIRS", 4)];
        let first = only(step(input(base, mine), replies.clone())).body.unwrap();
        replies.extend([Value::Null, json!([]), row("a\nTHEIRS2", 5)]);
        let second = only(step(input(base, mine), replies.clone())).body.unwrap();
        replies.extend([Value::Null, json!([{ "id": "p1" }])]);
        let page = done(step(input(base, mine), replies));
        assert_eq!(page["conflictCopyIds"], json!([first["id"], second["id"]]));
        assert_eq!(page["conflictCopyId"], second["id"]);
    }

    #[test]
    fn a_second_copy_in_one_call_gets_its_own_title() {
        let (base, mine) = ("a\nb", "a\nMINE");
        let mut replies = vec![row("a\nTHEIRS", 4)];
        let first = only(step(input(base, mine), replies.clone())).body.unwrap();
        replies.extend([Value::Null, json!([]), row("a\nTHEIRS2", 5)]);
        let second = only(step(input(base, mine), replies)).body.unwrap();
        let (first, second) = (first["title"].as_str(), second["title"].as_str());
        assert_eq!(first, Some("Home (conflict copy 2026-11-12 09:00:00)"));
        let id = call(json!(null), vec![]).id(1);
        assert_eq!(
            second,
            Some(format!("Home (conflict copy 2026-11-12 09:00:00) {}", &id[..8]).as_str())
        );
    }

    #[test]
    fn the_copy_is_soft_and_a_title_taken_elsewhere_is_saved_again_tagged() {
        let (base, mine) = ("a\nb", "a\nMINE");
        let mut replies = vec![row("a\nTHEIRS", 4)];
        let copy = only(step(input(base, mine), replies.clone()));
        assert!(copy.soft, "a refused title must come back as a reply");
        let id = copy.body.unwrap()["id"].clone();
        // Another device made a copy with this title in the same second.
        replies.push(json!({ "error": { "code": "23505", "message": "dup" } }));
        let again = only(step(input(base, mine), replies.clone()));
        assert_eq!(again.action, RepoAction::Upsert);
        let again = again.body.unwrap();
        assert_eq!(again["id"], id, "the same copy, under a new title");
        let tag = &id.as_str().unwrap()[..8];
        assert_eq!(
            again["title"],
            format!("Home (conflict copy 2026-11-12 09:00:00) {tag}")
        );
        // The short tag clashed too: the whole id is the last resort.
        let mut twice = replies.clone();
        twice.push(json!({ "error": { "code": "23505", "message": "dup" } }));
        let last = only(step(input(base, mine), twice)).body.unwrap();
        assert_eq!(
            last["title"],
            format!(
                "Home (conflict copy 2026-11-12 09:00:00) {}",
                id.as_str().unwrap()
            )
        );
        replies.push(Value::Null);
        let write = only(step(input(base, mine), replies.clone()));
        assert_eq!(write.action, RepoAction::Update);
        replies.push(json!([{ "id": "p1" }]));
        assert_eq!(done(step(input(base, mine), replies))["conflictCopyId"], id);
    }

    #[test]
    fn a_copy_refused_for_another_reason_fails_the_save() {
        let replies = vec![
            row("a\nTHEIRS", 4),
            json!({ "error": { "code": "42501", "message": "denied" } }),
        ];
        match step(input("a\nb", "a\nMINE"), replies) {
            RepoStep::Fail { message, .. } => assert_eq!(message, "denied"),
            other => panic!("{other:?}"),
        }
        let mut thrice = vec![row("a\nTHEIRS", 4)];
        thrice.extend(std::iter::repeat_n(
            json!({ "error": { "code": "23505", "message": "dup" } }),
            3,
        ));
        assert!(matches!(
            step(input("a\nb", "a\nMINE"), thrice),
            RepoStep::Fail { .. }
        ));
    }

    #[test]
    fn a_retry_that_meets_the_text_already_copied_makes_no_second_copy() {
        let (base, mine) = (
            "a
b", "a
MINE",
        );
        let mut replies = vec![row(
            "a
THEIRS", 4,
        )];
        let copy_id = only(step(input(base, mine), replies.clone())).body.unwrap()["id"].clone();
        // The race was lost to a change that left the body alone (a pin).
        replies.extend([
            Value::Null,
            json!([]),
            row(
                "a
THEIRS", 5,
            ),
        ]);
        let write = only(step(input(base, mine), replies.clone()));
        assert_eq!(write.action, RepoAction::Update);
        assert!(filters(&write).contains(&("row_version".into(), json!(5))));
        replies.push(json!([{ "id": "p1" }]));
        assert_eq!(
            done(step(input(base, mine), replies))["conflictCopyId"],
            copy_id
        );
    }

    #[test]
    fn a_copy_made_before_a_lost_race_is_reported_after_a_clean_retry() {
        let (base, mine) = (
            "a
b", "a
MINE",
        );
        let mut replies = vec![row(
            "a
THEIRS", 4,
        )];
        let copy_id = only(step(input(base, mine), replies.clone())).body.unwrap()["id"].clone();
        replies.extend([Value::Null, json!([]), row(mine, 5)]);
        let page = done(step(input(base, mine), replies));
        assert_eq!(page["body"], mine);
        assert_eq!(page["conflictCopyId"], copy_id);
    }

    #[test]
    fn a_write_the_row_policy_hides_is_a_permission_error_not_a_race() {
        let replies = vec![row("a", 7), json!([]), row("a", 7)];
        match step(input("a", "b"), replies) {
            RepoStep::Fail { name, .. } => {
                assert_eq!(name.as_deref(), Some("VaultPagePermissionError"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_unversioned_write_that_matches_nothing_is_refused_not_raced() {
        // With no version to filter on, the write is unconditional: an empty
        // reply cannot be a lost race, only the row policy refusing it.
        let mut unversioned = row("a", 0);
        unversioned["row_version"] = Value::Null;
        let replies = vec![unversioned.clone(), json!([]), unversioned];
        match step(input("a", "b"), replies) {
            RepoStep::Fail { name, .. } => {
                assert_eq!(name.as_deref(), Some("VaultPagePermissionError"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn gives_up_after_every_attempt_loses_the_race() {
        let mut replies = Vec::new();
        for version in 0..ATTEMPTS {
            replies.push(row("a", i64::try_from(version).unwrap()));
            replies.push(json!([]));
        }
        match step(input("a", "b"), replies) {
            RepoStep::Fail { name, .. } => {
                assert_eq!(name.as_deref(), Some("VaultPageConflictError"));
            }
            other => panic!("{other:?}"),
        }
    }
}

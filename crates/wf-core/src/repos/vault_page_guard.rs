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
//!   "conflict copy", so neither edit is lost.
//!
//! A write that misses the version (someone saved in between) reads again and
//! decides again, up to [`ATTEMPTS`] times. A retry that clashes again reuses
//! the same copy, and a copy made on any attempt is reported. A missed write
//! whose re-read shows the same version was refused by the row policy.

use serde::Deserialize;
use serde_json::{Value, json};

use super::vault_pages::{TABLE, VAULT_PAGE_COLUMNS, save, scoped};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep};
use crate::sync::change_origin::digest_text;
use crate::sync::text_merge::{TextMerge, merge_text};
use crate::vault::page::{NewVaultPageInput, VaultPage, create_vault_page};
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

fn plan(base: &str, mine: &str, theirs: &str, session: &[String]) -> Plan {
    if theirs == mine {
        return Plan::Keep;
    }
    if theirs == base || session.iter().any(|d| *d == digest_text(theirs)) {
        return Plan::Write(mine.to_owned());
    }
    match merge_text(base, mine, theirs) {
        TextMerge::Clean(merged) if merged == theirs => Plan::Keep,
        TextMerge::Clean(merged) => Plan::Write(merged),
        TextMerge::Conflict => Plan::CopyThenWrite,
    }
}

/// The next query, or the reply at `at` when it is in.
fn reply_or_send(call: &RepoCall, at: usize, query: RepoQuery) -> Result<&Value, RepoStep> {
    call.replies.get(at).ok_or_else(|| RepoStep::send(query))
}

/// The title of the copy that keeps the other side's text.
fn copy_title(title: &str, now: &str) -> String {
    let when = now.get(..19).unwrap_or(now).replace('T', " ");
    format!("{title} (conflict copy {when})")
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
    let mut copy_id = None;
    // The bodies kept as copies so far: a retry copies only text not yet kept.
    let mut copied: Vec<String> = Vec::new();
    let mut missed: Option<Option<i64>> = None;
    for _ in 0..ATTEMPTS {
        let (version, existing) = match read(call, at, &id) {
            Ok(read) => read,
            Err(step) => return step,
        };
        at += 1;
        // Without a version the write is unconditional, so an empty reply was
        // the row policy refusing it, never a lost race: the same as when the
        // version did not move.
        if missed == Some(version) {
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
        ) {
            Plan::Keep => return finish(&existing, copy_id),
            Plan::Write(text) => text,
            Plan::CopyThenWrite => {
                if !copied.contains(&existing.body) {
                    let copy = match conflict_copy(call, &existing, copied.len()) {
                        Ok(copy) => copy,
                        Err(step) => return step,
                    };
                    let saved = save(&call.sub(vec![copy.clone()], at));
                    if call.replies.len() <= at {
                        return saved;
                    }
                    at += 1;
                    copied.push(existing.body.clone());
                    copy_id = copy.get("id").cloned();
                }
                input.body.clone()
            }
        };
        let now = call.now().to_owned();
        let mut write = scoped(
            RepoQuery::update(TABLE, json!({ "body": text, "updated_at": now })),
            call,
        )
        .eq("id", id.as_str());
        if let Some(version) = version {
            write = write.eq("row_version", version);
        }
        let written = match reply_or_send(call, at, write.returning("id")) {
            Ok(written) => written,
            Err(step) => return step,
        };
        at += 1;
        if written.as_array().is_some_and(Vec::is_empty) {
            missed = Some(version);
            continue; // Someone saved in between, or the policy refused: read again.
        }
        let mut page = existing;
        page.body = text;
        page.summary.updated_at = now;
        return finish(&page, copy_id);
    }
    RepoStep::fail_named(
        "VaultPageConflictError",
        "This note kept changing while it was being saved; your text is still in the editor.",
    )
}

/// The page at reply `at` with its `row_version`, or the step that reads it.
fn read(call: &RepoCall, at: usize, id: &str) -> Result<(Option<i64>, VaultPage), RepoStep> {
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
    let row = serde_json::from_value::<VaultPageRow>(row.clone()).map_err(RepoStep::fail)?;
    Ok((version, to_domain(&row)))
}

/// The saved page, naming the conflict copy when one was made.
fn finish(page: &VaultPage, copy_id: Option<Value>) -> RepoStep {
    let mut value = match serde_json::to_value(page) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    if let (Some(copy_id), Some(obj)) = (copy_id, value.as_object_mut()) {
        let _ = obj.insert("conflictCopyId".into(), copy_id);
    }
    RepoStep::Done { value }
}

/// The `n`th new page beside `existing` holding the body it had, as `save`
/// takes it. The id is fixed per `n`, so a replayed step names the same copy.
/// A retry that meets other clashing text makes another copy rather than
/// overwrite this one: the newer text need not be built on the older (a plain
/// update writes the body without a base).
fn conflict_copy(call: &RepoCall, existing: &VaultPage, n: usize) -> Result<Value, RepoStep> {
    let input = NewVaultPageInput {
        title: copy_title(&existing.summary.title, call.now()),
        body: Some(existing.body.clone()),
        parent_id: existing.summary.parent_id.clone(),
        folder: None,
        sort_order: Some(existing.summary.sort_order),
    };
    let page = create_vault_page(&input, &call.id(n), call.now())
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
    fn writes_only_if_the_version_is_unchanged() {
        let write = only(step(input("a", "b"), vec![row("a", 7)]));
        assert_eq!(write.action, RepoAction::Update);
        assert_eq!(write.body, Some(json!({ "body": "b", "updated_at": NOW })));
        assert_eq!(
            filters(&write),
            vec![
                ("project_id".into(), json!("proj")),
                ("id".into(), json!("p1")),
                ("row_version".into(), json!(7)),
            ]
        );
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
        let (base, mine) = ("a
b", "a
MINE");
        let mut replies = vec![row("a
THEIRS", 4)];
        let first = only(step(input(base, mine), replies.clone()));
        let first = first.body.unwrap();
        assert_eq!(first["body"], "a
THEIRS");
        replies.extend([Value::Null, json!([])]); // copy saved, write lost the race
        replies.push(row("a
THEIRS2", 5));
        let second = only(step(input(base, mine), replies.clone()));
        assert_eq!(second.action, RepoAction::Upsert);
        let second = second.body.unwrap();
        assert_eq!(second["body"], "a
THEIRS2");
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
    fn a_retry_that_meets_the_text_already_copied_makes_no_second_copy() {
        let (base, mine) = ("a
b", "a
MINE");
        let mut replies = vec![row("a
THEIRS", 4)];
        let copy_id = only(step(input(base, mine), replies.clone())).body.unwrap()["id"].clone();
        // The race was lost to a change that left the body alone (a pin).
        replies.extend([Value::Null, json!([]), row("a
THEIRS", 5)]);
        let write = only(step(input(base, mine), replies.clone()));
        assert_eq!(write.action, RepoAction::Update);
        assert!(filters(&write).contains(&("row_version".into(), json!(5))));
        replies.push(json!([{ "id": "p1" }]));
        assert_eq!(done(step(input(base, mine), replies))["conflictCopyId"], copy_id);
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

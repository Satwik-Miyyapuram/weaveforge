//! The `citation_alert_tracks` repository as Rust-planned queries.
//!
//! Ported from `PostgrestCitationAlertTrackRepository` in
//! `apps/web/src/features/relations/infrastructure/parts.ts`. Rows map with
//! [`citation_alert_track_from_row`].

use serde::Deserialize;
use serde_json::{Value, json};

use crate::relations::citation_alert_track::{
    CitationAlertTrack, CitationAlertTrackRow, citation_alert_track_from_row,
};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "citation_alert_tracks";
const ACTION: &str = "managing citation alerts";

/// The columns a [`CitationAlertTrackRow`] is read as, named rather than starred.
pub const TRACK_COLUMNS: &str = "id,paper_id,tracked_at,last_checked_at,seen_citing_ids";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "track" => track(call),
        "untrack" => untrack(call),
        "listForProject" => list_for_project(call),
        "getByPaperId" => get_by_paper_id(call),
        "save" => save(call),
        _ => return None,
    })
}

fn to_domain(row: &CitationAlertTrackRow) -> CitationAlertTrack {
    citation_alert_track_from_row(row.clone())
}

/// `NewCitationAlertTrackInput`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTrack {
    paper_id: String,
    #[serde(default)]
    seen_citing_ids: Option<Vec<String>>,
    #[serde(default)]
    last_checked_at: Option<String>,
}

/// `track(input)`: upsert on (project, paper) and return the stored track.
fn track(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_row(call, 0, to_domain);
    }
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    let input: NewTrack = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(
        RepoQuery::upsert(
            TABLE,
            json!({
                "user_id": user,
                "project_id": project,
                "paper_id": input.paper_id,
                "seen_citing_ids": input.seen_citing_ids.unwrap_or_default(),
                "last_checked_at": input.last_checked_at,
            }),
        )
        .on_conflict("project_id,paper_id", false)
        .returning(TRACK_COLUMNS)
        .single(),
    )
}

/// `untrack(paperId)`.
fn untrack(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    match call.project(ACTION) {
        Ok(project) => RepoStep::send(
            RepoQuery::delete(TABLE)
                .eq("project_id", project)
                .eq("paper_id", call.text(0)),
        ),
        Err(step) => step,
    }
}

/// `listForProject()`: newest first; none without a project.
fn list_for_project(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_domain);
    }
    match call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) {
        Some(project) => RepoStep::send(
            RepoQuery::select(TABLE, TRACK_COLUMNS)
                .eq("project_id", project)
                .order("tracked_at", false),
        ),
        None => RepoStep::done(&Vec::<Value>::new()),
    }
}

/// `getByPaperId(paperId)`: the track, or `null`; `null` without a project.
fn get_by_paper_id(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_row(call, 0, |row: &Option<CitationAlertTrackRow>| {
            row.as_ref().map(to_domain)
        });
    }
    match call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) {
        Some(project) => RepoStep::send(
            RepoQuery::select(TABLE, TRACK_COLUMNS)
                .eq("project_id", project)
                .eq("paper_id", call.text(0))
                .maybe_single(),
        ),
        None => RepoStep::done(&Value::Null),
    }
}

/// `save(track)`: the poll state only.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    let track: CitationAlertTrack = match call.parse(0) {
        Ok(track) => track,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(
        RepoQuery::update(
            TABLE,
            json!({
                "last_checked_at": track.last_checked_at,
                "seen_citing_ids": track.seen_citing_ids,
            }),
        )
        .eq("id", track.id)
        .eq("project_id", project),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                user_id: Some("u1".into()),
                ..RepoCtx::default()
            },
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
        json!({ "id": "t1", "paper_id": "pa", "tracked_at": "2026-11-01T10:00:00Z",
            "last_checked_at": null, "seen_citing_ids": null })
    }

    #[test]
    fn track_upserts_on_project_and_paper_and_returns_the_row() {
        let q = sent(track(&call(vec![json!({ "paperId": "pa" })], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some("project_id,paper_id"));
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["seen_citing_ids"], json!([]));
        assert_eq!(body["last_checked_at"], Value::Null);
        let v = done(track(&call(vec![json!({ "paperId": "pa" })], vec![row()])));
        assert_eq!(v["paperId"], "pa");
        assert_eq!(v["seenCitingIds"], json!([]));
        assert!(v.get("lastCheckedAt").is_none());
    }

    #[test]
    fn writes_need_a_project_and_track_needs_a_user() {
        let mut c = call(vec![json!({ "paperId": "pa" })], vec![]);
        c.ctx.project_id = None;
        assert!(matches!(track(&c), RepoStep::Fail { .. }));
        assert!(matches!(untrack(&c), RepoStep::Fail { .. }));
        let mut c = call(vec![json!({ "paperId": "pa" })], vec![]);
        c.ctx.user_id = None;
        assert!(matches!(track(&c), RepoStep::Fail { .. }));
    }

    #[test]
    fn reads_without_a_project_are_empty() {
        let mut c = call(vec![json!("pa")], vec![]);
        c.ctx.project_id = None;
        assert_eq!(done(list_for_project(&c)), json!([]));
        assert_eq!(done(get_by_paper_id(&c)), Value::Null);
    }

    #[test]
    fn list_is_newest_first_and_get_maps_a_missing_row_to_null() {
        let q = sent(list_for_project(&call(vec![], vec![])));
        assert_eq!(q.order[0].column, "tracked_at");
        assert!(!q.order[0].ascending);
        let q = sent(get_by_paper_id(&call(vec![json!("pa")], vec![])));
        assert_eq!(q.filters[1].value, json!("pa"));
        assert_eq!(
            done(get_by_paper_id(&call(vec![json!("pa")], vec![Value::Null]))),
            Value::Null
        );
    }

    #[test]
    fn save_updates_only_the_poll_state() {
        let t = json!({ "id": "t1", "paperId": "pa", "trackedAt": "2026-11-01T10:00:00Z",
            "seenCitingIds": ["c1"] });
        let q = sent(step("save", &call(vec![t], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(
            q.body,
            Some(json!({ "last_checked_at": null, "seen_citing_ids": ["c1"] }))
        );
        let cols: Vec<_> = q.filters.iter().map(|f| f.column.as_str()).collect();
        assert_eq!(cols, ["id", "project_id"]);
    }
}

//! The `paper_tags` links of the tags repository as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/tags/infrastructure/postgrest-tag-repository.ts`
//! (`PostgrestPaperTagRepository`). Links are not project-scoped in the TS, so no `project_id`
//! filter is added. `link` and `reconcile` upsert without `onConflict`, as the TS does.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};
use crate::tag_row::to_paper_tag;

const PAPER_TAGS: &str = "paper_tags";
const PAPER_TAG_COLUMNS: &str = "paper_id,tag_id,source,annotation_ref";

/// A link as the TS `PaperTag` arrives for `link` and `reconcile` (camelCase).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperTagInput {
    paper_id: String,
    tag_id: String,
    source: String,
    annotation_ref: Option<String>,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "listForPaper" => list_for_paper(call),
        "listForTag" => list_for_tag(call),
        "listAll" => list_all(call),
        "link" => link(call),
        "unlink" => unlink(call),
        "unlinkBySource" => unlink_by_source(call),
        "reconcile" => reconcile(call),
        _ => return None,
    })
}

/// The `paper_tags` row a link is written as (TS `toPaperTagRow`); an empty annotation is left out.
fn link_row(link: &PaperTagInput) -> Value {
    let mut row = json!({
        "paper_id": link.paper_id,
        "tag_id": link.tag_id,
        "source": link.source,
    });
    if let Some(annotation) = link.annotation_ref.as_deref().filter(|a| !a.is_empty()) {
        row["annotation_ref"] = json!(annotation);
    }
    row
}

/// A string argument, or `None` when absent or empty (TS `if (source)`).
fn non_empty(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| !s.is_empty())
}

/// `listForPaper(paperId)`: the links of one paper.
fn list_for_paper(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(PAPER_TAGS, PAPER_TAG_COLUMNS).eq("paper_id", call.text(0)),
        );
    }
    map_rows(call, 0, to_paper_tag)
}

/// `listForTag(tagId)`: the links of one tag.
fn list_for_tag(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(PAPER_TAGS, PAPER_TAG_COLUMNS).eq("tag_id", call.text(0)),
        );
    }
    map_rows(call, 0, to_paper_tag)
}

/// `listAll()`: every link.
fn list_all(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::select(PAPER_TAGS, PAPER_TAG_COLUMNS));
    }
    map_rows(call, 0, to_paper_tag)
}

/// `link(link)`: upserts one link.
fn link(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let input: PaperTagInput = match call.parse(0) {
            Ok(input) => input,
            Err(e) => return RepoStep::fail(e),
        };
        return RepoStep::send(RepoQuery::upsert(PAPER_TAGS, link_row(&input)));
    }
    RepoStep::unit()
}

/// `unlink(paperId, tagId, source?)`: deletes the matching links, narrowed by source when given.
fn unlink(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let mut query = RepoQuery::delete(PAPER_TAGS)
            .eq("paper_id", call.text(0))
            .eq("tag_id", call.text(1));
        if let Some(source) = non_empty(call.arg(2)) {
            query = query.eq("source", source);
        }
        return RepoStep::send(query);
    }
    RepoStep::unit()
}

/// `unlinkBySource(paperId, source)`: deletes one paper's links from one source.
fn unlink_by_source(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::delete(PAPER_TAGS)
                .eq("paper_id", call.text(0))
                .eq("source", call.text(1)),
        );
    }
    RepoStep::unit()
}

/// `reconcile(paperId, links, sources)`: deletes the paper's links from `sources`, then upserts
/// `links`. Reply 0 is the delete when `sources` is non-empty; the upsert follows it.
fn reconcile(call: &RepoCall) -> RepoStep {
    let links: Vec<PaperTagInput> = match call.parse(1) {
        Ok(links) => links,
        Err(e) => return RepoStep::fail(e),
    };
    let sources: Vec<String> = match call.parse(2) {
        Ok(sources) => sources,
        Err(e) => return RepoStep::fail(e),
    };
    let deletes = usize::from(!sources.is_empty());
    if call.replies.len() < deletes {
        return RepoStep::send(
            RepoQuery::delete(PAPER_TAGS)
                .eq("paper_id", call.text(0))
                .filter("in", "source", json!(sources)),
        );
    }
    if links.is_empty() || call.replies.len() > deletes {
        return RepoStep::unit();
    }
    let rows: Vec<Value> = links.iter().map(link_row).collect();
    RepoStep::send(RepoQuery::upsert(PAPER_TAGS, Value::Array(rows)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ..RepoCall::default()
        }
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn row() -> Value {
        json!({
            "paper_id": "p1", "tag_id": "t1", "source": "manual", "annotation_ref": null
        })
    }

    fn link_input() -> Value {
        json!({"paperId": "p1", "tagId": "t1", "source": "manual"})
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn list_for_paper_filters_by_paper() {
        let q = only(step("listForPaper", &call(vec![json!("p1")], vec![])).unwrap());
        assert_eq!(q.table, "paper_tags");
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.columns.as_deref(), Some(PAPER_TAG_COLUMNS));
        assert_eq!(q.filters[0].column, "paper_id");
        assert_eq!(q.filters[0].value, json!("p1"));
    }

    #[test]
    fn list_for_paper_maps_rows_and_omits_null_annotation() {
        let s = step("listForPaper", &call(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["paperId"], "p1");
        assert_eq!(value[0]["tagId"], "t1");
        assert!(value[0].get("annotationRef").is_none());
    }

    #[test]
    fn list_for_tag_filters_by_tag() {
        let q = only(step("listForTag", &call(vec![json!("t1")], vec![])).unwrap());
        assert_eq!(q.filters[0].column, "tag_id");
        assert_eq!(q.filters[0].value, json!("t1"));
    }

    #[test]
    fn list_for_tag_maps_annotation_ref() {
        let r = json!({"paper_id": "p1", "tag_id": "t1", "source": "zotero_annotation", "annotation_ref": "a1"});
        let s = step("listForTag", &call(vec![], vec![json!([r])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["annotationRef"], "a1");
    }

    #[test]
    fn list_all_has_no_filters() {
        let q = only(step("listAll", &call(vec![], vec![])).unwrap());
        assert!(q.filters.is_empty());
        assert_eq!(q.columns.as_deref(), Some(PAPER_TAG_COLUMNS));
        let s = step("listAll", &call(vec![], vec![json!([row()])])).unwrap();
        assert!(matches!(s, RepoStep::Done { .. }));
    }

    #[test]
    fn list_fails_on_bad_row() {
        let s = step("listAll", &call(vec![], vec![json!([{"paper_id": 1}])])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn link_upserts_row_without_empty_annotation() {
        let q = only(step("link", &call(vec![link_input()], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict, None);
        let body = q.body.unwrap();
        assert_eq!(body["paper_id"], "p1");
        assert_eq!(body["source"], "manual");
        assert!(body.get("annotation_ref").is_none());
        assert_eq!(
            step("link", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn link_keeps_annotation_ref_when_set() {
        let input = json!({"paperId": "p1", "tagId": "t1", "source": "zotero_annotation", "annotationRef": "a1"});
        let q = only(step("link", &call(vec![input], vec![])).unwrap());
        assert_eq!(q.body.unwrap()["annotation_ref"], "a1");
    }

    #[test]
    fn link_rejects_bad_input() {
        let s = step("link", &call(vec![json!({"paperId": 1})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn unlink_deletes_by_paper_and_tag() {
        let q = only(step("unlink", &call(vec![json!("p1"), json!("t1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters.len(), 2);
        assert_eq!(q.filters[1].column, "tag_id");
    }

    #[test]
    fn unlink_narrows_by_source_when_given() {
        let q = only(
            step(
                "unlink",
                &call(vec![json!("p1"), json!("t1"), json!("manual")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.filters.len(), 3);
        assert_eq!(q.filters[2].column, "source");
        assert_eq!(q.filters[2].value, json!("manual"));
    }

    #[test]
    fn unlink_ignores_empty_source() {
        let q = only(
            step(
                "unlink",
                &call(vec![json!("p1"), json!("t1"), json!("")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.filters.len(), 2);
    }

    #[test]
    fn unlink_finishes_after_reply() {
        assert_eq!(
            step("unlink", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn unlink_by_source_deletes_by_paper_and_source() {
        let q = only(
            step(
                "unlinkBySource",
                &call(vec![json!("p1"), json!("summary")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "paper_id");
        assert_eq!(q.filters[1].column, "source");
        assert_eq!(q.filters[1].value, json!("summary"));
        assert_eq!(
            step("unlinkBySource", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn reconcile_deletes_sources_then_upserts_links() {
        let args = vec![
            json!("p1"),
            json!([link_input()]),
            json!(["summary", "manual"]),
        ];
        let del = only(step("reconcile", &call(args.clone(), vec![])).unwrap());
        assert_eq!(del.action, RepoAction::Delete);
        assert_eq!(del.filters[1].op, "in");
        assert_eq!(del.filters[1].column, "source");
        assert_eq!(del.filters[1].value, json!(["summary", "manual"]));

        let up = only(step("reconcile", &call(args, vec![Value::Null])).unwrap());
        assert_eq!(up.action, RepoAction::Upsert);
        assert_eq!(
            up.body.unwrap(),
            json!([{"paper_id": "p1", "tag_id": "t1", "source": "manual"}])
        );

        assert_eq!(
            step(
                "reconcile",
                &call(
                    vec![json!("p1"), json!([link_input()]), json!(["summary"])],
                    vec![Value::Null, Value::Null]
                )
            ),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn reconcile_without_sources_upserts_directly() {
        let args = vec![json!("p1"), json!([link_input()]), json!([])];
        let up = only(step("reconcile", &call(args, vec![])).unwrap());
        assert_eq!(up.action, RepoAction::Upsert);
        assert_eq!(up.single, RepoSingle::Many);
    }

    #[test]
    fn reconcile_with_nothing_to_do_finishes() {
        let args = vec![json!("p1"), json!([]), json!([])];
        assert_eq!(
            step("reconcile", &call(args, vec![])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn reconcile_rejects_bad_links() {
        let args = vec![json!("p1"), json!("nope"), json!([])];
        let s = step("reconcile", &call(args, vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }
}

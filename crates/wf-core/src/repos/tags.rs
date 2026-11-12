//! The `tags` repository (`tags`, `paper_tags`) as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/tags/infrastructure/postgrest-tag-repository.ts`
//! (`PostgrestTagRepository`). Reads and `save` filter or write `project_id` only when a project
//! is selected, as the TS does. The `PostgrestPaperTagRepository` in the same file is not ported.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::tag_counts::{TagPaperLink, paper_counts_for_tags};
use crate::tag_row::{Tag, TagRow, to_tag};

const TABLE: &str = "tags";
const PAPER_TAGS: &str = "paper_tags";
const TAG_COLUMNS: &str = "id,name,color";

/// Tag ids per `paper_tags` read; the list travels in the URL.
const TAG_ID_CHUNK: usize = 200;

/// A tag with the number of distinct papers linked to it (TS `TagWithPaperCount`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TagWithPaperCount {
    #[serde(flatten)]
    tag: Tag,
    paper_count: u32,
}

/// A `paper_tags` row as read with `tag_id, paper_id`.
#[derive(Debug, Deserialize)]
struct PaperLinkRow {
    tag_id: String,
    paper_id: String,
}

/// The tag `save` receives (TS `Tag`, camelCase).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagInput {
    id: String,
    name: String,
    color: Option<String>,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "findByName" => find_by_name(call),
        "list" => list(call),
        "listWithCounts" => list_with_counts(call),
        "save" => save(call),
        "delete" => delete(call),
        _ => return None,
    })
}

/// The selected project, when one is set; an empty id counts as none, as in the TS `if (this.pid)`.
fn project_id(call: &RepoCall) -> Option<&str> {
    call.ctx.project_id.as_deref().filter(|id| !id.is_empty())
}

/// `.eq("project_id", pid)` when a project is selected.
fn scoped(query: RepoQuery, call: &RepoCall) -> RepoQuery {
    match project_id(call) {
        Some(pid) => query.eq("project_id", pid),
        None => query,
    }
}

/// `getById(id)`: the tag, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, TAG_COLUMNS)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    maybe_tag(call)
}

/// `findByName(name)`: the tag, or `null`.
fn find_by_name(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(
                RepoQuery::select(TABLE, TAG_COLUMNS).eq("name", call.text(0)),
                call,
            )
            .maybe_single(),
        );
    }
    maybe_tag(call)
}

/// `list()`: by name.
fn list(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(scoped(
            RepoQuery::select(TABLE, TAG_COLUMNS).order("name", true),
            call,
        ));
    }
    map_rows(call, 0, to_tag)
}

/// `listWithCounts()`: the tags by name, each with its distinct paper count.
///
/// Reply 0 is the tag list. The `paper_tags` links then come in chunks of [`TAG_ID_CHUNK`] ids,
/// sent together, so the URL stays short.
fn list_with_counts(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(scoped(
            RepoQuery::select(TABLE, TAG_COLUMNS).order("name", true),
            call,
        ));
    }
    let tags = match tags_reply(call) {
        Ok(tags) => tags,
        Err(e) => return RepoStep::fail(e),
    };
    let ids: Vec<String> = tags.iter().map(|t| t.id.clone()).collect();
    if call.replies.len() == 1 {
        if ids.is_empty() {
            return RepoStep::Done { value: json!([]) };
        }
        let queries = ids
            .chunks(TAG_ID_CHUNK)
            .map(|chunk| {
                RepoQuery::select(PAPER_TAGS, "tag_id, paper_id").filter(
                    "in",
                    "tag_id",
                    json!(chunk),
                )
            })
            .collect();
        return RepoStep::Send { queries };
    }
    let mut links = Vec::new();
    for i in 1..call.replies.len() {
        match call.reply::<Vec<PaperLinkRow>>(i) {
            Some(Ok(page)) => links.extend(page.into_iter().map(|r| TagPaperLink {
                tag_id: r.tag_id,
                paper_id: r.paper_id,
            })),
            Some(Err(e)) => return RepoStep::fail(e),
            None => return RepoStep::fail(format!("reply {i} missing")),
        }
    }
    let counts = paper_counts_for_tags(&ids, &links);
    let out: Vec<TagWithPaperCount> = tags
        .into_iter()
        .enumerate()
        .map(|(i, tag)| TagWithPaperCount {
            tag,
            paper_count: counts.get(i).copied().unwrap_or(0),
        })
        .collect();
    RepoStep::done(&out)
}

/// `save(tag)`: upsert on the primary key, with `project_id` when a project is selected.
fn save(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let tag: TagInput = match call.parse(0) {
            Ok(tag) => tag,
            Err(e) => return RepoStep::fail(e),
        };
        let mut row = json!({ "id": tag.id, "name": tag.name, "color": tag.color });
        if let Some(pid) = project_id(call) {
            row["project_id"] = json!(pid);
        }
        return RepoStep::send(RepoQuery::upsert(TABLE, row));
    }
    RepoStep::unit()
}

/// `delete(id)`.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// The tags in reply 0, mapped to the app's tags.
fn tags_reply(call: &RepoCall) -> Result<Vec<Tag>, String> {
    match call.reply::<Vec<TagRow>>(0) {
        Some(rows) => Ok(rows?.iter().map(to_tag).collect()),
        None => Err("reply 0 missing".into()),
    }
}

/// A `maybeSingle` reply: `null` stays `null`, a row maps to the app's tag.
fn maybe_tag(call: &RepoCall) -> RepoStep {
    if matches!(call.replies.first(), Some(Value::Null)) {
        return RepoStep::Done { value: Value::Null };
    }
    map_row(call, 0, to_tag)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ..RepoCall::default()
        }
    }

    fn in_project(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                user_id: None,
                now: None,
                id_seed: None,
            },
        }
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn tag_row() -> Value {
        json!({ "id": "t1", "name": "method", "color": null })
    }

    #[test]
    fn get_by_id_selects_one_maybe() {
        let q = only(step("getById", &call(vec![json!("t1")], vec![])).unwrap());
        assert_eq!(q.table, "tags");
        assert_eq!(q.columns.as_deref(), Some("id,name,color"));
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.filters[0].value, json!("t1"));
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn get_by_id_maps_row_or_null() {
        let s = step("getById", &call(vec![], vec![tag_row()])).unwrap();
        assert_eq!(
            s,
            RepoStep::Done {
                value: json!({ "id": "t1", "name": "method" })
            }
        );
        let none = step("getById", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(none, RepoStep::Done { value: Value::Null });
    }

    #[test]
    fn get_by_id_fails_on_bad_row() {
        let s = step("getById", &call(vec![], vec![json!({ "id": 1 })])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn find_by_name_filters_name_and_project() {
        let q = only(step("findByName", &in_project(vec![json!("method")], vec![])).unwrap());
        assert_eq!(q.filters[0].column, "name");
        assert_eq!(q.filters[1].column, "project_id");
        assert_eq!(q.filters[1].value, json!("p1"));
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn find_by_name_without_project_has_no_project_filter() {
        let q = only(step("findByName", &call(vec![json!("method")], vec![])).unwrap());
        assert_eq!(q.filters.len(), 1);
    }

    #[test]
    fn list_orders_by_name_within_project() {
        let q = only(step("list", &in_project(vec![], vec![])).unwrap());
        assert_eq!(q.order[0].column, "name");
        assert!(q.order[0].ascending);
        assert_eq!(q.filters[0].column, "project_id");
    }

    #[test]
    fn list_maps_rows_and_omits_null_colour() {
        let s = step("list", &call(vec![], vec![json!([tag_row()])])).unwrap();
        assert_eq!(
            s,
            RepoStep::Done {
                value: json!([{ "id": "t1", "name": "method" }])
            }
        );
    }

    #[test]
    fn list_fails_on_bad_row() {
        let s = step("list", &call(vec![], vec![json!([{ "id": 1 }])])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn list_with_counts_empty_tags_finishes_without_links() {
        let s = step("listWithCounts", &call(vec![], vec![json!([])])).unwrap();
        assert_eq!(s, RepoStep::Done { value: json!([]) });
    }

    #[test]
    fn list_with_counts_sends_chunks_of_200_ids() {
        let tags: Vec<Value> = (0..201)
            .map(|i| json!({ "id": format!("t{i}"), "name": format!("n{i}"), "color": null }))
            .collect();
        let s = step("listWithCounts", &call(vec![], vec![json!(tags)])).unwrap();
        let RepoStep::Send { queries } = s else {
            panic!("{s:?}")
        };
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].table, "paper_tags");
        assert_eq!(queries[0].columns.as_deref(), Some("tag_id, paper_id"));
        assert_eq!(queries[0].filters[0].op, "in");
        assert_eq!(
            queries[0].filters[0].value.as_array().map(Vec::len),
            Some(200)
        );
        assert_eq!(
            queries[1].filters[0].value.as_array().map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn list_with_counts_counts_distinct_papers_per_tag() {
        let replies = vec![
            json!([{ "id": "t1", "name": "a", "color": null }, { "id": "t2", "name": "b", "color": "#fff" }]),
            json!([
                { "tag_id": "t1", "paper_id": "p1" },
                { "tag_id": "t1", "paper_id": "p1" },
                { "tag_id": "t1", "paper_id": "p2" }
            ]),
        ];
        let s = step("listWithCounts", &call(vec![], replies)).unwrap();
        assert_eq!(
            s,
            RepoStep::Done {
                value: json!([
                    { "id": "t1", "name": "a", "paperCount": 2 },
                    { "id": "t2", "name": "b", "color": "#fff", "paperCount": 0 }
                ])
            }
        );
    }

    #[test]
    fn save_upserts_row_with_project() {
        let input = json!({ "id": "t1", "name": "method", "color": null });
        let q = only(step("save", &in_project(vec![input], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.columns, None);
        assert_eq!(
            q.body.unwrap(),
            json!({ "id": "t1", "name": "method", "color": null, "project_id": "p1" })
        );
    }

    #[test]
    fn save_without_project_omits_project_id() {
        let input = json!({ "id": "t1", "name": "method", "color": "#0f0" });
        let q = only(step("save", &call(vec![input], vec![])).unwrap());
        assert_eq!(
            q.body.unwrap(),
            json!({ "id": "t1", "name": "method", "color": "#0f0" })
        );
    }

    #[test]
    fn save_rejects_bad_input_and_finishes_after_write() {
        let bad = step("save", &call(vec![json!({ "id": 1 })], vec![])).unwrap();
        assert!(matches!(bad, RepoStep::Fail { .. }));
        assert_eq!(
            step("save", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn delete_removes_by_id_then_finishes() {
        let q = only(step("delete", &call(vec![json!("t1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, json!("t1"));
        assert_eq!(
            step("delete", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}

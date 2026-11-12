//! The `vaultPages` repository (`vault_pages` table) as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/vault/infrastructure/postgrest-vault-page-repository.ts`.
//! Rows map through `vault::page_row`; search and title-match text come from `vault::page_query`.
//! Every read and write is scoped to `project_id` when a project is selected.
//!
//! Gap: `listSummaries` and `getTree` fall back to reading `body` when the `body_preview` column
//! is missing. A step cannot see a query error, so only the migrated path is planned here.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::reader_analysis::lines::js_trim;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::vault::page::{
    NewVaultPageInput, VAULT_BODY_PREVIEW_CHARS, VaultPage, VaultPageSummary, build_page_tree,
    create_vault_page, normalize_title_key, vault_body_preview,
};
use crate::vault::page_query::{
    is_missing_body_preview_column, title_like_pattern, title_or_body_filter,
};
use crate::vault::page_row::{VaultPageRow, to_domain, to_row, to_summary_domain};

const TABLE: &str = "vault_pages";

/// How many ids one `in` filter carries; the list travels in the URL.
const ID_CHUNK: usize = 200;

/// The columns a [`VaultPageRow`] is read as, named rather than starred.
pub const VAULT_PAGE_COLUMNS: &str =
    "id,title,body,body_preview,parent_id,pinned,folder,sort_order,created_at,updated_at";

/// The tree and card projection: a preview, no body.
const VAULT_SUMMARY_COLUMNS: &str =
    "id,title,parent_id,pinned,folder,sort_order,created_at,updated_at,project_id,body_preview";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "listStamps" => list_stamps(call),
        "listByIds" => list_by_ids(call),
        "list" => list(call),
        "listSummaries" => list_summaries(call),
        "getTree" => get_tree(call),
        "titleTaken" => title_taken(call),
        "save" => save(call),
        "add" => add(call),
        "update" => update(call),
        "delete" | "remove" => delete(call),
        _ => return None,
    })
}

/// The project filter every query carries when a project is selected.
fn scoped(query: RepoQuery, call: &RepoCall) -> RepoQuery {
    match call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) {
        Some(pid) => query.eq("project_id", pid),
        None => query,
    }
}

/// `getById(id)`: the full page, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(RepoQuery::select(TABLE, VAULT_PAGE_COLUMNS), call)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    match &call.replies[0] {
        Value::Null => RepoStep::Done { value: Value::Null },
        _ => map_row(call, 0, to_domain),
    }
}

/// One row of the delta read: the id and the stamp that changes with it.
#[derive(Deserialize)]
struct StampRow {
    id: String,
    updated_at: Option<String>,
    created_at: String,
}

/// An `EntityStamp` as the TS object is shaped.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    id: String,
    updated_at: String,
}

fn stamp_from_row(row: &StampRow) -> Stamp {
    Stamp {
        id: row.id.clone(),
        updated_at: row
            .updated_at
            .clone()
            .unwrap_or_else(|| row.created_at.clone()),
    }
}

/// `listStamps()`: ids and versions, in `sort_order`.
fn list_stamps(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(RepoQuery::select(TABLE, "id,updated_at,created_at"), call)
                .order("sort_order", true),
        );
    }
    map_rows(call, 0, stamp_from_row)
}

/// `listByIds(ids)`: one query per chunk of ids, run together; chunks concatenate in order.
fn list_by_ids(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let ids: Vec<String> = match call.parse(0) {
            Ok(ids) => ids,
            Err(e) => return RepoStep::fail(e),
        };
        // No ids, no request.
        if ids.is_empty() {
            return RepoStep::Done { value: json!([]) };
        }
        let queries = ids
            .chunks(ID_CHUNK)
            .map(|chunk| {
                scoped(RepoQuery::select(TABLE, VAULT_PAGE_COLUMNS), call)
                    .filter("in", "id", json!(chunk))
                    .order("id", true)
            })
            .collect();
        return RepoStep::Send { queries };
    }
    let mut found = Vec::new();
    for i in 0..call.replies.len() {
        match call.reply::<Vec<VaultPageRow>>(i) {
            Some(Ok(rows)) => found.extend(rows.iter().map(to_domain)),
            Some(Err(e)) => return RepoStep::fail(e),
            None => return RepoStep::fail(format!("reply {i} missing")),
        }
    }
    RepoStep::done(&found)
}

/// `list(filter?)`: `parentId` (absent: any, `null`: roots only) and `query` (title or body
/// search), ordered by `sort_order` then `title`.
fn list(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let filter = call.arg(0);
        let mut query = scoped(RepoQuery::select(TABLE, VAULT_PAGE_COLUMNS), call);
        if let Some(parent) = filter.get("parentId") {
            query = match parent.as_str() {
                Some(id) => query.eq("parent_id", id),
                None => query.filter("is", "parent_id", Value::Null),
            };
        }
        let text = filter.get("query").and_then(Value::as_str).unwrap_or("");
        if let Some(search) = title_or_body_filter(text) {
            query = query.filter("or", "", search);
        }
        return RepoStep::send(query.order("sort_order", true).order("title", true));
    }
    map_rows(call, 0, to_domain)
}

/// `listSummaries()`: the card projection, ordered by `sort_order` then `title`.
fn list_summaries(call: &RepoCall) -> RepoStep {
    match summaries(call, true) {
        Ok(pages) => RepoStep::done(&pages),
        Err(step) => step,
    }
}

/// `getTree()`: the summaries nested by `parentId`. Nodes carry the summary, as the Rust
/// `buildPageTree` does for the wasm path.
fn get_tree(call: &RepoCall) -> RepoStep {
    match summaries(call, false) {
        Ok(pages) => {
            let pages: Vec<VaultPageSummary> = pages.into_iter().map(|p| p.summary).collect();
            RepoStep::done(&build_page_tree(&pages))
        }
        Err(step) => step,
    }
}

/// Columns of the fallback read when `body_preview` is not migrated yet.
const FALLBACK_COLUMNS: &str =
    "id,title,parent_id,sort_order,created_at,updated_at,project_id,body";

/// The page summaries, or the next step. The summary read is soft: when it fails because
/// `body_preview` is not migrated yet, a second read takes `body` and the preview is
/// derived here.
fn summaries(call: &RepoCall, ordered: bool) -> Result<Vec<VaultPage>, RepoStep> {
    // The fallback read is always ordered, as TS `listSummariesFromBody` is.
    let read = |columns: &str, ordered: bool| {
        let q = scoped(RepoQuery::select(TABLE, columns), call);
        if ordered {
            q.order("sort_order", true).order("title", true)
        } else {
            q
        }
    };
    match call.replies.len() {
        0 => Err(RepoStep::send(read(VAULT_SUMMARY_COLUMNS, ordered).soft())),
        1 => {
            if let Some(error) = call.replies[0].get("error") {
                let message = error.get("message").and_then(Value::as_str);
                let code = error.get("code").and_then(Value::as_str);
                if is_missing_body_preview_column(message, code) {
                    return Err(RepoStep::send(read(FALLBACK_COLUMNS, true)));
                }
                return Err(RepoStep::fail(message.unwrap_or("Query failed")));
            }
            rows(call, 0).map(|rows| rows.iter().map(to_summary_domain).collect())
        }
        _ => rows(call, 1).map(|rows| {
            rows.iter()
                .map(|row| {
                    let mut page = to_summary_domain(row);
                    page.summary.body_preview = Some(vault_body_preview(
                        row.body.as_deref().unwrap_or(""),
                        VAULT_BODY_PREVIEW_CHARS,
                    ));
                    page
                })
                .collect()
        }),
    }
}

fn rows(call: &RepoCall, i: usize) -> Result<Vec<VaultPageRow>, RepoStep> {
    match call.reply::<Vec<VaultPageRow>>(i) {
        Some(Ok(rows)) => Ok(rows),
        Some(Err(e)) => Err(RepoStep::fail(e)),
        None => Err(RepoStep::fail(format!("reply {i} missing"))),
    }
}

/// One candidate row of the title match.
#[derive(Deserialize)]
struct TitleRow {
    id: String,
    title: String,
}

/// `titleTaken(title, exceptId?)`: whether another page has the same normalised title.
fn title_taken(call: &RepoCall) -> RepoStep {
    let key = normalize_title_key(call.text(0));
    if key.is_empty() {
        return RepoStep::Done {
            value: json!(false),
        };
    }
    if call.replies.is_empty() {
        // ILIKE only narrows candidates; the exact rule is applied to each one below.
        return RepoStep::send(scoped(RepoQuery::select(TABLE, "id,title"), call).filter(
            "ilike",
            "title",
            title_like_pattern(&key),
        ));
    }
    let except = call.arg(1).as_str();
    match call.reply::<Vec<TitleRow>>(0) {
        Some(Ok(rows)) => RepoStep::done(
            &rows
                .iter()
                .any(|r| Some(r.id.as_str()) != except && normalize_title_key(&r.title) == key),
        ),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `save(page)`: upserts the row. `updated_at` is the server's; `project_id` is added when a
/// project is selected.
fn save(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let page: VaultPage = match call.parse(0) {
            Ok(page) => page,
            Err(e) => return RepoStep::fail(e),
        };
        let mut row = match serde_json::to_value(to_row(&page)) {
            Ok(row) => row,
            Err(e) => return RepoStep::fail(e),
        };
        if let (Some(pid), Some(obj)) = (
            call.ctx.project_id.as_deref().filter(|p| !p.is_empty()),
            row.as_object_mut(),
        ) {
            let _ = obj.insert("project_id".into(), json!(pid));
        }
        return RepoStep::send(RepoQuery::upsert(TABLE, row));
    }
    RepoStep::unit()
}

/// `delete(id)`.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(scoped(RepoQuery::delete(TABLE), call).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// Saves `page` after `skip` replies; once the save reply is in, the saved page is the result.
fn save_then_done(call: &RepoCall, skip: usize, page: &VaultPage) -> RepoStep {
    if call.replies.len() > skip {
        return RepoStep::done(page);
    }
    match serde_json::to_value(page) {
        Ok(value) => save(&call.sub(vec![value], skip)),
        Err(e) => RepoStep::fail(e),
    }
}

/// `titleTaken` as a sub-step at `skip`. `Ok` holds the next reply offset; `Err` is the refusal
/// or the query to send.
fn assert_title_unique(
    call: &RepoCall,
    skip: usize,
    title: &str,
    except: Option<&str>,
) -> Result<usize, RepoStep> {
    let args = match except {
        Some(id) => vec![json!(title), json!(id)],
        None => vec![json!(title)],
    };
    match title_taken(&call.sub(args, skip)) {
        RepoStep::Done {
            value: Value::Bool(true),
        } => Err(RepoStep::fail_named(
            "VaultPageValidationError",
            format!("A note titled “{}” already exists.", js_trim(title)),
        )),
        RepoStep::Done { .. } => {
            // A blank key sends no query, so it reads nothing.
            let reads = usize::from(!normalize_title_key(title).is_empty());
            Ok(skip + reads)
        }
        other => Err(other),
    }
}

/// Walks the parent chain from `new_parent` (TS `assertNotUnder`). `Ok` holds the next reply
/// offset; `Err` is the refusal or the query. A loop already in the data ends the walk quietly.
fn assert_not_under(
    call: &RepoCall,
    skip: usize,
    id: &str,
    new_parent: &str,
) -> Result<usize, RepoStep> {
    let mut cursor = new_parent.to_owned();
    let mut seen = HashSet::new();
    let mut next = skip;
    while !cursor.is_empty() {
        if cursor == id {
            return Err(RepoStep::fail_named(
                "VaultPageValidationError",
                "A note cannot be moved inside itself.",
            ));
        }
        if !seen.insert(cursor.clone()) {
            return Ok(next);
        }
        let value = match get_by_id(&call.sub(vec![json!(cursor)], next)) {
            RepoStep::Done { value } => value,
            other => return Err(other),
        };
        next += 1;
        if value.is_null() {
            // Names the requested parent, not the missing ancestor, as TS does.
            return Err(RepoStep::fail_named(
                "NotFoundError",
                format!("No vault page with id \"{new_parent}\"."),
            ));
        }
        cursor = value
            .get("parentId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
    }
    Ok(next)
}

/// `add(input)`: validates the page, refuses a title another page holds, then saves it.
fn add(call: &RepoCall) -> RepoStep {
    let input: NewVaultPageInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let page = match create_vault_page(&input, &call.id(0), call.now()) {
        Ok(page) => page,
        Err(e) => return RepoStep::fail_named("VaultPageValidationError", e),
    };
    match assert_title_unique(call, 0, &page.summary.title, None) {
        Ok(skip) => save_then_done(call, skip, &page),
        Err(step) => step,
    }
}

/// The fields `update` changes. An absent field is left alone; `parentId: null` moves the page
/// to the top level.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditInput {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default, deserialize_with = "present")]
    parent_id: Option<Option<String>>,
    #[serde(default)]
    pinned: Option<bool>,
}

/// Keeps an explicit `null` apart from an absent field.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

/// `update(id, input)`: the page must exist; a changed title must be non-blank and unused; the
/// parent move must not loop; then the page is saved. Reads run in that order, as TS does.
fn update(call: &RepoCall) -> RepoStep {
    let input: EditInput = match call.parse(1) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let id = call.text(0).to_owned();
    let value = match get_by_id(&call.sub(vec![json!(id)], 0)) {
        RepoStep::Done { value } => value,
        other => return other,
    };
    if value.is_null() {
        return RepoStep::fail_named("NotFoundError", format!("No vault page with id \"{id}\"."));
    }
    let existing: VaultPage = match serde_json::from_value(value) {
        Ok(page) => page,
        Err(e) => return RepoStep::fail(e),
    };
    let title = match &input.title {
        Some(title) => js_trim(title).to_owned(),
        None => existing.summary.title.clone(),
    };
    if title.is_empty() {
        return RepoStep::fail_named("VaultPageValidationError", "Page title is required.");
    }
    let mut next = 1;
    if normalize_title_key(&title) != normalize_title_key(&existing.summary.title) {
        next = match assert_title_unique(call, next, &title, Some(id.as_str())) {
            Ok(next) => next,
            Err(step) => return step,
        };
    }
    if let Some(Some(parent)) = &input.parent_id {
        next = match assert_not_under(call, next, &id, parent) {
            Ok(next) => next,
            Err(step) => return step,
        };
    }
    let mut updated = existing;
    updated.summary.title = title;
    if let Some(body) = input.body {
        updated.body = body;
    }
    if let Some(parent) = input.parent_id {
        updated.summary.parent_id = parent;
    }
    if let Some(pinned) = input.pinned {
        updated.summary.pinned = Some(pinned);
    }
    updated.summary.updated_at = call.now().to_owned();
    save_then_done(call, next, &updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    const NOW: &str = "2026-11-12T09:00:00.000Z";

    fn call(args: Vec<Value>, replies: Vec<Value>, project: Option<&str>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: project.map(String::from),
                id_seed: Some("seed".into()),
                now: Some(NOW.into()),
                ..RepoCtx::default()
            },
        }
    }

    fn sent(step: RepoStep) -> Vec<RepoQuery> {
        match step {
            RepoStep::Send { queries } => queries,
            other => panic!("expected a send, got {other:?}"),
        }
    }

    fn only(step: RepoStep) -> RepoQuery {
        let mut queries = sent(step);
        assert_eq!(queries.len(), 1);
        queries.remove(0)
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn failure(step: RepoStep) -> String {
        match step {
            RepoStep::Fail { message, .. } => message,
            other => panic!("expected a failure, got {other:?}"),
        }
    }

    fn fail(step: RepoStep) -> (String, Option<String>) {
        match step {
            RepoStep::Fail { message, name } => (message, name),
            other => panic!("expected a failure, got {other:?}"),
        }
    }

    fn folder_row(id: &str) -> Value {
        let mut value = row(id, None);
        value["folder"] = json!(true);
        value
    }

    fn row(id: &str, parent: Option<&str>) -> Value {
        json!({
            "id": id, "title": "Home", "body": "# hi", "body_preview": "hi",
            "parent_id": parent, "pinned": false, "folder": false, "sort_order": 1.0,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"
        })
    }

    fn page_json() -> Value {
        json!({
            "id": "p1", "title": "Home", "body": "# hi", "parentId": null,
            "pinned": false, "folder": false, "sortOrder": 1.0,
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z"
        })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![], None)).is_none());
    }

    #[test]
    fn get_by_id_scopes_and_asks_for_one_or_none() {
        let q = only(step("getById", &call(vec![json!("p1")], vec![], Some("proj"))).unwrap());
        assert_eq!(q.table, "vault_pages");
        assert_eq!(q.columns.as_deref(), Some(VAULT_PAGE_COLUMNS));
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[1].value, json!("p1"));
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn get_by_id_maps_row_and_null() {
        let value = done(step("getById", &call(vec![], vec![row("p1", None)], None)).unwrap());
        assert_eq!(value["id"], "p1");
        assert_eq!(value["body"], "# hi");
        assert!(value.get("bodyPreview").is_none());
        assert_eq!(
            done(step("getById", &call(vec![], vec![Value::Null], None)).unwrap()),
            Value::Null
        );
    }

    #[test]
    fn list_stamps_uses_created_at_when_updated_at_is_null() {
        let q = only(step("listStamps", &call(vec![], vec![], None)).unwrap());
        assert_eq!(q.columns.as_deref(), Some("id,updated_at,created_at"));
        assert!(q.order[0].ascending);
        let replies = json!([
            {"id": "a", "updated_at": null, "created_at": "2026-01-01"},
            {"id": "b", "updated_at": "2026-02-01", "created_at": "2026-01-01"}
        ]);
        let value = done(step("listStamps", &call(vec![], vec![replies], None)).unwrap());
        assert_eq!(
            value,
            json!([{"id": "a", "updatedAt": "2026-01-01"}, {"id": "b", "updatedAt": "2026-02-01"}])
        );
    }

    #[test]
    fn list_by_ids_chunks_by_two_hundred() {
        let ids: Vec<String> = (0..450).map(|i| format!("p{i}")).collect();
        let queries = sent(step("listByIds", &call(vec![json!(ids)], vec![], None)).unwrap());
        let sizes: Vec<usize> = queries
            .iter()
            .map(|q| {
                let inq = q.filters.iter().find(|f| f.op == "in").unwrap();
                inq.value.as_array().map_or(0, Vec::len)
            })
            .collect();
        assert_eq!(sizes, vec![200, 200, 50]);
        assert!(queries.iter().all(|q| q.order[0].column == "id"));
    }

    #[test]
    fn list_by_ids_empty_sends_nothing() {
        let value = done(step("listByIds", &call(vec![json!([])], vec![], None)).unwrap());
        assert_eq!(value, json!([]));
    }

    #[test]
    fn list_by_ids_concatenates_chunk_replies() {
        let replies = vec![json!([row("a", None)]), json!([row("b", None)])];
        let value = done(step("listByIds", &call(vec![json!(["a", "b"])], replies, None)).unwrap());
        assert_eq!(value[0]["id"], "a");
        assert_eq!(value[1]["id"], "b");
    }

    #[test]
    fn list_filters_parent_and_search_then_orders() {
        let args = vec![json!({"parentId": null, "query": "a_b"})];
        let q = only(step("list", &call(args, vec![], Some("proj"))).unwrap());
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[1].op, "is");
        assert_eq!(q.filters[1].value, Value::Null);
        assert_eq!(q.filters[2].op, "or");
        assert!(
            q.filters[2]
                .value
                .as_str()
                .unwrap()
                .starts_with("title.ilike.")
        );
        assert_eq!(q.order[0].column, "sort_order");
        assert_eq!(q.order[1].column, "title");
    }

    #[test]
    fn list_parent_string_is_eq_and_empty_query_adds_no_or() {
        let args = vec![json!({"parentId": "p0", "query": ""})];
        let q = only(step("list", &call(args, vec![], None)).unwrap());
        assert_eq!(q.filters.len(), 1);
        assert_eq!(q.filters[0].op, "eq");
        assert_eq!(q.filters[0].value, json!("p0"));
    }

    #[test]
    fn list_maps_rows() {
        let value =
            done(step("list", &call(vec![], vec![json!([row("p1", None)])], None)).unwrap());
        assert_eq!(value[0]["id"], "p1");
    }

    #[test]
    fn list_summaries_has_preview_and_maps_it() {
        let q = only(step("listSummaries", &call(vec![], vec![], None)).unwrap());
        assert_eq!(q.columns.as_deref(), Some(VAULT_SUMMARY_COLUMNS));
        let value = done(
            step(
                "listSummaries",
                &call(vec![], vec![json!([row("p1", None)])], None),
            )
            .unwrap(),
        );
        assert_eq!(value[0]["bodyPreview"], "hi");
        assert_eq!(value[0]["body"], "");
    }

    #[test]
    fn summaries_fall_back_to_body_when_preview_column_is_missing() {
        let q = only(step("listSummaries", &call(vec![], vec![], None)).unwrap());
        assert!(q.soft);
        let missing = json!({"error": {"code": "42703", "message": "column vault_pages.body_preview does not exist"}});
        let q = only(step("listSummaries", &call(vec![], vec![missing.clone()], None)).unwrap());
        assert_eq!(q.columns.as_deref(), Some(FALLBACK_COLUMNS));
        assert!(!q.soft);
        let value = done(
            step(
                "listSummaries",
                &call(
                    vec![],
                    vec![missing.clone(), json!([row("p1", None)])],
                    None,
                ),
            )
            .unwrap(),
        );
        assert_eq!(
            value[0]["bodyPreview"],
            vault_body_preview("# hi", VAULT_BODY_PREVIEW_CHARS)
        );
        let tree = done(
            step(
                "getTree",
                &call(vec![], vec![missing, json!([row("p1", None)])], None),
            )
            .unwrap(),
        );
        assert_eq!(tree[0]["page"]["id"], "p1");
    }

    #[test]
    fn summaries_fail_on_other_errors() {
        let other = json!({"error": {"code": "42501", "message": "denied"}});
        let s = step("getTree", &call(vec![], vec![other], None)).unwrap();
        assert_eq!(s, RepoStep::fail("denied"));
    }

    #[test]
    fn get_tree_nests_summaries() {
        let replies = json!([row("p1", None), row("p2", Some("p1"))]);
        let value = done(step("getTree", &call(vec![], vec![replies], None)).unwrap());
        assert_eq!(value[0]["page"]["id"], "p1");
        assert_eq!(value[0]["children"][0]["page"]["id"], "p2");
        assert!(value[0]["page"].get("body").is_none());
    }

    #[test]
    fn title_taken_matches_normalised_title_except_id() {
        let q = only(
            step(
                "titleTaken",
                &call(vec![json!("  Home  ")], vec![], Some("proj")),
            )
            .unwrap(),
        );
        assert_eq!(q.filters[1].op, "ilike");
        assert_eq!(q.filters[1].value, json!("home"));
        let rows = json!([{"id": "p1", "title": "HOME"}]);
        let taken = done(
            step(
                "titleTaken",
                &call(vec![json!("home")], vec![rows.clone()], None),
            )
            .unwrap(),
        );
        assert_eq!(taken, json!(true));
        let except = done(
            step(
                "titleTaken",
                &call(vec![json!("home"), json!("p1")], vec![rows], None),
            )
            .unwrap(),
        );
        assert_eq!(except, json!(false));
    }

    #[test]
    fn title_taken_empty_key_is_false_without_query() {
        let value = done(step("titleTaken", &call(vec![json!("   ")], vec![], None)).unwrap());
        assert_eq!(value, json!(false));
    }

    #[test]
    fn save_upserts_row_and_adds_project_id() {
        let q = only(step("save", &call(vec![page_json()], vec![], Some("proj"))).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.unwrap();
        assert_eq!(body["project_id"], "proj");
        assert_eq!(body["body"], "# hi");
        assert!(body.get("updated_at").is_none());
        assert!(q.on_conflict.is_none());
        assert_eq!(
            done(step("save", &call(vec![page_json()], vec![Value::Null], None)).unwrap()),
            Value::Null
        );
    }

    #[test]
    fn save_without_project_has_no_project_id() {
        let q = only(step("save", &call(vec![page_json()], vec![], None)).unwrap());
        assert!(q.body.unwrap().get("project_id").is_none());
    }

    #[test]
    fn save_rejects_bad_page() {
        let message = failure(step("save", &call(vec![json!({"id": 1})], vec![], None)).unwrap());
        assert!(message.starts_with("argument 0:"));
    }

    #[test]
    fn delete_scopes_and_filters_by_id() {
        let q = only(step("delete", &call(vec![json!("p1")], vec![], Some("proj"))).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[1].value, json!("p1"));
        assert_eq!(
            step("delete", &call(vec![json!("p1")], vec![Value::Null], None)),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn add_trims_title_defaults_body_and_requires_title() {
        let args = vec![json!({"title": "  Notes  "})];
        let q = only(step("add", &call(args.clone(), vec![], None)).unwrap());
        assert_eq!(q.filters[0].op, "ilike");
        let value = done(step("add", &call(args, vec![json!([]), Value::Null], None)).unwrap());
        assert_eq!(value["title"], "Notes");
        assert_eq!(value["body"], "");
        assert_eq!(value["createdAt"], NOW);
        let (msg, name) =
            fail(step("add", &call(vec![json!({"title": " "})], vec![], None)).unwrap());
        assert_eq!(msg, "Page title is required.");
        assert_eq!(name.as_deref(), Some("VaultPageValidationError"));
    }

    #[test]
    fn add_rejects_a_case_insensitive_duplicate_title() {
        let rows = json!([{"id": "p0", "title": "My Note"}]);
        let args = vec![json!({"title": "  my note  "})];
        let (msg, name) = fail(step("add", &call(args, vec![rows], None)).unwrap());
        assert_eq!(msg, "A note titled “my note” already exists.");
        assert_eq!(name.as_deref(), Some("VaultPageValidationError"));
    }

    #[test]
    fn add_saves_a_folder_as_one_and_a_note_as_not_a_folder() {
        let args = vec![json!({"title": "Methods", "folder": true})];
        let q = only(step("add", &call(args, vec![json!([])], None)).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.body.unwrap()["folder"], true);
        let args = vec![json!({"title": "Sampling", "parentId": "f1"})];
        let q = only(step("add", &call(args, vec![json!([])], None)).unwrap());
        assert_eq!(q.body.unwrap()["folder"], false);
    }

    #[test]
    fn update_edits_title_and_body_keeping_id_and_created_at() {
        let args = vec![json!("p1"), json!({"title": "New", "body": "b"})];
        let q = only(step("update", &call(args.clone(), vec![], None)).unwrap());
        assert_eq!(q.single, RepoSingle::Maybe);
        let replies = vec![row("p1", None), json!([]), Value::Null];
        let value = done(step("update", &call(args, replies, None)).unwrap());
        assert_eq!(value["id"], "p1");
        assert_eq!(value["createdAt"], "2026-01-01T00:00:00Z");
        assert_eq!(value["updatedAt"], NOW);
        assert_eq!(value["title"], "New");
        assert_eq!(value["body"], "b");
    }

    #[test]
    fn update_blocks_renaming_onto_another_title() {
        let args = vec![json!("p2"), json!({"title": "first"})];
        let replies = vec![row("p2", None), json!([{"id": "p1", "title": "First"}])];
        let (msg, name) = fail(step("update", &call(args, replies, None)).unwrap());
        assert_eq!(msg, "A note titled “first” already exists.");
        assert_eq!(name.as_deref(), Some("VaultPageValidationError"));
    }

    #[test]
    fn update_unknown_id_and_blank_title_then_remove_deletes() {
        let args = vec![json!("nope"), json!({"title": "x"})];
        let (msg, name) = fail(step("update", &call(args, vec![Value::Null], None)).unwrap());
        assert_eq!(msg, "No vault page with id \"nope\".");
        assert_eq!(name.as_deref(), Some("NotFoundError"));
        let args = vec![json!("p1"), json!({"title": "  "})];
        let (msg, name) = fail(step("update", &call(args, vec![row("p1", None)], None)).unwrap());
        assert_eq!(msg, "Page title is required.");
        assert_eq!(name.as_deref(), Some("VaultPageValidationError"));
        let q = only(step("remove", &call(vec![json!("p1")], vec![], None)).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, json!("p1"));
    }

    #[test]
    fn update_moves_under_a_parent_clears_it_and_never_moves_into_itself() {
        let args = vec![json!("page"), json!({"parentId": "folder"})];
        let replies = vec![row("page", None), row("folder", None), Value::Null];
        let moved = done(step("update", &call(args, replies, None)).unwrap());
        assert_eq!(moved["parentId"], "folder");
        // Absent leaves the parent alone; null clears it.
        let held = vec![row("page", Some("folder")), Value::Null];
        let args = vec![json!("page"), json!({"body": "x"})];
        let kept = done(step("update", &call(args, held.clone(), None)).unwrap());
        assert_eq!(kept["parentId"], "folder");
        let args = vec![json!("page"), json!({"parentId": null})];
        let cleared = done(step("update", &call(args, held, None)).unwrap());
        assert!(cleared["parentId"].is_null());
        // A page cannot move under itself...
        let args = vec![json!("folder"), json!({"parentId": "folder"})];
        let (msg, name) =
            fail(step("update", &call(args, vec![row("folder", None)], None)).unwrap());
        assert_eq!(msg, "A note cannot be moved inside itself.");
        assert_eq!(name.as_deref(), Some("VaultPageValidationError"));
        // ...nor under its own descendant: page sits under folder.
        let args = vec![json!("folder"), json!({"parentId": "page"})];
        let replies = vec![row("folder", None), row("page", Some("folder"))];
        let (msg, _) = fail(step("update", &call(args, replies, None)).unwrap());
        assert_eq!(msg, "A note cannot be moved inside itself.");
    }

    #[test]
    fn update_pins_and_unpins_keeping_the_body() {
        let args = vec![json!("p1"), json!({"pinned": true})];
        let pinned = done(
            step(
                "update",
                &call(args, vec![row("p1", None), Value::Null], None),
            )
            .unwrap(),
        );
        assert_eq!(pinned["pinned"], true);
        assert_eq!(pinned["body"], "# hi");
        let args = vec![json!("p1"), json!({"pinned": false})];
        let unpinned = done(
            step(
                "update",
                &call(args, vec![row("p1", None), Value::Null], None),
            )
            .unwrap(),
        );
        assert_eq!(unpinned["pinned"], false);
    }

    #[test]
    fn update_refuses_a_missing_parent_and_loops_and_names_the_requested_parent() {
        let args = vec![json!("a"), json!({"parentId": "nope"})];
        let (msg, name) = fail(
            step(
                "update",
                &call(args, vec![row("a", None), Value::Null], None),
            )
            .unwrap(),
        );
        assert_eq!(msg, "No vault page with id \"nope\".");
        assert_eq!(name.as_deref(), Some("NotFoundError"));
        // a -> c -> b -> ghost: the missing ancestor is ghost, but the message names c.
        let args = vec![json!("a"), json!({"parentId": "c"})];
        let replies = vec![
            row("a", None),
            row("c", Some("b")),
            row("b", Some("ghost")),
            Value::Null,
        ];
        let (msg, _) = fail(step("update", &call(args, replies, None)).unwrap());
        assert_eq!(msg, "No vault page with id \"c\".");
        // c -> b -> a: moving a under c would close a loop.
        let args = vec![json!("a"), json!({"parentId": "c"})];
        let replies = vec![row("a", None), row("c", Some("b")), row("b", Some("a"))];
        let (msg, name) = fail(step("update", &call(args, replies, None)).unwrap());
        assert_eq!(msg, "A note cannot be moved inside itself.");
        assert_eq!(name.as_deref(), Some("VaultPageValidationError"));
    }

    #[test]
    fn update_moves_under_a_loop_already_in_the_data() {
        let args = vec![json!("m"), json!({"parentId": "x"})];
        let replies = vec![
            row("m", None),
            row("x", Some("y")),
            row("y", Some("x")),
            Value::Null,
        ];
        let value = done(step("update", &call(args, replies, None)).unwrap());
        assert_eq!(value["parentId"], "x");
    }

    #[test]
    fn duplicate_title_check_reads_no_page_list() {
        let q = only(step("add", &call(vec![json!({"title": "ALPHA"})], vec![], None)).unwrap());
        assert_eq!(q.table, TABLE);
        assert_eq!(q.columns.as_deref(), Some("id,title"));
        assert_eq!(q.filters[0].op, "ilike");
        let args = vec![json!("p1"), json!({"title": "Beta"})];
        let q = only(step("update", &call(args, vec![row("p1", None)], None)).unwrap());
        assert_eq!(q.filters[0].op, "ilike");
    }

    #[test]
    fn update_keeps_a_folder_when_it_is_edited() {
        let args = vec![json!("f1"), json!({"title": "Method"})];
        let q = only(
            step(
                "update",
                &call(args, vec![folder_row("f1"), json!([])], None),
            )
            .unwrap(),
        );
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.body.unwrap()["folder"], true);
    }

    #[test]
    fn bad_reply_shape_fails() {
        let message = failure(step("list", &call(vec![], vec![json!([{"id": 1}])], None)).unwrap());
        assert!(message.starts_with("reply 0:"));
    }
}

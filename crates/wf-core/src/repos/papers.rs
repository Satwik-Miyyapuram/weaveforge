//! The `papers` repository as Rust-planned queries.
//!
//! Ported from `PostgrestPaperRepository` in
//! `apps/web/src/features/papers/infrastructure/postgrest-paper-repository.ts`.
//! Rows map with `papers::paper_row`. `findByTitleKey` matches titles in Rust after the
//! narrowed read, as the TS matches them in JS.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::papers::paper::{PaperStatus, normalize_doi};
use crate::papers::paper_row::{
    Paper, PaperRow, PaperSummary, empty_to_null, paper_to_domain, paper_to_row, paper_to_summary,
};
use crate::papers::paper_title::title_key;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "papers";

/// Full list projection for sync and search (TS `PAPER_LIST_COLUMNS`).
const PAPER_LIST_COLUMNS: &str = "id,title,authors,status,year,read_at,pdf_path,tags,created_at,updated_at,doi_bidx,arxiv_bidx,venue,abstract,summary,doi,arxiv_id,url,bibtex,metadata,rating,project_id";
/// Card projection (TS `PAPER_SUMMARY_COLUMNS`).
const PAPER_SUMMARY_COLUMNS: &str = "id,title,authors,status,year,read_at,pdf_path,tags,created_at,updated_at,project_id,summary,doi,arxiv_id,url";
/// What a delta read keys on (TS `PAPER_STAMP_COLUMNS`).
const PAPER_STAMP_COLUMNS: &str = "id,updated_at,created_at";
/// What a citation link reads (TS `PAPER_IDENTITY_COLUMNS`).
const PAPER_IDENTITY_COLUMNS: &str = "id,title,status";
/// How many ids one `in` filter carries; the list travels in the URL.
const ID_CHUNK: usize = 200;

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "listStamps" => list_stamps(call),
        "listByIds" => list_by_ids(call),
        "list" => list(call),
        "listSummaries" => list_summaries(call),
        "save" => save(call),
        "setTags" => set_tags(call),
        "replaceSummary" => replace_summary(call),
        "findByTitleKey" => find_by_title_key(call),
        "delete" => delete(call),
        "findByArxivId" => find_by_arxiv_id(call),
        "findByDoi" => find_by_doi(call),
        "findIdentityByArxivId" => find_identity_by_arxiv_id(call),
        "findIdentityByDoi" => find_identity_by_doi(call),
        _ => return None,
    })
}

/// The version columns a stamp read keys on.
#[derive(Deserialize)]
struct StampRow {
    id: String,
    updated_at: Option<String>,
    created_at: String,
}

/// `EntityStamp`: the id and the version it was last written at.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    id: String,
    updated_at: String,
}

/// `PaperIdentity`: what a citation link reads.
#[derive(Clone, Deserialize, Serialize)]
struct Identity {
    id: String,
    title: String,
    status: PaperStatus,
}

/// A title read for `findByTitleKey`.
#[derive(Deserialize)]
struct TitleRow {
    id: String,
    title: String,
}

/// `PaperFilter`, as `list` reads it.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filter {
    status: Option<PaperStatus>,
    title_contains: Option<String>,
    arxiv_id: Option<String>,
    doi: Option<String>,
}

/// The selected project, when one is (TS `this.pid`).
fn project_id(call: &RepoCall) -> Option<&str> {
    call.ctx.project_id.as_deref().filter(|id| !id.is_empty())
}

/// `query`, narrowed to the selected project when there is one (TS `scoped`).
fn scoped(call: &RepoCall, query: RepoQuery) -> RepoQuery {
    match project_id(call) {
        Some(pid) => query.eq("project_id", pid),
        None => query,
    }
}

fn domain(row: &PaperRow) -> Paper {
    paper_to_domain(row.clone())
}

fn summary(row: &PaperRow) -> PaperSummary {
    paper_to_summary(row.clone())
}

fn stamp(row: &StampRow) -> Stamp {
    Stamp {
        id: row.id.clone(),
        updated_at: row
            .updated_at
            .as_deref()
            .unwrap_or(&row.created_at)
            .to_owned(),
    }
}

/// The distinct words of `key` that are four or more lower-case ASCII letters or digits.
fn long_words(key: &str) -> Vec<&str> {
    let mut words: Vec<&str> = Vec::new();
    for word in key.split(' ') {
        let plain = word.len() >= 4
            && word
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
        if plain && !words.contains(&word) {
            words.push(word);
        }
    }
    words
}

/// `getById(id)`: the paper, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(call, RepoQuery::select(TABLE, PAPER_LIST_COLUMNS))
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<PaperRow>| row.as_ref().map(domain))
}

/// `listStamps()`: every id with its version, newest created first.
fn list_stamps(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(call, RepoQuery::select(TABLE, PAPER_STAMP_COLUMNS))
                .order("created_at", false)
                .order("id", true),
        );
    }
    map_rows(call, 0, stamp)
}

/// `listByIds(ids)`: one query per id chunk, sent together; no ids, no request.
fn list_by_ids(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let ids: Vec<String> = match call.parse(0) {
            Ok(ids) => ids,
            Err(e) => return RepoStep::fail(e),
        };
        if ids.is_empty() {
            return RepoStep::done(&Vec::<Paper>::new());
        }
        let queries = ids
            .chunks(ID_CHUNK)
            .map(|chunk| {
                scoped(call, RepoQuery::select(TABLE, PAPER_LIST_COLUMNS))
                    .filter("in", "id", json!(chunk))
                    .order("id", true)
            })
            .collect();
        return RepoStep::Send { queries };
    }
    // Chunk replies are concatenated in chunk order, as the TS `inChunks` does.
    let mut found = Vec::new();
    for i in 0..call.replies.len() {
        match call.reply::<Vec<PaperRow>>(i) {
            Some(Ok(rows)) => found.extend(rows.iter().map(domain)),
            Some(Err(e)) => return RepoStep::fail(e),
            None => return RepoStep::fail(format!("reply {i} missing")),
        }
    }
    RepoStep::done(&found)
}

/// `list(filter?)`: newest created first, ties by id.
fn list(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, domain);
    }
    let filter: Filter = if call.arg(0).is_null() {
        Filter::default()
    } else {
        match call.parse(0) {
            Ok(filter) => filter,
            Err(e) => return RepoStep::fail(e),
        }
    };
    let mut query = scoped(call, RepoQuery::select(TABLE, PAPER_LIST_COLUMNS));
    if let Some(status) = filter.status {
        query = query.eq("status", json!(status));
    }
    if let Some(arxiv_id) = filter.arxiv_id.filter(|id| !id.is_empty()) {
        query = query.eq("arxiv_id", arxiv_id);
    }
    // A DOI that does not normalise filters nothing, as the TS does.
    if let Some(doi) = normalize_doi(filter.doi.as_deref()) {
        query = query.eq("doi", doi);
    }
    if let Some(title) = filter.title_contains.filter(|t| !t.is_empty()) {
        query = query.filter("ilike", "title", format!("%{title}%"));
    }
    RepoStep::send(query.order("created_at", false).order("id", true))
}

/// `listSummaries()`: the card projection, newest created first.
fn list_summaries(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(call, RepoQuery::select(TABLE, PAPER_SUMMARY_COLUMNS))
                .order("created_at", false)
                .order("id", true),
        );
    }
    map_rows(call, 0, summary)
}

/// `save(paper)`: upsert on `id`, stamped with the selected project when there is one.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let paper: Paper = match call.parse(0) {
        Ok(paper) => paper,
        Err(e) => return RepoStep::fail(e),
    };
    let mut row = json!(paper_to_row(paper));
    if let (Some(pid), Value::Object(map)) = (project_id(call), &mut row) {
        let _ = map.insert("project_id".into(), json!(pid));
    }
    RepoStep::send(RepoQuery::upsert(TABLE, row).on_conflict("id", false))
}

/// `setTags(id, tags, updatedAt)`.
fn set_tags(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let tags: Vec<String> = match call.parse(1) {
        Ok(tags) => tags,
        Err(e) => return RepoStep::fail(e),
    };
    let body = json!({ "tags": tags, "updated_at": call.text(2) });
    RepoStep::send(scoped(call, RepoQuery::update(TABLE, body)).eq("id", call.text(0)))
}

/// `replaceSummary(id, expected, next, updatedAt)`: compare-and-set; `true` when a row matched.
fn replace_summary(call: &RepoCall) -> RepoStep {
    if let Some(reply) = call.reply::<Vec<Value>>(0) {
        return match reply {
            Ok(rows) => RepoStep::done(&!rows.is_empty()),
            Err(e) => RepoStep::fail(e),
        };
    }
    let expected = empty_to_null(call.arg(1).as_str().map(str::to_owned));
    let body = json!({
        "summary": empty_to_null(Some(call.text(2).to_owned())),
        "updated_at": call.text(3),
    });
    let query = scoped(call, RepoQuery::update(TABLE, body)).eq("id", call.text(0));
    let query = match expected {
        Some(was) => query.eq("summary", was),
        None => query.filter("is", "summary", Value::Null),
    };
    RepoStep::send(query.returning("id"))
}

/// `findByTitleKey(key)`: titles sharing a long word with the key are read, the one whose
/// title key is `key` is picked in Rust, then that paper is loaded.
fn find_by_title_key(call: &RepoCall) -> RepoStep {
    let key = call.text(0);
    match call.replies.len() {
        0 => {
            let words = long_words(key);
            let mut query = scoped(call, RepoQuery::select(TABLE, "id,title"));
            if !words.is_empty() {
                let clauses: Vec<String> = words
                    .iter()
                    .map(|word| format!("title.ilike.%{word}%"))
                    .collect();
                query = query.filter("or", "", clauses.join(","));
            }
            RepoStep::send(query.order("created_at", false).order("id", true))
        }
        1 => {
            let rows = match call.reply::<Vec<TitleRow>>(0) {
                Some(Ok(rows)) => rows,
                Some(Err(e)) => return RepoStep::fail(e),
                None => return RepoStep::fail("reply 0 missing"),
            };
            let hit = rows
                .into_iter()
                .find(|row| title_key(Some(row.title.as_str())).as_deref() == Some(key));
            match hit {
                Some(hit) => RepoStep::send(
                    scoped(call, RepoQuery::select(TABLE, PAPER_LIST_COLUMNS))
                        .eq("id", hit.id)
                        .maybe_single(),
                ),
                None => RepoStep::done(&Value::Null),
            }
        }
        _ => map_row(call, 1, |row: &Option<PaperRow>| row.as_ref().map(domain)),
    }
}

/// `delete(id)`.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(scoped(call, RepoQuery::delete(TABLE)).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// One paper matching `column = value`, or `null`.
fn find_by(call: &RepoCall, column: &str, value: &str) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(call, RepoQuery::select(TABLE, PAPER_LIST_COLUMNS))
                .eq(column, value)
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<PaperRow>| row.as_ref().map(domain))
}

/// `findByArxivId(arxivId)`.
fn find_by_arxiv_id(call: &RepoCall) -> RepoStep {
    find_by(call, "arxiv_id", call.text(0))
}

/// `findByDoi(doi)`: a DOI that does not normalise finds nothing, without a request.
fn find_by_doi(call: &RepoCall) -> RepoStep {
    match normalize_doi(Some(call.text(0))) {
        Some(doi) => find_by(call, "doi", &doi),
        None => RepoStep::done(&Value::Null),
    }
}

/// The identity of one paper matching `column = value`, or `null`.
fn find_identity(call: &RepoCall, column: &str, value: &str) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            scoped(call, RepoQuery::select(TABLE, PAPER_IDENTITY_COLUMNS))
                .eq(column, value)
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<Identity>| row.clone())
}

/// `findIdentityByArxivId(arxivId)`.
fn find_identity_by_arxiv_id(call: &RepoCall) -> RepoStep {
    find_identity(call, "arxiv_id", call.text(0))
}

/// `findIdentityByDoi(doi)`: a DOI that does not normalise finds nothing, without a request.
fn find_identity_by_doi(call: &RepoCall) -> RepoStep {
    match normalize_doi(Some(call.text(0))) {
        Some(doi) => find_identity(call, "doi", &doi),
        None => RepoStep::done(&Value::Null),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                ..RepoCtx::default()
            },
        }
    }

    fn sent(step: RepoStep) -> Vec<RepoQuery> {
        match step {
            RepoStep::Send { queries } => queries,
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn first(step: RepoStep) -> RepoQuery {
        sent(step).remove(0)
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn ops(q: &RepoQuery) -> Vec<(&str, &str)> {
        q.filters
            .iter()
            .map(|f| (f.op.as_str(), f.column.as_str()))
            .collect()
    }

    fn row() -> Value {
        json!({ "id": "p1", "title": "Attention Is All You Need", "authors": ["A"],
            "year": 2017, "status": "to_read", "tags": null, "metadata": null,
            "abstract": "a", "created_at": "c", "updated_at": "u" })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn get_by_id_scopes_to_the_project_and_maps_a_missing_row_to_null() {
        let q = first(step("getById", &call(vec![json!("p1")], vec![])).unwrap());
        assert_eq!(ops(&q), [("eq", "project_id"), ("eq", "id")]);
        assert_eq!(q.single, RepoSingle::Maybe);
        let none = step("getById", &call(vec![json!("p1")], vec![Value::Null])).unwrap();
        assert_eq!(done(none), Value::Null);
        let found = step("getById", &call(vec![json!("p1")], vec![row()])).unwrap();
        assert_eq!(done(found)["abstract"], "a");
    }

    #[test]
    fn list_stamps_reads_versions_and_falls_back_to_created() {
        let q = first(step("listStamps", &call(vec![], vec![])).unwrap());
        assert_eq!(q.columns.as_deref(), Some(PAPER_STAMP_COLUMNS));
        assert_eq!(q.order[0].column, "created_at");
        assert!(!q.order[0].ascending);
        let reply = json!([{ "id": "p1", "updated_at": null, "created_at": "c" }]);
        let v = done(step("listStamps", &call(vec![], vec![reply])).unwrap());
        assert_eq!(v, json!([{ "id": "p1", "updatedAt": "c" }]));
    }

    #[test]
    fn list_by_ids_chunks_by_200_and_skips_the_request_when_empty() {
        let ids: Vec<String> = (0..450).map(|i| format!("p{i}")).collect();
        let queries = sent(step("listByIds", &call(vec![json!(ids)], vec![])).unwrap());
        assert_eq!(queries.len(), 3);
        assert_eq!(
            queries[0].filters[1].value.as_array().map(Vec::len),
            Some(200)
        );
        assert_eq!(
            queries[2].filters[1].value.as_array().map(Vec::len),
            Some(50)
        );
        let none = step("listByIds", &call(vec![json!([])], vec![])).unwrap();
        assert_eq!(done(none), json!([]));
        let reply = json!([row()]);
        let found = step("listByIds", &call(vec![json!(["p1"])], vec![reply])).unwrap();
        assert_eq!(done(found)[0]["id"], "p1");
    }

    #[test]
    fn list_narrows_by_filter_and_project_then_orders_newest_first() {
        let filter = json!({ "status": "read", "arxivId": "2401.1",
            "doi": "https://doi.org/10.1000/ABC", "titleContains": "attention" });
        let q = first(step("list", &call(vec![filter], vec![])).unwrap());
        assert_eq!(
            ops(&q),
            [
                ("eq", "project_id"),
                ("eq", "status"),
                ("eq", "arxiv_id"),
                ("eq", "doi"),
                ("ilike", "title"),
            ]
        );
        assert_eq!(q.filters[1].value, json!("read"));
        assert_eq!(q.filters[3].value, json!("10.1000/abc"));
        assert_eq!(q.filters[4].value, json!("%attention%"));
        assert_eq!(q.order[0].column, "created_at");
        assert_eq!(q.order[1].column, "id");
        let mut bare = call(vec![Value::Null], vec![]);
        bare.ctx.project_id = None;
        assert!(first(step("list", &bare).unwrap()).filters.is_empty());
        let v = done(step("list", &call(vec![Value::Null], vec![json!([row()])])).unwrap());
        assert_eq!(v[0]["id"], "p1");
    }

    #[test]
    fn list_summaries_reads_card_columns_and_maps_them() {
        let q = first(step("listSummaries", &call(vec![], vec![])).unwrap());
        assert_eq!(q.columns.as_deref(), Some(PAPER_SUMMARY_COLUMNS));
        let v = done(step("listSummaries", &call(vec![], vec![json!([row()])])).unwrap());
        assert_eq!(v[0]["id"], "p1");
        assert!(v[0].get("abstract").is_none());
    }

    #[test]
    fn save_upserts_on_id_with_the_project_and_rejects_bad_input() {
        let paper = json!({ "id": "p1", "title": "T", "authors": [], "status": "to_read",
            "createdAt": "c", "updatedAt": "u" });
        let q = first(step("save", &call(vec![paper], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some("id"));
        let body = q.body.unwrap();
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["created_at"], "c");
        assert_eq!(body["doi_bidx"], Value::Null);
        let bad = step("save", &call(vec![json!({})], vec![])).unwrap();
        assert!(matches!(bad, RepoStep::Fail { .. }));
    }

    #[test]
    fn set_tags_updates_one_paper_in_the_project() {
        let args = vec![json!("p1"), json!(["a"]), json!("2026-11-11T00:00:00Z")];
        let q = first(step("setTags", &call(args, vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(ops(&q), [("eq", "project_id"), ("eq", "id")]);
        let body = q.body.unwrap();
        assert_eq!(body["tags"], json!(["a"]));
        assert_eq!(body["updated_at"], "2026-11-11T00:00:00Z");
        let bad = vec![json!("p1"), json!("x"), json!("u")];
        assert!(matches!(
            step("setTags", &call(bad, vec![])).unwrap(),
            RepoStep::Fail { .. }
        ));
        let done_step = step(
            "setTags",
            &call(vec![json!("p1"), json!([]), json!("u")], vec![Value::Null]),
        );
        assert_eq!(done(done_step.unwrap()), Value::Null);
    }

    #[test]
    fn replace_summary_compares_and_reports_whether_a_row_matched() {
        let args = |expected: Value| vec![json!("p1"), expected, json!("next"), json!("u")];
        let q = first(step("replaceSummary", &call(args(json!("old")), vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(q.columns.as_deref(), Some("id"));
        assert_eq!(
            ops(&q),
            [("eq", "project_id"), ("eq", "id"), ("eq", "summary")]
        );
        assert_eq!(q.body.as_ref().unwrap()["summary"], "next");
        let empty = first(step("replaceSummary", &call(args(json!("")), vec![])).unwrap());
        assert_eq!(ops(&empty)[2], ("is", "summary"));
        let miss = step("replaceSummary", &call(args(Value::Null), vec![json!([])]));
        assert_eq!(done(miss.unwrap()), json!(false));
        let hit = step(
            "replaceSummary",
            &call(args(Value::Null), vec![json!([{ "id": "p1" }])]),
        );
        assert_eq!(done(hit.unwrap()), json!(true));
    }

    #[test]
    fn find_by_title_key_reads_titles_then_loads_the_match() {
        let key = "attention is all you need";
        let titling = first(step("findByTitleKey", &call(vec![json!(key)], vec![])).unwrap());
        assert_eq!(titling.columns.as_deref(), Some("id,title"));
        assert_eq!(titling.filters[1].op, "or");
        assert_eq!(
            titling.filters[1].value,
            json!("title.ilike.%attention%,title.ilike.%need%")
        );
        let titles = json!([{ "id": "p1", "title": "Attention Is All You Need" },
            { "id": "p2", "title": "Other" }]);
        let loading = step(
            "findByTitleKey",
            &call(vec![json!(key)], vec![titles.clone()]),
        );
        let loading = first(loading.unwrap());
        assert_eq!(ops(&loading), [("eq", "project_id"), ("eq", "id")]);
        assert_eq!(loading.filters[1].value, json!("p1"));
        let loaded = step(
            "findByTitleKey",
            &call(vec![json!(key)], vec![titles, row()]),
        );
        assert_eq!(done(loaded.unwrap())["id"], "p1");
        let miss = json!([{ "id": "p2", "title": "Other" }]);
        let none = step("findByTitleKey", &call(vec![json!(key)], vec![miss]));
        assert_eq!(done(none.unwrap()), Value::Null);
    }

    #[test]
    fn delete_removes_one_paper_in_the_project() {
        let q = first(step("delete", &call(vec![json!("p1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(ops(&q), [("eq", "project_id"), ("eq", "id")]);
        let gone = step("delete", &call(vec![json!("p1")], vec![Value::Null]));
        assert_eq!(done(gone.unwrap()), Value::Null);
    }

    #[test]
    fn find_by_arxiv_id_and_doi_match_one_row_by_identifier() {
        let q = first(step("findByArxivId", &call(vec![json!("2401.1")], vec![])).unwrap());
        assert_eq!(ops(&q), [("eq", "project_id"), ("eq", "arxiv_id")]);
        let by_doi = step(
            "findByDoi",
            &call(vec![json!("https://doi.org/10.1000/ABC")], vec![]),
        );
        assert_eq!(
            first(by_doi.unwrap()).filters[1].value,
            json!("10.1000/abc")
        );
        let no_doi = step("findByDoi", &call(vec![json!("")], vec![]));
        assert_eq!(done(no_doi.unwrap()), Value::Null);
        let hit = step("findByArxivId", &call(vec![json!("2401.1")], vec![row()]));
        assert_eq!(done(hit.unwrap())["id"], "p1");
    }

    #[test]
    fn find_identity_reads_three_columns_by_arxiv_id_or_doi() {
        let q = first(
            step(
                "findIdentityByArxivId",
                &call(vec![json!("2401.1")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.columns.as_deref(), Some(PAPER_IDENTITY_COLUMNS));
        let by_doi = step(
            "findIdentityByDoi",
            &call(vec![json!("10.1000/ABC")], vec![]),
        );
        assert_eq!(
            first(by_doi.unwrap()).filters[1].value,
            json!("10.1000/abc")
        );
        let hit = json!({ "id": "p1", "title": "T", "status": "read" });
        let found = step(
            "findIdentityByDoi",
            &call(vec![json!("10.1000/ABC")], vec![hit.clone()]),
        );
        assert_eq!(done(found.unwrap()), hit);
        let miss = step(
            "findIdentityByArxivId",
            &call(vec![json!("x")], vec![Value::Null]),
        );
        assert_eq!(done(miss.unwrap()), Value::Null);
        let no_doi = step("findIdentityByDoi", &call(vec![json!("")], vec![]));
        assert_eq!(done(no_doi.unwrap()), Value::Null);
    }
}

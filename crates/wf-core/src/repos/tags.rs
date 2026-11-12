//! The `tags` repository (`tags`, `paper_tags`) as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/tags/infrastructure/postgrest-tag-repository.ts`
//! (`PostgrestTagRepository`) and from the former TS `ManageTagsUseCase`, whose methods are arms
//! here. Reads and `save` filter or write `project_id` only when a project
//! is selected, as the TS does. The `PostgrestPaperTagRepository` links are reached through
//! [`super::paper_tags`].
//!
//! The use-case methods are plans over these queries. Every distinct tag is read once by
//! `getById` in one batch (the web cache memoises `getById`, so it stays the only tag read).
//! A new tag's id is `call.id(index)`, where `index` is the position of its name among the
//! distinct names of the call, so every replay derives the same id.

use std::collections::HashSet;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{paper_tags, papers};
use crate::js_collate::locale_compare;
use crate::papers::paper::normalize_tags;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::tag_counts::{TagPaperLink, paper_counts_for_tags};
use crate::tag_row::{Tag, TagRow, to_tag};

const TABLE: &str = "tags";
const PAPER_TAGS: &str = "paper_tags";
const TAG_COLUMNS: &str = "id,name,color";
const PAPER_TAG_LINK_COLUMNS: &str = "paper_id,tag_id,source,annotation_ref";

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

/// A `paper_tags` row as read by the link reads of this module.
#[derive(Debug, Deserialize)]
struct LinkRow {
    paper_id: String,
    tag_id: String,
    source: String,
}

/// A `paper_tags` row read for its paper id only.
#[derive(Debug, Deserialize)]
struct PaperIdRow {
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

/// One tag membership to write (TS `reconcileSources` item, camelCase).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReconcileItem {
    name: String,
    source: String,
    #[serde(default)]
    annotation_ref: Option<String>,
}

/// One link of a paper with its tag name and source (TS `listPaperTagLinks` item).
#[derive(Debug, Serialize)]
struct TagLinkName {
    name: String,
    source: String,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "findByName" => find_by_name(call),
        "list" | "listAll" => list(call),
        "listWithCounts" => list_with_counts(call),
        "save" => save(call),
        "delete" => delete(call),
        "listForPaper" => finish(list_for_paper(call)),
        "listPapersForTag" => finish(papers_for_tag(call)),
        "listPaperTagLinks" => finish(paper_tag_links(call)),
        "setManualTags" => finish(set_manual_tags(call)),
        "mergeTags" => finish(merge_tags(call)),
        "removeManualTag" => finish(remove_manual_tag(call)),
        "reconcileSources" => finish(reconcile_sources(call)),
        "mergeConcepts" => finish(merge_concepts(call)),
        "refreshPaperCache" => finish(refresh_paper_cache(call)),
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

/// The finished value of a plan, or the step it still needs to send.
fn finish(result: Result<Value, RepoStep>) -> RepoStep {
    match result {
        Ok(value) => RepoStep::Done { value },
        Err(step) => step,
    }
}

/// The value of a sub-step that finished, or the step it still needs (a send or a failure).
fn sub_done(step: RepoStep) -> Result<Value, RepoStep> {
    match step {
        RepoStep::Done { value } => Ok(value),
        other => Err(other),
    }
}

/// Reply `value` read as `T`, or the failing step.
fn read<T: DeserializeOwned>(value: &Value) -> Result<T, RepoStep> {
    serde_json::from_value(value.clone()).map_err(|e| RepoStep::fail(format!("reply: {e}")))
}

/// Argument `i` parsed as `T`, or the failing step.
fn arg_as<T: DeserializeOwned>(call: &RepoCall, i: usize) -> Result<T, RepoStep> {
    call.parse(i).map_err(RepoStep::fail)
}

/// `value` serialized as the reply, or the failing step.
fn value_of<T: Serialize>(value: &T) -> Result<Value, RepoStep> {
    serde_json::to_value(value).map_err(RepoStep::fail)
}

/// The distinct ids, in first-seen order.
fn distinct_ids<'a>(ids: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.filter(|id| seen.insert(*id))
        .map(str::to_owned)
        .collect()
}

/// A tag name as the TS `normalizeTagName` gives it: `None` when nothing is left.
fn normalize_name(raw: &str) -> Option<String> {
    normalize_tags(&[raw.to_owned()]).into_iter().next()
}

/// Runs `queries` at reply position `pos`. Sends them when none of their replies are back,
/// returns their replies once all are back, and fails when only some are.
fn batch(call: &RepoCall, pos: usize, queries: Vec<RepoQuery>) -> Result<Vec<Value>, RepoStep> {
    let n = queries.len();
    if n == 0 {
        return Ok(Vec::new());
    }
    match call.replies.len().checked_sub(pos) {
        Some(0) => Err(RepoStep::Send { queries }),
        Some(got) if got >= n => Ok(call.replies[pos..pos + n].to_vec()),
        _ => Err(RepoStep::fail("reply batch incomplete")),
    }
}

/// The `getById` query of one tag (the same read as the `getById` arm).
fn tag_query(id: &str) -> RepoQuery {
    RepoQuery::select(TABLE, TAG_COLUMNS)
        .eq("id", id)
        .maybe_single()
}

/// The `findByName` query of one tag name, scoped to the project.
fn find_by_name_query(call: &RepoCall, name: &str) -> RepoQuery {
    scoped(RepoQuery::select(TABLE, TAG_COLUMNS).eq("name", name), call).maybe_single()
}

/// The `tags` row of a new tag, with `project_id` when a project is selected (TS `save`).
fn new_tag_row(call: &RepoCall, id: &str, name: &str) -> Value {
    let mut row = json!({ "id": id, "name": name, "color": null });
    if let Some(pid) = project_id(call) {
        row["project_id"] = json!(pid);
    }
    row
}

/// The `paper_tags` links of one paper, read with their source.
fn links_query(paper_id: &str) -> RepoQuery {
    RepoQuery::select(PAPER_TAGS, PAPER_TAG_LINK_COLUMNS).eq("paper_id", paper_id)
}

/// A paper's links, and the tags they point at, read once per distinct tag (TS `listForPaper`
/// with `tagsById`).
struct PaperLinks {
    /// The links, in the order the table returned them.
    links: Vec<LinkRow>,
    /// The found tags, one per distinct tag id, in first-link order.
    tags: Vec<Tag>,
    /// The reply position after the replies this read used.
    pos: usize,
}

impl PaperLinks {
    /// The found tag with this id, when it exists.
    fn tag(&self, id: &str) -> Option<&Tag> {
        self.tags.iter().find(|t| t.id == id)
    }
}

/// Reads a paper's links at `pos`, then each distinct tag they name at the position after.
fn paper_links(call: &RepoCall, pos: usize, paper_id: &str) -> Result<PaperLinks, RepoStep> {
    let values = batch(call, pos, vec![links_query(paper_id)])?;
    let links: Vec<LinkRow> = read(values.first().unwrap_or(&Value::Null))?;
    let ids = distinct_ids(links.iter().map(|l| l.tag_id.as_str()));
    let (found, pos) = tags_by_id(call, pos + 1, &ids)?;
    Ok(PaperLinks {
        links,
        tags: found.into_iter().flatten().collect(),
        pos,
    })
}

/// The tags of `ids`, one `getById` each in one batch at `pos`; unknown ids give `None`.
/// Returns the tags and the reply position after them.
fn tags_by_id(
    call: &RepoCall,
    pos: usize,
    ids: &[String],
) -> Result<(Vec<Option<Tag>>, usize), RepoStep> {
    let queries = ids.iter().map(|id| tag_query(id)).collect();
    let values = batch(call, pos, queries)?;
    let mut tags = Vec::with_capacity(values.len());
    for value in &values {
        let row: Option<TagRow> = read(value)?;
        tags.push(row.as_ref().map(to_tag));
    }
    Ok((tags, pos + ids.len()))
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
        return RepoStep::send(find_by_name_query(call, call.text(0)));
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

/// `listForPaper(paperId)`: the paper's tags, one per distinct tag, by name (TS `listForPaper`).
fn list_for_paper(call: &RepoCall) -> Result<Value, RepoStep> {
    let mut tags = paper_links(call, 0, call.text(0))?.tags;
    tags.sort_by(|a, b| locale_compare(&a.name, &b.name));
    value_of(&tags)
}

/// `listPapersForTag(tagId)`: the distinct paper ids linked to the tag.
fn papers_for_tag(call: &RepoCall) -> Result<Value, RepoStep> {
    let query = RepoQuery::select(PAPER_TAGS, "paper_id").eq("tag_id", call.text(0));
    let values = batch(call, 0, vec![query])?;
    let rows: Vec<PaperIdRow> = read(values.first().unwrap_or(&Value::Null))?;
    value_of(&distinct_ids(rows.iter().map(|r| r.paper_id.as_str())))
}

/// `listPaperTagLinks(paperId)`: each link with its tag name and source, by name. A link to a
/// missing tag is skipped.
fn paper_tag_links(call: &RepoCall) -> Result<Value, RepoStep> {
    let paper = paper_links(call, 0, call.text(0))?;
    let mut out: Vec<TagLinkName> = paper
        .links
        .iter()
        .filter_map(|l| {
            paper.tag(&l.tag_id).map(|t| TagLinkName {
                name: t.name.clone(),
                source: l.source.clone(),
            })
        })
        .collect();
    out.sort_by(|a, b| locale_compare(&a.name, &b.name));
    value_of(&out)
}

/// `setManualTags(paperId, rawNames)`: replaces the manual tags, then refreshes the cache once.
fn set_manual_tags(call: &RepoCall) -> Result<Value, RepoStep> {
    let raw: Vec<String> = arg_as(call, 1)?;
    let items: Vec<ReconcileItem> = normalize_tags(&raw)
        .into_iter()
        .map(|name| ReconcileItem {
            name,
            source: "manual".to_owned(),
            annotation_ref: None,
        })
        .collect();
    let pos = reconcile_items(call, 0, call.text(0), &items, &["manual".to_owned()])?;
    refresh(call, pos, call.text(0)).map(|(paper, _)| paper)
}

/// `mergeTags(paperId, rawNames, source = "manual")`: unions the names into the tags of that
/// source, then refreshes the cache once.
fn merge_tags(call: &RepoCall) -> Result<Value, RepoStep> {
    let raw: Vec<String> = arg_as(call, 1)?;
    let source = match call.arg(2) {
        Value::String(s) if !s.is_empty() => s.clone(),
        _ => "manual".to_owned(),
    };
    let paper = paper_links(call, 0, call.text(0))?;
    let existing: Vec<String> = paper
        .links
        .iter()
        .filter(|l| l.source == source)
        .filter_map(|l| paper.tag(&l.tag_id).map(|t| t.name.clone()))
        .collect();
    let merged = normalize_tags(&[existing, raw].concat());
    let items: Vec<ReconcileItem> = merged
        .into_iter()
        .map(|name| ReconcileItem {
            name,
            source: source.clone(),
            annotation_ref: None,
        })
        .collect();
    let pos = reconcile_items(call, paper.pos, call.text(0), &items, &[source])?;
    refresh(call, pos, call.text(0)).map(|(paper, _)| paper)
}

/// `removeManualTag(paperId, rawName)`: unlinks the first manual link named `rawName`; synced
/// links are untouched. Refreshes the cache either way.
fn remove_manual_tag(call: &RepoCall) -> Result<Value, RepoStep> {
    let paper_id = call.text(0);
    let Some(name) = normalize_name(call.text(1)) else {
        return refresh(call, 0, paper_id).map(|(paper, _)| paper);
    };
    let paper = paper_links(call, 0, paper_id)?;
    let target = paper
        .links
        .iter()
        .filter(|l| l.source == "manual")
        .find(|l| paper.tag(&l.tag_id).is_some_and(|t| t.name == name));
    let mut pos = paper.pos;
    if let Some(link) = target {
        let query = RepoQuery::delete(PAPER_TAGS)
            .eq("paper_id", paper_id)
            .eq("tag_id", link.tag_id.as_str())
            .eq("source", "manual");
        let _ = batch(call, pos, vec![query])?;
        pos += 1;
    }
    refresh(call, pos, paper_id).map(|(paper, _)| paper)
}

/// `reconcileSources(paperId, items, sources)`: replaces the links from `sources` with `items`,
/// then refreshes the cache.
fn reconcile_sources(call: &RepoCall) -> Result<Value, RepoStep> {
    let items: Vec<ReconcileItem> = arg_as(call, 1)?;
    let sources: Vec<String> = arg_as(call, 2)?;
    let pos = reconcile_items(call, 0, call.text(0), &items, &sources)?;
    refresh(call, pos, call.text(0)).map(|(paper, _)| paper)
}

/// The reconcile of [`reconcile_sources`] without the refresh (TS `reconcileSources` up to the
/// `paperTags.reconcile` call). Returns the reply position after it.
///
/// Reads every distinct name with `findByName` in one batch, creates the missing tags in a
/// second batch, then runs the `paper_tags` reconcile over the replies after them.
fn reconcile_items(
    call: &RepoCall,
    pos: usize,
    paper_id: &str,
    items: &[ReconcileItem],
    sources: &[String],
) -> Result<usize, RepoStep> {
    let mut keys = HashSet::new();
    let mut entries: Vec<(String, String, Option<String>)> = Vec::new();
    for item in items {
        let Some(name) = normalize_name(&item.name) else {
            continue;
        };
        if !keys.insert(format!("{name}:{}", item.source)) {
            continue;
        }
        entries.push((name, item.source.clone(), item.annotation_ref.clone()));
    }

    let names = distinct_ids(entries.iter().map(|e| e.0.as_str()));
    let lookups = names.iter().map(|n| find_by_name_query(call, n)).collect();
    let found = batch(call, pos, lookups)?;
    let mut pos = pos + names.len();

    let mut ids: Vec<(String, String)> = Vec::with_capacity(names.len());
    let mut creates = Vec::new();
    for (i, (name, value)) in names.iter().zip(&found).enumerate() {
        let existing: Option<TagRow> = read(value)?;
        let id = match existing {
            Some(row) => row.id,
            None => {
                let id = call.id(i);
                creates.push(RepoQuery::upsert(TABLE, new_tag_row(call, &id, name)));
                id
            }
        };
        ids.push((name.clone(), id));
    }
    let created = creates.len();
    let _ = batch(call, pos, creates)?;
    pos += created;

    let links: Vec<Value> = entries
        .iter()
        .map(|(name, source, annotation)| {
            let tag_id = ids
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, id)| id.clone())
                .unwrap_or_default();
            json!({
                "paperId": paper_id,
                "tagId": tag_id,
                "source": source,
                "annotationRef": annotation,
            })
        })
        .collect();
    let sub = call.sub(
        vec![json!(paper_id), Value::Array(links.clone()), json!(sources)],
        pos,
    );
    let reconcile =
        paper_tags::step("reconcile", &sub).unwrap_or_else(|| RepoStep::fail("reconcile missing"));
    let _ = sub_done(reconcile)?;
    // The reconcile step consumes one reply for its delete (when `sources` is set) and one for
    // its upsert (when there are links).
    let deletes = usize::from(!sources.is_empty());
    Ok(pos + deletes + usize::from(!links.is_empty()))
}

/// `mergeConcepts(keepTagId, dropTagId)`: moves the drop tag's links to the keep tag, deletes
/// the drop tag, then refreshes every paper it was on (TS `mergeConcepts`).
fn merge_concepts(call: &RepoCall) -> Result<Value, RepoStep> {
    let keep = call.text(0);
    let drop = call.text(1);
    if keep == drop {
        return Ok(Value::Null);
    }
    let values = batch(
        call,
        0,
        vec![RepoQuery::select(PAPER_TAGS, PAPER_TAG_LINK_COLUMNS).eq("tag_id", drop)],
    )?;
    let links: Vec<LinkRow> = read(values.first().unwrap_or(&Value::Null))?;
    let mut queries = Vec::new();
    for link in &links {
        queries.push(RepoQuery::upsert(
            PAPER_TAGS,
            json!({ "paper_id": link.paper_id, "tag_id": keep, "source": link.source }),
        ));
    }
    for link in &links {
        queries.push(
            RepoQuery::delete(PAPER_TAGS)
                .eq("paper_id", link.paper_id.as_str())
                .eq("tag_id", drop)
                .eq("source", link.source.as_str()),
        );
    }
    queries.push(RepoQuery::delete(TABLE).eq("id", drop));
    let written = queries.len();
    let _ = batch(call, 1, queries)?;
    let mut pos = 1 + written;
    for paper_id in distinct_ids(links.iter().map(|l| l.paper_id.as_str())) {
        pos = refresh(call, pos, &paper_id)?.1;
    }
    Ok(Value::Null)
}

/// `refreshPaperCache(paperId)`: the paper with its `tags` column set from its links.
fn refresh_paper_cache(call: &RepoCall) -> Result<Value, RepoStep> {
    refresh(call, 0, call.text(0)).map(|(paper, _)| paper)
}

/// Writes the names of a paper's links into its `tags` column and reads the paper back (TS
/// `refreshPaperCache`). Returns the paper and the reply position after it.
fn refresh(call: &RepoCall, pos: usize, paper_id: &str) -> Result<(Value, usize), RepoStep> {
    let paper = paper_links(call, pos, paper_id)?;
    let names: Vec<String> = paper.tags.iter().map(|t| t.name.clone()).collect();
    let mut names = normalize_tags(&names);
    names.sort();
    // Only the tag column is written, so an edit that landed meanwhile is kept.
    let set = papers::step(
        "setTags",
        &call.sub(
            vec![json!(paper_id), json!(names), json!(call.now())],
            paper.pos,
        ),
    )
    .unwrap_or_else(|| RepoStep::fail("setTags missing"));
    let _ = sub_done(set)?;
    let pos = paper.pos + 1;
    let get = papers::step("getById", &call.sub(vec![json!(paper_id)], pos))
        .unwrap_or_else(|| RepoStep::fail("getById missing"));
    let found = sub_done(get)?;
    if found.is_null() {
        return Err(RepoStep::fail_named(
            "NotFoundError",
            format!("No paper with id \"{paper_id}\"."),
        ));
    }
    Ok((found, pos + 1))
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

    fn link(tag: &str, source: &str) -> Value {
        json!({ "paper_id": "p1", "tag_id": tag, "source": source, "annotation_ref": null })
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
    fn list_all_is_list() {
        let q = only(step("listAll", &in_project(vec![], vec![])).unwrap());
        assert_eq!(q.order[0].column, "name");
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
    fn list_for_paper_reads_links_then_each_distinct_tag_once() {
        let first = step("listForPaper", &call(vec![json!("p1")], vec![])).unwrap();
        let q = only(first);
        assert_eq!(q.table, "paper_tags");
        assert_eq!(q.filters[0].column, "paper_id");

        let replies = vec![json!([
            link("t1", "manual"),
            link("t1", "summary"),
            link("t2", "manual")
        ])];
        let RepoStep::Send { queries } =
            step("listForPaper", &call(vec![json!("p1")], replies)).unwrap()
        else {
            panic!("expected the tag reads");
        };
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].filters[0].value, json!("t1"));
        assert_eq!(queries[1].filters[0].value, json!("t2"));
    }

    #[test]
    fn list_for_paper_sorts_tags_by_name() {
        let replies = vec![
            json!([link("t1", "manual"), link("t2", "manual")]),
            json!({ "id": "t1", "name": "zeta", "color": null }),
            json!({ "id": "t2", "name": "alpha", "color": null }),
        ];
        assert_eq!(
            step("listForPaper", &call(vec![json!("p1")], replies)),
            Some(RepoStep::Done {
                value: json!([{ "id": "t2", "name": "alpha" }, { "id": "t1", "name": "zeta" }])
            })
        );
    }

    #[test]
    fn list_papers_for_tag_lists_distinct_paper_ids() {
        let replies = vec![json!([
            { "paper_id": "p1" },
            { "paper_id": "p1" },
            { "paper_id": "p2" }
        ])];
        assert_eq!(
            step("listPapersForTag", &call(vec![json!("t1")], replies)),
            Some(RepoStep::Done {
                value: json!(["p1", "p2"])
            })
        );
    }

    #[test]
    fn paper_tag_links_skip_a_link_to_a_missing_tag() {
        let replies = vec![
            json!([link("t1", "manual"), link("t2", "zotero")]),
            json!({ "id": "t1", "name": "a", "color": null }),
            Value::Null,
        ];
        assert_eq!(
            step("listPaperTagLinks", &call(vec![json!("p1")], replies)),
            Some(RepoStep::Done {
                value: json!([{ "name": "a", "source": "manual" }])
            })
        );
    }

    #[test]
    fn reconcile_sources_looks_up_each_name_once() {
        let items = json!([
            { "name": "ml", "source": "manual" },
            { "name": "ml", "source": "zotero" }
        ]);
        let q = only(
            step(
                "reconcileSources",
                &call(
                    vec![json!("p1"), items, json!(["manual", "zotero"])],
                    vec![],
                ),
            )
            .unwrap(),
        );
        assert_eq!(q.table, "tags");
        assert_eq!(q.filters[0].column, "name");
        assert_eq!(q.filters[0].value, json!("ml"));
    }

    #[test]
    fn reconcile_sources_creates_a_missing_tag_with_a_fresh_id() {
        let items = json!([{ "name": "ml", "source": "manual" }]);
        let ctx = RepoCtx {
            id_seed: Some("seed".into()),
            ..RepoCtx::default()
        };
        let c = RepoCall {
            args: vec![json!("p1"), items, json!(["manual"])],
            replies: vec![Value::Null],
            ctx,
        };
        let RepoStep::Send { queries } = step("reconcileSources", &c).unwrap() else {
            panic!("expected the create");
        };
        assert_eq!(queries[0].action, RepoAction::Upsert);
        assert_eq!(queries[0].body.as_ref().unwrap()["id"], json!(c.id(0)));
        assert_eq!(queries[0].body.as_ref().unwrap()["name"], json!("ml"));
    }

    #[test]
    fn merge_concepts_with_the_same_ids_does_nothing() {
        assert_eq!(
            step(
                "mergeConcepts",
                &call(vec![json!("t1"), json!("t1")], vec![])
            ),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn remove_manual_tag_with_a_blank_name_only_refreshes() {
        let q = only(
            step(
                "removeManualTag",
                &call(vec![json!("p1"), json!("#")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.table, "paper_tags");
    }

    #[test]
    fn refresh_writes_sorted_tag_names_to_the_paper() {
        let replies = vec![
            json!([link("t1", "manual"), link("t2", "manual")]),
            json!({ "id": "t1", "name": "Zeta", "color": null }),
            json!({ "id": "t2", "name": "#alpha", "color": null }),
        ];
        let q = only(step("refreshPaperCache", &call(vec![json!("p1")], replies)).unwrap());
        assert_eq!(q.table, "papers");
        assert_eq!(q.body.unwrap()["tags"], json!(["alpha", "zeta"]));
    }

    #[test]
    fn refresh_of_a_paper_that_is_gone_fails_with_not_found() {
        let replies = vec![json!([]), Value::Null, Value::Null];
        let s = step("refreshPaperCache", &call(vec![json!("p1")], replies)).unwrap();
        assert_eq!(
            s,
            RepoStep::Fail {
                message: "No paper with id \"p1\".".into(),
                name: Some("NotFoundError".into()),
            }
        );
    }

    #[test]
    fn set_manual_tags_creates_tags_links_them_and_refreshes_the_paper_cache() {
        let ctx = RepoCtx {
            id_seed: Some("seed".into()),
            ..RepoCtx::default()
        };
        let args = vec![json!("p1"), json!(["ml", "  NLP  "])];
        let c = |replies: Vec<Value>| RepoCall {
            args: args.clone(),
            replies,
            ctx: ctx.clone(),
        };
        let RepoStep::Send { queries } = step("setManualTags", &c(vec![])).unwrap() else {
            panic!("expected the tag lookups")
        };
        assert_eq!(queries[0].filters[0].value, json!("ml"));
        assert_eq!(queries[1].filters[0].value, json!("nlp"));
        let RepoStep::Send { queries } = step("setManualTags", &c(vec![Value::Null; 2])).unwrap()
        else {
            panic!("expected the tag creates")
        };
        assert_eq!(queries[1].body.as_ref().unwrap()["name"], json!("nlp"));
        let RepoStep::Send { queries } = step("setManualTags", &c(vec![Value::Null; 4])).unwrap()
        else {
            panic!("expected the manual links delete")
        };
        assert_eq!(queries[0].table, "paper_tags");
        let RepoStep::Send { queries } = step("setManualTags", &c(vec![Value::Null; 5])).unwrap()
        else {
            panic!("expected the link upsert")
        };
        assert_eq!(queries[0].action, RepoAction::Upsert);
        assert_eq!(queries[0].body.as_ref().unwrap().as_array().map(Vec::len), Some(2));
        let id0 = c(vec![]).id(0);
        let id1 = c(vec![]).id(1);
        let mut replies = vec![Value::Null; 6];
        replies.push(json!([link(&id0, "manual"), link(&id1, "manual")]));
        replies.push(json!({ "id": id0, "name": "ml", "color": null }));
        replies.push(json!({ "id": id1, "name": "nlp", "color": null }));
        let RepoStep::Send { queries } = step("setManualTags", &c(replies)).unwrap() else {
            panic!("expected the paper cache write")
        };
        assert_eq!(queries[0].table, "papers");
        assert_eq!(queries[0].body.as_ref().unwrap()["tags"], json!(["ml", "nlp"]));
    }

    #[test]
    fn set_manual_tags_replacing_removes_dropped_manual_tags() {
        let args = vec![json!("p1"), json!(["b", "c"])];
        // "b" exists, "c" is new; the replace clears the manual links before re-adding.
        let replies = vec![
            json!({ "id": "tb", "name": "b", "color": null }),
            Value::Null,
            Value::Null,
        ];
        let call = RepoCall {
            args,
            replies,
            ..RepoCall::default()
        };
        let RepoStep::Send { queries } = step("setManualTags", &call).unwrap() else {
            panic!("expected the manual links delete")
        };
        assert_eq!(queries[0].table, "paper_tags");
        assert_eq!(queries[0].filters[1].column, "source");
        assert_eq!(queries[0].filters[1].value, json!(["manual"]));
    }

    #[test]
    fn merge_tags_unions_with_existing_tags_of_that_source() {
        let replies = vec![
            json!([link("t1", "manual")]),
            json!({ "id": "t1", "name": "a", "color": null }),
        ];
        let RepoStep::Send { queries } =
            step("mergeTags", &call(vec![json!("p1"), json!(["b"])], replies)).unwrap()
        else {
            panic!("expected the tag lookups")
        };
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].filters[0].value, json!("a"));
        assert_eq!(queries[1].filters[0].value, json!("b"));
    }

    #[test]
    fn reuses_an_existing_tag_row_rather_than_creating_a_duplicate() {
        let replies = vec![
            json!([link("t1", "manual")]),
            json!({ "id": "t1", "name": "a", "color": null }),
            json!({ "id": "t1", "name": "a", "color": null }),
            Value::Null,
        ];
        let RepoStep::Send { queries } =
            step("mergeTags", &call(vec![json!("p1"), json!(["a", "b"])], replies)).unwrap()
        else {
            panic!("expected the create for the new tag only")
        };
        assert_eq!(queries.len(), 1);
        assert_eq!(queries[0].body.as_ref().unwrap()["name"], json!("b"));
    }

    #[test]
    fn remove_manual_tag_unlinks_one_manual_tag_keeps_the_rest() {
        let replies = vec![
            json!([link("t2", "manual"), link("t3", "manual")]),
            json!({ "id": "t2", "name": "keep", "color": null }),
            json!({ "id": "t3", "name": "drop", "color": null }),
        ];
        let q = only(
            step(
                "removeManualTag",
                &call(vec![json!("p1"), json!("drop")], replies),
            )
            .unwrap(),
        );
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[1].column, "tag_id");
        assert_eq!(q.filters[1].value, json!("t3"));
    }

    #[test]
    fn remove_manual_tag_unlinks_manual_only() {
        // Both links are named "one"; only the manual one may be unlinked.
        let replies = vec![
            json!([link("t4", "zotero_annotation"), link("t2", "manual")]),
            json!({ "id": "t4", "name": "one", "color": null }),
            json!({ "id": "t2", "name": "one", "color": null }),
        ];
        let q = only(
            step(
                "removeManualTag",
                &call(vec![json!("p1"), json!("one")], replies),
            )
            .unwrap(),
        );
        assert_eq!(q.filters[1].value, json!("t2"));
        assert_eq!(q.filters[2].value, json!("manual"));
    }

    #[test]
    fn reconcile_sources_replaces_zotero_annotation_tags() {
        let items = json!([{ "name": "vae", "source": "zotero_annotation" }]);
        let replies = vec![Value::Null, Value::Null];
        let q = only(
            step(
                "reconcileSources",
                &call(
                    vec![json!("p1"), items, json!(["zotero_annotation"])],
                    replies,
                ),
            )
            .unwrap(),
        );
        assert_eq!(q.table, "paper_tags");
        assert_eq!(q.filters[1].column, "source");
        assert_eq!(q.filters[1].value, json!(["zotero_annotation"]));
    }

    #[test]
    fn manual_and_zotero_annotation_sources_coexist() {
        // The zotero reconcile deletes only its own source, so manual links survive it.
        let items = json!([{ "name": "zotero", "source": "zotero_annotation" }]);
        let replies = vec![Value::Null, Value::Null];
        let q = only(
            step(
                "reconcileSources",
                &call(
                    vec![json!("p1"), items, json!(["zotero_annotation"])],
                    replies,
                ),
            )
            .unwrap(),
        );
        assert_eq!(q.filters[1].value, json!(["zotero_annotation"]));
        assert!(!q.filters[1].value.to_string().contains("manual"));
    }

    #[test]
    fn merge_concepts_reassigns_links() {
        let replies = vec![json!([link("t2", "manual")])];
        let RepoStep::Send { queries } = step(
            "mergeConcepts",
            &call(vec![json!("t1"), json!("t2")], replies),
        )
        .unwrap() else {
            panic!("expected the link moves")
        };
        assert_eq!(queries[0].action, RepoAction::Upsert);
        assert_eq!(queries[0].body.as_ref().unwrap()["tag_id"], json!("t1"));
        let last = queries.last().unwrap();
        assert_eq!(last.table, "tags");
        assert_eq!(last.filters[0].value, json!("t2"));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}

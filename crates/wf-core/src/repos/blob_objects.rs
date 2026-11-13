//! The `blob_objects` registry as Rust-planned queries.
//!
//! Ported from `PostgrestBlobRegistry` in `apps/web/src/storage/providers/postgrest/blob-registry.ts`,
//! plus the two inline queries of `purgeUserBlobs` in `apps/web/src/backend/account/purge-user-blobs.ts`
//! (`listForUser`, `deleteForUser`). Bucket removal stays in TS. The `getMany` Map is built in TS
//! from the array this returns, keyed by `path`. Rows map with [`to_domain`]; timestamps are
//! sent as the ISO-8601 text the database returns, so TS builds the `Date`s.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "blob_objects";
const HOT: &str = "hot";

/// The columns a [`BlobRow`] is read as, named rather than starred.
pub const BLOB_COLUMNS: &str =
    "bucket,path,tier,size_bytes,access_count,last_accessed_at,priority,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "get" => get(call),
        "getMany" => get_many(call),
        "register" => register(call),
        "recordAccess" => record_access(call),
        "recordAccessMany" => record_access_many(call),
        "setTier" => set_tier(call),
        "remove" => remove(call),
        "listHot" => list_hot(call),
        "hotBytesTotal" => hot_bytes_total(call),
        "listForUser" => list_for_user(call),
        "deleteForUser" => delete_for_user(call),
        _ => return None,
    })
}

/// A `blob_objects` row as read.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct BlobRow {
    bucket: String,
    path: String,
    tier: String,
    #[serde(deserialize_with = "number_or_text")]
    size_bytes: f64,
    access_count: f64,
    last_accessed_at: Option<String>,
    priority: f64,
    created_at: String,
}

/// A registry record as TS `BlobObjectRecord` reads it (`rowToRecord`), timestamps as ISO-8601.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobObject {
    /// Storage bucket name.
    pub bucket: String,
    /// Object path inside the bucket.
    pub path: String,
    /// `hot` or `cold`.
    pub tier: String,
    /// Object size in bytes.
    pub size_bytes: f64,
    /// Number of recorded accesses.
    pub access_count: f64,
    /// ISO-8601 time of the last access, or `null`.
    pub last_accessed_at: Option<String>,
    /// 0 = tier off first, 100 = keep hot longest.
    pub priority: f64,
    /// ISO-8601 time the object was registered.
    pub created_at: String,
}

/// The `bucket`/`path` pair `purgeUserBlobs` reads.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
struct BucketPath {
    bucket: String,
    path: String,
}

/// The `size_bytes` column alone, for the hot-bytes sum.
#[derive(Deserialize)]
struct SizeRow {
    #[serde(deserialize_with = "number_or_text")]
    size_bytes: f64,
}

/// `RegisterBlobInput`, with the defaults applied in [`register`].
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterInput {
    bucket: String,
    path: String,
    tier: Option<String>,
    size_bytes: i64,
    priority: Option<i64>,
}

/// `Postgres` returns `bigint` as text, and TS applies `Number()` to it.
#[derive(Deserialize)]
#[serde(untagged)]
enum NumberOrText {
    Number(f64),
    Text(String),
}

fn number_or_text<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    match NumberOrText::deserialize(d)? {
        NumberOrText::Number(n) => Ok(n),
        NumberOrText::Text(t) => t
            .parse::<f64>()
            .map_err(<D::Error as serde::de::Error>::custom),
    }
}

/// The record for a stored row (`rowToRecord`).
fn to_domain(row: &BlobRow) -> BlobObject {
    BlobObject {
        bucket: row.bucket.clone(),
        path: row.path.clone(),
        tier: row.tier.clone(),
        size_bytes: row.size_bytes,
        access_count: row.access_count,
        last_accessed_at: row.last_accessed_at.clone(),
        priority: row.priority,
        created_at: row.created_at.clone(),
    }
}

/// `get(bucket, path)`: the record, or `null`.
fn get(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, BLOB_COLUMNS)
                .eq("bucket", call.text(0))
                .eq("path", call.text(1))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<BlobRow>| row.as_ref().map(to_domain))
}

/// `getMany(bucket, paths)`: one `in` query; a path with no row is absent.
fn get_many(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_domain);
    }
    let paths: Vec<String> = match call.parse(1) {
        Ok(paths) => paths,
        Err(e) => return RepoStep::fail(e),
    };
    if paths.is_empty() {
        return RepoStep::done(&Vec::<BlobObject>::new());
    }
    RepoStep::send(
        RepoQuery::select(TABLE, BLOB_COLUMNS)
            .eq("bucket", call.text(0))
            .filter("in", "path", paths),
    )
}

/// `register(input)`: upsert with `tier` defaulting to hot and `priority` to 50.
fn register(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let input: RegisterInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(
        RepoQuery::upsert(
            TABLE,
            json!({
                "bucket": input.bucket,
                "path": input.path,
                "tier": input.tier.unwrap_or_else(|| HOT.into()),
                "size_bytes": input.size_bytes,
                "priority": input.priority.unwrap_or(50),
            }),
        )
        .on_conflict("bucket,path", false),
    )
}

/// `recordAccess(bucket, path)`: the `0125` increment, in the database.
fn record_access(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    RepoStep::send(RepoQuery::rpc(
        "record_blob_access",
        json!({ "p_bucket": call.text(0), "p_path": call.text(1) }),
    ))
}

/// `recordAccessMany(bucket, paths)`: one statement for the batch; nothing for an empty batch.
fn record_access_many(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let paths: Vec<String> = match call.parse(1) {
        Ok(paths) => paths,
        Err(e) => return RepoStep::fail(e),
    };
    if paths.is_empty() {
        return RepoStep::unit();
    }
    RepoStep::send(RepoQuery::rpc(
        "record_blob_access_many",
        json!({ "p_bucket": call.text(0), "p_paths": paths }),
    ))
}

/// `setTier(bucket, path, tier, sizeBytes?)`: `size_bytes` only when given.
fn set_tier(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let mut patch = Map::new();
    let _ = patch.insert("tier".into(), call.arg(2).clone());
    if !call.arg(3).is_null() {
        let _ = patch.insert("size_bytes".into(), call.arg(3).clone());
    }
    RepoStep::send(
        RepoQuery::update(TABLE, Value::Object(patch))
            .eq("bucket", call.text(0))
            .eq("path", call.text(1)),
    )
}

/// `remove(bucket, path)`.
fn remove(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::delete(TABLE)
                .eq("bucket", call.text(0))
                .eq("path", call.text(1)),
        );
    }
    RepoStep::unit()
}

/// `listHot()`: every hot record.
fn list_hot(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_domain);
    }
    RepoStep::send(RepoQuery::select(TABLE, BLOB_COLUMNS).eq("tier", HOT))
}

/// `hotBytesTotal()`: the sum of hot `size_bytes`.
fn hot_bytes_total(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::select(TABLE, "size_bytes").eq("tier", HOT));
    }
    match call.reply::<Vec<SizeRow>>(0) {
        Some(Ok(rows)) => RepoStep::done(&rows.iter().map(|r| r.size_bytes).sum::<f64>()),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `listForUser(userId)`: the bucket and path of each object the user owns.
fn list_for_user(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::select(TABLE, "bucket,path").eq("user_id", call.text(0)));
    }
    match call.reply::<Vec<BucketPath>>(0) {
        Some(Ok(rows)) => RepoStep::done(&rows),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `deleteForUser(userId)`. Runs after the objects are gone; its error is thrown, not dropped.
fn delete_for_user(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("user_id", call.text(0)));
    }
    RepoStep::unit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx::default(),
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
        json!({ "bucket": "paper-images", "path": "u1/a.webp", "tier": "hot",
            "size_bytes": "120", "access_count": 2, "last_accessed_at": null,
            "priority": 50, "created_at": "2026-11-01T10:00:00Z" })
    }

    #[test]
    fn unknown_methods_are_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn get_reads_one_row_by_bucket_and_path() {
        let q = sent(get(&call(
            vec![json!("paper-images"), json!("u1/a.webp")],
            vec![],
        )));
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.filters[0].column, "bucket");
        assert_eq!(q.filters[1].value, json!("u1/a.webp"));
        assert_eq!(q.single, RepoSingle::Maybe);
        let v = done(get(&call(vec![json!("b"), json!("p")], vec![row()])));
        assert_eq!(v["sizeBytes"], json!(120.0));
        assert_eq!(v["lastAccessedAt"], Value::Null);
        assert_eq!(v["createdAt"], "2026-11-01T10:00:00Z");
    }

    #[test]
    fn get_maps_a_missing_row_to_null() {
        let v = done(get(&call(vec![json!("b"), json!("p")], vec![Value::Null])));
        assert_eq!(v, Value::Null);
    }

    #[test]
    fn get_many_is_one_in_query_and_empty_without_a_query() {
        let q = sent(get_many(&call(vec![json!("b"), json!(["a", "b"])], vec![])));
        assert_eq!(q.filters[1].op, "in");
        assert_eq!(q.filters[1].value, json!(["a", "b"]));
        assert_eq!(
            done(get_many(&call(vec![json!("b"), json!([])], vec![]))),
            json!([])
        );
        let v = done(get_many(&call(
            vec![json!("b"), json!(["a"])],
            vec![json!([row()])],
        )));
        assert_eq!(v[0]["bucket"], "paper-images");
    }

    #[test]
    fn register_upserts_with_the_defaults_and_needs_a_size() {
        let q = sent(register(&call(
            vec![json!({ "bucket": "b", "path": "p", "sizeBytes": 10 })],
            vec![],
        )));
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some("bucket,path"));
        let body = q.body.unwrap();
        assert_eq!(body["tier"], "hot");
        assert_eq!(body["priority"], 50);
        assert_eq!(body["size_bytes"], 10);
        assert_eq!(
            done(register(&call(vec![], vec![Value::Null]))),
            Value::Null
        );
        assert!(matches!(
            register(&call(vec![json!({ "bucket": "b", "path": "p" })], vec![])),
            RepoStep::Fail { .. }
        ));
    }

    #[test]
    fn record_access_calls_the_rpc() {
        let q = sent(record_access(&call(vec![json!("b"), json!("p")], vec![])));
        assert_eq!(q.rpc.as_deref(), Some("record_blob_access"));
        assert_eq!(q.body.unwrap(), json!({ "p_bucket": "b", "p_path": "p" }));
        assert_eq!(
            done(record_access(&call(
                vec![json!("b"), json!("p")],
                vec![Value::Null]
            ))),
            Value::Null
        );
    }

    #[test]
    fn record_access_many_skips_an_empty_batch() {
        assert_eq!(
            done(record_access_many(&call(
                vec![json!("b"), json!([])],
                vec![]
            ))),
            Value::Null
        );
        let q = sent(record_access_many(&call(
            vec![json!("b"), json!(["a", "b"])],
            vec![],
        )));
        assert_eq!(q.rpc.as_deref(), Some("record_blob_access_many"));
        assert_eq!(
            q.body.unwrap(),
            json!({ "p_bucket": "b", "p_paths": ["a", "b"] })
        );
    }

    #[test]
    fn set_tier_patches_the_size_only_when_given() {
        let q = sent(set_tier(&call(
            vec![json!("b"), json!("p"), json!("cold")],
            vec![],
        )));
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(q.filters.len(), 2);
        assert_eq!(q.body.unwrap(), json!({ "tier": "cold" }));
        let q = sent(set_tier(&call(
            vec![json!("b"), json!("p"), json!("cold"), json!(42)],
            vec![],
        )));
        assert_eq!(q.body.unwrap(), json!({ "tier": "cold", "size_bytes": 42 }));
    }

    #[test]
    fn remove_deletes_the_one_path() {
        let q = sent(remove(&call(vec![json!("b"), json!("p")], vec![])));
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[1].value, json!("p"));
        assert_eq!(
            done(remove(&call(
                vec![json!("b"), json!("p")],
                vec![Value::Null]
            ))),
            Value::Null
        );
    }

    #[test]
    fn list_hot_reads_the_hot_tier() {
        let q = sent(list_hot(&call(vec![], vec![])));
        assert_eq!(q.filters[0].column, "tier");
        assert_eq!(q.filters[0].value, json!("hot"));
        assert_eq!(
            done(list_hot(&call(vec![], vec![json!([row()])])))[0]["priority"],
            50.0
        );
    }

    #[test]
    fn hot_bytes_total_sums_text_and_numbers() {
        let q = sent(hot_bytes_total(&call(vec![], vec![])));
        assert_eq!(q.filters[0].value, json!("hot"));
        let v = done(hot_bytes_total(&call(
            vec![],
            vec![json!([{ "size_bytes": "100" }, { "size_bytes": 23 }])],
        )));
        assert_eq!(v, json!(123.0));
    }

    #[test]
    fn list_for_user_reads_the_users_bucket_and_path() {
        let q = sent(list_for_user(&call(vec![json!("u1")], vec![])));
        assert_eq!(q.filters[0].column, "user_id");
        assert_eq!(q.columns.as_deref(), Some("bucket,path"));
        let v = done(list_for_user(&call(
            vec![json!("u1")],
            vec![json!([{ "bucket": "b", "path": "p" }])],
        )));
        assert_eq!(v, json!([{ "bucket": "b", "path": "p" }]));
    }

    #[test]
    fn delete_for_user_deletes_the_users_rows_and_is_not_soft() {
        let q = sent(delete_for_user(&call(vec![json!("u1")], vec![])));
        assert_eq!(q.action, RepoAction::Delete);
        assert!(!q.soft);
        assert_eq!(q.filters[0].value, json!("u1"));
        assert_eq!(
            done(delete_for_user(&call(vec![json!("u1")], vec![Value::Null]))),
            Value::Null
        );
    }
}

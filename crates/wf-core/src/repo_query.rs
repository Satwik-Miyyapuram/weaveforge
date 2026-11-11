//! Rust-planned repository I/O (`docs/building/core/data-access.md`, option 2).
//!
//! A repository method is a step function: given its arguments, the caller's context and the
//! replies to the queries it already asked for, it either asks for one more [`RepoQuery`] or
//! finishes. The one TS sender (`backend/providers/postgrest/rust-repository.ts`, `rustRepository`)
//! runs each query with supabase-js and calls the step again with the reply. Rust owns the
//! table, columns, filters, bodies and the mapping of rows; TS only sends.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What a table query does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum RepoAction {
    /// Read rows.
    Select,
    /// Add rows.
    Insert,
    /// Add or replace rows.
    Upsert,
    /// Change rows matching the filters.
    Update,
    /// Remove rows matching the filters.
    Delete,
}

/// How many rows the reply holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum RepoSingle {
    /// An array of rows.
    #[default]
    Many,
    /// Exactly one row; PostgREST errors otherwise.
    One,
    /// One row or `null`.
    Maybe,
}

/// One filter, sent as the supabase-js method of the same name (`eq`, `in`, `is`, `or`, …).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RepoFilter {
    /// The supabase-js filter method.
    pub op: String,
    /// The column; empty for `or`.
    pub column: String,
    /// The value; for `or`, the filter text; for `not` and `filter`, `[operator, value]`.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub value: Value,
}

/// A list order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RepoOrder {
    /// The column.
    pub column: String,
    /// Smallest first when true.
    pub ascending: bool,
    /// Nulls first when set; the server default otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub nulls_first: Option<bool>,
}

/// One request: a table query, or an RPC when `rpc` is set.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RepoQuery {
    /// The table; empty for an RPC.
    pub table: String,
    /// The RPC name, when this is a call rather than a table query.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub rpc: Option<String>,
    /// What the query does.
    pub action: RepoAction,
    /// Columns a select reads, or a write returns; a write returns nothing when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub columns: Option<String>,
    /// The write body, or the RPC arguments.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = specta_typescript::Unknown))]
    pub body: Option<Value>,
    /// Upsert conflict columns.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub on_conflict: Option<String>,
    /// Upsert keeps the existing row instead of replacing it.
    pub ignore_duplicates: bool,
    /// Filters, applied in order.
    pub filters: Vec<RepoFilter>,
    /// Orders, applied in order.
    pub order: Vec<RepoOrder>,
    /// Row limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub limit: Option<u32>,
    /// Inclusive row range `[from, to]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub range: Option<(u32, u32)>,
    /// How many rows the reply holds.
    pub single: RepoSingle,
    /// A head request: the reply is the exact row count (a number), not rows.
    pub count: bool,
    /// A failed query replies `{"error": {"code", "message"}}` instead of failing the call,
    /// so the step can react (e.g. retry after a unique-violation race).
    pub soft: bool,
}

impl RepoQuery {
    fn new(table: &str, action: RepoAction) -> Self {
        Self {
            table: table.into(),
            rpc: None,
            action,
            columns: None,
            body: None,
            on_conflict: None,
            ignore_duplicates: false,
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            range: None,
            single: RepoSingle::Many,
            count: false,
            soft: false,
        }
    }

    /// `select(columns)` on `table`.
    #[must_use]
    pub fn select(table: &str, columns: &str) -> Self {
        Self::new(table, RepoAction::Select).returning(columns)
    }

    /// How many rows of `table` match the filters; the reply is a number.
    #[must_use]
    pub fn count(table: &str) -> Self {
        let mut q = Self::select(table, "id");
        q.count = true;
        q
    }

    /// Replies with the error instead of failing the call (see [`RepoQuery::soft`]).
    #[must_use]
    pub fn soft(mut self) -> Self {
        self.soft = true;
        self
    }

    /// `insert(body)` on `table`.
    #[must_use]
    pub fn insert(table: &str, body: Value) -> Self {
        Self::new(table, RepoAction::Insert).body(body)
    }

    /// `upsert(body)` on `table`.
    #[must_use]
    pub fn upsert(table: &str, body: Value) -> Self {
        Self::new(table, RepoAction::Upsert).body(body)
    }

    /// `update(body)` on `table`.
    #[must_use]
    pub fn update(table: &str, body: Value) -> Self {
        Self::new(table, RepoAction::Update).body(body)
    }

    /// `delete()` on `table`.
    #[must_use]
    pub fn delete(table: &str) -> Self {
        Self::new(table, RepoAction::Delete)
    }

    /// `rpc(name, args)`.
    #[must_use]
    pub fn rpc(name: &str, args: Value) -> Self {
        let mut query = Self::new("", RepoAction::Select).body(args);
        query.rpc = Some(name.into());
        query
    }

    /// The columns read, or returned by a write.
    #[must_use]
    pub fn returning(mut self, columns: &str) -> Self {
        self.columns = Some(columns.into());
        self
    }

    fn body(mut self, body: Value) -> Self {
        self.body = Some(body);
        self
    }

    /// Adds a filter: `op` is the supabase-js method name.
    #[must_use]
    pub fn filter(mut self, op: &str, column: &str, value: impl Into<Value>) -> Self {
        self.filters.push(RepoFilter {
            op: op.into(),
            column: column.into(),
            value: value.into(),
        });
        self
    }

    /// `.eq(column, value)`.
    #[must_use]
    pub fn eq(self, column: &str, value: impl Into<Value>) -> Self {
        self.filter("eq", column, value)
    }

    /// Orders by `column`.
    #[must_use]
    pub fn order(mut self, column: &str, ascending: bool) -> Self {
        self.order.push(RepoOrder {
            column: column.into(),
            ascending,
            nulls_first: None,
        });
        self
    }

    /// Orders by `column`, with nulls first or last.
    #[must_use]
    pub fn order_nulls(mut self, column: &str, ascending: bool, nulls_first: bool) -> Self {
        self.order.push(RepoOrder {
            column: column.into(),
            ascending,
            nulls_first: Some(nulls_first),
        });
        self
    }

    /// Upsert conflict columns, and whether a conflict keeps the existing row.
    #[must_use]
    pub fn on_conflict(mut self, columns: &str, ignore_duplicates: bool) -> Self {
        self.on_conflict = Some(columns.into());
        self.ignore_duplicates = ignore_duplicates;
        self
    }

    /// Row limit.
    #[must_use]
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Inclusive row range.
    #[must_use]
    pub fn range(mut self, from: u32, to: u32) -> Self {
        self.range = Some((from, to));
        self
    }

    /// Exactly one row.
    #[must_use]
    pub fn single(mut self) -> Self {
        self.single = RepoSingle::One;
        self
    }

    /// One row or `null`.
    #[must_use]
    pub fn maybe_single(mut self) -> Self {
        self.single = RepoSingle::Maybe;
        self
    }
}

/// What a repository method does next.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepoStep {
    /// Send these queries together; their replies come back in the same order.
    Send {
        /// The queries.
        queries: Vec<RepoQuery>,
    },
    /// The method's result.
    Done {
        /// The value the method resolves to.
        #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
        value: Value,
    },
    /// The method fails with this message.
    Fail {
        /// The error message.
        message: String,
    },
}

impl RepoStep {
    /// Send one query.
    #[must_use]
    pub fn send(query: RepoQuery) -> Self {
        Self::Send {
            queries: vec![query],
        }
    }

    /// Finish with `value`, or fail when it does not serialize.
    #[must_use]
    pub fn done<T: Serialize>(value: &T) -> Self {
        match serde_json::to_value(value) {
            Ok(value) => Self::Done { value },
            Err(error) => Self::fail(error),
        }
    }

    /// Finish with no value.
    #[must_use]
    pub fn unit() -> Self {
        Self::Done { value: Value::Null }
    }

    /// Fail with `message`.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn fail(message: impl ToString) -> Self {
        Self::Fail {
            message: message.to_string(),
        }
    }
}

/// Who is asking: the selected project and the signed-in user, when known.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RepoCtx {
    /// The selected project.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub project_id: Option<String>,
    /// The signed-in user.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub user_id: Option<String>,
    /// The sender's clock as an ISO-8601 instant (Rust in wasm has none); set on every call.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub now: Option<String>,
}

/// One call of a repository method, as the TS sender hands it over.
#[derive(Debug, Clone, Default)]
pub struct RepoCall {
    /// The method's arguments, in order.
    pub args: Vec<Value>,
    /// Who is asking.
    pub ctx: RepoCtx,
    /// Replies so far, one per query sent, in order.
    pub replies: Vec<Value>,
}

impl RepoCall {
    /// Argument `i`, or `null`.
    #[must_use]
    pub fn arg(&self, i: usize) -> &Value {
        self.args.get(i).unwrap_or(&Value::Null)
    }

    /// Argument `i` as text, or empty.
    #[must_use]
    pub fn text(&self, i: usize) -> &str {
        self.arg(i).as_str().unwrap_or_default()
    }

    /// Argument `i` parsed as `T`.
    ///
    /// # Errors
    ///
    /// Fails when the argument does not have `T`'s shape.
    pub fn parse<T: serde::de::DeserializeOwned>(&self, i: usize) -> Result<T, String> {
        serde_json::from_value(self.arg(i).clone()).map_err(|e| format!("argument {i}: {e}"))
    }

    /// Reply `i` parsed as `T`, or `None` while it has not come back.
    ///
    /// # Errors
    ///
    /// Fails when the reply does not have `T`'s shape.
    #[must_use]
    pub fn reply<T: serde::de::DeserializeOwned>(&self, i: usize) -> Option<Result<T, String>> {
        self.replies
            .get(i)
            .map(|v| serde_json::from_value(v.clone()).map_err(|e| format!("reply {i}: {e}")))
    }

    /// The Postgres error code of reply `i` when a [`RepoQuery::soft`] query failed.
    #[must_use]
    pub fn reply_error_code(&self, i: usize) -> Option<&str> {
        self.replies.get(i)?.get("error")?.get("code")?.as_str()
    }

    /// The signed-in user, or the step that fails with "Not signed in.".
    ///
    /// # Errors
    ///
    /// The failing step when no user is signed in.
    pub fn user(&self) -> Result<&str, RepoStep> {
        self.ctx
            .user_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| RepoStep::fail("Not signed in."))
    }

    /// The sender's clock (ISO-8601) for `updated_at`-style columns; empty when not sent.
    #[must_use]
    pub fn now(&self) -> &str {
        self.ctx.now.as_deref().unwrap_or_default()
    }

    /// The selected project, or the step that fails with "Select a project before {action}.".
    ///
    /// # Errors
    ///
    /// The failing step when no project is selected.
    pub fn project(&self, action: &str) -> Result<&str, RepoStep> {
        self.ctx
            .project_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| RepoStep::fail(format!("Select a project before {action}.")))
    }
}

/// The next step of `repo.method`, or a failure naming an unknown repository or method.
#[must_use]
pub fn repo_step(repo: &str, method: &str, call: &RepoCall) -> RepoStep {
    let step = match repo {
        "ai_audit" => crate::repos::ai_audit::step(method, call),
        "ai_proposals" => crate::repos::ai_proposals::step(method, call),
        "annotation_quotation_types" => {
            crate::repos::annotation_quotation_types::step(method, call)
        }
        "citation_alert_tracks" => crate::repos::citation_alert_tracks::step(method, call),
        "comments" => crate::repos::comments::step(method, call),
        "library_pins" => crate::repos::library_pins::step(method, call),
        "members" => crate::repos::members::step(method, call),
        "org" => crate::repos::org::step(method, call),
        "lab_snapshots" => crate::repos::lab_snapshots::step(method, call),
        "log_entries" => crate::repos::log_entries::step(method, call),
        "report_sections" => crate::repos::report_sections::step(method, call),
        "supervision" => crate::repos::supervision::step(method, call),
        "paper_tags" => crate::repos::paper_tags::step(method, call),
        "paper_relations" => crate::repos::paper_relations::step(method, call),
        "share_links" => crate::repos::share_links::step(method, call),
        "shares" => crate::repos::shares::step(method, call),
        "tags" => crate::repos::tags::step(method, call),
        "user_settings" => crate::repos::user_settings::step(method, call),
        "vault_pages" => crate::repos::vault_pages::step(method, call),
        _ => return RepoStep::fail(format!("No Rust repository named {repo}")),
    };
    step.unwrap_or_else(|| RepoStep::fail(format!("No method {method} on Rust repository {repo}")))
}

/// Maps reply rows with `f`, or fails on the first row of the wrong shape.
pub(crate) fn map_rows<R, D, F>(call: &RepoCall, i: usize, f: F) -> RepoStep
where
    R: serde::de::DeserializeOwned,
    D: Serialize,
    F: Fn(&R) -> D,
{
    match call.reply::<Vec<R>>(i) {
        Some(Ok(rows)) => RepoStep::done(&rows.iter().map(f).collect::<Vec<_>>()),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail(format!("reply {i} missing")),
    }
}

/// Maps one reply row with `f`.
pub(crate) fn map_row<R, D, F>(call: &RepoCall, i: usize, f: F) -> RepoStep
where
    R: serde::de::DeserializeOwned,
    D: Serialize,
    F: Fn(&R) -> D,
{
    match call.reply::<R>(i) {
        Some(Ok(row)) => RepoStep::done(&f(&row)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail(format!("reply {i} missing")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builder_sets_filters_order_and_single() {
        let q = RepoQuery::select("t", "a,b")
            .eq("x", "1")
            .filter("in", "id", json!(["a"]))
            .order("a", false)
            .limit(5)
            .maybe_single();
        assert_eq!(q.columns.as_deref(), Some("a,b"));
        assert_eq!(q.filters.len(), 2);
        assert_eq!(q.filters[1].op, "in");
        assert_eq!(q.order[0].column, "a");
        assert_eq!(q.limit, Some(5));
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn rpc_carries_name_and_args() {
        let q = RepoQuery::rpc("f", json!({"p": 1}));
        assert_eq!(q.rpc.as_deref(), Some("f"));
        assert_eq!(q.body, Some(json!({"p": 1})));
    }

    #[test]
    fn step_serializes_with_kind_tag() {
        let s = serde_json::to_value(RepoStep::unit()).unwrap();
        assert_eq!(s, json!({"kind": "done", "value": null}));
        let f = serde_json::to_value(RepoStep::fail("no")).unwrap();
        assert_eq!(f, json!({"kind": "fail", "message": "no"}));
    }

    #[test]
    fn count_is_a_head_select() {
        let q = RepoQuery::count("t").eq("a", "1");
        assert!(q.count);
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.columns.as_deref(), Some("id"));
    }

    #[test]
    fn soft_reply_error_code_reads_the_code() {
        let call = RepoCall {
            replies: vec![
                json!({"error": {"code": "23505", "message": "dup"}}),
                json!([]),
            ],
            ..RepoCall::default()
        };
        assert!(RepoQuery::delete("t").soft().soft);
        assert_eq!(call.reply_error_code(0), Some("23505"));
        assert_eq!(call.reply_error_code(1), None);
        assert_eq!(call.reply_error_code(2), None);
    }

    #[test]
    fn user_and_project_fail_when_missing() {
        let mut call = RepoCall::default();
        assert_eq!(call.user(), Err(RepoStep::fail("Not signed in.")));
        assert_eq!(
            call.project("pinning items"),
            Err(RepoStep::fail("Select a project before pinning items."))
        );
        call.ctx = RepoCtx {
            project_id: Some("p".into()),
            user_id: Some("u".into()),
            now: None,
        };
        assert_eq!(call.user(), Ok("u"));
        assert_eq!(call.project("x"), Ok("p"));
    }

    #[test]
    fn unknown_repo_and_method_fail() {
        let call = RepoCall::default();
        assert!(matches!(
            repo_step("nope", "list", &call),
            RepoStep::Fail { .. }
        ));
        assert!(matches!(
            repo_step("comments", "nope", &call),
            RepoStep::Fail { .. }
        ));
    }
}

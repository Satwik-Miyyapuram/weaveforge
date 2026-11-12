//! The keyed JSON columns of a `projects` row, `dashboardLayout` and `graphSettings` (TS
//! `KeyedColumnRepository` in `backend/providers/postgrest/parts-1.ts`, wired in
//! `wire-postgrest-backend.ts`). Table and column come from `postgrest_spec::keyed_column_spec`;
//! parsing is `dashboard::layout` and `relations::graph_settings`.
//!
//! `step` takes the keyed spec name as well as the method, because two repositories share this
//! table and differ only by column.

use serde_json::{Map, Value};

use crate::dashboard::layout::parse_dashboard_layout;
use crate::postgrest_spec::keyed_column_spec;
use crate::relations::graph_settings::parse_graph_persisted_state;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep};

/// The next step of `method` on the keyed spec `spec`, or `None` for an unknown method.
#[must_use]
pub fn step(spec: &str, method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "get" => get(spec, call),
        "save" => save(spec, call),
        _ => return None,
    })
}

/// `get(projectId)`: the parsed column, or `null` when the row or the value is absent.
fn get(spec: &str, call: &RepoCall) -> RepoStep {
    let Some(keyed) = keyed_column_spec(spec) else {
        return RepoStep::fail(format!("No PostgREST keyed-column spec named {spec}"));
    };
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(&keyed.table, &keyed.column)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    match call.reply::<Option<Value>>(0) {
        Some(Ok(row)) => {
            // A falsy raw value never reaches a parser: both parsers return `None` for it.
            let raw = row
                .as_ref()
                .and_then(|r| r.get(keyed.column.as_str()))
                .unwrap_or(&Value::Null);
            parsed(spec, raw)
        }
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// The stored value as its domain shape, or `null` when Rust rejects it.
fn parsed(spec: &str, raw: &Value) -> RepoStep {
    match spec {
        "dashboardLayout" => RepoStep::done(&parse_dashboard_layout(raw)),
        "graphSettings" => RepoStep::done(&parse_graph_persisted_state(raw)),
        _ => RepoStep::fail(format!("No keyed-column parser for {spec}")),
    }
}

/// `save(projectId, value)`: writes the whole value into the column.
fn save(spec: &str, call: &RepoCall) -> RepoStep {
    let Some(keyed) = keyed_column_spec(spec) else {
        return RepoStep::fail(format!("No PostgREST keyed-column spec named {spec}"));
    };
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let mut body = Map::new();
    let _ = body.insert(keyed.column, call.arg(1).clone());
    RepoStep::send(RepoQuery::update(&keyed.table, Value::Object(body)).eq("id", call.text(0)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};
    use serde_json::json;

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

    #[test]
    fn unknown_method_is_none() {
        assert!(step("dashboardLayout", "delete", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn get_selects_the_column_of_the_project_by_id() {
        let q = sent(get("dashboardLayout", &call(vec![json!("p1")], vec![])));
        assert_eq!(q.table, "projects");
        assert_eq!(q.columns.as_deref(), Some("dashboard_layout"));
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.filters[0].value, json!("p1"));
    }

    #[test]
    fn get_uses_the_graph_column_for_graph_settings() {
        let q = sent(get("graphSettings", &call(vec![json!("p1")], vec![])));
        assert_eq!(q.columns.as_deref(), Some("graph_settings"));
    }

    #[test]
    fn get_maps_a_missing_row_to_null() {
        let v = done(get(
            "dashboardLayout",
            &call(vec![json!("p1")], vec![Value::Null]),
        ));
        assert_eq!(v, Value::Null);
    }

    #[test]
    fn get_maps_a_null_column_to_null() {
        let v = done(get(
            "graphSettings",
            &call(vec![json!("p1")], vec![json!({ "graph_settings": null })]),
        ));
        assert_eq!(v, Value::Null);
    }

    #[test]
    fn get_parses_the_stored_dashboard_layout() {
        let stored = json!({ "dashboard_layout": { "lg": [], "sm": [] } });
        let v = done(get(
            "dashboardLayout",
            &call(vec![json!("p1")], vec![stored]),
        ));
        assert_eq!(v["lg"], json!([]));
        assert_eq!(v["sm"], json!([]));
    }

    #[test]
    fn save_updates_only_the_keyed_column_of_the_project() {
        let q = sent(save(
            "graphSettings",
            &call(vec![json!("p1"), json!({ "x": 1 })], vec![]),
        ));
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(q.table, "projects");
        assert_eq!(q.body.expect("body")["graph_settings"], json!({ "x": 1 }));
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.filters[0].value, json!("p1"));
    }

    #[test]
    fn unknown_spec_fails() {
        match get("nope", &call(vec![json!("p1")], vec![])) {
            RepoStep::Fail { message, .. } => assert!(message.contains("nope")),
            other => panic!("expected fail, got {other:?}"),
        }
    }
}

//! The Python SDK's `/api/sdk/*` routes, answered from the local database.
//!
//! Port of `apps/shell/sidecar/src/local-sdk-api.ts`. Errors keep the TS shape `{"error": ...}`.

use base64::Engine;
use serde_json::{Map, Value, json};

use super::{LocalApiRequest, LocalApiResponse, SaveArtifact, SdkQuery};
use crate::local_artifacts::{MAX_LOCAL_ARTIFACT_BYTES, is_safe_segment};

/// The path prefix every SDK route shares.
pub const SDK_PREFIX: &str = "/api/sdk/";

/// `LOCAL_USER_ID` from `packages/core/src/database/local-postgres.ts`.
pub const LOCAL_USER_ID: &str = "00000000-0000-4000-8000-000000000001";

/// Columns an experiment row may carry. An allowlist: body keys are never interpolated unchecked.
const EXPERIMENT_COLUMNS: [&str; 17] = [
    "id",
    "project_id",
    "name",
    "hypothesis",
    "status",
    "repo_url",
    "commit_sha",
    "branch",
    "run_command",
    "config",
    "metrics",
    "artifacts",
    "result_note",
    "started_at",
    "finished_at",
    "related_paper",
    "created_at",
];

/// Columns whose value is JSON: sent as text and cast on the way in.
const JSON_COLUMNS: [&str; 3] = ["config", "metrics", "artifacts"];

/// The web route's cap; also keeps one insert under Postgres' 65535-parameter limit.
const MAX_POINTS_PER_REQUEST: usize = 5000;

/// Answer an `/api/sdk/*` request, or `None` when the path is not one.
///
/// `path` is percent-decoded with no query string; `search` is the raw query after `?`.
/// Authentication happened before this was called.
pub async fn route_sdk_request(
    query: &dyn SdkQuery,
    request: &LocalApiRequest,
    path: &str,
    search: &str,
    save_artifact: Option<&dyn SaveArtifact>,
) -> Option<LocalApiResponse> {
    let route = path.strip_prefix(SDK_PREFIX)?;
    let route = route.strip_suffix('/').unwrap_or(route);
    Some(match (route, save_artifact) {
        ("whoami", _) => whoami(query).await,
        ("projects", _) => projects(query, search).await,
        ("experiments", _) => experiments(query, request, search).await,
        ("metrics", _) => metrics(query, request, search).await,
        ("artifacts", Some(save)) => artifacts(query, save, request).await,
        _ => bad(404, "No such route."),
    })
}

/// The TS error shape: `{"error": message}`.
fn bad(status: u16, message: &str) -> LocalApiResponse {
    LocalApiResponse::json(status, &json!({ "error": message }))
}

/// The first row, or JSON `null` when there is none.
fn first_or_null(rows: Vec<Value>) -> Value {
    rows.into_iter().next().unwrap_or(Value::Null)
}

/// The JSON object body, or `None` when it is not valid JSON or not an object.
fn parse_body(request: &LocalApiRequest) -> Option<Map<String, Value>> {
    match serde_json::from_str::<Value>(&request.body) {
        Ok(Value::Object(map)) => Some(map),
        _ => None,
    }
}

/// What the database binds for a JSON value: scalars as they are, objects and arrays as JSON text.
fn bind(value: Option<&Value>) -> Value {
    match value {
        None | Some(Value::Null) => Value::Null,
        Some(v @ (Value::Object(_) | Value::Array(_))) => Value::String(v.to_string()),
        Some(v) => v.clone(),
    }
}

/// JS `Number(value)`; objects and arrays give NaN here, which differs from JS for one-element arrays.
fn to_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let text = s.trim();
            if text.is_empty() {
                0.0
            } else {
                text.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}

/// A JS number as JSON; whole numbers are written without a fraction, as `JSON.stringify` does.
#[allow(
    clippy::cast_possible_truncation,
    reason = "checked whole and under 2^53 before the cast"
)]
fn number(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
        Value::from(x as i64)
    } else {
        serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
    }
}

/// `searchParams.get(key)?.trim()`: the first value for `key`, or `""` when absent.
fn trimmed_param(search: &str, key: &str) -> String {
    search
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| pair.split_once('=').unwrap_or((pair, "")))
        .find(|(name, _)| form_decode(name) == key)
        .map(|(_, value)| form_decode(value).trim().to_owned())
        .unwrap_or_default()
}

/// Form decoding as `URLSearchParams` does it: `+` is a space, then `%XX`; bad escapes stay as written.
fn form_decode(raw: &str) -> String {
    let bytes: Vec<u8> = raw
        .bytes()
        .map(|b| if b == b'+' { b' ' } else { b })
        .collect();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escape = match bytes.get(i..i + 3) {
            Some([b'%', hi, lo]) => hex_value(*hi)
                .zip(hex_value(*lo))
                .map(|(h, l)| (h << 4) | l),
            _ => None,
        };
        match escape {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The value of one ASCII hex digit.
#[allow(
    clippy::cast_possible_truncation,
    reason = "to_digit(16) yields at most 15"
)]
fn hex_value(byte: u8) -> Option<u8> {
    char::from(byte).to_digit(16).map(|d| d as u8)
}

async fn whoami(query: &dyn SdkQuery) -> LocalApiResponse {
    let id = match query.query("select auth.uid() as id", Vec::new()).await {
        Ok(rows) => rows
            .first()
            .and_then(|row| row.get("id"))
            .filter(|id| !id.is_null())
            .cloned(),
        Err(_) => None,
    };
    let user_id = id.unwrap_or_else(|| Value::String(LOCAL_USER_ID.to_owned()));
    LocalApiResponse::json(
        200,
        &json!({ "userId": user_id, "email": null, "fullName": null }),
    )
}

async fn projects(query: &dyn SdkQuery, search: &str) -> LocalApiResponse {
    let name = trimmed_param(search, "name");
    if name.is_empty() {
        return bad(400, "Missing project name.");
    }
    match query
        .query(
            "select id from projects where name = $1 limit 1",
            vec![Value::String(name)],
        )
        .await
    {
        Ok(rows) => {
            let id = rows
                .first()
                .and_then(|row| row.get("id"))
                .cloned()
                .unwrap_or(Value::Null);
            LocalApiResponse::json(200, &json!({ "projectId": id }))
        }
        Err(message) => bad(500, &message),
    }
}

async fn experiments(
    query: &dyn SdkQuery,
    request: &LocalApiRequest,
    search: &str,
) -> LocalApiResponse {
    let method = request.method.as_str();
    if method == "GET" || method == "DELETE" {
        let id = trimmed_param(search, "id");
        if id.is_empty() {
            return bad(400, "Missing experiment id.");
        }
        if method == "GET" {
            return match query
                .query(
                    "select * from experiments where id = $1 limit 1",
                    vec![Value::String(id)],
                )
                .await
            {
                Ok(rows) => {
                    LocalApiResponse::json(200, &json!({ "experiment": first_or_null(rows) }))
                }
                Err(message) => bad(500, &message),
            };
        }
        return match query
            .query(
                "delete from experiments where id = $1 returning id",
                vec![Value::String(id)],
            )
            .await
        {
            Err(message) => bad(500, &message),
            Ok(rows) if rows.is_empty() => bad(404, "Experiment not found."),
            Ok(_) => LocalApiResponse::json(200, &json!({ "ok": true })),
        };
    }
    if method != "POST" {
        return bad(405, "That method is not served here.");
    }
    let Some(body) = parse_body(request) else {
        return bad(400, "Invalid JSON body.");
    };
    save_experiment(query, body).await
}

async fn save_experiment(query: &dyn SdkQuery, row: Map<String, Value>) -> LocalApiResponse {
    let id = match row.get("id") {
        Some(Value::String(id)) => id.trim(),
        _ => "",
    };
    if id.is_empty() {
        return bad(400, "Experiment must include id.");
    }

    // The query runs as the device's user, so policies demand that id, not the local-only one.
    let mut columns: Vec<&str> = vec!["user_id"];
    let mut placeholders: Vec<String> = vec!["auth.uid()".to_owned()];
    let mut params: Vec<Value> = Vec::new();
    for column in EXPERIMENT_COLUMNS {
        let Some(value) = row.get(column) else {
            continue;
        };
        params.push(bind(Some(value)));
        columns.push(column);
        let cast = if JSON_COLUMNS.contains(&column) {
            "::jsonb"
        } else {
            ""
        };
        placeholders.push(format!("${}{cast}", params.len()));
    }

    // Every column but `id` is overwritten by what arrived, so a partial save keeps the rest.
    let assignments = columns
        .iter()
        .copied()
        .filter(|column| *column != "id")
        .map(|column| format!("{column} = excluded.{column}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "insert into experiments ({}) values ({}) on conflict (id) do update set {assignments} returning *",
        columns.join(", "),
        placeholders.join(", ")
    );
    match query.query(sql.as_str(), params).await {
        Ok(rows) => LocalApiResponse::json(200, &json!({ "experiment": first_or_null(rows) })),
        Err(message) => bad(500, &message),
    }
}

async fn metrics(
    query: &dyn SdkQuery,
    request: &LocalApiRequest,
    search: &str,
) -> LocalApiResponse {
    let method = request.method.as_str();
    if method == "DELETE" {
        let id = trimmed_param(search, "experiment_id");
        if id.is_empty() {
            return bad(400, "Missing experiment_id.");
        }
        // The server copy is cleared by the renderer's push before new points go.
        let statements = [
            "delete from experiment_metric_points where experiment_id = $1",
            "delete from experiment_metric_chunks where experiment_id = $1",
            "delete from local_metric_pushes where experiment_id = $1",
            "insert into local_metric_resets (experiment_id) values ($1) on conflict do nothing",
        ];
        for sql in statements {
            if let Err(message) = query.query(sql, vec![Value::String(id.clone())]).await {
                return bad(500, &message);
            }
        }
        return LocalApiResponse::json(200, &json!({ "ok": true }));
    }
    if method != "POST" {
        return bad(405, "That method is not served here.");
    }
    let Some(body) = parse_body(request) else {
        return bad(400, "Invalid JSON body.");
    };
    append_metrics(query, &body).await
}

/// One `VALUES` tuple and its binds per point, or the 400 for the first bad point.
fn metric_rows(points: &[Value]) -> Result<(Vec<String>, Vec<Value>), LocalApiResponse> {
    let mut values: Vec<String> = Vec::with_capacity(points.len());
    let mut params: Vec<Value> = Vec::new();
    for raw in points {
        let Some(point) = raw.as_object() else {
            return Err(bad(400, &format!("A point must be an object, got {raw}.")));
        };
        let step = match point.get("step") {
            None | Some(Value::Null) => 0.0,
            Some(v) => to_number(v),
        };
        let value = point.get("value").map_or(f64::NAN, to_number);
        if !step.is_finite() || !value.is_finite() {
            return Err(bad(
                400,
                &format!("A point needs a finite step and value, got {raw}."),
            ));
        }
        params.push(bind(point.get("experiment_id")));
        params.push(bind(point.get("metric")));
        params.push(number(step));
        params.push(number(value));
        params.push(bind(point.get("wall_time")));
        let first = params.len() - 4;
        values.push(format!(
            "(auth.uid(), ${first}, ${}, ${}, ${}, ${})",
            first + 1,
            first + 2,
            first + 3,
            first + 4
        ));
    }
    Ok((values, params))
}

async fn append_metrics(query: &dyn SdkQuery, body: &Map<String, Value>) -> LocalApiResponse {
    let Some(points) = body.get("points").and_then(Value::as_array) else {
        return bad(400, "Body must be { points: [...] }.");
    };
    if points.is_empty() {
        return LocalApiResponse::json(200, &json!({ "ok": true, "received": 0, "stored": 0 }));
    }
    if points.len() > MAX_POINTS_PER_REQUEST {
        return bad(
            400,
            &format!("At most {MAX_POINTS_PER_REQUEST} points per request."),
        );
    }

    let (values, params) = match metric_rows(points) {
        Ok(rows) => rows,
        Err(response) => return response,
    };

    let sql = format!(
        "insert into experiment_metrics (user_id, experiment_id, metric, step, value, wall_time) values {}",
        values.join(", ")
    );
    if let Err(message) = query.query(sql.as_str(), params).await {
        return bad(500, &message);
    }

    // A run that is sending numbers is running, whatever an earlier crash left the row saying.
    let mut ids: Vec<String> = Vec::new();
    for point in points.iter().filter_map(Value::as_object) {
        let bound = bind(point.get("experiment_id"));
        if let Value::String(id) = bound
            && !id.is_empty()
            && !ids.contains(&id)
        {
            ids.push(id);
        }
    }
    if !ids.is_empty() {
        let placeholders = (1..=ids.len())
            .map(|i| format!("${i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "update experiments set started_at = now(), status = 'running' \
             where status in ('running', 'abandoned') and id in ({placeholders})"
        );
        // Best effort: a failed heartbeat does not fail the flush, as in the TS.
        let _ = query
            .query(sql.as_str(), ids.into_iter().map(Value::String).collect())
            .await;
    }
    let count = points.len();
    LocalApiResponse::json(
        200,
        &json!({ "ok": true, "received": count, "stored": count }),
    )
}

async fn artifacts(
    query: &dyn SdkQuery,
    save: &dyn SaveArtifact,
    request: &LocalApiRequest,
) -> LocalApiResponse {
    if request.method != "POST" {
        return bad(405, "That method is not served here.");
    }
    let Some(body) = parse_body(request) else {
        return bad(400, "Invalid JSON body.");
    };
    save_artifact_request(query, save, &body).await
}

async fn save_artifact_request(
    query: &dyn SdkQuery,
    save: &dyn SaveArtifact,
    body: &Map<String, Value>,
) -> LocalApiResponse {
    const BODY_HINT: &str = "Body must include a plain experimentId, name and dataBase64.";
    let fields = (
        body.get("experimentId").and_then(Value::as_str),
        body.get("name").and_then(Value::as_str),
        body.get("dataBase64").and_then(Value::as_str),
    );
    let (Some(experiment_id), Some(name), Some(data)) = fields else {
        return bad(400, BODY_HINT);
    };
    if !is_safe_segment(experiment_id) || !is_safe_segment(name) {
        return bad(400, BODY_HINT);
    }
    // TS's Buffer.from is lenient; invalid base64 is refused here instead.
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) else {
        return bad(400, BODY_HINT);
    };
    if bytes.len() > MAX_LOCAL_ARTIFACT_BYTES {
        return bad(413, "Artifact is too large.");
    }
    let owned = match query
        .query(
            "select id from experiments where id = $1 limit 1",
            vec![Value::String(experiment_id.to_owned())],
        )
        .await
    {
        Ok(rows) => rows,
        Err(message) => return bad(500, &message),
    };
    if owned.is_empty() {
        return bad(404, "Experiment not found.");
    }
    match save.save(experiment_id, name, bytes).await {
        Ok(url) => LocalApiResponse::json(200, &json!({ "path": url.clone(), "url": url })),
        Err(message) => bad(500, &message),
    }
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::sync::Mutex;

    use crate::local_http::BoxFuture;

    use super::*;

    /// Answers queries in order (empty rows once the list runs out) and remembers each ask.
    struct FakeDb {
        answers: Vec<Result<Vec<Value>, String>>,
        asked: Mutex<Vec<(String, Vec<Value>)>>,
    }

    impl FakeDb {
        fn new(answers: Vec<Result<Vec<Value>, String>>) -> Self {
            Self {
                answers,
                asked: Mutex::new(Vec::new()),
            }
        }

        fn asked(&self) -> Vec<(String, Vec<Value>)> {
            self.asked.lock().expect("lock").clone()
        }
    }

    impl SdkQuery for FakeDb {
        fn query<'a>(
            &'a self,
            sql: &'a str,
            params: Vec<Value>,
        ) -> BoxFuture<'a, Result<Vec<Value>, String>> {
            let index = {
                let mut asked = self.asked.lock().expect("lock");
                asked.push((sql.to_owned(), params));
                asked.len() - 1
            };
            let answer = self.answers.get(index).cloned().unwrap_or(Ok(Vec::new()));
            Box::pin(async move { answer })
        }
    }

    /// Records each save and answers `app://artifacts/...`.
    #[derive(Default)]
    struct FakeSave {
        saved: Mutex<Vec<(String, String, Vec<u8>)>>,
    }

    impl SaveArtifact for FakeSave {
        fn save<'a>(
            &'a self,
            experiment_id: &'a str,
            name: &'a str,
            bytes: Vec<u8>,
        ) -> BoxFuture<'a, Result<String, String>> {
            self.saved.lock().expect("lock").push((
                experiment_id.to_owned(),
                name.to_owned(),
                bytes,
            ));
            let url = format!("app://artifacts/{experiment_id}/u/{name}");
            Box::pin(async move { Ok(url) })
        }
    }

    fn block_on<T>(future: impl Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    /// One request through the router, with `url` split into path and search as the server does.
    fn call(
        db: &dyn SdkQuery,
        save: Option<&dyn SaveArtifact>,
        method: &str,
        url: &str,
        body: &str,
    ) -> Option<LocalApiResponse> {
        let (path, search) = url.split_once('?').unwrap_or((url, ""));
        let request = LocalApiRequest {
            method: method.to_owned(),
            url: url.to_owned(),
            authorization: None,
            body: body.to_owned(),
        };
        block_on(route_sdk_request(db, &request, path, search, save))
    }

    fn answer(db: &dyn SdkQuery, method: &str, url: &str, body: &str) -> LocalApiResponse {
        call(db, None, method, url, body).expect("an SDK route answers")
    }

    fn body_of(response: &LocalApiResponse) -> Value {
        serde_json::from_str(&response.body).expect("JSON body")
    }

    #[test]
    fn a_path_that_is_not_the_sdks_is_left_for_the_rest_of_the_api() {
        let db = FakeDb::new(vec![]);
        assert!(call(&db, None, "GET", "/vault/notes/a.md", "").is_none());
        assert!(call(&db, None, "GET", "/api/sdk", "").is_none());
        assert!(call(&db, None, "GET", "/api/sdkx/whoami", "").is_none());
        assert!(db.asked().is_empty());
    }

    #[test]
    fn an_sdk_route_the_sdk_does_not_have_is_a_404_not_a_fall_through() {
        let db = FakeDb::new(vec![]);
        assert_eq!(answer(&db, "GET", "/api/sdk/artifacts", "").status, 404);
        assert_eq!(answer(&db, "POST", "/api/sdk/artifacts", "{}").status, 404);
        assert_eq!(answer(&db, "GET", "/api/sdk/", "").status, 404);
        assert_eq!(answer(&db, "GET", "/api/sdk/nope", "").status, 404);
    }

    #[test]
    fn whoami_names_the_user_queries_run_as() {
        let db = FakeDb::new(vec![Ok(vec![json!({ "id": "acct-1" })])]);
        let response = answer(&db, "GET", "/api/sdk/whoami", "");
        assert_eq!(response.status, 200);
        assert_eq!(body_of(&response)["userId"], "acct-1");
        assert!(db.asked()[0].0.contains("auth.uid()"));
    }

    #[test]
    fn whoami_falls_back_to_the_local_user() {
        let db = FakeDb::new(vec![Ok(vec![])]);
        let response = answer(&db, "GET", "/api/sdk/whoami", "");
        assert_eq!(body_of(&response)["userId"], LOCAL_USER_ID);
    }

    #[test]
    fn whoami_falls_back_to_the_local_user_when_the_query_fails() {
        let db = FakeDb::new(vec![Err("down".to_owned())]);
        let response = answer(&db, "GET", "/api/sdk/whoami", "");
        assert_eq!(response.status, 200);
        assert_eq!(body_of(&response)["userId"], LOCAL_USER_ID);
    }

    #[test]
    fn a_project_is_found_by_name() {
        let db = FakeDb::new(vec![Ok(vec![json!({ "id": "proj-1" })])]);
        let response = answer(&db, "GET", "/api/sdk/projects?name=Offline%20Trial", "");
        assert_eq!(body_of(&response)["projectId"], "proj-1");
        assert_eq!(db.asked()[0].1, vec![json!("Offline Trial")]);
    }

    #[test]
    fn a_project_name_decodes_like_url_search_params() {
        let db = FakeDb::new(vec![Ok(vec![])]);
        let response = answer(
            &db,
            "GET",
            "/api/sdk/projects?name=%20%20Offline+Trial%21%20",
            "",
        );
        assert_eq!(response.status, 200);
        assert_eq!(db.asked()[0].1, vec![json!("Offline Trial!")]);
    }

    #[test]
    fn a_project_query_failure_is_a_500() {
        let db = FakeDb::new(vec![Err("boom".to_owned())]);
        let response = answer(&db, "GET", "/api/sdk/projects?name=x", "");
        assert_eq!(response.status, 500);
        assert_eq!(body_of(&response)["error"], "boom");
    }

    #[test]
    fn a_project_nobody_named_is_refused_rather_than_searched_for() {
        let db = FakeDb::new(vec![]);
        assert_eq!(answer(&db, "GET", "/api/sdk/projects", "").status, 400);
        assert!(db.asked().is_empty());
    }

    #[test]
    fn saving_an_experiment_is_owned_by_the_querying_user_and_casts_the_json_columns() {
        let db = FakeDb::new(vec![Ok(vec![json!({ "id": "exp-1" })])]);
        let body = json!({
            "id": "exp-1",
            "name": "warm start",
            "config": { "lr": 0.01 },
            "status": "running",
        })
        .to_string();
        let response = answer(&db, "POST", "/api/sdk/experiments", &body);
        assert_eq!(response.status, 200);
        let asked = db.asked();
        let (sql, params) = &asked[0];
        assert!(sql.contains("insert into experiments (user_id, id, name, status, config)"));
        assert!(sql.contains("values (auth.uid(), $1, $2, $3, $4::jsonb)"));
        assert!(sql.contains(
            "on conflict (id) do update set user_id = excluded.user_id, name = excluded.name"
        ));
        assert_eq!(params[3], json!("{\"lr\":0.01}"));
    }

    #[test]
    fn a_column_nobody_declared_is_dropped_not_interpolated() {
        let db = FakeDb::new(vec![]);
        let body = json!({ "id": "exp-1", "name = 1, user_id": "x" }).to_string();
        let _ = answer(&db, "POST", "/api/sdk/experiments", &body);
        assert!(db.asked()[0].0.contains("user_id, id)"));
    }

    #[test]
    fn an_experiment_with_no_id_is_refused() {
        let db = FakeDb::new(vec![]);
        let body = json!({ "name": "nameless" }).to_string();
        assert_eq!(
            answer(&db, "POST", "/api/sdk/experiments", &body).status,
            400
        );
        assert!(db.asked().is_empty());
    }

    #[test]
    fn an_experiment_body_that_is_not_an_object_is_refused() {
        let db = FakeDb::new(vec![]);
        assert_eq!(
            answer(&db, "POST", "/api/sdk/experiments", "[]").status,
            400
        );
        assert_eq!(
            answer(&db, "POST", "/api/sdk/experiments", "not json").status,
            400
        );
        assert_eq!(answer(&db, "PUT", "/api/sdk/experiments", "{}").status, 405);
        assert!(db.asked().is_empty());
    }

    #[test]
    fn deleting_an_experiment_that_was_never_there_says_so() {
        let db = FakeDb::new(vec![]);
        let response = answer(&db, "DELETE", "/api/sdk/experiments?id=exp-9", "");
        assert_eq!(response.status, 404);
    }

    #[test]
    fn metric_points_go_in_as_one_statement_and_the_run_is_marked_running() {
        let db = FakeDb::new(vec![Ok(vec![]), Ok(vec![])]);
        let body = json!({
            "points": [
                { "experiment_id": "exp-1", "metric": "loss", "step": 0, "value": 1.5, "wall_time": "2026-08-27T00:00:00Z" },
                { "experiment_id": "exp-1", "metric": "loss", "step": 1, "value": 1.25 },
            ]
        })
        .to_string();
        let response = answer(&db, "POST", "/api/sdk/metrics", &body);
        assert_eq!(response.status, 200);
        assert_eq!(body_of(&response)["stored"], 2);
        let asked = db.asked();
        assert_eq!(asked.len(), 2);
        assert!(asked[0].0.ends_with(
            "values (auth.uid(), $1, $2, $3, $4, $5), (auth.uid(), $6, $7, $8, $9, $10)"
        ));
        assert_eq!(asked[0].1[4], json!("2026-08-27T00:00:00Z"));
        assert_eq!(asked[0].1[9], Value::Null);
        assert!(
            asked[1]
                .0
                .contains("update experiments set started_at = now()")
        );
        assert_eq!(asked[1].1, vec![json!("exp-1")]);
    }

    #[test]
    fn a_point_whose_value_is_not_a_number_is_refused_before_anything_is_written() {
        let db = FakeDb::new(vec![]);
        let body =
            json!({ "points": [{ "experiment_id": "exp-1", "metric": "loss", "value": "later" }] })
                .to_string();
        assert_eq!(answer(&db, "POST", "/api/sdk/metrics", &body).status, 400);
        assert!(db.asked().is_empty());
    }

    #[test]
    fn clearing_a_runs_metrics_empties_both_the_points_and_the_chunks() {
        let db = FakeDb::new(vec![]);
        let response = answer(&db, "DELETE", "/api/sdk/metrics?experiment_id=exp-1", "");
        assert_eq!(response.status, 200);
        let asked = db.asked();
        assert_eq!(asked.len(), 4);
        assert!(
            asked[0]
                .0
                .contains("delete from experiment_metric_points where experiment_id = $1")
        );
        assert!(
            asked[1]
                .0
                .contains("delete from experiment_metric_chunks where experiment_id = $1")
        );
        assert_eq!(asked[1].1, vec![json!("exp-1")]);
        assert!(asked[3].0.contains("insert into local_metric_resets"));
    }

    #[test]
    fn clearing_metrics_without_a_run_is_refused() {
        let db = FakeDb::new(vec![]);
        assert_eq!(answer(&db, "DELETE", "/api/sdk/metrics", "").status, 400);
        assert!(db.asked().is_empty());
    }

    #[test]
    fn an_empty_flush_is_not_a_statement() {
        let db = FakeDb::new(vec![]);
        assert_eq!(
            answer(&db, "POST", "/api/sdk/metrics", r#"{"points":[]}"#).status,
            200
        );
        assert!(db.asked().is_empty());
    }

    // 37-07: a point that is not an object is the client's mistake, a 400, not a TypeError.
    #[test]
    fn a_point_that_is_not_an_object_is_a_400() {
        for point in ["null", "3", "\"x\"", "[1]"] {
            let db = FakeDb::new(vec![]);
            let body = format!(r#"{{"points":[{point}]}}"#);
            assert_eq!(
                answer(&db, "POST", "/api/sdk/metrics", &body).status,
                400,
                "{point}"
            );
            assert!(db.asked().is_empty(), "{point}");
        }
    }

    #[test]
    fn a_point_without_a_finite_step_or_value_is_a_400() {
        let db = FakeDb::new(vec![]);
        let body =
            r#"{"points":[{"experiment_id":"exp-1","metric":"loss","step":"nan?","value":1}]}"#;
        assert_eq!(answer(&db, "POST", "/api/sdk/metrics", body).status, 400);
        assert!(db.asked().is_empty());
    }

    #[test]
    fn a_flush_over_the_web_routes_5000_point_cap_is_refused_and_5000_goes_in() {
        let point = json!({ "experiment_id": "exp-1", "metric": "loss", "step": 1, "value": 0.5 });

        let over = FakeDb::new(vec![]);
        let body = json!({ "points": vec![point.clone(); 5001] }).to_string();
        let response = answer(&over, "POST", "/api/sdk/metrics", &body);
        assert_eq!(response.status, 400);
        assert!(
            body_of(&response)["error"]
                .as_str()
                .is_some_and(|e| e.contains("5000"))
        );
        assert!(over.asked().is_empty());

        let at = FakeDb::new(vec![]);
        let body = json!({ "points": vec![point; 5000] }).to_string();
        assert_eq!(answer(&at, "POST", "/api/sdk/metrics", &body).status, 200);
        assert!(
            at.asked()[0].1.len() < 65535,
            "stays under Postgres' bind limit"
        );
    }

    #[test]
    fn an_artifact_upload_is_saved_to_disk_and_its_url_handed_back() {
        let db = FakeDb::new(vec![Ok(vec![json!({ "id": "exp-1" })])]);
        let save = FakeSave::default();
        let body = json!({
            "experimentId": "exp-1",
            "name": "a.png",
            "dataBase64": base64::engine::general_purpose::STANDARD.encode(b"png"),
        })
        .to_string();
        let response = call(
            &db,
            Some(&save as &dyn SaveArtifact),
            "POST",
            "/api/sdk/artifacts",
            &body,
        )
        .expect("answers");
        assert_eq!(response.status, 200);
        assert_eq!(body_of(&response)["url"], "app://artifacts/exp-1/u/a.png");
        assert_eq!(
            *save.saved.lock().expect("lock"),
            vec![("exp-1".to_owned(), "a.png".to_owned(), b"png".to_vec())]
        );
    }

    #[test]
    fn an_artifact_name_that_could_leave_its_folder_is_refused() {
        let db = FakeDb::new(vec![]);
        let save = FakeSave::default();
        let body = json!({ "experimentId": "exp-1", "name": "../x", "dataBase64": "" }).to_string();
        let response = call(
            &db,
            Some(&save as &dyn SaveArtifact),
            "POST",
            "/api/sdk/artifacts",
            &body,
        )
        .expect("answers");
        assert_eq!(response.status, 400);
        assert!(save.saved.lock().expect("lock").is_empty());
        assert!(db.asked().is_empty());
    }

    #[test]
    fn unsafe_or_missing_artifact_fields_are_refused() {
        let bodies = [
            json!({ "experimentId": "a/b", "name": "ok.png", "dataBase64": "" }),
            json!({ "experimentId": "exp-1", "name": "", "dataBase64": "" }),
            json!({ "experimentId": "exp-1", "name": "ok.png" }),
            json!({ "name": "ok.png", "dataBase64": "" }),
        ];
        for body in bodies {
            let db = FakeDb::new(vec![]);
            let save = FakeSave::default();
            let response = call(
                &db,
                Some(&save as &dyn SaveArtifact),
                "POST",
                "/api/sdk/artifacts",
                &body.to_string(),
            )
            .expect("answers");
            assert_eq!(response.status, 400, "{body}");
            assert!(save.saved.lock().expect("lock").is_empty(), "{body}");
        }
    }

    #[test]
    fn an_artifact_with_bad_base64_is_refused_and_not_saved() {
        let db = FakeDb::new(vec![Ok(vec![json!({ "id": "exp-1" })])]);
        let save = FakeSave::default();
        let body =
            json!({ "experimentId": "exp-1", "name": "a.png", "dataBase64": "!!!!" }).to_string();
        let response = call(
            &db,
            Some(&save as &dyn SaveArtifact),
            "POST",
            "/api/sdk/artifacts",
            &body,
        )
        .expect("answers");
        assert_eq!(response.status, 400);
        assert!(save.saved.lock().expect("lock").is_empty());
    }

    #[test]
    fn an_artifact_over_the_size_cap_is_a_413_before_any_query() {
        let db = FakeDb::new(vec![]);
        let save = FakeSave::default();
        let data =
            base64::engine::general_purpose::STANDARD
                .encode(vec![0u8; MAX_LOCAL_ARTIFACT_BYTES + 1]);
        let body =
            json!({ "experimentId": "exp-1", "name": "big.bin", "dataBase64": data }).to_string();
        let response = call(
            &db,
            Some(&save as &dyn SaveArtifact),
            "POST",
            "/api/sdk/artifacts",
            &body,
        )
        .expect("answers");
        assert_eq!(response.status, 413);
        assert!(db.asked().is_empty());
        assert!(save.saved.lock().expect("lock").is_empty());
    }

    #[test]
    fn an_artifact_for_an_experiment_that_does_not_exist_is_a_404() {
        let db = FakeDb::new(vec![Ok(vec![])]);
        let save = FakeSave::default();
        let body =
            json!({ "experimentId": "exp-9", "name": "a.png", "dataBase64": "" }).to_string();
        let response = call(
            &db,
            Some(&save as &dyn SaveArtifact),
            "POST",
            "/api/sdk/artifacts",
            &body,
        )
        .expect("answers");
        assert_eq!(response.status, 404);
        assert!(save.saved.lock().expect("lock").is_empty());
    }

    #[test]
    fn a_query_failure_is_a_500_with_its_message() {
        let db = FakeDb::new(vec![Err("boom".to_owned())]);
        let body =
            json!({ "points": [{ "experiment_id": "exp-1", "metric": "loss", "value": 1 }] })
                .to_string();
        let response = answer(&db, "POST", "/api/sdk/metrics", &body);
        assert_eq!(response.status, 500);
        assert_eq!(body_of(&response)["error"], "boom");
    }
}

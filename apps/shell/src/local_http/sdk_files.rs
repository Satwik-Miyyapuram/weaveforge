//! Files-first local SDK (0.9.8: there is no local database). A local
//! `POST /api/sdk/metrics` is written as a CSV chunk in the experiment's
//! folder (`<experiment>/metrics/<run>/<batch>.csv`).
//!
//! Laws (proved in the tests below and in `wf-store/tests/metrics_chunks.rs`):
//! - The same request sent twice names the same chunk, so it is stored once.
//! - A request with any bad point writes nothing.

use serde_json::{Value, json};
use wf_store::files::metrics_csv::{
    ChunkWrite, experiment_dirs, local_batch_id, store_metric_points,
};

use super::sdk::{LOCAL_USER_ID, SDK_PREFIX, trimmed_param};
use super::verified::Mode;
use super::{LocalApiRequest, LocalApiResponse};
use crate::vault::VaultState;

/// The web route's cap on points per request.
const MAX_POINTS: usize = 5000;
/// The project file the files-first folder keeps (`{ id, name }` plus other keys).
const WORKSPACE_JSON: &str = ".weaveforge/workspace.json";
/// Said when the blocking write task panicked.
const TASK_FAILED: &str = "The metrics could not be written.";
/// Said by every SDK route when no folder is open.
pub(super) const UNAVAILABLE: &str = "folder status unavailable";
/// Said by a files-mode folder for experiments and artifacts over the local SDK.
pub(super) const EXPERIMENTS_LATER: &str =
    "experiment tracking over the local SDK is unavailable in files mode";
/// Said by a files-mode folder for an SDK route that is not file-backed yet. Never SQL.
pub(super) const NOT_FILED: &str = "not available in files mode yet";

/// Answers every SDK request under `SDK_PREFIX`; `None` only for other paths.
///
/// - `Files`: `GET projects` from `workspace.json`, `GET whoami` locally, metrics as chunks.
///   Experiments, artifacts and any other route are 503. Never SQL.
/// - `Unavailable`: every SDK route is 503.
pub async fn route(
    mode: Mode,
    vault: &VaultState,
    request: &LocalApiRequest,
    path: &str,
    search: &str,
) -> Option<LocalApiResponse> {
    let rest = path.strip_prefix(SDK_PREFIX)?;
    let route = rest.trim_end_matches('/');
    Some(match mode {
        Mode::Unavailable => bad(503, UNAVAILABLE),
        Mode::Files => match (request.method.as_str(), route) {
            ("GET", "projects") => project_from_files(vault, search).await,
            ("GET", "whoami") => LocalApiResponse::json(
                200,
                &json!({ "userId": LOCAL_USER_ID, "email": null, "fullName": null }),
            ),
            ("POST", "metrics") => append_metrics_to_files(vault, &request.body).await,
            _ if matches!(route.split('/').next(), Some("experiments" | "artifacts")) => {
                bad(503, EXPERIMENTS_LATER)
            }
            _ => bad(503, NOT_FILED),
        },
    })
}

/// The SDK routes' error shape: `{"error": message}`.
fn bad(status: u16, message: &str) -> LocalApiResponse {
    LocalApiResponse::json(status, &json!({ "error": message }))
}

/// `GET projects?name=`: the id of the project in `workspace.json` with that name,
/// or JSON `null` when it does not match. Same reply as the database route.
async fn project_from_files(vault: &VaultState, search: &str) -> LocalApiResponse {
    let name = trimmed_param(search, "name");
    if name.is_empty() {
        return bad(400, "Missing project name.");
    }
    match workspace_project(vault).await {
        Ok(project) => {
            let id = project
                .filter(|project| project.get("name").and_then(Value::as_str) == Some(&name))
                .and_then(|project| project.get("id").cloned())
                .unwrap_or(Value::Null);
            LocalApiResponse::json(200, &json!({ "projectId": id }))
        }
        Err(message) => bad(500, &message),
    }
}

/// The project object in `workspace.json`; `None` when the file is absent or not JSON.
pub(super) async fn workspace_project(vault: &VaultState) -> Result<Option<Value>, String> {
    let vault = vault.clone();
    let read = tokio::task::spawn_blocking(move || vault.lock().read_text(WORKSPACE_JSON))
        .await
        .unwrap_or_else(|_| Err(TASK_FAILED.to_owned()))?;
    Ok(read.and_then(|text| serde_json::from_str::<Value>(&text).ok()))
}

/// Answers a `POST /api/sdk/metrics` body by writing one chunk per experiment
/// and run. The reply has the database route's shape; `stored` is 0 when the
/// same request was already on disk.
pub async fn append_metrics_to_files(vault: &VaultState, body: &str) -> LocalApiResponse {
    let Ok(body) = serde_json::from_str::<Value>(body) else {
        return bad(400, "Invalid JSON body.");
    };
    let Some(points) = body.get("points").and_then(Value::as_array).cloned() else {
        return bad(400, "Body must be { points: [...] }.");
    };
    if points.is_empty() {
        return LocalApiResponse::json(200, &json!({ "ok": true, "received": 0, "stored": 0 }));
    }
    if points.len() > MAX_POINTS {
        return bad(400, &format!("At most {MAX_POINTS} points per request."));
    }
    let vault = vault.clone();
    let written = tokio::task::spawn_blocking(move || {
        let session = vault.lock();
        let vault = session.vault().map_err(|e| (500, e))?;
        let dirs = experiment_dirs(vault).map_err(|e| (500, e.to_string()))?;
        let writes = store_metric_points(vault, &local_batch_id(&points), &points, &dirs)
            .map_err(|e| (400, e))?;
        Ok((points.len(), writes))
    })
    .await
    .unwrap_or_else(|_| Err((500, TASK_FAILED.to_owned())));
    match written {
        Ok((count, writes)) => {
            let fresh = writes.contains(&ChunkWrite::Written);
            LocalApiResponse::json(
                200,
                &json!({ "ok": true, "received": count, "stored": if fresh { count } else { 0 } }),
            )
        }
        Err((status, message)) => bad(status, &message),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::local_http::verified::folder_mode;

    const EXP: &str = "experiments/lr-sweep";

    /// A workspace with one experiment file, adopted as the chosen folder.
    struct Fixture {
        root: PathBuf,
        vault: VaultState,
    }

    /// The storage mode the request path would compute for this fixture.
    fn mode_of(fixture: &Fixture) -> Mode {
        folder_mode(&fixture.vault)
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir()
                .join(format!("wf-shell-sdk-files-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join(".weaveforge")).expect("create workspace");
            fs::create_dir_all(root.join("experiments")).expect("create experiments");
            fs::write(
                root.join(format!("{EXP}.md")),
                "---\nweaveforge-id: exp-1\nweaveforge-type: experiment\nwf: 3\n---\n",
            )
            .expect("write experiment");
            let vault = VaultState::new();
            assert!(
                vault
                    .lock()
                    .adopt(Some(root.as_path()))
                    .expect("adopt workspace")
                    .is_some()
            );
            Self { root, vault }
        }

        fn chunks(&self) -> usize {
            fs::read_dir(self.root.join(EXP).join("metrics").join("main"))
                .map_or(0, Iterator::count)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn post(fixture: &Fixture, body: &Value) -> (u16, Value) {
        let response = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(append_metrics_to_files(&fixture.vault, &body.to_string()));
        let reply = serde_json::from_str(&response.body).unwrap_or(Value::Null);
        (response.status, reply)
    }

    fn points(steps: std::ops::Range<u32>) -> Value {
        let points: Vec<Value> = steps
            .map(|s| json!({"experiment_id": "exp-1", "metric": "loss", "step": s, "value": 0.5}))
            .collect();
        json!({ "points": points })
    }

    fn route_once(fixture: &Fixture, body: &Value) -> Option<LocalApiResponse> {
        let request = LocalApiRequest {
            method: "POST".to_owned(),
            url: "/api/sdk/metrics".to_owned(),
            authorization: None,
            body: body.to_string(),
        };
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(route(
                mode_of(fixture),
                &fixture.vault,
                &request,
                "/api/sdk/metrics",
                "",
            ))
    }

    fn route_get(fixture: &Fixture, path: &str, search: &str) -> Option<LocalApiResponse> {
        let request = LocalApiRequest {
            method: "GET".to_owned(),
            url: path.to_owned(),
            authorization: None,
            body: String::new(),
        };
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(route(
                mode_of(fixture),
                &fixture.vault,
                &request,
                path,
                search,
            ))
    }

    #[test]
    fn an_open_folder_answers_projects_from_workspace_json() {
        let fixture = Fixture::new("projects-route");
        fs::write(
            fixture.root.join(".weaveforge").join("workspace.json"),
            json!({ "id": "proj-1", "name": "Lab", "other": true }).to_string(),
        )
        .expect("write workspace");
        let found = route_get(&fixture, "/api/sdk/projects", "name=Lab").expect("answered");
        assert_eq!(found.status, 200);
        let reply: Value = serde_json::from_str(&found.body).expect("json");
        assert_eq!(reply["projectId"], json!("proj-1"));
        let missing = route_get(&fixture, "/api/sdk/projects", "name=Other").expect("answered");
        let reply: Value = serde_json::from_str(&missing.body).expect("json");
        assert_eq!(reply["projectId"], Value::Null);
    }

    #[test]
    fn an_open_folder_writes_metrics_to_files_without_any_flag_or_report() {
        let fixture = Fixture::new("files-route");
        assert_eq!(mode_of(&fixture), Mode::Files);
        let answer = route_once(&fixture, &points(0..2)).expect("answered from files");
        assert_eq!(answer.status, 200);
        assert_eq!(fixture.chunks(), 1);
    }

    #[test]
    fn a_leftover_0_9_7_report_changes_nothing() {
        for (n, report) in [
            r#"{"version":1,"state":"incomplete","runs":[]}"#,
            "not json",
        ]
        .into_iter()
        .enumerate()
        {
            let fixture = Fixture::new(&format!("leftover-report-{n}"));
            let dir = fixture.root.join(".weaveforge").join("migration-0.9.7");
            fs::create_dir_all(&dir).expect("create migration dir");
            fs::write(dir.join("report.json"), report).expect("write report");
            assert_eq!(mode_of(&fixture), Mode::Files, "{report}");
            let answer = route_once(&fixture, &points(0..2)).expect("answered from files");
            assert_eq!(answer.status, 200, "{report}");
            assert_eq!(fixture.chunks(), 1, "{report}");
        }
    }

    #[test]
    fn no_open_folder_answers_503_on_every_sdk_route() {
        let vault = VaultState::new();
        assert_eq!(folder_mode(&vault), Mode::Unavailable);
        for (method, path) in [("POST", "/api/sdk/metrics"), ("GET", "/api/sdk/projects")] {
            let request = LocalApiRequest {
                method: method.to_owned(),
                url: path.to_owned(),
                authorization: None,
                body: points(0..2).to_string(),
            };
            let answer = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime")
                .block_on(route(Mode::Unavailable, &vault, &request, path, "name=Lab"))
                .expect("answered 503");
            assert_eq!(answer.status, 503, "{path}");
            let reply: Value = serde_json::from_str(&answer.body).expect("json body");
            assert_eq!(reply["error"], UNAVAILABLE);
        }
    }

    #[test]
    fn a_path_outside_the_sdk_is_not_answered() {
        let fixture = Fixture::new("outside");
        assert!(route_get(&fixture, "/api/search", "q=x").is_none());
    }

    #[test]
    fn an_open_folder_answers_unfiled_sdk_routes_503_and_never_falls_back() {
        let fixture = Fixture::new("unfiled-503");
        for (path, search) in [
            ("/api/sdk/experiments", "id=e1"),
            ("/api/sdk/artifacts", ""),
        ] {
            let answer = route_get(&fixture, path, search).expect("answered, not left to SQL");
            assert_eq!(answer.status, 503, "{path}");
            let reply: Value = serde_json::from_str(&answer.body).expect("json");
            assert_eq!(reply["error"], json!(EXPERIMENTS_LATER), "{path}");
        }
        let answer = route_get(&fixture, "/api/sdk/metrics", "experiment_id=e1")
            .expect("answered, not left to SQL");
        assert_eq!(answer.status, 503);
        let reply: Value = serde_json::from_str(&answer.body).expect("json");
        assert_eq!(reply["error"], json!(NOT_FILED));
    }

    #[test]
    fn an_open_folder_answers_whoami_locally_without_sql() {
        let fixture = Fixture::new("whoami-files");
        let answer = route_get(&fixture, "/api/sdk/whoami", "").expect("answered locally");
        assert_eq!(answer.status, 200);
        let reply: Value = serde_json::from_str(&answer.body).expect("json");
        assert_eq!(reply["userId"], json!(LOCAL_USER_ID));
    }

    #[test]
    fn same_request_twice_is_one_chunk() {
        let fixture = Fixture::new("twice");
        let (status, reply) = post(&fixture, &points(0..3));
        assert_eq!((status, reply["stored"].as_u64()), (200, Some(3)));
        let (status, reply) = post(&fixture, &points(0..3));
        assert_eq!((status, reply["stored"].as_u64()), (200, Some(0)));
        assert_eq!(fixture.chunks(), 1);
        let _ = post(&fixture, &points(3..5));
        assert_eq!(fixture.chunks(), 2);
    }

    #[test]
    fn unknown_experiment_writes_nothing() {
        let fixture = Fixture::new("unknown");
        let body = json!({"points": [{"experiment_id": "nope", "metric": "loss", "value": 1}]});
        assert_eq!(post(&fixture, &body).0, 400);
        assert_eq!(fixture.chunks(), 0);
    }

    #[test]
    fn bad_bodies_are_refused() {
        let fixture = Fixture::new("bad");
        assert_eq!(post(&fixture, &json!({"nope": 1})).0, 400);
        assert_eq!(post(&fixture, &json!({"points": []})).0, 200);
        let many: Vec<Value> = (0..=MAX_POINTS).map(|_| json!({})).collect();
        assert_eq!(post(&fixture, &json!({ "points": many })).0, 400);
    }
}

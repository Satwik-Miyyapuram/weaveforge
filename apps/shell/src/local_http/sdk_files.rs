//! Files-first SDK metrics (0.9.5 L4). With `WF_METRICS_FILES=1`, a local
//! `POST /api/sdk/metrics` is written as a CSV chunk in the experiment's
//! folder (`<experiment>/metrics/<run>/<batch>.csv`) instead of the local
//! database.
//!
//! Laws (proved in the tests below and in `wf-store/tests/metrics_chunks.rs`):
//! - The same request sent twice names the same chunk, so it is stored once.
//! - A request with any bad point writes nothing.

use serde_json::{Value, json};
use wf_store::files::metrics_csv::{
    ChunkWrite, experiment_dirs, local_batch_id, store_metric_points,
};

use super::sdk::SDK_PREFIX;
use super::{LocalApiRequest, LocalApiResponse};
use crate::vault::VaultState;

/// The web route's cap on points per request.
const MAX_POINTS: usize = 5000;
/// Said when the blocking write task panicked.
const TASK_FAILED: &str = "The metrics could not be written.";

/// Whether local metrics go to files (`WF_METRICS_FILES=1`); read on every call.
#[must_use]
pub fn enabled() -> bool {
    std::env::var("WF_METRICS_FILES").is_ok_and(|value| value == "1")
}

/// Answers a local `POST /api/sdk/metrics` from files when [`enabled`];
/// `None` leaves every other request to the database routes.
pub async fn route(
    vault: &VaultState,
    request: &LocalApiRequest,
    path: &str,
) -> Option<LocalApiResponse> {
    let metrics = request.method == "POST"
        && path
            .strip_prefix(SDK_PREFIX)
            .map(|r| r.trim_end_matches('/'))
            == Some("metrics");
    if !metrics || !enabled() {
        return None;
    }
    Some(append_metrics_to_files(vault, &request.body).await)
}

/// The SDK routes' error shape: `{"error": message}`.
fn bad(status: u16, message: &str) -> LocalApiResponse {
    LocalApiResponse::json(status, &json!({ "error": message }))
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

    const EXP: &str = "experiments/lr-sweep";

    /// A workspace with one experiment file, adopted as the chosen folder.
    struct Fixture {
        root: PathBuf,
        vault: VaultState,
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

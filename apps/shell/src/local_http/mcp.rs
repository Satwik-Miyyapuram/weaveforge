//! The MCP JSON-RPC router behind POST `/mcp`. Ported from `routeMcpRequest` in
//! apps/shell/sidecar/src/local-mcp.ts, plus `trackingFor` / `projectsFrom` in local-api.ts.
//!
//! Tool calls are sync and run under the vault lock. `search_workspace` is split so the
//! page's ranker is awaited with the lock released.

use std::sync::Arc;

use serde_json::{Map, Value, json};
use wf_core::sync::folder_layout::WorkspaceProject;

use super::mcp_call::{Ctx, call_tool, search_answer, search_hits};
use super::mcp_draft::canonical_ai_tool_name;
use super::mcp_projects::resolve_projects;
use super::mcp_read::PROTOCOL_VERSION;
use super::mcp_tools::{TrackingSetup, tools, tracking_setup, tracking_tool};
use super::{BoxFuture, McpHome, McpRouter, SdkQuery, SemanticRanker};
use crate::vault::VaultState;

/// The tracking tool's name, as `tracking_tool()` lists it.
const TRACKING_TOOL_NAME: &str = "experiment_tracking_setup";

/// The app's MCP server: reads the chosen folder, asks the page to rank, and names projects.
pub struct LocalMcp {
    vault: VaultState,
    query: Option<Arc<dyn SdkQuery>>,
    ranker: Option<Arc<dyn SemanticRanker>>,
    home: Option<McpHome>,
}

impl LocalMcp {
    /// `query` lists projects; `ranker` orders search hits; `home` is where Connect left the token.
    #[must_use]
    pub fn new(
        vault: VaultState,
        query: Option<Arc<dyn SdkQuery>>,
        ranker: Option<Arc<dyn SemanticRanker>>,
        home: Option<McpHome>,
    ) -> Self {
        Self {
            vault,
            query,
            ranker,
            home,
        }
    }

    /// The app's projects, or none when there is no database or the query failed (TS `projectsFrom`).
    async fn project_rows(&self) -> Vec<WorkspaceProject> {
        let Some(query) = &self.query else {
            return Vec::new();
        };
        query
            .query("select id, name from projects order by name", Vec::new())
            .await
            .unwrap_or_default()
            .iter()
            .map(|row| WorkspaceProject {
                id: js_string(&row["id"]),
                name: js_string(&row["name"]),
            })
            .collect()
    }

    /// Tracking help when the token may log runs and Connect has run (TS `trackingFor`).
    async fn tracking(&self, allowed: bool) -> Option<TrackingSetup> {
        let home = self.home.as_ref()?;
        let query = self.query.as_ref()?;
        if !allowed {
            return None;
        }
        let projects = query
            .query("select name from projects order by name", Vec::new())
            .await
            .unwrap_or_default()
            .iter()
            .map(|row| js_string(&row["name"]))
            .collect();
        Some(TrackingSetup {
            api_url: home.api_url.clone(),
            token_file: home.token_file.clone(),
            projects,
        })
    }

    /// Whether tracking would be offered, without querying project names.
    fn can_track(&self, allowed: bool) -> bool {
        allowed && self.home.is_some() && self.query.is_some()
    }

    /// One tool call. `Err` is the message shown to the agent.
    async fn call(&self, name: &str, args: &Map<String, Value>) -> Result<Value, String> {
        let rows = self.project_rows().await;
        if canonical_ai_tool_name(name) != "search_workspace" {
            let session = self.vault.lock();
            let projects = resolve_projects(&session, &rows);
            return call_tool(&session, name, args, &projects);
        }
        let (query, hits) = {
            let session = self.vault.lock();
            let projects = resolve_projects(&session, &rows);
            search_hits(&Ctx {
                session: &session,
                params: args,
                projects: &projects,
            })?
        };
        let ordered = match &self.ranker {
            Some(ranker) if !hits.is_empty() => {
                ranker
                    .rank(
                        &query,
                        hits.iter().map(|hit| hit.filename.clone()).collect(),
                    )
                    .await
            }
            _ => None,
        };
        search_answer(hits, ordered.as_deref())
    }

    /// Answers one JSON-RPC message (TS `routeMcpRequest`).
    async fn answer(&self, message: Value, may_suggest: bool, tracking: bool) -> Option<Value> {
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let empty = Map::new();
        let params = message
            .get("params")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        match method {
            "initialize" => Some(ok(
                &id,
                &json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "weaveforge-workspace", "version": "1" },
                }),
            )),
            "notifications/initialized" => None,
            "ping" => Some(ok(&id, &json!({}))),
            "tools/list" => {
                let mut listed = tools();
                if !may_suggest {
                    listed.retain(|tool| {
                        !tool["name"]
                            .as_str()
                            .unwrap_or_default()
                            .starts_with("suggest_")
                    });
                }
                if self.can_track(tracking) {
                    listed.push(tracking_tool());
                }
                Some(ok(&id, &json!({ "tools": listed })))
            }
            "tools/call" => Some(self.tools_call(&id, params, may_suggest, tracking).await),
            _ if id.is_null() => None,
            _ => Some(err(&id, -32601, &format!("No method named {method}."))),
        }
    }

    /// Answers `tools/call`; refusals and failures are tool errors, not protocol ones.
    async fn tools_call(
        &self,
        id: &Value,
        params: &Map<String, Value>,
        may_suggest: bool,
        tracking: bool,
    ) -> Value {
        let empty = Map::new();
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let args = params
            .get("arguments")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        if !may_suggest && canonical_ai_tool_name(name).starts_with("suggest_") {
            return tool_error(id, "This token may read only; it cannot leave drafts.");
        }
        if name == TRACKING_TOOL_NAME {
            return match self.tracking(tracking).await {
                Some(setup) => ok(
                    id,
                    &json!({ "content": [{ "type": "text", "text": tracking_setup(&setup) }] }),
                ),
                None => tool_error(
                    id,
                    "This token cannot log experiments. Press Connect in WeaveForge again.",
                ),
            };
        }
        match self.call(name, args).await {
            Ok(result) => ok(id, &result),
            // The call was well-formed and the answer is "no".
            Err(message) if message.is_empty() => tool_error(id, "That did not work."),
            Err(message) => tool_error(id, &message),
        }
    }
}

impl McpRouter for LocalMcp {
    fn route<'a>(
        &'a self,
        message: Value,
        may_suggest: bool,
        tracking: bool,
    ) -> BoxFuture<'a, Option<Value>> {
        Box::pin(self.answer(message, may_suggest, tracking))
    }
}

/// What tools/list answers for a token that may suggest; the bridge caches it (TS `listedTools`).
#[must_use]
pub fn listed_tools(with_tracking: bool) -> Vec<Value> {
    let mut listed = tools();
    if with_tracking {
        listed.push(tracking_tool());
    }
    listed
}

/// JS `String(value)`: strings unquoted, null as "null".
fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn ok(id: &Value, result: &Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn err(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_error(id: &Value, message: &str) -> Value {
    ok(
        id,
        &json!({ "isError": true, "content": [{ "type": "text", "text": message }] }),
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::future::Future;
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;

    /// A workspace with one note, adopted as the chosen folder. Removed on drop.
    struct Fixture {
        root: PathBuf,
        vault: VaultState,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir()
                .join(format!("wf-shell-local-mcp-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join(".weaveforge")).expect("create workspace");
            fs::create_dir_all(root.join("notes")).expect("create notes");
            fs::write(
                root.join("notes").join("a.note.md"),
                "# Kettle\nboiling water\n",
            )
            .expect("write a");
            fs::write(root.join("notes").join("b.note.md"), "more water here\n").expect("write b");
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
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    /// Answers project queries with one fixed project.
    struct OneProject;

    impl SdkQuery for OneProject {
        fn query<'a>(
            &'a self,
            _sql: &'a str,
            _params: Vec<Value>,
        ) -> BoxFuture<'a, Result<Vec<Value>, String>> {
            Box::pin(async { Ok(vec![json!({ "id": "p1", "name": "Tea" })]) })
        }
    }

    /// Reverses the candidates and records what it was asked.
    #[derive(Default)]
    struct Reverse {
        asked: Mutex<Vec<String>>,
    }

    impl SemanticRanker for Reverse {
        fn rank<'a>(
            &'a self,
            query: &'a str,
            mut candidates: Vec<String>,
        ) -> BoxFuture<'a, Option<Vec<String>>> {
            self.asked.lock().expect("asked").push(query.to_owned());
            candidates.reverse();
            Box::pin(async move { Some(candidates) })
        }
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    fn home() -> McpHome {
        McpHome {
            api_url: "http://127.0.0.1:27123".to_owned(),
            token_file: "/home/u/.weaveforge/mcp.json".to_owned(),
        }
    }

    fn route(mcp: &LocalMcp, message: Value, may_suggest: bool, tracking: bool) -> Option<Value> {
        block_on(mcp.route(message, may_suggest, tracking))
    }

    fn names(answer: &Value) -> Vec<String> {
        answer["result"]["tools"]
            .as_array()
            .expect("tools")
            .iter()
            .map(|t| t["name"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    #[allow(clippy::needless_pass_by_value, reason = "test helper takes literals")]
    fn call(mcp: &LocalMcp, name: &str, args: Value, may_suggest: bool, tracking: bool) -> Value {
        let message = json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": name, "arguments": args } });
        route(mcp, message, may_suggest, tracking).expect("answer")["result"].clone()
    }

    #[test]
    fn initialize_ping_and_notifications() {
        let fx = Fixture::new("init");
        let mcp = LocalMcp::new(fx.vault.clone(), None, None, None);
        let init = route(
            &mcp,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
            true,
            false,
        )
        .expect("init");
        assert_eq!(init["id"], json!(1));
        assert_eq!(init["result"]["protocolVersion"], json!(PROTOCOL_VERSION));
        assert_eq!(
            init["result"]["serverInfo"]["name"],
            json!("weaveforge-workspace")
        );
        assert_eq!(
            route(&mcp, json!({ "id": "x", "method": "ping" }), true, false).expect("ping")["result"],
            json!({})
        );
        assert!(
            route(
                &mcp,
                json!({ "method": "notifications/initialized" }),
                true,
                false
            )
            .is_none()
        );
    }

    #[test]
    fn unknown_method_errors_only_for_requests() {
        let fx = Fixture::new("unknown");
        let mcp = LocalMcp::new(fx.vault.clone(), None, None, None);
        let answer =
            route(&mcp, json!({ "id": 2, "method": "nope" }), true, false).expect("answer");
        assert_eq!(
            answer["error"],
            json!({ "code": -32601, "message": "No method named nope." })
        );
        assert!(route(&mcp, json!({ "method": "nope" }), true, false).is_none());
    }

    #[test]
    fn tools_list_hides_suggest_for_read_only_tokens() {
        let fx = Fixture::new("list");
        let mcp = LocalMcp::new(fx.vault.clone(), None, None, None);
        let all = names(
            &route(
                &mcp,
                json!({ "id": 1, "method": "tools/list" }),
                true,
                false,
            )
            .expect("all"),
        );
        let read = names(
            &route(
                &mcp,
                json!({ "id": 1, "method": "tools/list" }),
                false,
                false,
            )
            .expect("read"),
        );
        assert!(all.iter().any(|n| n.starts_with("suggest_")));
        assert!(!read.iter().any(|n| n.starts_with("suggest_")));
        assert!(read.contains(&"search_workspace".to_owned()));
        assert!(!all.contains(&TRACKING_TOOL_NAME.to_owned()));
    }

    #[test]
    fn tracking_tool_needs_permission_home_and_database() {
        let fx = Fixture::new("tracking");
        let bare = LocalMcp::new(fx.vault.clone(), None, None, None);
        let full = LocalMcp::new(
            fx.vault.clone(),
            Some(Arc::new(OneProject)),
            None,
            Some(home()),
        );
        let list = json!({ "id": 1, "method": "tools/list" });
        assert!(
            !names(&route(&bare, list.clone(), true, true).expect("bare"))
                .contains(&TRACKING_TOOL_NAME.to_owned())
        );
        assert!(
            !names(&route(&full, list.clone(), true, false).expect("no perm"))
                .contains(&TRACKING_TOOL_NAME.to_owned())
        );
        assert!(
            names(&route(&full, list, true, true).expect("full"))
                .contains(&TRACKING_TOOL_NAME.to_owned())
        );

        let refused = call(&bare, TRACKING_TOOL_NAME, json!({}), true, true);
        assert_eq!(refused["isError"], json!(true));
        assert_eq!(
            refused["content"][0]["text"],
            json!("This token cannot log experiments. Press Connect in WeaveForge again.")
        );
        let setup = call(&full, TRACKING_TOOL_NAME, json!({}), true, true);
        assert!(setup.get("isError").is_none());
        assert!(
            setup["content"][0]["text"]
                .as_str()
                .unwrap_or_default()
                .contains("Tea")
        );
    }

    #[test]
    fn read_only_tokens_cannot_suggest() {
        let fx = Fixture::new("readonly");
        let mcp = LocalMcp::new(fx.vault.clone(), None, None, None);
        let answer = call(
            &mcp,
            "suggest_note_create",
            json!({ "title": "x" }),
            false,
            false,
        );
        assert_eq!(answer["isError"], json!(true));
        assert_eq!(
            answer["content"][0]["text"],
            json!("This token may read only; it cannot leave drafts.")
        );
    }

    #[test]
    fn unknown_tool_is_a_tool_error() {
        let fx = Fixture::new("unknowntool");
        let mcp = LocalMcp::new(fx.vault.clone(), None, None, None);
        let answer = call(&mcp, "no_such_tool", json!({}), true, false);
        assert_eq!(answer["isError"], json!(true));
        assert_eq!(
            answer["content"][0]["text"],
            json!("No tool named no_such_tool.")
        );
    }

    #[test]
    fn search_asks_the_ranker_without_holding_the_lock() {
        let fx = Fixture::new("search");
        let ranker = Arc::new(Reverse::default());
        let mcp = LocalMcp::new(fx.vault.clone(), None, Some(ranker.clone()), None);
        let answer = call(
            &mcp,
            "search_workspace",
            json!({ "query": "water" }),
            true,
            false,
        );
        assert!(answer.get("isError").is_none(), "{answer}");
        assert_eq!(
            *ranker.asked.lock().expect("asked"),
            vec!["water".to_owned()]
        );
        let text = answer["content"][0]["text"].as_str().unwrap_or_default();
        let (a, b) = (
            text.find("a.note.md").expect("a listed"),
            text.find("b.note.md").expect("b listed"),
        );
        assert!(b < a, "ranker order kept: {text}");
    }
}

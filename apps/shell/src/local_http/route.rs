//! Which local API requests are answered and which are refused. Ported from
//! `apps/shell/sidecar/src/local-api.ts` (`routeLocalRequest`).

use serde_json::{Value, json};

use super::sdk::{SDK_PREFIX, route_sdk_request};
use super::token::grant_permissions;
use super::{
    Expected, LocalApiRequest, LocalApiResponse, McpRouter, Permission, SaveArtifact, SdkQuery,
};
use crate::cmd_vault;
use crate::vault::{EntryKindPayload, VaultState};
use crate::vault_search::search_vault;

const UNAUTHORIZED: &str = "A bearer token is required.";
const NOT_FOUND: &str = "No such route.";
const VAULT_PREFIX: &str = "/vault/";
const SEARCH_PATH: &str = "/search/simple/";
const MCP_PATH: &str = "/mcp";

/// What a request can reach: the vault and the optional backends.
pub struct RouteDeps<'a> {
    /// The chosen workspace folder.
    pub vault: &'a VaultState,
    /// The local database for `/api/sdk/`. `None` means those paths are not served.
    pub query: Option<&'a dyn SdkQuery>,
    /// Saves experiment artifacts for `/api/sdk/`.
    pub save_artifact: Option<&'a dyn SaveArtifact>,
    /// Answers `/mcp`. `None` answers 404, as an unserved route.
    pub mcp: Option<&'a dyn McpRouter>,
}

/// Answers one request. `expected` is the install's token; `now_ms` and `now_iso` decide expiry.
pub async fn route_local_request(
    deps: &RouteDeps<'_>,
    request: &LocalApiRequest,
    expected: &mut Expected,
    now_ms: u64,
    now_iso: &str,
) -> LocalApiResponse {
    let Some(may) = grant_permissions(request.authorization.as_deref(), expected, now_ms, now_iso)
    else {
        return LocalApiResponse::fail(401, UNAUTHORIZED);
    };
    let allowed = |need: Permission| may.contains(&need);

    let (target, search) = split_target(&request.url);
    let Some(path) = decode_uri_component(target) else {
        return LocalApiResponse::fail(400, "The path has a malformed percent escape.");
    };
    if path.starts_with(SDK_PREFIX) && !allowed(Permission::Experiments) {
        return denied(Permission::Experiments);
    }

    if let Some(query) = deps.query
        && let Some(answered) =
            route_sdk_request(query, request, &path, search, deps.save_artifact).await
    {
        return answered;
    }

    if path == MCP_PATH {
        if !allowed(Permission::McpRead) {
            return denied(Permission::McpRead);
        }
        if request.method != "POST" {
            return LocalApiResponse::fail(405, "MCP is spoken over POST.");
        }
        let Ok(message) = serde_json::from_str::<Value>(&request.body) else {
            return LocalApiResponse::json(
                400,
                &json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Not JSON." } }),
            );
        };
        let Some(mcp) = deps.mcp else {
            return LocalApiResponse::fail(404, NOT_FOUND);
        };
        return match mcp
            .route(
                message,
                allowed(Permission::McpSuggest),
                allowed(Permission::Experiments),
            )
            .await
        {
            Some(answer) => LocalApiResponse::json(200, &answer),
            // A notification is answered with no body, which is what the client waits for.
            None => LocalApiResponse::empty(202, "application/json"),
        };
    }

    if path == SEARCH_PATH || path.starts_with(VAULT_PREFIX) {
        let need = if request.method == "GET" || path == SEARCH_PATH {
            Permission::RestRead
        } else {
            Permission::RestWrite
        };
        if !allowed(need) {
            return denied(need);
        }
    }

    if path == SEARCH_PATH && request.method == "POST" {
        let query = query_param(search, "query").unwrap_or_default();
        return simple_search(deps.vault, query.trim());
    }

    if let Some(relative) = path.strip_prefix(VAULT_PREFIX) {
        return vault_route(deps.vault, request, relative).await;
    }

    LocalApiResponse::fail(404, NOT_FOUND)
}

/// The vault answer for `/vault/<relative>`: a directory listing, or one file.
async fn vault_route(
    vault: &VaultState,
    request: &LocalApiRequest,
    relative: &str,
) -> LocalApiResponse {
    if relative.is_empty() || relative.ends_with('/') {
        if request.method != "GET" {
            return LocalApiResponse::fail(405, "A directory is read, not written.");
        }
        let dir = relative.strip_suffix('/').unwrap_or(relative);
        return match cmd_vault::list(vault, Some(dir.to_owned())).await {
            Ok(entries) => {
                // Directories end with `/` so a client can tell them from files.
                let files: Vec<String> = entries
                    .into_iter()
                    .map(|entry| match entry.kind {
                        EntryKindPayload::Dir => format!("{}/", entry.path),
                        EntryKindPayload::File => entry.path,
                    })
                    .collect();
                LocalApiResponse::json(200, &json!({ "files": files }))
            }
            Err(message) => LocalApiResponse::fail(400, &message),
        };
    }

    match request.method.as_str() {
        "GET" => match cmd_vault::read(vault, relative.to_owned()).await {
            Ok(Some(text)) => LocalApiResponse {
                status: 200,
                content_type: "text/markdown",
                body: text,
            },
            Ok(None) => LocalApiResponse::fail(404, "No such file."),
            Err(message) => LocalApiResponse::fail(400, &message),
        },
        "PUT" => match cmd_vault::write(vault, relative.to_owned(), request.body.clone()).await {
            Ok(()) => LocalApiResponse::empty(204, "text/plain"),
            Err(message) => LocalApiResponse::fail(400, &message),
        },
        "DELETE" => match cmd_vault::remove(vault, relative.to_owned()).await {
            Ok(()) => LocalApiResponse::empty(204, "text/plain"),
            Err(message) => LocalApiResponse::fail(400, &message),
        },
        _ => LocalApiResponse::fail(405, "That method is not served here."),
    }
}

/// Searches every note for the query; a blank query is refused.
fn simple_search(vault: &VaultState, query: &str) -> LocalApiResponse {
    if query.is_empty() {
        return LocalApiResponse::fail(400, "A search needs a query.");
    }
    let hits = search_vault(&vault.lock(), query, "");
    LocalApiResponse::json(200, &serde_json::to_value(&hits).unwrap_or_default())
}

fn denied(need: Permission) -> LocalApiResponse {
    LocalApiResponse::fail(
        403,
        &format!("This token lacks the {} permission.", need.as_str()),
    )
}

/// Splits a request target into path and query, dropping any `#fragment` as `new URL` does.
fn split_target(url: &str) -> (&str, &str) {
    let url = url.split_once('#').map_or(url, |(before, _)| before);
    url.split_once('?').unwrap_or((url, ""))
}

/// Percent-decodes like `decodeURIComponent`: `+` stays, and `None` on a bad escape or non-UTF-8.
fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let high = hex_digit(*bytes.get(i + 1)?)?;
            let low = hex_digit(*bytes.get(i + 2)?)?;
            out.push(high * 16 + low);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Decodes one query name or value like `URLSearchParams`: `+` is a space, a bad escape stays as typed.
fn decode_form_component(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' => {
                let escape = bytes
                    .get(i + 1)
                    .and_then(|b| hex_digit(*b))
                    .zip(bytes.get(i + 2).and_then(|b| hex_digit(*b)));
                if let Some((high, low)) = escape {
                    out.push(high * 16 + low);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            other => out.push(other),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The first value of `key` in a raw query string, as `URLSearchParams.get` returns it.
fn query_param(search: &str, key: &str) -> Option<String> {
    search.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        (decode_form_component(name) == key).then(|| decode_form_component(value))
    })
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::future::Future;
    use std::path::PathBuf;

    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::local_http::{BoxFuture, TokenRecord};

    const TOKEN: &str = "secret";
    const NOW_MS: u64 = 1_800_000_000_000;
    const NOW_ISO: &str = "2027-01-15T08:00:00Z";

    /// A workspace with two notes, adopted as the chosen folder. Removed on drop.
    struct Fixture {
        root: PathBuf,
        vault: VaultState,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "wf-shell-local-route-{}-{name}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join(".weaveforge")).expect("create workspace");
            fs::create_dir_all(root.join("notes")).expect("create notes");
            fs::write(
                root.join("notes").join("a.note.md"),
                "# Kettle\nboiling water\n",
            )
            .expect("write a");
            fs::write(root.join("notes").join("b.note.md"), "nothing about tea\n")
                .expect("write b");
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

    /// Stands in for the MCP router: notifications get no answer, requests echo the flags.
    struct FakeMcp;

    impl McpRouter for FakeMcp {
        fn route<'a>(
            &'a self,
            message: Value,
            may_suggest: bool,
            tracking: bool,
        ) -> BoxFuture<'a, Option<Value>> {
            Box::pin(async move {
                if message["method"] == "notifications/initialized" {
                    return None;
                }
                Some(json!({ "id": message["id"], "suggest": may_suggest, "tracking": tracking }))
            })
        }
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    fn request(method: &str, url: &str, body: &str) -> LocalApiRequest {
        LocalApiRequest {
            method: method.to_owned(),
            url: url.to_owned(),
            authorization: Some(format!("Bearer {TOKEN}")),
            body: body.to_owned(),
        }
    }

    fn single() -> Expected {
        Expected::Single(TOKEN.to_owned())
    }

    fn sha256_hex(text: &str) -> String {
        Sha256::digest(text.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// Stored grants for `TOKEN` with the given permissions and expiry.
    fn grants(permissions: &[Permission], expires_at: Option<&str>) -> Expected {
        Expected::Grants(vec![TokenRecord {
            id: "t1".to_owned(),
            name: "test".to_owned(),
            hash: sha256_hex(TOKEN),
            prefix: "secret".to_owned(),
            permissions: permissions.to_vec(),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            expires_at: expires_at.map(str::to_owned),
            used_at: None,
            legacy: false,
        }])
    }

    fn answer(
        fixture: &Fixture,
        request: &LocalApiRequest,
        expected: &mut Expected,
        mcp: Option<&dyn McpRouter>,
    ) -> LocalApiResponse {
        let deps = RouteDeps {
            vault: &fixture.vault,
            query: None,
            save_artifact: None,
            mcp,
        };
        block_on(route_local_request(
            &deps, request, expected, NOW_MS, NOW_ISO,
        ))
    }

    fn filenames(body: &str) -> Vec<String> {
        let hits: Value = serde_json::from_str(body).expect("search json");
        hits.as_array()
            .expect("hits array")
            .iter()
            .map(|hit| hit["filename"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    #[test]
    fn no_token_is_refused_before_anything_is_read() {
        let fixture = Fixture::new("no-token");
        let mut req = request("GET", "/vault/notes/a.note.md", "");
        req.authorization = None;
        assert_eq!(answer(&fixture, &req, &mut single(), None).status, 401);
    }

    #[test]
    fn wrong_token_is_refused() {
        let fixture = Fixture::new("wrong-token");
        let mut req = request("GET", "/vault/notes/a.note.md", "");
        req.authorization = Some("Bearer nope".to_owned());
        assert_eq!(answer(&fixture, &req, &mut single(), None).status, 401);
    }

    #[test]
    fn file_is_served_as_markdown() {
        let fixture = Fixture::new("read");
        let res = answer(
            &fixture,
            &request("GET", "/vault/notes/a.note.md", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 200);
        assert_eq!(res.content_type, "text/markdown");
        assert!(res.body.contains("boiling water"));
    }

    #[test]
    fn missing_file_is_404_not_a_failure() {
        let fixture = Fixture::new("missing");
        let res = answer(
            &fixture,
            &request("GET", "/vault/notes/none.md", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 404);
    }

    #[test]
    fn path_that_leaves_the_folder_is_400() {
        let fixture = Fixture::new("leaves");
        let res = answer(
            &fixture,
            &request("GET", "/vault/..%2F..%2Fsecrets.txt", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 400);
    }

    #[test]
    fn malformed_percent_escape_is_400() {
        let fixture = Fixture::new("escape");
        let res = answer(
            &fixture,
            &request("GET", "/vault/%E0%A4", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 400);
    }

    #[test]
    fn fragment_and_query_are_not_part_of_the_path() {
        let fixture = Fixture::new("fragment");
        let res = answer(
            &fixture,
            &request("GET", "/vault/notes/a.note.md?x=1#top", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 200);
    }

    #[test]
    fn write_lands_in_the_folder() {
        let fixture = Fixture::new("write");
        let res = answer(
            &fixture,
            &request("PUT", "/vault/notes/c.note.md", "written from outside"),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 204);
        assert_eq!(
            block_on(cmd_vault::read(
                &fixture.vault,
                "notes/c.note.md".to_owned()
            )),
            Ok(Some("written from outside".to_owned()))
        );
    }

    #[test]
    fn delete_removes_one_file() {
        let fixture = Fixture::new("delete");
        let res = answer(
            &fixture,
            &request("DELETE", "/vault/notes/a.note.md", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 204);
        assert_eq!(
            block_on(cmd_vault::read(
                &fixture.vault,
                "notes/a.note.md".to_owned()
            )),
            Ok(None)
        );
    }

    #[test]
    fn directory_lists_what_is_in_it_marking_directories() {
        let fixture = Fixture::new("list");
        let res = answer(
            &fixture,
            &request("GET", "/vault/", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 200);
        let listed: Value = serde_json::from_str(&res.body).expect("list json");
        let files = listed["files"].as_array().expect("files array");
        assert!(
            files.iter().any(|f| f.as_str() == Some("notes/")),
            "{listed}"
        );
    }

    #[test]
    fn directory_is_not_written_to() {
        let fixture = Fixture::new("dir-put");
        let res = answer(
            &fixture,
            &request("PUT", "/vault/notes/", "x"),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 405);
    }

    #[test]
    fn file_method_other_than_get_put_delete_is_405() {
        let fixture = Fixture::new("file-post");
        let res = answer(
            &fixture,
            &request("POST", "/vault/notes/a.note.md", "x"),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 405);
        assert!(res.body.contains("That method is not served here."));
    }

    #[test]
    fn search_reports_files_and_lines_that_matched() {
        let fixture = Fixture::new("search");
        let res = answer(
            &fixture,
            &request("POST", "/search/simple/?query=kettle", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 200);
        assert_eq!(filenames(&res.body), vec!["notes/a.note.md".to_owned()]);
        let hits: Value = serde_json::from_str(&res.body).expect("search json");
        assert!(
            hits[0]["matches"][0]["context"]
                .as_str()
                .unwrap_or_default()
                .contains("Kettle")
        );
    }

    #[test]
    fn search_trims_the_query_and_refuses_a_blank_one() {
        let fixture = Fixture::new("search-trim");
        let padded = answer(
            &fixture,
            &request("POST", "/search/simple/?query=%20kettle%20", ""),
            &mut single(),
            None,
        );
        assert_eq!(padded.status, 200);
        assert_eq!(filenames(&padded.body), vec!["notes/a.note.md".to_owned()]);
        let blank = answer(
            &fixture,
            &request("POST", "/search/simple/?query=%20%20", ""),
            &mut single(),
            None,
        );
        assert_eq!(blank.status, 400);
    }

    #[test]
    fn search_by_get_is_not_served() {
        let fixture = Fixture::new("search-get");
        let res = answer(
            &fixture,
            &request("GET", "/search/simple/", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 404);
    }

    #[test]
    fn unserved_route_says_so() {
        let fixture = Fixture::new("unserved");
        let res = answer(
            &fixture,
            &request("GET", "/active/", ""),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 404);
    }

    #[test]
    fn mcp_is_behind_the_same_token() {
        let fixture = Fixture::new("mcp-token");
        let mut req = request("POST", "/mcp", "{}");
        req.authorization = None;
        assert_eq!(answer(&fixture, &req, &mut single(), None).status, 401);
    }

    #[test]
    fn mcp_is_post_only() {
        let fixture = Fixture::new("mcp-get");
        let res = answer(
            &fixture,
            &request("GET", "/mcp", ""),
            &mut single(),
            Some(&FakeMcp as &dyn McpRouter),
        );
        assert_eq!(res.status, 405);
    }

    #[test]
    fn mcp_bad_json_is_32700() {
        let fixture = Fixture::new("mcp-json");
        let res = answer(
            &fixture,
            &request("POST", "/mcp", "{"),
            &mut single(),
            Some(&FakeMcp as &dyn McpRouter),
        );
        assert_eq!(res.status, 400);
        let body: Value = serde_json::from_str(&res.body).expect("rpc json");
        assert_eq!(body["error"]["code"], -32700);
    }

    #[test]
    fn mcp_notification_is_202_with_no_body() {
        let fixture = Fixture::new("mcp-notify");
        let body = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
        let res = answer(
            &fixture,
            &request("POST", "/mcp", body),
            &mut single(),
            Some(&FakeMcp as &dyn McpRouter),
        );
        assert_eq!(res.status, 202);
        assert_eq!(res.body, "");
    }

    #[test]
    fn mcp_answer_is_passed_through_with_the_token_flags() {
        let fixture = Fixture::new("mcp-flags");
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let res = answer(
            &fixture,
            &request("POST", "/mcp", body),
            &mut single(),
            Some(&FakeMcp as &dyn McpRouter),
        );
        let answer: Value = serde_json::from_str(&res.body).expect("rpc json");
        assert_eq!(
            answer,
            json!({ "id": 1, "suggest": true, "tracking": true })
        );

        let mut read_only = grants(&[Permission::McpRead], None);
        let res = answer_with(&fixture, body, &mut read_only);
        let answer: Value = serde_json::from_str(&res.body).expect("rpc json");
        assert_eq!(
            answer,
            json!({ "id": 1, "suggest": false, "tracking": false })
        );
    }

    /// An MCP call made with the given token store, through the fake router.
    fn answer_with(fixture: &Fixture, body: &str, expected: &mut Expected) -> LocalApiResponse {
        answer(
            fixture,
            &request("POST", "/mcp", body),
            expected,
            Some(&FakeMcp as &dyn McpRouter),
        )
    }

    #[test]
    fn mcp_without_a_router_is_404() {
        let fixture = Fixture::new("mcp-none");
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let res = answer(
            &fixture,
            &request("POST", "/mcp", body),
            &mut single(),
            None,
        );
        assert_eq!(res.status, 404);
        assert!(res.body.contains("No such route."));
    }

    #[test]
    fn token_without_a_permission_gets_403_for_that_surface() {
        let fixture = Fixture::new("forbidden");
        let mut only = grants(&[Permission::Experiments], None);
        let file = answer(
            &fixture,
            &request("GET", "/vault/notes/a.note.md", ""),
            &mut only,
            None,
        );
        assert_eq!(file.status, 403);
        let search = answer(
            &fixture,
            &request("POST", "/search/simple/?query=tea", ""),
            &mut only,
            None,
        );
        assert_eq!(search.status, 403);
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let mcp = answer_with(&fixture, body, &mut only);
        assert_eq!(mcp.status, 403);
        assert!(mcp.body.contains("mcp:read"));
    }

    #[test]
    fn sdk_paths_need_experiments() {
        let fixture = Fixture::new("sdk");
        let res = answer(
            &fixture,
            &request("GET", "/api/sdk/anything", ""),
            &mut grants(&[Permission::RestRead], None),
            None,
        );
        assert_eq!(res.status, 403);
        assert!(res.body.contains("experiments"));
    }

    #[test]
    fn rest_read_does_not_allow_writes() {
        let fixture = Fixture::new("read-only");
        let mut read = grants(&[Permission::RestRead], None);
        let get = answer(
            &fixture,
            &request("GET", "/vault/notes/a.note.md", ""),
            &mut read,
            None,
        );
        assert_eq!(get.status, 200);
        let put = answer(
            &fixture,
            &request("PUT", "/vault/notes/a.note.md", "x"),
            &mut read,
            None,
        );
        assert_eq!(put.status, 403);
        assert!(put.body.contains("rest:write"));
    }

    #[test]
    fn expired_token_is_refused() {
        let fixture = Fixture::new("expired");
        let mut expired = grants(&[Permission::RestRead], Some("2000-01-01T00:00:00Z"));
        let res = answer(
            &fixture,
            &request("GET", "/vault/notes/a.note.md", ""),
            &mut expired,
            None,
        );
        assert_eq!(res.status, 401);
    }

    #[test]
    fn decode_keeps_plus_and_refuses_bad_escapes() {
        assert_eq!(decode_uri_component("a+b%2Fc"), Some("a+b/c".to_owned()));
        assert_eq!(decode_uri_component("%E0%A4"), None);
        assert_eq!(decode_uri_component("%zz"), None);
        assert_eq!(decode_uri_component("100%"), None);
    }

    #[test]
    fn query_values_read_plus_as_space() {
        assert_eq!(
            query_param("query=%20a+b&x=1", "query"),
            Some(" a b".to_owned())
        );
        assert_eq!(query_param("x=1", "query"), None);
        assert_eq!(query_param("q=%zz", "q"), Some("%zz".to_owned()));
    }

    #[test]
    fn split_target_drops_the_fragment() {
        assert_eq!(split_target("/a?b=1#c"), ("/a", "b=1"));
        assert_eq!(split_target("/a#x?y"), ("/a", ""));
    }
}

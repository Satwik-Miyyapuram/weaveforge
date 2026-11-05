//! The local HTTP API on 127.0.0.1:27123, ported from the Node sidecar (step 5.3).
//!
//! Route shapes follow `obsidian-local-rest-api`, plus the Python SDK routes under
//! `/api/sdk/` and MCP over POST `/mcp`. Every file access goes through the shell's
//! `VaultState`, so the network surface never gets its own way into the folder.
//!
//! Sources: `apps/shell/sidecar/src/local-api.ts`, `local-api-server.ts`,
//! `local-sdk-api.ts`, `local-mcp*.ts`.

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

pub mod connect;
pub mod control;
pub mod mcp;
mod mcp_call;
mod mcp_draft;
pub mod mcp_projects;
mod mcp_read;
mod mcp_suggest;
pub mod mcp_tools;
pub mod rewrite;
pub mod route;
pub mod sdk;
pub mod server;
pub mod token;

/// A boxed future, so the injected dependencies below stay object safe.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One request as the router sees it (the socket lives in `server`).
#[derive(Debug, Clone, Default)]
pub struct LocalApiRequest {
    /// HTTP method, e.g. GET.
    pub method: String,
    /// Path and query, as the client sent them.
    pub url: String,
    /// The `Authorization` header, verbatim.
    pub authorization: Option<String>,
    /// Request body as sent, empty when there is none.
    pub body: String,
}

/// One answer. `content_type` has no charset; the server adds `; charset=utf-8`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalApiResponse {
    /// HTTP status code.
    pub status: u16,
    /// MIME type, without charset.
    pub content_type: &'static str,
    /// Response body text.
    pub body: String,
}

impl LocalApiResponse {
    /// `application/json` with `value` as the body.
    #[must_use]
    pub fn json(status: u16, value: &Value) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: value.to_string(),
        }
    }

    /// The error shape every route uses: `{"errorCode": status, "message": message}`.
    #[must_use]
    pub fn fail(status: u16, message: &str) -> Self {
        Self::json(
            status,
            &serde_json::json!({ "errorCode": status, "message": message }),
        )
    }

    /// An empty answer, e.g. 204 after a write.
    #[must_use]
    pub fn empty(status: u16, content_type: &'static str) -> Self {
        Self {
            status,
            content_type,
            body: String::new(),
        }
    }
}

/// Runs SQL against the local database. `Err` carries a message for the log.
///
/// TS: `SdkQuery` in local-sdk-api.ts. Params are JSON scalars (string, number, bool, null).
pub trait SdkQuery: Send + Sync {
    /// Runs one SQL statement with JSON params.
    fn query<'a>(
        &'a self,
        sql: &'a str,
        params: Vec<Value>,
    ) -> BoxFuture<'a, Result<Vec<Value>, String>>;
}

/// Ranks candidate paths for a query in the page, or `None` when no ranker answered.
///
/// TS: `SemanticRanker` in local-mcp.ts.
pub trait SemanticRanker: Send + Sync {
    /// Ranks the candidate paths against the query.
    fn rank<'a>(
        &'a self,
        query: &'a str,
        candidates: Vec<String>,
    ) -> BoxFuture<'a, Option<Vec<String>>>;
}

/// Saves an experiment artifact and returns its `app://artifacts/...` URL.
///
/// TS: `SaveArtifact` in local-artifacts.ts.
pub trait SaveArtifact: Send + Sync {
    /// Stores the artifact bytes for the experiment.
    fn save<'a>(
        &'a self,
        experiment_id: &'a str,
        name: &'a str,
        bytes: Vec<u8>,
    ) -> BoxFuture<'a, Result<String, String>>;
}

/// Answers one parsed JSON-RPC message from POST `/mcp`; `None` for a notification (202).
///
/// TS: `routeMcpRequest` in local-mcp.ts. `tracking` is true when the token also has
/// `experiments`; `may_suggest` when it has `mcp:suggest`.
pub trait McpRouter: Send + Sync {
    /// Answers one parsed JSON-RPC message.
    fn route<'a>(
        &'a self,
        message: Value,
        may_suggest: bool,
        tracking: bool,
    ) -> BoxFuture<'a, Option<Value>>;
}

/// What a token may reach. TS: `LOCAL_API_PERMISSIONS`; serde names are the TS strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum Permission {
    /// May run the experiment-tracking routes.
    #[serde(rename = "experiments")]
    Experiments,
    /// May read notes over REST.
    #[serde(rename = "rest:read")]
    RestRead,
    /// May write notes over REST.
    #[serde(rename = "rest:write")]
    RestWrite,
    /// May read tools over MCP.
    #[serde(rename = "mcp:read")]
    McpRead,
    /// May leave suggestions over MCP.
    #[serde(rename = "mcp:suggest")]
    McpSuggest,
}

impl Permission {
    /// Every permission, in the TS order.
    pub const ALL: [Self; 5] = [
        Self::Experiments,
        Self::RestRead,
        Self::RestWrite,
        Self::McpRead,
        Self::McpSuggest,
    ];

    /// The TS string, e.g. `rest:read`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Experiments => "experiments",
            Self::RestRead => "rest:read",
            Self::RestWrite => "rest:write",
            Self::McpRead => "mcp:read",
            Self::McpSuggest => "mcp:suggest",
        }
    }
}

/// One stored token. TS: `LocalApiTokenRecord` (and `LocalApiGrant`), camelCase on disk.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenRecord {
    /// Random id of the token record.
    pub id: String,
    /// Name the user gave the token.
    pub name: String,
    /// sha256 hex of the token.
    pub hash: String,
    /// First 6 characters of the token, shown in Settings.
    pub prefix: String,
    /// What the token may reach.
    pub permissions: Vec<Permission>,
    /// ISO-8601.
    pub created_at: String,
    /// ISO-8601, or `None` for no expiry.
    pub expires_at: Option<String>,
    /// Epoch ms of the last request it authorised; in memory only.
    #[serde(skip)]
    pub used_at: Option<u64>,
    /// True for the record made from a pre-list bare token.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub legacy: bool,
}

/// What the server checks a bearer token against. TS: `string | readonly LocalApiGrant[]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expected {
    /// One token that grants everything.
    Single(String),
    /// Stored tokens, by hash.
    Grants(Vec<TokenRecord>),
}

/// Where Connect left the token, and the address the SDK should use. TS: `McpHome`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpHome {
    /// Base URL the SDK calls.
    pub api_url: String,
    /// Path of the file holding the token.
    pub token_file: String,
}

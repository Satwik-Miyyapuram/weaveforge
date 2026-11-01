//! Settings for the `/api/settings/*` routes, read once at startup.

/// What the settings routes need from the environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsConfig {
    /// False when `RELAY_MCP_ENABLED` is "false" or "0"; the MCP token routes then answer 404.
    pub mcp_enabled: bool,
    /// `OVERLEAF_CREDENTIAL_KEY`, the secret that seals stored credentials; None when unset.
    pub credential_key: Option<String>,
    /// `GITHUB_ISSUES_TOKEN`, the write-scoped token that files error reports; None when unset.
    pub issues_token: Option<String>,
    /// `GITHUB_ISSUES_REPO`, the `owner/name` that error reports are filed to.
    pub issues_repo: String,
    /// The GitHub API base for filing; fixed, so tests can point it at a stand-in.
    pub issues_api: String,
    /// The Zotero Web API base; fixed, so tests can point it at a stand-in.
    pub zotero_api: String,
    /// The Overleaf site base (with a trailing '/'); fixed, so tests can point it at a stand-in.
    pub overleaf_base: String,
    /// The first retry delay in ms for Overleaf calls (doubles, capped at 4x); 0 in tests.
    pub overleaf_retry_ms: u64,
}

/// The repository error reports go to when `GITHUB_ISSUES_REPO` is unset.
const DEFAULT_ISSUES_REPO: &str = "Satwik-Miyyapuram/weaveforge";
/// The GitHub API base; not read from the environment.
const ISSUES_API: &str = "https://api.github.com";
/// The Zotero Web API base; not read from the environment.
const ZOTERO_API: &str = "https://api.zotero.org";
/// The Overleaf site base; not read from the environment.
const OVERLEAF_BASE: &str = "https://www.overleaf.com/";
/// The first Overleaf retry delay, as the web uses.
const OVERLEAF_RETRY_MS: u64 = 1000;

impl Default for SettingsConfig {
    fn default() -> Self {
        Self {
            mcp_enabled: true,
            credential_key: None,
            issues_token: None,
            issues_repo: DEFAULT_ISSUES_REPO.to_owned(),
            issues_api: ISSUES_API.to_owned(),
            zotero_api: ZOTERO_API.to_owned(),
            overleaf_base: OVERLEAF_BASE.to_owned(),
            overleaf_retry_ms: OVERLEAF_RETRY_MS,
        }
    }
}

impl SettingsConfig {
    /// Reads the settings through `get`, an environment lookup.
    #[must_use]
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> SettingsConfig {
        let mcp = get("RELAY_MCP_ENABLED").map(|v| v.trim().to_ascii_lowercase());
        // Not trimmed: the web hashes the value exactly as set, so the key must match.
        let credential_key = get("OVERLEAF_CREDENTIAL_KEY").filter(|v| !v.is_empty());
        let issues_token = get("GITHUB_ISSUES_TOKEN")
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty());
        let issues_repo = get("GITHUB_ISSUES_REPO")
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_ISSUES_REPO.to_owned());
        SettingsConfig {
            mcp_enabled: !matches!(mcp.as_deref(), Some("false" | "0")),
            credential_key,
            issues_token,
            issues_repo,
            issues_api: ISSUES_API.to_owned(),
            zotero_api: ZOTERO_API.to_owned(),
            overleaf_base: OVERLEAF_BASE.to_owned(),
            overleaf_retry_ms: OVERLEAF_RETRY_MS,
        }
    }
}

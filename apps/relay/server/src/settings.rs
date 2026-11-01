//! Settings for the `/api/settings/*` routes, read once at startup.

/// What the settings routes need from the environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsConfig {
    /// False when `RELAY_MCP_ENABLED` is "false" or "0"; the MCP token routes then answer 404.
    pub mcp_enabled: bool,
    /// `OVERLEAF_CREDENTIAL_KEY`, the secret that seals stored credentials; None when unset.
    pub credential_key: Option<String>,
}

impl Default for SettingsConfig {
    fn default() -> Self {
        Self {
            mcp_enabled: true,
            credential_key: None,
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
        SettingsConfig {
            mcp_enabled: !matches!(mcp.as_deref(), Some("false" | "0")),
            credential_key,
        }
    }
}

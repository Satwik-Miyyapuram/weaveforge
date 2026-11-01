//! Startup configuration for the relay, read from environment variables.

use std::net::SocketAddr;

const DEFAULT_BIND: &str = "0.0.0.0:8787";

/// Relay settings resolved once at startup.
#[derive(Debug, Clone)]
pub struct Config {
    /// Supabase project URL, without a trailing slash.
    pub supabase_url: String,
    /// PostgREST root, without a trailing slash.
    pub data_url: String,
    /// Supabase anon key, sent as `apikey` on user lookups.
    pub anon_key: String,
    /// Supabase service-role key, used for server-side RPCs.
    pub service_role_key: String,
    /// HS256 secret for minting session tokens; absent disables API-token auth.
    pub jwt_secret: Option<String>,
    /// Origins allowed by CORS.
    pub allowed_origins: Vec<String>,
    /// Address the HTTP server listens on.
    pub bind: SocketAddr,
}

impl Config {
    /// Reads the config through `get`; errors name the variable that is missing or invalid.
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Result<Config, String> {
        let value = |name: &str| {
            get(name)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let required = |name: &str| value(name).ok_or_else(|| format!("{name} is required"));

        let supabase_url = trim_trailing_slashes(&required("NEXT_PUBLIC_SUPABASE_URL")?);
        let data_url = match value("NEXT_PUBLIC_DATA_URL") {
            Some(url) => trim_trailing_slashes(&url),
            None => format!("{supabase_url}/rest/v1"),
        };
        let anon_key = required("NEXT_PUBLIC_SUPABASE_ANON_KEY")?;
        let service_role_key = required("SUPABASE_SERVICE_ROLE_KEY")?;
        let jwt_secret = value("SUPABASE_JWT_SECRET");
        let allowed_origins: Vec<String> = value("RELAY_ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(str::to_string)
            .collect();
        let bind_text = value("RELAY_BIND").unwrap_or_else(|| DEFAULT_BIND.to_string());
        let bind = bind_text
            .parse::<SocketAddr>()
            .map_err(|_| "RELAY_BIND is not a valid socket address".to_string())?;

        Ok(Config {
            supabase_url,
            data_url,
            anon_key,
            service_role_key,
            jwt_secret,
            allowed_origins,
            bind,
        })
    }
}

fn trim_trailing_slashes(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

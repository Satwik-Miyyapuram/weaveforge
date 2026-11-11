//! Names the absent backend env vars for the server config message, ported from
//! `apps/web/src/backend/parts.ts` (`missingConfig` and `missingConfigMessage`).
//! Pure: names only, never values. The env reads stay in TypeScript.

use serde::{Deserialize, Serialize};

/// A backend config field that can be required, named as in the TypeScript `ConfigField`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "BackendConfigField"))]
#[serde(rename_all = "camelCase")]
pub enum ConfigField {
    /// Supabase Auth project URL.
    SupabaseUrl,
    /// Supabase Auth anon/public key.
    SupabaseAnonKey,
    /// Service role key (server routes only).
    SupabaseServiceRoleKey,
    /// JWT secret (server routes only).
    SupabaseJwtSecret,
    /// Server-only key for the Overleaf integration token.
    OverleafCredentialKey,
    /// Postgres connection string.
    DatabaseUrl,
}

impl ConfigField {
    /// The env var this field is read from. Names only; never a value.
    #[must_use]
    pub const fn env_var(self) -> &'static str {
        match self {
            Self::SupabaseUrl => "NEXT_PUBLIC_SUPABASE_URL",
            Self::SupabaseAnonKey => "NEXT_PUBLIC_SUPABASE_ANON_KEY",
            Self::SupabaseServiceRoleKey => "SUPABASE_SERVICE_ROLE_KEY",
            Self::SupabaseJwtSecret => "SUPABASE_JWT_SECRET",
            Self::OverleafCredentialKey => "OVERLEAF_CREDENTIAL_KEY",
            Self::DatabaseUrl => "DATABASE_URL",
        }
    }
}

/// The backend config values the message check reads. Other `BackendConfig`
/// keys in the JS object are ignored.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BackendConfigFields {
    /// Supabase Auth project URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub supabase_url: Option<String>,
    /// Supabase Auth anon/public key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub supabase_anon_key: Option<String>,
    /// Service role key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub supabase_service_role_key: Option<String>,
    /// JWT secret.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub supabase_jwt_secret: Option<String>,
    /// Overleaf credential encryption key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub overleaf_credential_key: Option<String>,
    /// Postgres connection string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub database_url: Option<String>,
}

impl BackendConfigFields {
    fn value(&self, field: ConfigField) -> &Option<String> {
        match field {
            ConfigField::SupabaseUrl => &self.supabase_url,
            ConfigField::SupabaseAnonKey => &self.supabase_anon_key,
            ConfigField::SupabaseServiceRoleKey => &self.supabase_service_role_key,
            ConfigField::SupabaseJwtSecret => &self.supabase_jwt_secret,
            ConfigField::OverleafCredentialKey => &self.overleaf_credential_key,
            ConfigField::DatabaseUrl => &self.database_url,
        }
    }

    /// True when the field is set and not empty (an empty string counts as absent).
    fn is_set(&self, field: ConfigField) -> bool {
        self.value(field).as_deref().is_some_and(|v| !v.is_empty())
    }
}

/// The message naming the required fields that are absent, in the order given,
/// or `None` when every required field is set. Names only, never values.
///
/// Worth the words: a variable scoped to Production only is invisible on Preview
/// deployments, so the message says which environment to set it for.
#[must_use]
pub fn missing_config_message(
    cfg: &BackendConfigFields,
    required: &[ConfigField],
) -> Option<String> {
    let missing: Vec<&str> = required
        .iter()
        .filter(|field| !cfg.is_set(**field))
        .map(|field| field.env_var())
        .collect();
    if missing.is_empty() {
        return None;
    }
    let these = if missing.len() > 1 { "these" } else { "this" };
    Some(format!(
        "Missing server config: {}. Set {these} for the environment this deployment runs in (a Production-only variable is absent on Preview builds), then redeploy.",
        missing.join(", "),
    ))
}

#[cfg(test)]
mod tests {
    use super::{BackendConfigFields, ConfigField, missing_config_message};

    const SECRET: &str = "super-secret-service-role-value";

    fn set_all() -> BackendConfigFields {
        BackendConfigFields {
            supabase_url: Some("https://example.supabase.co".into()),
            supabase_anon_key: Some("anon-key".into()),
            supabase_service_role_key: Some("service-key".into()),
            supabase_jwt_secret: Some("jwt".into()),
            overleaf_credential_key: Some("key".into()),
            database_url: Some("postgres://local".into()),
        }
    }

    #[test]
    fn names_the_absent_env_vars_and_not_the_present_ones() {
        let cfg = BackendConfigFields {
            supabase_url: Some("https://example.supabase.co".into()),
            supabase_anon_key: Some("anon-key".into()),
            ..BackendConfigFields::default()
        };
        let message = missing_config_message(
            &cfg,
            &[
                ConfigField::SupabaseUrl,
                ConfigField::SupabaseAnonKey,
                ConfigField::SupabaseServiceRoleKey,
            ],
        )
        .expect("one field is absent");
        assert!(message.contains("SUPABASE_SERVICE_ROLE_KEY"));
        assert!(
            !message.contains("NEXT_PUBLIC_SUPABASE_URL"),
            "present vars are not named"
        );
        assert!(message.starts_with("Missing server config: SUPABASE_SERVICE_ROLE_KEY. Set this "));
    }

    #[test]
    fn none_when_every_required_field_is_set() {
        let required = [
            ConfigField::SupabaseUrl,
            ConfigField::SupabaseAnonKey,
            ConfigField::SupabaseServiceRoleKey,
        ];
        assert_eq!(missing_config_message(&set_all(), &required), None);
    }

    #[test]
    fn none_when_nothing_is_required() {
        assert_eq!(
            missing_config_message(&BackendConfigFields::default(), &[]),
            None
        );
    }

    #[test]
    fn empty_string_counts_as_absent() {
        let cfg = BackendConfigFields {
            supabase_url: Some(String::new()),
            ..set_all()
        };
        let message =
            missing_config_message(&cfg, &[ConfigField::SupabaseUrl]).expect("empty is absent");
        assert_eq!(
            message,
            "Missing server config: NEXT_PUBLIC_SUPABASE_URL. Set this for the environment this deployment runs in (a Production-only variable is absent on Preview builds), then redeploy.",
        );
    }

    #[test]
    fn plural_lists_every_absent_name_in_required_order() {
        let cfg = BackendConfigFields {
            database_url: Some("postgres://local".into()),
            ..BackendConfigFields::default()
        };
        let message = missing_config_message(
            &cfg,
            &[
                ConfigField::DatabaseUrl,
                ConfigField::SupabaseJwtSecret,
                ConfigField::OverleafCredentialKey,
            ],
        )
        .expect("two fields are absent");
        assert_eq!(
            message,
            "Missing server config: SUPABASE_JWT_SECRET, OVERLEAF_CREDENTIAL_KEY. Set these for the environment this deployment runs in (a Production-only variable is absent on Preview builds), then redeploy.",
        );
    }

    #[test]
    fn never_echoes_a_secret_value() {
        let cfg = BackendConfigFields {
            supabase_url: Some("https://example.supabase.co".into()),
            supabase_service_role_key: Some(SECRET.into()),
            ..BackendConfigFields::default()
        };
        let message = missing_config_message(
            &cfg,
            &[
                ConfigField::SupabaseUrl,
                ConfigField::SupabaseAnonKey,
                ConfigField::SupabaseServiceRoleKey,
            ],
        )
        .expect("anon key is absent");
        assert!(message.contains("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
        assert!(
            !message.contains(SECRET),
            "secret value must never appear in the message"
        );
    }

    #[test]
    fn deserializes_camel_case_js_keys_and_ignores_extra_keys() {
        let json = r#"{"provider":"postgrest","supabaseUrl":"https://x","databaseUrl":null}"#;
        let cfg: BackendConfigFields = serde_json::from_str(json).expect("valid object");
        assert_eq!(cfg.supabase_url.as_deref(), Some("https://x"));
        assert_eq!(cfg.database_url, None);
        let message =
            missing_config_message(&cfg, &[ConfigField::DatabaseUrl]).expect("null is absent");
        assert!(message.contains("DATABASE_URL"));
    }
}

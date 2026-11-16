//! Blob storage settings read from the environment: the hot (R2) and cold tiers.
//! Ported from apps/web/src/storage/config.ts and providers/s3/s3-blob-store.ts.

use crate::s3::S3Target;

/// Blob storage settings, read once at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageConfig {
    /// True when the blob provider is "tiered".
    pub tiered: bool,
    /// Hot (R2) target, or the error naming the missing settings.
    pub hot: Result<S3Target, String>,
    /// Cold target; None means cold reads and writes go to hot.
    pub cold: Option<S3Target>,
    /// Secret for signing blob view tokens (BLOB_VIEW_SECRET).
    pub view_secret: Option<String>,
}

/// Reads a variable, trimmed; None when unset or blank.
fn value(get: &impl Fn(&str) -> Option<String>, name: &str) -> Option<String> {
    get(name)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

impl StorageConfig {
    /// Reads the storage settings through `get`, an environment lookup.
    #[must_use]
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> StorageConfig {
        let provider =
            value(&get, "NEXT_PUBLIC_BLOB_PROVIDER").or_else(|| value(&get, "BLOB_PROVIDER"));
        let tiered = provider.as_deref() == Some("tiered");

        let hot = match (
            value(&get, "R2_ACCOUNT_ID"),
            value(&get, "R2_ACCESS_KEY_ID"),
            value(&get, "R2_SECRET_ACCESS_KEY"),
            value(&get, "R2_BUCKET"),
        ) {
            (Some(account), Some(access_key_id), Some(secret_access_key), Some(bucket)) => {
                Ok(S3Target {
                    endpoint: format!("https://{account}.r2.cloudflarestorage.com"),
                    region: "auto".into(),
                    bucket,
                    access_key_id,
                    secret_access_key,
                })
            }
            (account, access_key, secret_key, bucket) => {
                let unset = [
                    ("R2_ACCOUNT_ID", account.is_none()),
                    ("R2_ACCESS_KEY_ID", access_key.is_none()),
                    ("R2_SECRET_ACCESS_KEY", secret_key.is_none()),
                    ("R2_BUCKET", bucket.is_none()),
                ];
                let missing: Vec<&str> = unset
                    .iter()
                    .filter_map(|(name, is_unset)| is_unset.then_some(*name))
                    .collect();
                Err(format!(
                    "Tiered storage is not configured: missing {}.",
                    missing.join(", ")
                ))
            }
        };

        let cold = match (
            value(&get, "BLOB_COLD_ENDPOINT"),
            value(&get, "BLOB_COLD_ACCESS_KEY_ID"),
            value(&get, "BLOB_COLD_SECRET_ACCESS_KEY"),
            value(&get, "BLOB_COLD_BUCKET"),
        ) {
            (Some(endpoint), Some(access_key_id), Some(secret_access_key), Some(bucket)) => {
                Some(S3Target {
                    endpoint: endpoint.trim_end_matches('/').to_string(),
                    region: "auto".into(),
                    bucket,
                    access_key_id,
                    secret_access_key,
                })
            }
            _ => None,
        };

        StorageConfig {
            tiered,
            hot,
            cold,
            view_secret: value(&get, "BLOB_VIEW_SECRET"),
        }
    }

    /// The target for a tier: cold when configured, otherwise hot.
    pub fn target_for(&self, tier: &str) -> Result<&S3Target, String> {
        match (tier, &self.cold) {
            ("cold", Some(cold)) => Ok(cold),
            _ => self.hot.as_ref().map_err(String::clone),
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self::from_env(|_| None)
    }
}

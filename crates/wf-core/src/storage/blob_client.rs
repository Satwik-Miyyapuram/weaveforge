//! S3-compatible client config for the R2 hot tier and the MinIO cold tier,
//! ported from `apps/web/src/storage/providers/s3/s3-blob-store.ts`. Pure: builds
//! the config only. The AWS client and the object I/O stay in TypeScript.

use serde::{Deserialize, Serialize};

/// Client settings for one S3-compatible bucket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BlobClientConfig {
    /// Physical bucket name.
    pub physical_bucket: String,
    /// Signing region (always "auto" for R2 and MinIO here).
    pub region: String,
    /// Access key id.
    pub access_key_id: String,
    /// Secret access key.
    pub secret_access_key: String,
    /// Endpoint URL.
    pub endpoint: String,
    /// Path-style addressing (required for R2 and MinIO here).
    pub force_path_style: bool,
}

/// R2 hot-tier fields, as read from env.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct R2Fields {
    /// Cloudflare account id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_account_id: Option<String>,
    /// R2 access key id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_access_key_id: Option<String>,
    /// R2 secret access key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_secret_access_key: Option<String>,
    /// R2 bucket name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_bucket: Option<String>,
}

/// Cold-tier fields, as read from env.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ColdFields {
    /// MinIO / OCI endpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_endpoint: Option<String>,
    /// Cold-tier access key id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_access_key_id: Option<String>,
    /// Cold-tier secret access key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_secret_access_key: Option<String>,
    /// Cold-tier bucket name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_bucket: Option<String>,
}

/// Reads one R2 field from [`R2Fields`].
type R2FieldGetter = fn(&R2Fields) -> &Option<String>;

/// Env var names for the R2 fields, in check order.
const R2_ENV_NAMES: [(&str, R2FieldGetter); 4] = [
    ("R2_ACCOUNT_ID", |f| &f.r2_account_id),
    ("R2_ACCESS_KEY_ID", |f| &f.r2_access_key_id),
    ("R2_SECRET_ACCESS_KEY", |f| &f.r2_secret_access_key),
    ("R2_BUCKET", |f| &f.r2_bucket),
];

/// True when the value is set and not empty.
fn present(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|v| !v.is_empty())
}

/// The message for R2 env vars that are unset or empty (names only, never values).
#[must_use]
pub fn missing_r2_config_message(fields: &R2Fields) -> String {
    let missing: Vec<&str> = R2_ENV_NAMES
        .iter()
        .filter(|(_, get)| !present(get(fields)))
        .map(|(name, _)| *name)
        .collect();
    let list = if missing.is_empty() {
        "none".to_owned()
    } else {
        missing.join(", ")
    };
    format!("Tiered storage is not configured: missing {list}.")
}

/// R2 hot-tier client config, or `None` when any R2 field is unset or empty.
#[must_use]
pub fn r2_blob_client_config(fields: &R2Fields) -> Option<BlobClientConfig> {
    let account = fields.r2_account_id.as_deref().filter(|v| !v.is_empty())?;
    let access_key = fields
        .r2_access_key_id
        .as_deref()
        .filter(|v| !v.is_empty())?;
    let secret = fields
        .r2_secret_access_key
        .as_deref()
        .filter(|v| !v.is_empty())?;
    let bucket = fields.r2_bucket.as_deref().filter(|v| !v.is_empty())?;
    Some(BlobClientConfig {
        physical_bucket: bucket.to_owned(),
        region: "auto".to_owned(),
        access_key_id: access_key.to_owned(),
        secret_access_key: secret.to_owned(),
        endpoint: format!("https://{account}.r2.cloudflarestorage.com"),
        force_path_style: true,
    })
}

/// Cold-tier (MinIO / OCI) client config, or `None` when any field is unset or empty.
#[must_use]
pub fn cold_blob_client_config(fields: &ColdFields) -> Option<BlobClientConfig> {
    let endpoint = fields.cold_endpoint.as_deref().filter(|v| !v.is_empty())?;
    let access_key = fields
        .cold_access_key_id
        .as_deref()
        .filter(|v| !v.is_empty())?;
    let secret = fields
        .cold_secret_access_key
        .as_deref()
        .filter(|v| !v.is_empty())?;
    let bucket = fields.cold_bucket.as_deref().filter(|v| !v.is_empty())?;
    Some(BlobClientConfig {
        physical_bucket: bucket.to_owned(),
        region: "auto".to_owned(),
        access_key_id: access_key.to_owned(),
        secret_access_key: secret.to_owned(),
        endpoint: endpoint.to_owned(),
        force_path_style: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_r2() -> R2Fields {
        R2Fields {
            r2_account_id: Some("acct".to_owned()),
            r2_access_key_id: Some("ak".to_owned()),
            r2_secret_access_key: Some("sk".to_owned()),
            r2_bucket: Some("hot".to_owned()),
        }
    }

    #[test]
    fn r2_config_builds_endpoint_and_path_style() {
        let c = r2_blob_client_config(&full_r2()).expect("complete");
        assert_eq!(c.endpoint, "https://acct.r2.cloudflarestorage.com");
        assert_eq!(c.region, "auto");
        assert_eq!(c.physical_bucket, "hot");
        assert!(c.force_path_style);
    }

    #[test]
    fn r2_config_none_when_any_field_empty() {
        let mut f = full_r2();
        f.r2_bucket = Some(String::new());
        assert!(r2_blob_client_config(&f).is_none());
        assert!(r2_blob_client_config(&R2Fields::default()).is_none());
    }

    #[test]
    fn missing_message_lists_names_only() {
        let mut f = full_r2();
        f.r2_secret_access_key = None;
        f.r2_bucket = Some(String::new());
        assert_eq!(
            missing_r2_config_message(&f),
            "Tiered storage is not configured: missing R2_SECRET_ACCESS_KEY, R2_BUCKET."
        );
        assert_eq!(
            missing_r2_config_message(&full_r2()),
            "Tiered storage is not configured: missing none."
        );
    }

    #[test]
    fn cold_config_uses_endpoint_as_given() {
        let f = ColdFields {
            cold_endpoint: Some("http://minio:9000".to_owned()),
            cold_access_key_id: Some("ak".to_owned()),
            cold_secret_access_key: Some("sk".to_owned()),
            cold_bucket: Some("cold".to_owned()),
        };
        let c = cold_blob_client_config(&f).expect("complete");
        assert_eq!(c.endpoint, "http://minio:9000");
        assert_eq!(c.physical_bucket, "cold");
        assert!(cold_blob_client_config(&ColdFields::default()).is_none());
    }
}

//! WeaveForge relay server: the outside fetches the web app cannot make from the
//! browser (PDFs, pages, arXiv, Semantic Scholar, pasted links, paper metadata),
//! served over HTTP on the OCI server behind Caddy at `/relay/*`. It also serves
//! the SDK and org API routes (`/api/sdk/*`, `/api/org/*`)
//! tiered blob storage (`/api/blobs/*`) and settings (`/api/settings/*`).

pub mod api_tokens;
pub mod auth;
pub mod blob_routes;
pub mod blob_store;
pub mod blob_token;
pub mod config;
pub mod credential_crypto;
pub mod credentials;
pub mod limiter;
pub mod org;
pub mod org_members;
pub mod org_routes;
pub mod plan_feed;
pub mod postgrest;
pub mod report_issue;
pub mod routes;
pub mod s3;
pub mod safe_error;
pub mod sdk;
pub mod sdk_artifacts;
pub mod sdk_metrics;
pub mod settings;
pub mod settings_routes;
pub mod storage;
pub mod url_meta;

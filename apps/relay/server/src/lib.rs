//! WeaveForge relay server: the outside fetches the web app cannot make from the
//! browser (PDFs, pages, arXiv, Semantic Scholar, pasted links, paper metadata),
//! served over HTTP on the OCI server behind Caddy at `/relay/*`. It also serves
//! the SDK and org API routes (`/api/sdk/*`, `/api/org/*`)
//! tiered blob storage (`/api/blobs/*`) settings (`/api/settings/*`),
//! account deletion (`/api/account/*`), admin user creation (`/api/admin/*`),
//! Overleaf links (`/api/overleaf/*`), Zotero collections and the MCP relay (`/api/mcp/*`).

pub mod account;
pub mod account_purge;
pub mod admin_users;
pub mod api_tokens;
pub mod auth;
pub mod blob_routes;
pub mod blob_store;
pub mod blob_token;
pub mod config;
pub mod credential_crypto;
pub mod credentials;
pub mod gotrue;
pub mod limiter;
pub mod mcp_relay;
pub mod org;
pub mod org_members;
pub mod org_routes;
pub mod overleaf_api;
pub mod overleaf_connections;
pub mod overleaf_reports;
pub mod overleaf_workshop;
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
pub mod zotero_collections;

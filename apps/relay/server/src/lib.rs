//! WeaveForge relay server: the outside fetches the web app cannot make from the
//! browser (PDFs, pages, arXiv, Semantic Scholar, pasted links, paper metadata),
//! served over HTTP on the OCI server behind Caddy at `/relay/*`. It also serves
//! the SDK API routes (`/api/sdk/*`).

pub mod auth;
pub mod config;
pub mod limiter;
pub mod postgrest;
pub mod routes;
pub mod safe_error;
pub mod sdk;
pub mod sdk_metrics;
pub mod url_meta;

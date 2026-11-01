//! WeaveForge relay server: the outside fetches the web app cannot make from the
//! browser (PDFs, pages, arXiv, Semantic Scholar, pasted links, paper metadata),
//! served over HTTP on the OCI server behind Caddy at `/relay/*`.

pub mod auth;
pub mod config;
pub mod limiter;
pub mod routes;
pub mod url_meta;

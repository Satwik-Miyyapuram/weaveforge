//! The shell's integration tests, in one binary: each test binary links Tauri,
//! about 100 MB of debug info apiece. Run one file's tests with
//! `cargo test --test shell <file>::`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]

mod common;
#[path = "common/upstream.rs"]
mod upstream;

mod app_log;
mod app_route;
mod app_storage;
mod auth_loopback;
mod cmd_ink;
mod cmd_tools;
mod cmd_vault;
mod commands;
mod git;
mod ink;
mod launch;
mod local_artifacts;
mod mattermost;
mod menu;
mod model_cache;
mod overleaf_links;
mod overleaf_read;
mod plan_widget;
mod prefs;
mod protocol_range;
mod range;
mod secrets;
mod sidecar;
mod temp_dir;
mod tex;
mod update_check;
mod vault;
mod vault_choice;
mod vault_search;
mod vault_sync;
mod vault_watch;
mod vault_watcher;
mod zotero_local;

//! Storage and sync rules (phase 3): merges, body diffs, change detection,
//! frontmatter and the workspace folder layout. Each module matches the
//! TypeScript it replaces in `packages/core/src/{shared,workspace}`; the table
//! tests in `tests/sync_*.rs` keep the cases that TypeScript printed.

pub mod blob_links;
pub mod change_origin;
pub mod deserialize;
pub mod entity_file;
pub mod folder_layout;
pub mod folder_merge;
pub mod folder_mirror;
pub mod frontmatter;
pub mod git_api;
pub mod git_gate;
pub mod git_policy;
pub mod git_reason;
pub mod git_remote;
pub mod gitlab_log_file;
pub mod import_action;
pub mod ink_note;
pub mod instant;
pub mod integration_fields;
pub mod integration_store;
pub mod json_entities;
pub mod local_identity;
pub mod markdown_image;
pub mod mattermost_messages;
pub mod mattermost_options;
pub mod mattermost_post;
pub mod memory_fs;
pub mod merge;
pub mod merge_vault_page;
pub mod migrated_notice;
pub mod panel_labels;
pub mod pglite_sql;
pub mod project_pick;
pub mod pump_route;
pub mod repo_web_url;
pub mod send_verdict;
pub mod serialize;
pub mod snapshot_delta;
pub mod stamp_workspace_id;
pub mod sync_dot;
pub mod text_diff;
pub mod text_merge;
pub mod workspace_fs;
pub mod workspace_snapshot;

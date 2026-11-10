//! Storage and sync rules (phase 3): merges, body diffs, change detection,
//! frontmatter and the workspace folder layout. Each module matches the
//! TypeScript it replaces in `packages/core/src/{shared,workspace}`; goldens
//! in `tests/goldens/sync-*.json` were printed by that TypeScript.

pub mod blob_links;
pub mod change_origin;
pub mod conflict_deletion;
pub mod conflict_resolve;
pub mod conflict_route;
pub mod conflict_settle;
pub mod deserialize;
pub mod device_session;
pub mod folder_layout;
pub mod folder_merge;
pub mod folder_mirror;
pub mod frontmatter;
pub mod git_gate;
pub mod git_policy;
pub mod git_reason;
pub mod git_remote;
pub mod import_action;
pub mod ink_note;
pub mod instant;
pub mod integration_fields;
pub mod json_entities;
pub mod local_first_route;
pub mod markdown_image;
pub mod mattermost_messages;
pub mod mattermost_options;
pub mod memory_fs;
pub mod merge;
pub mod merge_vault_page;
pub mod migrated_notice;
pub mod outbox_sides;
pub mod panel_labels;
pub mod pglite_sql;
pub mod postgrest_wire;
pub mod project_pick;
pub mod repo_web_url;
pub mod serialize;
pub mod snapshot_delta;
pub mod sql_ident;
pub mod stamp_workspace_id;
pub mod sync_dot;
pub mod text_diff;
pub mod workspace_fs;
pub mod workspace_snapshot;

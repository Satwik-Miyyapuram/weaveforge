//! Storage and sync rules (phase 3): merges, body diffs, change detection,
//! frontmatter and the workspace folder layout. Each module matches the
//! TypeScript it replaces in `packages/core/src/{shared,workspace}`; goldens
//! in `tests/goldens/sync-*.json` were printed by that TypeScript.

pub mod blob_links;
pub mod change_origin;
pub mod deserialize;
pub mod folder_layout;
pub mod folder_mirror;
pub mod frontmatter;
pub mod git_gate;
pub mod git_policy;
pub mod git_remote;
pub mod import_action;
pub mod ink_note;
pub mod instant;
pub mod json_entities;
pub mod markdown_image;
pub mod memory_fs;
pub mod merge;
pub mod merge_vault_page;
pub mod serialize;
pub mod snapshot_delta;
pub mod stamp_workspace_id;
pub mod text_diff;
pub mod workspace_fs;
pub mod workspace_snapshot;

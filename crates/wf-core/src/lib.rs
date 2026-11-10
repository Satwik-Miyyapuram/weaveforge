//! WeaveForge core: pure logic shared by every shell (desktop, phone, browser via WASM). No I/O.
#![forbid(unsafe_code)]

pub mod ai;
pub mod auth_transition;
pub mod cache_invalidation;
pub mod card_snippet;
pub mod collab;
pub mod dashboard;
pub mod editor_workspace;
pub mod error_report;
pub mod experiment_artifacts;
pub mod experiment_status;
pub mod experiments;
pub mod heading_slug;
pub mod ink;
pub mod integrations;
pub mod js_collate;
pub mod lab_snapshot;
pub mod latex_section_tree;
pub mod logbook;
pub mod markdown_figure_alt;
pub mod markdown_image_refs;
pub mod markdown_image_width;
pub mod markdown_mermaid_labels;
pub mod mcp;
pub mod member;
pub mod net;
pub mod org;
pub mod overleaf;
pub mod overleaf_workshop;
pub mod palette_groups;
pub mod palette_sort;
pub mod papers;
pub mod paste;
pub mod plan;
pub mod projects;
pub mod reader;
pub mod reader_analysis;
pub mod reading_lists;
pub mod relations;
pub mod report;
pub mod search;
mod serde_util;
pub mod settings;
pub mod sharing;
pub mod storage;
pub mod sync;
pub mod tag_tone;
pub mod text;
pub mod text_anchor;
pub mod tree;
pub mod units;
pub mod vault;
pub mod workspace;
pub mod zotero;

/// Version of this core build, taken from Cargo at compile time.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Facts about this core build that every shell can show.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CoreInfo {
    /// Semver version of the core crate.
    pub version: String,
}

/// Describe this core build.
#[must_use]
pub fn core_info() -> CoreInfo {
    CoreInfo {
        version: version().to_owned(),
    }
}
pub mod account_links;
pub mod account_menu;
pub mod app_log_line;
pub mod backend_config;
pub mod enum_label;
pub mod experiment_rows;
pub mod export_files;
pub mod figure_label;
pub mod home_config;
pub mod lab_snapshot_rows;
pub mod library_pin_rows;
pub mod library_pins;
pub mod mcp_client_config;
pub mod mcp_config_rewrite;
pub mod member_rows;
pub mod membership_row;
pub mod metric_chart_data;
pub mod metric_rows;
pub mod nav_open_groups;
pub mod overleaf_export_package;
pub mod overleaf_link;
pub mod overleaf_tree;
pub mod paper_note;
pub mod plan_widget;
pub mod plot_size;
pub mod privacy_disclaimer_readiness;
pub mod project_row;
pub mod proposal_created_page;
pub mod proposal_groups;
pub mod rail_group_text;
pub mod route_title;
pub mod screen_for_path;
pub mod semantic_status_text;
pub mod shortcut_label;
pub mod sync_fields;
pub mod tag_counts;
pub mod tag_row;
pub mod tex_log;
pub mod tex_path;
pub mod update_check;
pub mod zotero_local_url;

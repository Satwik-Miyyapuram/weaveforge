//! WeaveForge core: pure logic shared by every shell (desktop, phone, browser via WASM). No I/O.
#![forbid(unsafe_code)]

pub mod ai;
pub mod cache_invalidation;
pub mod card_snippet;
pub mod collab;
pub mod dashboard;
pub mod editor_workspace;
pub mod error_report;
pub mod experiment_status;
pub mod experiments;
pub mod heading_slug;
pub mod ink;
pub mod js_collate;
pub mod lab_snapshot;
pub mod latex_section_tree;
pub mod logbook;
pub mod markdown_figure_alt;
pub mod markdown_image_refs;
pub mod markdown_image_width;
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

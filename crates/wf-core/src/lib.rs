//! WeaveForge core: pure logic shared by every shell (desktop, phone, browser via WASM). No I/O.
#![forbid(unsafe_code)]

pub mod error_report;
pub mod experiments;
pub mod ink;
pub mod latex_section_tree;
pub mod mcp;
pub mod member;
pub mod org;
pub mod overleaf;
pub mod overleaf_workshop;
pub mod papers;
pub mod paste;
pub mod plan;
pub mod reader;
pub mod reader_analysis;
pub mod search;
pub mod storage;
pub mod sync;
pub mod units;
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

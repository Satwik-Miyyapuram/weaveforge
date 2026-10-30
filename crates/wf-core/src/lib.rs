//! WeaveForge core: pure logic shared by every shell (desktop, phone, browser via WASM). No I/O.
#![forbid(unsafe_code)]

pub mod search;
pub mod units;
pub mod workspace;

/// Version of this core build, taken from Cargo at compile time.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Facts about this core build that every shell can show.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
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

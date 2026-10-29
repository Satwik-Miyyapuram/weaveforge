//! WeaveForge core: pure logic shared by every shell (desktop, phone, browser via WASM). No I/O.
#![forbid(unsafe_code)]

/// Version of this core build, taken from Cargo at compile time.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

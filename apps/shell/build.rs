//! Generates the Tauri context (config, icons) at build time, bundles the bridge script into
//! `OUT_DIR/shim.gen.js` (see `src/shim.rs`), and gives Windows test binaries the Common Controls v6
//! manifest that Tauri links against (bins get it from Tauri's own resource).

use std::error::Error;
use std::process::Command;

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=windows-test.manifest");
    bundle_bridge()?;
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|v| v == "msvc");
    if msvc && let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") {
        // Reaches integration tests (tests/*.rs) only, not lib unit tests: keep tests that load tauri in tests/.
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{dir}\\windows-test.manifest");
    }
    tauri_build::build();
    Ok(())
}

/// Runs `bridge/build-shim.mjs` (esbuild, from the repo's `node_modules`, so `npm ci` comes first).
/// Every runtime import of `bridge/inject.ts` lives in `bridge/`, so watching that folder is enough.
fn bundle_bridge() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=bridge");
    let out = std::path::Path::new(&std::env::var("OUT_DIR")?).join("shim.gen.js");
    let status = Command::new("node")
        .arg("bridge/build-shim.mjs")
        .arg(&out)
        .status()
        .map_err(|e| format!("node must be on PATH to bundle the bridge: {e}"))?;
    if !status.success() {
        return Err("bridge/build-shim.mjs failed; run `npm ci` at the repo root first".into());
    }
    Ok(())
}

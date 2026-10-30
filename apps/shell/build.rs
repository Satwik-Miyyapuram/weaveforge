//! Generates the Tauri context (config, icons) at build time, and gives Windows test binaries the
//! Common Controls v6 manifest that Tauri links against (bins get it from Tauri's own resource).

fn main() {
    println!("cargo:rerun-if-changed=windows-test.manifest");
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|v| v == "msvc");
    if msvc && let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{dir}\\windows-test.manifest");
    }
    tauri_build::build();
}

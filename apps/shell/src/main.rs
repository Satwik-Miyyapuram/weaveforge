//! WeaveForge desktop shell entry point.

// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    // MCP clients start the app with `--mcp-bridge`: answer them on stdio, open no window.
    if std::env::args().skip(1).any(|a| a == "--mcp-bridge") {
        let home = std::env::home_dir().unwrap_or_default();
        let code = weaveforge_shell_lib::mcp_bridge::run_stdio(home);
        return std::process::ExitCode::from(u8::try_from(code).unwrap_or(1));
    }
    match weaveforge_shell_lib::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("weaveforge: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

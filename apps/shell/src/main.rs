//! WeaveForge desktop shell entry point.

// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    match weaveforge_shell::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("weaveforge: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

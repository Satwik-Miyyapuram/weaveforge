//! `cargo run -p wf-bindings` writes the bindings; `-- --check` fails if the file is stale.

use std::path::PathBuf;
use std::process::ExitCode;

use wf_bindings::{Mode, OUTPUT, is_fresh, parse_mode, write};

fn output_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(OUTPUT)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(mode) = parse_mode(&args) else {
        eprintln!("usage: wf-bindings [--check]");
        return ExitCode::FAILURE;
    };
    let path = output_path();
    let result = match mode {
        Mode::Write => write(&path).map(|()| true),
        Mode::Check => is_fresh(&path),
    };
    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => {
            eprintln!("{OUTPUT} is stale. Run `npm run bindings` and commit it.");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("wf-bindings: {e}");
            ExitCode::FAILURE
        }
    }
}

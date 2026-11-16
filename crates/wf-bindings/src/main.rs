//! `cargo run -p wf-bindings` (`npm run bindings`) writes the bindings; `npm run generate` runs it.

use std::path::PathBuf;
use std::process::ExitCode;

use wf_bindings::{OUTPUT, write};

fn output_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(OUTPUT)
}

fn main() -> ExitCode {
    if std::env::args().len() > 1 {
        eprintln!("usage: wf-bindings");
        return ExitCode::FAILURE;
    }
    match write(&output_path()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("wf-bindings: {e}");
            ExitCode::FAILURE
        }
    }
}

//! `cargo run -p wf-bindings` writes the bindings; `-- --check` fails if the file is stale.

use std::path::PathBuf;
use std::process::ExitCode;

use wf_bindings::{BindingsError, OUTPUT, render};

fn output_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(OUTPUT)
}

fn run(check: bool) -> Result<bool, BindingsError> {
    let path = output_path();
    let fresh = render()?;
    if check {
        let current = std::fs::read_to_string(&path).unwrap_or_default();
        return Ok(current == fresh);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|source| BindingsError::Io {
            path: dir.to_path_buf(),
            source,
        })?;
    }
    std::fs::write(&path, fresh).map_err(|source| BindingsError::Io {
        path: path.clone(),
        source,
    })?;
    Ok(true)
}

fn main() -> ExitCode {
    let check = std::env::args().skip(1).any(|a| a == "--check");
    match run(check) {
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

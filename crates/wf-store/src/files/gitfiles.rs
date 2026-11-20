//! Keeps the workspace `.gitignore` and `.gitattributes` holding the lines WeaveForge needs.
//!
//! Append-only: existing content is never rewritten or reordered.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// Lines WeaveForge keeps in `.gitignore`: local caches, trash and temp files.
pub const GITIGNORE_LINES: &[&str] = &[
    ".weaveforge/cache/",
    ".weaveforge/local/",
    ".weaveforge/trash/",
    ".weaveforge/tables/",
    ".weaveforge/migration-0.9.4/",
    "*.wftmp",
    "*.wfprev",
];

/// Lines WeaveForge keeps in `.gitattributes`: line endings and binary types.
pub const GITATTRIBUTES_LINES: &[&str] = &[
    "*.md text eol=lf",
    "*.json text eol=lf",
    "*.csv text eol=lf",
    "*.canvas text eol=lf",
    "*.inkb binary",
    "*.pdf binary",
];

/// How many lines [`ensure_gitfiles`] appended to each file.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct GitFilesReport {
    /// Lines added to `.gitignore`.
    pub gitignore_added: usize,
    /// Lines added to `.gitattributes`.
    pub gitattributes_added: usize,
}

/// Make sure the workspace at `root` has every WeaveForge line in its git files.
pub fn ensure_gitfiles(root: &Path) -> io::Result<GitFilesReport> {
    Ok(GitFilesReport {
        gitignore_added: ensure_file(&root.join(".gitignore"), GITIGNORE_LINES)?,
        gitattributes_added: ensure_file(&root.join(".gitattributes"), GITATTRIBUTES_LINES)?,
    })
}

/// The wanted lines that no existing line matches. A line matches when trimmed it equals
/// the wanted one, with any leading `/` ignored on both sides.
#[must_use]
pub fn missing_lines(existing: &str, wanted: &[&str]) -> Vec<String> {
    let present: HashSet<&str> = existing
        .lines()
        .map(|line| line.trim().trim_start_matches('/'))
        .collect();
    wanted
        .iter()
        .filter(|line| !present.contains(line.trim_start_matches('/')))
        .map(|line| (*line).to_owned())
        .collect()
}

/// Append the missing `wanted` lines to the file at `path`, creating it if absent.
/// Returns how many lines were added; writes nothing when none are missing.
fn ensure_file(path: &Path, wanted: &[&str]) -> io::Result<usize> {
    let existing = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err),
    };
    let missing = missing_lines(&existing, wanted);
    if missing.is_empty() {
        return Ok(0);
    }
    let mut block = String::new();
    if !existing.is_empty() && !existing.ends_with('\n') {
        block.push('\n');
    }
    for line in &missing {
        block.push_str(line);
        block.push('\n');
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(block.as_bytes())?;
    Ok(missing.len())
}

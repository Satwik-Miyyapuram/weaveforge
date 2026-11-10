//! Reads git's own text output for the vault mirror (port of the pure parsers in
//! `apps/shell/sidecar/src/vault-git.ts`). Running git and reading its stdout stay in TypeScript.

use serde::Serialize;

/// Git's separator between the fields of one `git log` line.
const FIELD_SEPARATOR: char = '\u{1f}';

/// Command lines are batched to stay under this many UTF-16 units (Windows caps near 32k characters).
pub const PATH_CHUNK_MAX_UNITS: usize = 8000;

/// The three states the vault reports for a changed file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileState {
    /// Removed from the working tree.
    Deleted,
    /// New, or not yet tracked.
    Added,
    /// Changed in place.
    Modified,
}

/// One changed path from `git status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileStatus {
    /// Path relative to the repository root.
    pub path: String,
    /// The reduced state.
    pub state: FileState,
}

/// One commit from `git log` with the vault's field separator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogCommit {
    /// Full commit id.
    pub oid: String,
    /// Author date as git prints it.
    pub authored_at: String,
    /// Author name.
    pub author: String,
    /// Subject and body, rejoined with the separator.
    pub message: String,
}

/// Porcelain v1 status (`git status --porcelain -z`), reduced to three states.
///
/// A rename or copy record is followed by a second record holding the original
/// path, which is skipped. Records shorter than a status code and a path are dropped.
#[must_use]
pub fn parse_status(stdout: &str) -> Vec<FileStatus> {
    let records: Vec<&str> = stdout.split('\0').collect();
    let mut out = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let units: Vec<u16> = records[index].encode_utf16().collect();
        if units.len() >= 4 {
            let code = String::from_utf16_lossy(&units[..2]);
            let path = String::from_utf16_lossy(&units[3..]);
            if code.contains(['R', 'C']) {
                index += 1;
            }
            let state = if code.contains('D') {
                FileState::Deleted
            } else if code.contains(['?', 'A']) {
                FileState::Added
            } else {
                FileState::Modified
            };
            out.push(FileStatus { path, state });
        }
        index += 1;
    }
    out
}

/// Commits from `git log` with fields split on the unit separator.
///
/// Blank lines are skipped, as are lines without an id, an authored date, or an author field.
/// The message is whatever follows the third separator, rejoined.
#[must_use]
pub fn parse_log(stdout: &str) -> Vec<LogCommit> {
    let mut out = Vec::new();
    for line in stdout.split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        let mut fields = line.split(FIELD_SEPARATOR);
        let oid = fields.next().unwrap_or("");
        let authored_at = fields.next().unwrap_or("");
        let Some(author) = fields.next() else {
            continue;
        };
        if oid.is_empty() || authored_at.is_empty() {
            continue;
        }
        let message = fields
            .collect::<Vec<_>>()
            .join(&FIELD_SEPARATOR.to_string());
        out.push(LogCommit {
            oid: oid.to_owned(),
            authored_at: authored_at.to_owned(),
            author: author.to_owned(),
            message,
        });
    }
    out
}

/// Paths git lists under a "would be overwritten" line, each indented by a tab.
#[must_use]
pub fn overwritten_files(output: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut listing = false;
    for line in output.lines() {
        if line.contains("would be overwritten") {
            listing = true;
        } else if listing && line.starts_with('\t') {
            files.push(line.trim().to_owned());
        } else {
            listing = false;
        }
    }
    files
}

/// The non-empty entries of a NUL-separated git listing (`-z` output).
#[must_use]
pub fn nul_list(stdout: &str) -> Vec<String> {
    stdout
        .split('\0')
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Batches of paths, each batch's total (plus one separator per path) at most `max_units` UTF-16 units.
///
/// A single path longer than `max_units` still goes in a batch of its own.
#[must_use]
pub fn path_chunks(paths: &[String], max_units: usize) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut size = 0usize;
    for path in paths {
        let units = path.encode_utf16().count();
        if !current.is_empty() && size + units > max_units {
            out.push(std::mem::take(&mut current));
            size = 0;
        }
        current.push(path.clone());
        size += units + 1;
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_codes_reduce_to_three_states() {
        let out = parse_status(" M a.md\0A  b.md\0?? c.md\0 D d.md\0");
        assert_eq!(
            out,
            vec![
                FileStatus {
                    path: "a.md".into(),
                    state: FileState::Modified
                },
                FileStatus {
                    path: "b.md".into(),
                    state: FileState::Added
                },
                FileStatus {
                    path: "c.md".into(),
                    state: FileState::Added
                },
                FileStatus {
                    path: "d.md".into(),
                    state: FileState::Deleted
                },
            ]
        );
    }

    #[test]
    fn a_rename_skips_its_original_path_record() {
        let out = parse_status("R  new.md\0old.md\0 M keep.md\0");
        assert_eq!(
            out,
            vec![
                FileStatus {
                    path: "new.md".into(),
                    state: FileState::Modified
                },
                FileStatus {
                    path: "keep.md".into(),
                    state: FileState::Modified
                },
            ]
        );
    }

    #[test]
    fn short_records_are_dropped() {
        assert!(parse_status("M\0 M\0").is_empty());
    }

    #[test]
    fn log_lines_split_on_the_unit_separator() {
        let line = "abc\u{1f}2026-01-02\u{1f}Ada\u{1f}subject\u{1f}body\n";
        assert_eq!(
            parse_log(line),
            vec![LogCommit {
                oid: "abc".into(),
                authored_at: "2026-01-02".into(),
                author: "Ada".into(),
                message: "subject\u{1f}body".into(),
            }]
        );
    }

    #[test]
    fn log_skips_blank_and_incomplete_lines() {
        assert!(parse_log("\n   \nabc\u{1f}date\n\u{1f}d\u{1f}a\u{1f}m\n").is_empty());
    }

    #[test]
    fn log_keeps_an_empty_author_and_message() {
        let out = parse_log("abc\u{1f}date\u{1f}\u{1f}");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].author, "");
        assert_eq!(out[0].message, "");
    }

    #[test]
    fn overwritten_listing_is_the_tab_indented_lines_after_the_warning() {
        let output = "error: The following untracked working tree files would be overwritten by merge:\n\ta.md\n\tdir/b.md\nPlease move or remove them\n\tnot-listed.md\n";
        assert_eq!(overwritten_files(output), vec!["a.md", "dir/b.md"]);
    }

    #[test]
    fn overwritten_listing_handles_crlf() {
        let output = "would be overwritten:\r\n\ta.md\r\n";
        assert_eq!(overwritten_files(output), vec!["a.md"]);
    }

    #[test]
    fn nul_list_drops_empty_entries() {
        assert_eq!(nul_list("a\0\0b\0"), vec!["a", "b"]);
        assert!(nul_list("").is_empty());
    }

    #[test]
    fn chunks_split_when_the_budget_is_reached() {
        let paths: Vec<String> = ["aaaa", "bbbb", "cc"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        // As in TS, a path's own length is checked, not its separator: "aaaa" costs 5,
        // 5 + 4 = 9 fits, then "cc" (10 + 2 > 9) starts a new batch.
        assert_eq!(
            path_chunks(&paths, 9),
            vec![
                vec!["aaaa".to_owned(), "bbbb".to_owned()],
                vec!["cc".to_owned()]
            ]
        );
    }

    #[test]
    fn an_oversized_path_gets_a_batch_of_its_own() {
        let paths = vec!["x".repeat(20), "y".to_owned()];
        assert_eq!(
            path_chunks(&paths, 5),
            vec![vec!["x".repeat(20)], vec!["y".to_owned()]]
        );
    }

    #[test]
    fn chunk_budget_counts_utf16_units() {
        // One astral character is two UTF-16 units, as in the JS `length`.
        let paths = vec!["\u{1F600}".to_owned(), "a".to_owned()];
        assert_eq!(path_chunks(&paths, 3).len(), 2);
        assert_eq!(path_chunks(&paths, 4).len(), 1);
    }

    #[test]
    fn no_paths_no_chunks() {
        assert!(path_chunks(&[], PATH_CHUNK_MAX_UNITS).is_empty());
    }
}

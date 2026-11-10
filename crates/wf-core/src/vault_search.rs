//! Rules for the vault folder: what a search reads and how a hit is cut (TS `apps/shell/sidecar/src/vault-search.ts`),
//! the folder verdict and nested-folder choice (TS `vault-folder.ts`), and the staged-write name. The walk, the
//! reads, the realpath containment and the mkdir stay in TypeScript.

/// How much of a matching line comes back with each hit (TS `CONTEXT`), in UTF-16 code units as JS slices.
pub const CONTEXT_UNITS: usize = 120;
/// Matches kept per file before the search moves on (TS `matches.length >= 5`).
pub const MAX_MATCHES_PER_FILE: usize = 5;
/// Suffix of a write staged beside its target (TS `TEMP_SUFFIX`).
pub const TEMP_SUFFIX: &str = ".wftmp";

/// Whether the search reads this file: a markdown file, by its exact lowercase extension (TS `endsWith(".md")`).
#[must_use]
pub fn is_search_file(path: &str) -> bool {
    path.ends_with(".md")
}

/// Whether the walk skips this directory: its last segment starts with a dot, so `.git` does not spend the cap.
#[must_use]
pub fn is_skipped_dir(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|last| last.starts_with('.'))
}

/// The lines of `text` that contain `query` ignoring case, each cut to [`CONTEXT_UNITS`], at most
/// [`MAX_MATCHES_PER_FILE`]. Lines split on `\n`, and a `\r` before a `\n` is dropped (TS `split(/\r?\n/)`).
#[must_use]
pub fn search_matches(text: &str, query: &str) -> Vec<String> {
    let needle = query.to_lowercase();
    let lines: Vec<&str> = text.split('\n').collect();
    let last = lines.len().saturating_sub(1);
    lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            if index < last {
                line.strip_suffix('\r').unwrap_or(line)
            } else {
                line
            }
        })
        .filter(|line| line.to_lowercase().contains(&needle))
        .take(MAX_MATCHES_PER_FILE)
        .map(context)
        .collect()
}

/// The first [`CONTEXT_UNITS`] UTF-16 code units of `line`, as JS `slice(0, 120)` gives them.
fn context(line: &str) -> String {
    let units: Vec<u16> = line.encode_utf16().take(CONTEXT_UNITS).collect();
    String::from_utf16_lossy(&units)
}

/// What a chosen folder may be used for (TS `verifyRoot`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootVerdict {
    /// Empty of anything but dotfiles: a new workspace can go here.
    Empty,
    /// Already holds the workspace mark: an existing workspace.
    Existing,
    /// Not a directory (or not there at all).
    NotADirectory,
    /// Holds someone else's files: refused strictly, nested when chosen.
    NotEmpty,
}

/// Decide a folder's verdict from what is known about it: whether it is a directory, the names directly
/// inside it, and the workspace mark (`meta_dir`, TS `WORKSPACE_META_DIR`). Dotfiles never count as files.
#[must_use]
pub fn root_verdict(is_dir: bool, entries: &[&str], meta_dir: &str) -> RootVerdict {
    if !is_dir {
        return RootVerdict::NotADirectory;
    }
    if entries.contains(&meta_dir) {
        return RootVerdict::Existing;
    }
    if entries.iter().any(|entry| !entry.starts_with('.')) {
        RootVerdict::NotEmpty
    } else {
        RootVerdict::Empty
    }
}

/// Where a chosen folder's workspace goes (TS `workspaceRootFor`): an ok folder is used as it is, a folder
/// with someone's files gets a `WeaveForge/` workspace inside, and any other refusal stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootChoice {
    /// Use the chosen folder itself.
    Use,
    /// Make and use `WeaveForge/` inside the chosen folder.
    Nest,
    /// Refuse the folder.
    Refuse,
}

/// Map a verdict on the chosen folder to what to do with it.
#[must_use]
pub fn choose_root(verdict: RootVerdict) -> RootChoice {
    match verdict {
        RootVerdict::Empty | RootVerdict::Existing => RootChoice::Use,
        RootVerdict::NotEmpty => RootChoice::Nest,
        RootVerdict::NotADirectory => RootChoice::Refuse,
    }
}

/// The name a write is staged under before it is renamed over `target` (TS `writeFile`).
#[must_use]
pub fn temporary_name(target: &str, pid: u32, seq: u32) -> String {
    format!("{target}.{pid}.{seq}{TEMP_SUFFIX}")
}

/// Whether a directory entry is a staged write a listing must skip (TS `list`).
#[must_use]
pub fn is_temporary_name(name: &str) -> bool {
    name.ends_with(TEMP_SUFFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_file_is_lowercase_md_only() {
        assert!(is_search_file("notes/a.md"));
        assert!(!is_search_file("notes/a.MD"));
        assert!(!is_search_file("notes/a.md.bak"));
    }

    #[test]
    fn skips_dot_directories_only_by_last_segment() {
        assert!(is_skipped_dir(".git"));
        assert!(is_skipped_dir("projects/.cache"));
        assert!(!is_skipped_dir("projects/.hidden/inner"));
        assert!(!is_skipped_dir("projects"));
    }

    #[test]
    fn matches_case_insensitively_with_crlf() {
        let text = "Alpha line\r\nnothing here\r\nbeta ALPHA\n";
        assert_eq!(
            search_matches(text, "alpha"),
            vec!["Alpha line".to_string(), "beta ALPHA".to_string()]
        );
    }

    #[test]
    fn keeps_a_trailing_cr_on_the_last_line() {
        assert_eq!(search_matches("x\r", "x"), vec!["x\r".to_string()]);
    }

    #[test]
    fn caps_matches_at_five_per_file() {
        let text = "hit\n".repeat(9);
        assert_eq!(search_matches(&text, "hit").len(), MAX_MATCHES_PER_FILE);
    }

    #[test]
    fn cuts_context_to_120_utf16_units() {
        let line = "a".repeat(200);
        assert_eq!(search_matches(&line, "a")[0].len(), CONTEXT_UNITS);
        // Each emoji is two UTF-16 units: 70 of them is 140 units, cut to 120.
        let astral = "😀".repeat(70);
        let cut = search_matches(&astral, "😀")[0].clone();
        assert_eq!(cut.encode_utf16().count(), CONTEXT_UNITS);
    }

    #[test]
    fn empty_query_matches_every_line() {
        assert_eq!(search_matches("a\nb", "").len(), 2);
    }

    #[test]
    fn verdict_follows_the_folder_rules() {
        assert_eq!(
            root_verdict(false, &[], ".weaveforge"),
            RootVerdict::NotADirectory
        );
        assert_eq!(root_verdict(true, &[], ".weaveforge"), RootVerdict::Empty);
        assert_eq!(
            root_verdict(true, &[".DS_Store"], ".weaveforge"),
            RootVerdict::Empty
        );
        assert_eq!(
            root_verdict(true, &["notes.md"], ".weaveforge"),
            RootVerdict::NotEmpty
        );
        assert_eq!(
            root_verdict(true, &["notes.md", ".weaveforge"], ".weaveforge"),
            RootVerdict::Existing
        );
    }

    #[test]
    fn choice_nests_only_a_folder_with_someone_elses_files() {
        assert_eq!(choose_root(RootVerdict::Empty), RootChoice::Use);
        assert_eq!(choose_root(RootVerdict::Existing), RootChoice::Use);
        assert_eq!(choose_root(RootVerdict::NotEmpty), RootChoice::Nest);
        assert_eq!(choose_root(RootVerdict::NotADirectory), RootChoice::Refuse);
    }

    #[test]
    fn temporary_name_round_trips_through_the_skip_rule() {
        let name = temporary_name("notes/a.md", 42, 7);
        assert_eq!(name, "notes/a.md.42.7.wftmp");
        assert!(is_temporary_name(&name));
        assert!(!is_temporary_name("notes/a.md"));
    }
}

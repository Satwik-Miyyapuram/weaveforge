//! Searching the workspace folder. Ported from apps/desktop/src/vault-search.ts.

use crate::vault::{EntryKindPayload, VaultSession};

/// How many files a search reads before it stops.
pub const SEARCH_LIMIT: usize = 2_000;
/// How much of a matching line comes back with each hit, in UTF-16 units.
pub const CONTEXT: usize = 120;
/// Most matching lines kept per file.
pub const MAX_MATCHES_PER_FILE: usize = 5;

/// One matching line.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct VaultSearchMatch {
    /// The start of the matching line.
    pub context: String,
}

/// One file that matched (TS `VaultSearchHit`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct VaultSearchHit {
    /// Path relative to the workspace root, `/`-separated.
    pub filename: String,
    /// The matching lines, at most `MAX_MATCHES_PER_FILE`.
    pub matches: Vec<VaultSearchMatch>,
}

/// Every file under `dir`, depth-first, up to `SEARCH_LIMIT`.
pub fn walk_vault(session: &VaultSession, dir: &str, out: &mut Vec<String>) {
    if out.len() >= SEARCH_LIMIT {
        return;
    }
    let Ok(listed) = session.list(Some(dir)) else {
        return;
    };
    for entry in listed {
        if out.len() >= SEARCH_LIMIT {
            return;
        }
        // `.git` alone can hold thousands of objects and spend the cap before any project.
        let hidden_dir = entry.kind == EntryKindPayload::Dir
            && entry
                .path
                .rsplit('/')
                .next()
                .is_some_and(|name| name.starts_with('.'));
        if hidden_dir {
            continue;
        }
        if entry.kind == EntryKindPayload::Dir {
            walk_vault(session, &entry.path, out);
        } else {
            out.push(entry.path);
        }
    }
}

/// Which markdown files under `dir` mention `query`, and the lines that did.
#[must_use]
pub fn search_vault(session: &VaultSession, query: &str, dir: &str) -> Vec<VaultSearchHit> {
    let mut files = Vec::new();
    walk_vault(session, dir, &mut files);

    let needle = query.to_lowercase();
    let mut results = Vec::new();
    for filename in files {
        if !filename.ends_with(".md") {
            continue;
        }
        let text = match session.read_text(&filename) {
            Ok(Some(text)) => text,
            _ => continue,
        };
        let matches = matching_lines(&text, &needle);
        if !matches.is_empty() {
            results.push(VaultSearchHit { filename, matches });
        }
    }
    results
}

/// The first `MAX_MATCHES_PER_FILE` lines of `text` whose lowercase form contains `needle`.
fn matching_lines(text: &str, needle: &str) -> Vec<VaultSearchMatch> {
    let mut matches = Vec::new();
    for line in split_lines(text) {
        if matches.len() >= MAX_MATCHES_PER_FILE {
            break;
        }
        if line.to_lowercase().contains(needle) {
            let context = utf16_prefix(line, CONTEXT).to_string();
            matches.push(VaultSearchMatch { context });
        }
    }
    matches
}

/// Splits on `\n`, dropping one `\r` before each `\n` (TS `/\r?\n/`).
fn split_lines(text: &str) -> Vec<&str> {
    let pieces: Vec<&str> = text.split('\n').collect();
    let last = pieces.len().saturating_sub(1);
    pieces
        .into_iter()
        .enumerate()
        .map(|(index, piece)| {
            if index < last {
                piece.strip_suffix('\r').unwrap_or(piece)
            } else {
                piece
            }
        })
        .collect()
}

/// The longest prefix of `s` within `units` UTF-16 units, cut on a char boundary.
fn utf16_prefix(s: &str, units: usize) -> &str {
    let mut used = 0;
    for (index, c) in s.char_indices() {
        used += c.len_utf16();
        if used > units {
            return s.get(..index).unwrap_or("");
        }
    }
    s
}

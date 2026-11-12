//! The folder mirror's manifest text (`writeMirrorManifest` in
//! `apps/web/src/features/workspace/application/parts-3.ts`).
//!
//! The manifest lists the files this app wrote into a connected folder, with the
//! digests and frontmatter bases it compares against later. Only the text is built
//! here, and only the comparison that skips the `writtenAt` stamp. Reading and
//! writing the file stay in TypeScript.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::sync::merge_vault_page::VaultPageBase;

/// Manifest format version this build writes.
pub const MANIFEST_VERSION: u32 = 3;

/// Field order is the file order, so it matches the TypeScript object literal.
#[derive(Serialize)]
struct Manifest<'a> {
    version: u32,
    paths: &'a [String],
    digests: BTreeMap<&'a str, &'a str>,
    bases: BTreeMap<&'a str, &'a VaultPageBase>,
    #[serde(rename = "writtenAt")]
    written_at: &'a str,
}

/// The manifest file text for `paths` (sorted, each once), with digests and bases kept only
/// for claimed paths, so a manifest cannot keep digests of files that left the folder.
/// Ends with a newline, as `JSON.stringify(body, null, 2)` plus `\n` did.
///
/// Paths sort by UTF-8 bytes, not UTF-16 units, so the two differ only for characters
/// outside the BMP; that costs at most one rewrite on the first run.
#[must_use]
pub fn manifest_text(
    paths: &[String],
    digests: &BTreeMap<String, String>,
    bases: &BTreeMap<String, VaultPageBase>,
    written_at: &str,
) -> String {
    let kept: Vec<String> = paths
        .iter()
        .cloned()
        .collect::<BTreeSet<String>>()
        .into_iter()
        .collect();
    let body = Manifest {
        version: MANIFEST_VERSION,
        paths: &kept,
        digests: kept
            .iter()
            .filter_map(|path| {
                digests
                    .get(path)
                    .map(|digest| (path.as_str(), digest.as_str()))
            })
            .collect(),
        bases: kept
            .iter()
            .filter_map(|path| bases.get(path).map(|base| (path.as_str(), base)))
            .collect(),
        written_at,
    };
    // The body is plain strings and numbers, so serialization cannot fail.
    let mut text = serde_json::to_string_pretty(&body).unwrap_or_default();
    text.push('\n');
    text
}

/// Whether two manifest texts differ only in their `writtenAt` line. A new time alone is not
/// a change, so rewriting it would commit noise on every run.
#[must_use]
pub fn same_manifest_ignoring_stamp(current: &str, next: &str) -> bool {
    strip_written_at(current) == strip_written_at(next)
}

/// Blank out the `writtenAt` line, as the TypeScript regex replace did.
fn strip_written_at(text: &str) -> String {
    text.split('\n')
        .map(|line| if is_written_at_line(line) { "" } else { line })
        .collect::<Vec<&str>>()
        .join("\n")
}

/// Whether `line` is `  "writtenAt": "<anything>"` with nothing after the closing quote.
fn is_written_at_line(line: &str) -> bool {
    const PREFIX: &str = "\"writtenAt\": \"";
    line.trim_start()
        .strip_prefix(PREFIX)
        .is_some_and(|rest| rest.ends_with('"'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    fn base(title: &str) -> VaultPageBase {
        VaultPageBase {
            fields: json!({ "title": title }),
            body_digest: format!("body-{title}"),
        }
    }

    // it: "sorts paths, keeps each once, ends with a newline, and writes the version"
    #[test]
    fn sorts_dedups_and_frames_the_text() {
        let text = manifest_text(
            &strings(&["b.md", "a.md", "b.md"]),
            &BTreeMap::new(),
            &BTreeMap::new(),
            "T",
        );
        assert_eq!(
            text,
            "{\n  \"version\": 3,\n  \"paths\": [\n    \"a.md\",\n    \"b.md\"\n  ],\n  \"digests\": {},\n  \"bases\": {},\n  \"writtenAt\": \"T\"\n}\n"
        );
    }

    // it: "keeps digests and bases only for paths still claimed"
    #[test]
    fn filters_digests_and_bases_to_claimed_paths() {
        let digests = BTreeMap::from([
            ("a.md".to_owned(), "d1".to_owned()),
            ("gone.md".to_owned(), "d2".to_owned()),
        ]);
        let bases = BTreeMap::from([
            ("a.md".to_owned(), base("A")),
            ("gone.md".to_owned(), base("Gone")),
        ]);
        let text = manifest_text(&strings(&["a.md"]), &digests, &bases, "T");
        let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        assert_eq!(parsed["version"], json!(3));
        assert_eq!(parsed["digests"], json!({ "a.md": "d1" }));
        assert_eq!(
            parsed["bases"],
            json!({ "a.md": { "fields": { "title": "A" }, "bodyDigest": "body-A" } })
        );
        assert!(!text.contains("gone.md"));
    }

    // it: "treats texts that differ only in writtenAt as the same manifest"
    #[test]
    fn same_when_only_the_stamp_differs() {
        let digests = BTreeMap::new();
        let bases = BTreeMap::new();
        let first = manifest_text(
            &strings(&["a.md"]),
            &digests,
            &bases,
            "2026-01-01T00:00:00.000Z",
        );
        let second = manifest_text(
            &strings(&["a.md"]),
            &digests,
            &bases,
            "2026-02-02T00:00:00.000Z",
        );
        assert_ne!(first, second);
        assert!(same_manifest_ignoring_stamp(&first, &second));
    }

    // it: "treats a change to the claimed paths as a different manifest"
    #[test]
    fn different_when_paths_differ() {
        let digests = BTreeMap::new();
        let bases = BTreeMap::new();
        let first = manifest_text(&strings(&["a.md"]), &digests, &bases, "T");
        let second = manifest_text(&strings(&["a.md", "b.md"]), &digests, &bases, "T");
        assert!(!same_manifest_ignoring_stamp(&first, &second));
    }

    // it: "does not strip a line that is not the writtenAt stamp"
    #[test]
    fn keeps_lines_that_are_not_the_stamp() {
        let plain = "{\n  \"writtenAt\": \"T\",\n  \"x\": 1\n}\n";
        let other = "{\n  \"writtenAt\": \"T\",\n  \"x\": 2\n}\n";
        assert!(!same_manifest_ignoring_stamp(plain, other));
        assert!(same_manifest_ignoring_stamp(plain, plain));
    }
}

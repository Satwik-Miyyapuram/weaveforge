//! Which files a folder import preview reads, and which assets it keeps (`readPreviewFolder` in
//! `apps/web/src/features/workspace/application/parts-2.ts`).
//!
//! The listing and the reads stay in TypeScript, which holds the file system. This decides what
//! to read, which assets a read note names, and where the size caps bite. Assets are read in
//! listing order, one at a time, so the total cap refuses at the same file as before.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::sync::folder_layout::ASSET_DIR;
use crate::sync::json_entities::json_kind_of_path;

const MIB: f64 = 1024.0 * 1024.0;

/// The caps a preview is held to: `{ maxTotalBytes, maxFileBytes }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLimits {
    /// Total bytes across the assets a preview keeps.
    pub max_total_bytes: u64,
    /// One asset.
    pub max_file_bytes: u64,
}

/// A listed file: its path in the folder and its listed size.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntry {
    /// Path inside the connected folder.
    pub path: String,
    /// Size as the listing reports it, before any bytes are read.
    pub size: u64,
}

/// The files to read as text, and the assets still to consider.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewReads {
    /// Markdown notes to read.
    pub notes: Vec<String>,
    /// The project's own data files to read.
    pub json: Vec<String>,
    /// Listed assets, before the `only` and named-by-note selection.
    pub assets: Vec<PreviewEntry>,
}

/// What to do with a selected asset before its bytes are read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetAction {
    /// Read the bytes, then [`admit_asset_bytes`].
    Read,
    /// Over the file cap on its listed size: skipped without reading.
    #[serde(rename = "too-big")]
    TooBig,
}

/// A selected asset and what to do with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPick {
    /// Path inside the connected folder.
    pub path: String,
    /// Read it or skip it.
    pub action: AssetAction,
}

/// Whether a read asset is kept, and the running total after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetAdmit {
    /// False when the bytes are over the file cap; the total is then unchanged.
    pub keep: bool,
    /// Bytes kept so far, including this asset when kept.
    pub total: u64,
}

fn selected_set(only: Option<&[String]>) -> Option<HashSet<&str>> {
    only.map(|paths| paths.iter().map(String::as_str).collect())
}

/// Which listed files a preview reads as text. A note or data file counts only for this project
/// (a legacy flat folder counts everything listed as this project's), and only when `only`, if
/// given, names it. Assets are returned for [`plan_asset_reads`].
#[must_use]
pub fn plan_preview_reads(
    entries: &[PreviewEntry],
    project_root: &str,
    has_project_dir: bool,
    only: Option<&[String]>,
) -> PreviewReads {
    let only = selected_set(only);
    let wanted = |path: &str| match &only {
        None => true,
        Some(set) => set.contains(path),
    };
    let own_prefix = format!("{project_root}/");
    let asset_prefix = format!("{ASSET_DIR}/");
    let mut reads = PreviewReads::default();
    for entry in entries {
        let path = entry.path.as_str();
        let ours = !has_project_dir || path.starts_with(&own_prefix);
        if path.ends_with(".md") {
            if ours && wanted(path) {
                reads.notes.push(entry.path.clone());
            }
            continue;
        }
        // The project's own data files, read from the folder rather than assumed, so a file
        // somebody added by hand is diffed like any other.
        if path.ends_with(".json") && json_kind_of_path(path).is_some() {
            if ours && wanted(path) {
                reads.json.push(entry.path.clone());
            }
            continue;
        }
        if path.starts_with(&asset_prefix) {
            reads.assets.push(entry.clone());
        }
    }
    reads
}

/// Select the assets to keep, in listing order. With `only`, an asset is selected when listed
/// there or named by a read note; a note names an asset by its path under the asset folder, and
/// a name found anywhere in a read note is enough. An asset over the file cap on its listed size
/// is marked [`AssetAction::TooBig`].
#[must_use]
pub fn plan_asset_reads(
    assets: &[PreviewEntry],
    only: Option<&[String]>,
    note_texts: &[String],
    limits: PreviewLimits,
) -> Vec<AssetPick> {
    let only = selected_set(only);
    let asset_prefix = format!("{ASSET_DIR}/");
    assets
        .iter()
        .filter_map(|entry| {
            let path = entry.path.as_str();
            if let Some(set) = &only {
                let rest = path.strip_prefix(&asset_prefix).unwrap_or(path);
                let named = note_texts.iter().any(|text| text.contains(rest));
                if !set.contains(path) && !named {
                    return None;
                }
            }
            let action = if entry.size > limits.max_file_bytes {
                AssetAction::TooBig
            } else {
                AssetAction::Read
            };
            Some(AssetPick {
                path: entry.path.clone(),
                action,
            })
        })
        .collect()
}

/// Admit an asset's real bytes against the caps. Bytes over the file cap are not kept and do not
/// count toward the total; a total past the cap is fatal.
///
/// # Errors
///
/// Fails when keeping the asset would pass the total cap.
pub fn admit_asset_bytes(
    running_total: u64,
    byte_len: u64,
    limits: PreviewLimits,
) -> Result<AssetAdmit, String> {
    if byte_len > limits.max_file_bytes {
        return Ok(AssetAdmit {
            keep: false,
            total: running_total,
        });
    }
    let total = running_total.saturating_add(byte_len);
    if total > limits.max_total_bytes {
        return Err(format!(
            "Folder assets exceed {} MB; refusing to continue.",
            megabytes(limits.max_total_bytes)
        ));
    }
    Ok(AssetAdmit { keep: true, total })
}

// Whole megabytes of a cap the caller set: non-negative and far below u64 range, so the cast is exact.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]
fn megabytes(bytes: u64) -> u64 {
    (bytes as f64 / MIB).round() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = "thesis--abc123";
    const LIMITS: PreviewLimits = PreviewLimits {
        max_total_bytes: 256 * 1024 * 1024,
        max_file_bytes: 32 * 1024 * 1024,
    };

    fn entry(path: &str, size: u64) -> PreviewEntry {
        PreviewEntry {
            path: path.to_owned(),
            size,
        }
    }

    fn paths(entries: &[PreviewEntry]) -> Vec<String> {
        entries.iter().map(|e| e.path.clone()).collect()
    }

    fn picked(picks: &[AssetPick]) -> Vec<(String, AssetAction)> {
        picks.iter().map(|p| (p.path.clone(), p.action)).collect()
    }

    // it: "a project folder reads its own notes, data and assets"
    #[test]
    fn a_project_folder_reads_its_own_notes_data_and_assets() {
        let listed = [
            entry(&format!("{ROOT}/notes/a.md"), 3),
            entry(&format!("{ROOT}/data/papers.json"), 2),
            entry("assets/x.png", 3),
            entry("other--zzz999/notes/b.md", 3),
            entry("stray.md", 7),
        ];
        let reads = plan_preview_reads(&listed, ROOT, true, None);
        assert_eq!(reads.notes, vec![format!("{ROOT}/notes/a.md")]);
        assert!(reads.json.is_empty());
        assert_eq!(paths(&reads.assets), vec!["assets/x.png".to_owned()]);
    }

    // it: "a legacy flat folder reads its top level but still skips .git"
    // (The walk itself stays in TypeScript; this is the classification of what it listed.)
    #[test]
    fn a_legacy_flat_folder_reads_its_top_level() {
        let listed = [
            entry("notes/a.md", 3),
            entry("top.md", 5),
            entry("assets/y.png", 3),
        ];
        let reads = plan_preview_reads(&listed, ROOT, false, None);
        assert_eq!(
            reads.notes,
            vec!["notes/a.md".to_owned(), "top.md".to_owned()]
        );
        assert_eq!(paths(&reads.assets), vec!["assets/y.png".to_owned()]);
    }

    // it: "an oversize asset is skipped without reading it (29-16)"
    #[test]
    fn an_oversize_asset_is_skipped_on_its_listed_size() {
        let listed = [
            entry("assets/big.bin", LIMITS.max_file_bytes + 1),
            entry("assets/ok.png", 3),
        ];
        let picks = plan_asset_reads(&listed, None, &[], LIMITS);
        assert_eq!(
            picked(&picks),
            vec![
                ("assets/big.bin".to_owned(), AssetAction::TooBig),
                ("assets/ok.png".to_owned(), AssetAction::Read),
            ]
        );
    }

    // it: "an empty folder reads nothing"
    #[test]
    fn an_empty_folder_reads_nothing() {
        let reads = plan_preview_reads(&[], ROOT, false, None);
        assert_eq!(reads, PreviewReads::default());
        assert!(plan_asset_reads(&[], None, &[], LIMITS).is_empty());
    }

    // it: "a preview of some paths reads those notes and only the assets they name"
    #[test]
    fn a_preview_of_some_paths_reads_those_notes_and_only_the_assets_they_name() {
        let note_a = format!("{ROOT}/notes/a.md");
        let listed = [
            entry(&note_a, 40),
            entry(&format!("{ROOT}/notes/b.md"), 3),
            entry("assets/vault/fig.png", 3),
            entry("assets/vault/other.png", 3),
            entry("assets/vault/dropped.png", 3),
        ];
        let only = vec![note_a.clone(), "assets/vault/dropped.png".to_owned()];
        let reads = plan_preview_reads(&listed, ROOT, true, Some(&only));
        assert_eq!(reads.notes, vec![note_a]);
        // The note as it was read names the figure, not the other file.
        let note_texts = vec!["# A\n\n![fig](../../assets/vault/fig.png)".to_owned()];
        let picks = plan_asset_reads(&reads.assets, Some(&only), &note_texts, LIMITS);
        let mut names: Vec<String> = picks.iter().map(|p| p.path.clone()).collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "assets/vault/dropped.png".to_owned(),
                "assets/vault/fig.png".to_owned()
            ]
        );
        assert!(!names.contains(&"assets/vault/other.png".to_owned()));
    }

    // it: "a preview of no paths reads nothing"
    #[test]
    fn a_preview_of_no_paths_reads_nothing() {
        let listed = [
            entry(&format!("{ROOT}/notes/a.md"), 3),
            entry("assets/x.png", 3),
        ];
        let reads = plan_preview_reads(&listed, ROOT, true, Some(&[]));
        assert!(reads.notes.is_empty());
        assert!(plan_asset_reads(&reads.assets, Some(&[]), &[], LIMITS).is_empty());
    }

    // Rust-only: a note or data file of another project is never read, even when listed.
    #[test]
    fn other_projects_notes_are_not_read_with_a_project_folder() {
        let listed = [entry("other--zzz999/notes/b.md", 3)];
        assert!(
            plan_preview_reads(&listed, ROOT, true, None)
                .notes
                .is_empty()
        );
    }

    // Rust-only: a note that is also an asset path is a note, not an asset.
    #[test]
    fn markdown_under_assets_is_a_note_not_an_asset() {
        let listed = [entry("assets/vault/note.md", 3)];
        let reads = plan_preview_reads(&listed, ROOT, false, None);
        assert_eq!(reads.notes, vec!["assets/vault/note.md".to_owned()]);
        assert!(reads.assets.is_empty());
    }

    // Rust-only: a data file is read only when it has one of the three kind names.
    #[test]
    fn only_the_three_data_file_names_are_read_as_json() {
        let listed = [
            entry(&format!("{ROOT}/.weaveforge/tags.json"), 2),
            entry(&format!("{ROOT}/data/papers.json"), 2),
        ];
        let reads = plan_preview_reads(&listed, ROOT, true, None);
        assert_eq!(reads.json, vec![format!("{ROOT}/.weaveforge/tags.json")]);
    }

    // Rust-only: admitting bytes keeps them, refuses an oversize file quietly, and refuses a total
    // past the cap with the same wording the TypeScript preview used.
    #[test]
    fn admit_keeps_under_caps_and_refuses_past_the_total() {
        let kept = admit_asset_bytes(0, 10, LIMITS).unwrap();
        assert_eq!(
            kept,
            AssetAdmit {
                keep: true,
                total: 10
            }
        );

        let oversize = admit_asset_bytes(10, LIMITS.max_file_bytes + 1, LIMITS).unwrap();
        assert_eq!(
            oversize,
            AssetAdmit {
                keep: false,
                total: 10
            }
        );

        let err = admit_asset_bytes(LIMITS.max_total_bytes, 1, LIMITS).unwrap_err();
        assert_eq!(err, "Folder assets exceed 256 MB; refusing to continue.");
    }
}

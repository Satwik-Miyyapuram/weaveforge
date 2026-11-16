//! Pure parts of the user-data export (TS `export-user-data.ts`): the manifest, the README and
//! the folder a stored asset is written to. The app keeps the snapshot reads and blob fetches.

use serde::{Deserialize, Serialize};

/// The per-collection counts the manifest reports (TS `workspaceSnapshotCounts`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExportStats {
    /// Vault notes.
    pub notes: u32,
    /// Papers in the library.
    pub papers: u32,
    /// Reading lists.
    pub reading_lists: u32,
    /// Report sections.
    pub report_sections: u32,
    /// Experiments.
    pub experiments: u32,
    /// Plan milestones.
    pub milestones: u32,
    /// Logbook entries.
    pub log_entries: u32,
    /// Relations between entities.
    pub relations: u32,
    /// Tags.
    pub tags: u32,
}

/// Encryption facts the manifest records; the export is always plaintext.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Encryption {
    exported_decrypted: bool,
    e2ee_enabled: bool,
}

/// The manifest file's shape. Field order is the file's key order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest<'a> {
    schema_version: u32,
    exported_at: &'a str,
    app: &'static str,
    encryption: Encryption,
    stats: &'a ExportStats,
}

/// The export's `manifest.json`, pretty-printed with two-space indent (`JSON.stringify(v, null, 2)`).
/// The value is made of plain fields, so serialisation does not fail; the empty fallback is never used.
#[must_use]
pub fn export_manifest_json(exported_at: &str, stats: &ExportStats) -> String {
    let manifest = Manifest {
        schema_version: 3,
        exported_at,
        app: "WeaveForge",
        encryption: Encryption {
            exported_decrypted: true,
            e2ee_enabled: false,
        },
        stats,
    };
    serde_json::to_string_pretty(&manifest).unwrap_or_default()
}

/// The export's `README.txt`, stamped with the export time.
#[must_use]
pub fn export_readme(exported_at: &str) -> String {
    let exported = format!("Exported at: {exported_at}");
    [
        "WeaveForge data export",
        exported.as_str(),
        "",
        "Layout:",
        "  manifest.json     \u{2014} schema + counts",
        "  notes/pages.json  \u{2014} vault notes",
        "  notes/assets/     \u{2014} embedded note images",
        "  papers/index.json \u{2014} papers",
        "  papers/images/    \u{2014} paper image attachments",
        "  reading-lists/, report/, experiments/, plan/, logbook/",
        "  relations.json, tags.json",
        "",
        "Content is plaintext JSON + binary assets.",
    ]
    .join("\n")
}

/// Where a stored asset is written in the export: `{root}/{prefix}/{id}/{name}`. `name` is the
/// last segment of `storage_path`; `id` is its second segment, or `unknown` when there is none.
/// `prefix` is `notes/assets` for vault assets and `papers/images` for paper images.
#[must_use]
pub fn export_asset_path(root: &str, prefix: &str, storage_path: &str) -> String {
    let name = storage_path.rsplit('/').next().unwrap_or(storage_path);
    let id = storage_path.split('/').nth(1).unwrap_or("unknown");
    format!("{root}/{prefix}/{id}/{name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats() -> ExportStats {
        ExportStats {
            notes: 2,
            papers: 3,
            reading_lists: 1,
            report_sections: 0,
            experiments: 4,
            milestones: 5,
            log_entries: 6,
            relations: 7,
            tags: 8,
        }
    }

    #[test]
    fn manifest_has_schema_app_and_camel_case_stats() {
        let json: serde_json::Value =
            serde_json::from_str(&export_manifest_json("2026-11-10T00:00:00Z", &stats()))
                .expect("manifest is JSON");
        assert_eq!(json["schemaVersion"], 3);
        assert_eq!(json["exportedAt"], "2026-11-10T00:00:00Z");
        assert_eq!(json["app"], "WeaveForge");
        assert_eq!(json["encryption"]["exportedDecrypted"], true);
        assert_eq!(json["encryption"]["e2eeEnabled"], false);
        assert_eq!(json["stats"]["readingLists"], 1);
        assert_eq!(json["stats"]["logEntries"], 6);
    }

    #[test]
    fn manifest_uses_two_space_indent() {
        let text = export_manifest_json("t", &stats());
        assert!(text.starts_with("{\n  \"schemaVersion\": 3,\n"));
    }

    #[test]
    fn readme_is_stamped_and_keeps_layout_lines() {
        let text = export_readme("2026-11-10");
        let mut lines = text.lines();
        assert_eq!(lines.next(), Some("WeaveForge data export"));
        assert_eq!(lines.next(), Some("Exported at: 2026-11-10"));
        assert!(text.contains("  notes/assets/     \u{2014} embedded note images"));
        assert!(text.ends_with("Content is plaintext JSON + binary assets."));
    }

    #[test]
    fn asset_path_takes_last_segment_and_second_segment_as_id() {
        assert_eq!(
            export_asset_path("root", "notes/assets", "vault/p9/img.png"),
            "root/notes/assets/p9/img.png"
        );
        assert_eq!(
            export_asset_path("root", "papers/images", "papers/x1/fig.webp"),
            "root/papers/images/x1/fig.webp"
        );
    }

    #[test]
    fn asset_path_without_a_second_segment_uses_unknown() {
        assert_eq!(
            export_asset_path("root", "notes/assets", "loose.png"),
            "root/notes/assets/unknown/loose.png"
        );
    }
}

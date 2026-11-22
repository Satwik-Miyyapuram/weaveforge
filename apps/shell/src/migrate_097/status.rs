//! Read-only status for the 0.9.7 migration, the reply of `migrate_097_status`. Field names are
//! camelCase on the wire; the WEB lane codes against them. Optional fields are omitted when absent.

use std::fs;
use std::path::Path;

use serde::Serialize;

const REPORT_REL: &str = ".weaveforge/migration-0.9.7/report.json";
const BACKUP_REL: &str = ".weaveforge/migration-0.9.7/pre-migration.dump";

/// Status of the 0.9.7 migration as the UI sees it.
#[derive(Debug, Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    /// `verified`, `incomplete`, `removing`, `removed`, or `none` when no readable report exists.
    pub state: String,
    /// When old data was removed (report.json `removedAt`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<String>,
    /// When the TS verify last passed (report.json `verifiedAt`); removal needs it at most 10 min old.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<String>,
    /// Folder named by `<pg_root>/exported-to.json`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_to: Option<String>,
    /// Absolute path of the PGDMP backup that "remove old data" checks, when that file exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    /// Kind names (from `runs[].missing[]` / report `missing[]`) with unexported items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<Vec<String>>,
}

/// Reads report.json, exported-to.json and the backup. Never writes and never fails: anything
/// unreadable is reported as absent (state `none` when the report itself is missing or bad).
pub fn migration_status(folder: &Path, pg_root: &Path) -> MigrationStatus {
    let report: Option<serde_json::Value> = fs::read_to_string(folder.join(REPORT_REL))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok());
    let Some(report) = report else {
        return MigrationStatus {
            state: "none".to_owned(),
            removed_at: None,
            verified_at: None,
            exported_to: exported_to(pg_root),
            backup_path: None,
            missing: None,
        };
    };
    let state = report["state"].as_str().unwrap_or("none").to_owned();
    let backup = folder.join(BACKUP_REL);
    let mut kinds: Vec<String> = report["missing"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["kind"].as_str().map(str::to_owned))
        .collect();
    kinds.sort();
    kinds.dedup();
    MigrationStatus {
        state,
        removed_at: report["removedAt"].as_str().map(str::to_owned),
        verified_at: report["verifiedAt"].as_str().map(str::to_owned),
        exported_to: exported_to(pg_root),
        backup_path: backup
            .is_file()
            .then(|| backup.to_string_lossy().into_owned()),
        missing: (!kinds.is_empty()).then_some(kinds),
    }
}

fn exported_to(pg_root: &Path) -> Option<String> {
    let text = fs::read_to_string(pg_root.join("exported-to.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value["folder"].as_str().map(str::to_owned)
}

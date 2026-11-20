//! One-time migration of 0.9.2 database rows into workspace files (0.9.5).
//!
//! `rules` holds the pure decisions and `export` the per-paper files. This module applies them
//! to the vault, writes the migration report under `.weaveforge/migration-0.9.4/`, and exposes
//! the commands. Files are named and paired by path only.

pub mod export;
pub mod rules;

#[cfg(test)]
mod tests;

use serde::Serialize;
use wf_core::sync::folder_layout::TRASH_DIR;

use crate::commands::{LocalDb, ShellError};
use crate::vault::{EntryKindPayload, VaultSession, VaultState};
use export::{
    PaperExport, export_paper, export_unmapped, plan_exports, verify_paper, verify_unmapped,
};
use rules::{Decision, LegacyShare};

/// Where the migration report is written, inside the workspace.
pub const REPORT_PATH: &str = ".weaveforge/migration-0.9.4/report.json";

/// The legacy share rows, read from the 0.9.2 tables.
const SHARES_SQL: &str =
    "SELECT owner_id, recipient_id, resource_type, resource_id, access FROM shares";
const PAPERS_SQL: &str = "SELECT id, title FROM papers";
const ANNOTATIONS_SQL: &str = "SELECT paper_id, type, color, text, comment, tags, page_index, sort_index, anchor, updated_at FROM reader_annotations";
const COMMENTS_SQL: &str = "SELECT id, resource_type, resource_id, author_id, body, created_at, anchor_quote, anchor_prefix, anchor_suffix, parent_id, resolved_at FROM comments";
const PINS_SQL: &str = "SELECT resource_id FROM library_pins WHERE resource_type = 'paper'";
const ANNOTATION_PINS_SQL: &str =
    "SELECT paper_id, annotation_key, report_section_id, created_at FROM annotation_pins";
const SCREENING_SQL: &str = "SELECT rli.paper_id AS paper_id, sd.state AS state, sd.reason AS reason, sd.decided_at AS decided_at FROM screening_decisions sd JOIN reading_list_items rli ON rli.id = sd.item_id";

/// The workspace files a migration step reads and writes.
pub trait WorkspaceFiles {
    /// The file's text, or `None` if it does not exist.
    ///
    /// # Errors
    /// The file cannot be read.
    fn read(&self, rel: &str) -> Result<Option<String>, String>;

    /// Writes `text` only while the file still has `expected` (`None` = create only if absent).
    /// Returns `false` when the file changed.
    ///
    /// # Errors
    /// A refused path or a filesystem failure.
    fn write_if(&self, rel: &str, text: &str, expected: Option<&str>) -> Result<bool, String>;

    /// Every file under the trash, as `.weaveforge/trash/<date>/<rel>`.
    ///
    /// # Errors
    /// The trash folder cannot be listed.
    fn trash_entries(&self) -> Result<Vec<String>, String>;
}

impl WorkspaceFiles for VaultSession {
    fn read(&self, rel: &str) -> Result<Option<String>, String> {
        self.read_text(rel)
    }

    fn write_if(&self, rel: &str, text: &str, expected: Option<&str>) -> Result<bool, String> {
        self.write_text_if(rel, text, expected)
    }

    fn trash_entries(&self) -> Result<Vec<String>, String> {
        let mut found = Vec::new();
        if self.stat(TRASH_DIR)?.is_none() {
            return Ok(found);
        }
        let mut dirs = vec![TRASH_DIR.to_owned()];
        while let Some(dir) = dirs.pop() {
            for entry in self.list(Some(&dir))? {
                match entry.kind {
                    EntryKindPayload::Dir => dirs.push(entry.path),
                    EntryKindPayload::File => found.push(entry.path),
                }
            }
        }
        Ok(found)
    }
}

/// A write that must land: a file that changed underneath is an error, never overwritten.
fn write_expected<F: WorkspaceFiles + ?Sized>(
    files: &F,
    rel: &str,
    text: &str,
    expected: Option<&str>,
) -> Result<(), String> {
    if files.write_if(rel, text, expected)? {
        Ok(())
    } else {
        Err(format!(
            "{rel} changed while the migration ran; not overwritten"
        ))
    }
}

/// Applies one decision for `rel`. Returns whether anything was written. A backup or conflict
/// copy that already holds other text is an error, so nobody's text is ever overwritten.
///
/// # Errors
/// A write failed, a file changed underneath, or a backup holds other text.
pub fn apply<F: WorkspaceFiles + ?Sized>(
    files: &F,
    rel: &str,
    text: &str,
    decision: &Decision,
) -> Result<bool, String> {
    match decision {
        Decision::SkipTrashed | Decision::Same => Ok(false),
        Decision::Create => {
            write_expected(files, rel, text, None)?;
            Ok(true)
        }
        Decision::Replace { previous, copy_to } => {
            // The replaced text is kept first, so a failure never loses it. A rerun finds its
            // own copy already in place and carries on.
            match files.read(copy_to)? {
                None => write_expected(files, copy_to, previous, None)?,
                Some(kept) if kept == *previous => {}
                Some(_) => {
                    return Err(format!(
                        "{copy_to} already holds other text; {rel} not replaced"
                    ));
                }
            }
            write_expected(files, rel, text, Some(previous))?;
            Ok(true)
        }
        Decision::KeepFile { conflict_path } => match files.read(conflict_path)? {
            None => {
                write_expected(files, conflict_path, text, None)?;
                Ok(true)
            }
            Some(kept) if kept == text => Ok(false),
            Some(_) => Err(format!("{conflict_path} already holds other text")),
        },
    }
}

/// Where the migration stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum MigrateState {
    /// No report yet.
    NotStarted,
    /// A report exists, but something is pending or failed, so the 0.9.2 database must be kept.
    Incomplete,
    /// Every row is in files, every grant is in, and the report says so. The database may go.
    Verified,
}

/// Reply of `migrate_093_status` and `migrate_093_run`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct MigrateReply {
    /// Where the migration stands.
    pub state: MigrateState,
    /// The report's workspace path, once one is written.
    pub report_path: Option<String>,
}

/// Reads the legacy share rows into shares.
fn plan_shares(rows: &[serde_json::Value]) -> Result<Vec<LegacyShare>, String> {
    rows.iter()
        .map(|row| -> Result<LegacyShare, String> {
            let text = |key: &str| {
                row.get(key)
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            };
            Ok(LegacyShare {
                owner: text("owner_id").ok_or("share row without owner_id")?,
                recipient: text("recipient_id").ok_or("share row without recipient_id")?,
                resource_type: text("resource_type").ok_or("share row without resource_type")?,
                resource_id: text("resource_id"),
                access: text("access").ok_or("share row without access")?,
            })
        })
        .collect()
}

/// How many shares could become grants, and the reason for each one that cannot.
fn share_outcome(shares: &[LegacyShare]) -> (usize, Vec<String>) {
    let mut grantable = 0_usize;
    let mut skipped = Vec::new();
    for share in shares {
        match rules::share_to_grant(share) {
            Ok(_) => grantable += 1,
            Err(reason) => skipped.push(reason),
        }
    }
    (grantable, skipped)
}

async fn with_session<T, F>(state: &VaultState, job: F) -> Result<T, ShellError>
where
    T: Send + 'static,
    F: FnOnce(&VaultSession) -> Result<T, String> + Send + 'static,
{
    let state = state.clone();
    tokio::task::spawn_blocking(move || {
        let session = state.lock();
        job(&session)
    })
    .await
    .unwrap_or_else(|_| Err("migration task failed".to_owned()))
    .map_err(ShellError::from)
}

/// Whether the report on disk says the migration was verified. A missing or garbled report is
/// not verified.
fn report_says_verified(report: &str) -> bool {
    let parsed: Option<serde_json::Value> = serde_json::from_str(report).ok();
    parsed
        .as_ref()
        .and_then(|value| value.get("state"))
        .and_then(serde_json::Value::as_str)
        == Some("verified")
}

fn status_of(files: &impl WorkspaceFiles) -> Result<MigrateReply, String> {
    let Some(report) = files.read(REPORT_PATH)? else {
        return Ok(MigrateReply {
            state: MigrateState::NotStarted,
            report_path: None,
        });
    };
    let state = if report_says_verified(&report) {
        MigrateState::Verified
    } else {
        MigrateState::Incomplete
    };
    Ok(MigrateReply {
        state,
        report_path: Some(REPORT_PATH.to_owned()),
    })
}

/// Exports every planned paper and checks each one back. Failures are collected, not fatal, so
/// one bad paper does not stop the rest. Returns the files written and one line per failure.
fn export_papers<F: WorkspaceFiles + ?Sized>(
    files: &F,
    papers: &[(String, PaperExport)],
) -> (usize, Vec<String>) {
    let mut written = 0_usize;
    let mut errors = Vec::new();
    for (rel, item) in papers {
        let result = export_paper(files, rel, item)
            .and_then(|count| verify_paper(files, rel, item).map(|()| count));
        match result {
            Ok(count) => written += count,
            Err(reason) => errors.push(format!("{rel}: {reason}")),
        }
    }
    (written, errors)
}

/// Exports the 0.9.2 data into workspace files, verifies it, and writes the report. Shares are
/// counted, not granted: the grant sink is not wired, so any grantable share keeps the
/// migration incomplete.
///
/// # Errors
/// No folder chosen, the database cannot be read, or the report cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn migrate_093_run(
    state: tauri::State<'_, VaultState>,
    db: tauri::State<'_, LocalDb>,
) -> Result<MigrateReply, ShellError> {
    let share_rows = db.query(SHARES_SQL.to_owned(), Vec::new()).await?;
    let shares = plan_shares(&share_rows).map_err(ShellError::from)?;
    let (pending_grants, share_skipped) = share_outcome(&shares);
    let papers = db.query(PAPERS_SQL.to_owned(), Vec::new()).await?;
    let annotations = db.query(ANNOTATIONS_SQL.to_owned(), Vec::new()).await?;
    let comments = db.query(COMMENTS_SQL.to_owned(), Vec::new()).await?;
    let pins = db.query(PINS_SQL.to_owned(), Vec::new()).await?;
    let annotation_pins = db.query(ANNOTATION_PINS_SQL.to_owned(), Vec::new()).await?;
    let screening = db.query(SCREENING_SQL.to_owned(), Vec::new()).await?;
    let plan = plan_exports(
        &papers,
        &annotations,
        &comments,
        &pins,
        &screening,
        &annotation_pins,
    );
    with_session(&state, move |session| {
        let (mut written, mut errors) = export_papers(session, &plan.papers);
        let unmapped = export_unmapped(session, &plan.unmapped_comments)
            .and_then(|count| verify_unmapped(session, &plan.unmapped_comments).map(|()| count));
        match unmapped {
            Ok(count) => written += count,
            Err(reason) => errors.push(format!("{}: {reason}", export::UNMAPPED_COMMENTS_PATH)),
        }
        let verified = errors.is_empty()
            && plan.skipped.is_empty()
            && share_skipped.is_empty()
            && pending_grants == 0;
        let report = serde_json::json!({
            "state": if verified { "verified" } else { "incomplete" },
            "papers": { "files_written": written, "errors": errors, "skipped": plan.skipped },
            "shares": { "grants_pending": pending_grants, "skipped": share_skipped },
            "unmapped_comments": plan.unmapped_counts,
        });
        let body = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
        session.write_text(REPORT_PATH, &body)?;
        status_of(session)
    })
    .await
}

/// Where the migration stands, and its report if one exists.
///
/// # Errors
/// No folder chosen, or the report cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn migrate_093_status(
    state: tauri::State<'_, VaultState>,
) -> Result<MigrateReply, ShellError> {
    with_session(&state, |session| status_of(session)).await
}

//! Tool commands for the page: the local Zotero, the update check and the app log.

use crate::app_log::{AppLog, AppLogEntry, LogLevel, MAX_ENTRIES};
use crate::commands::ShellError;
use crate::update_check::{UPDATE_CHECK_FAILED, Update, check_update_reply};
use crate::zotero_local::{ZoteroLocalReply, fetch_zotero_local};

/// What a page reports; every field checked before use.
///
/// Unlike TS `appReport`, a non-string `source` or `detail` fails to decode and the
/// line is dropped; the typed shim only ever sends strings or null.
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLogReport {
    /// `error`, `warn` or `info`; anything else is dropped.
    pub level: String,
    /// Where it came from; `renderer` when absent.
    pub source: Option<String>,
    /// What happened; an empty message is dropped.
    pub message: String,
    /// Free-form context.
    pub detail: Option<String>,
}

/// The log as the page reads it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLogText {
    /// Where the log file is.
    pub file: String,
    /// The entries, formatted for a person, oldest first.
    pub text: String,
    /// False when the in-memory log has dropped entries it once held.
    pub complete: bool,
}

/// One log entry as one line, with its detail indented under it.
#[must_use]
pub fn format_log_line(entry: &AppLogEntry) -> String {
    let stamp = entry.at.replacen('T', " ", 1).replacen('Z', "", 1);
    let name = match entry.level {
        LogLevel::Error => "ERROR",
        LogLevel::Warn => "WARN",
        LogLevel::Info => "INFO",
    };
    let head = format!("{stamp} {name:<5} [{}] {}", entry.source, entry.message);
    match entry.detail.as_deref() {
        Some(detail) if !detail.is_empty() => {
            format!("{head}\n    {}", detail.replace('\n', "\n    "))
        }
        _ => head,
    }
}

/// Records `report` when valid; an invalid one is dropped silently (TS appReport).
pub fn report(log: &AppLog, report: AppLogReport) {
    let Some(level) = parse_level(&report.level) else {
        return;
    };
    if report.message.is_empty() {
        return;
    }
    let source = report.source.unwrap_or_else(|| String::from("renderer"));
    log.record(level, &source, &report.message, report.detail.as_deref());
}

/// The page's level names, mapped; anything else is `None`.
fn parse_level(level: &str) -> Option<LogLevel> {
    match level {
        "error" => Some(LogLevel::Error),
        "warn" => Some(LogLevel::Warn),
        "info" => Some(LogLevel::Info),
        _ => None,
    }
}

/// The log file's path and every held entry, formatted and joined.
#[must_use]
pub fn read_log(log: &AppLog) -> AppLogText {
    let entries = log.entries();
    let text = entries
        .iter()
        .map(format_log_line)
        .collect::<Vec<_>>()
        .join("\n");
    AppLogText {
        file: log.path().to_string_lossy().into_owned(),
        text,
        complete: entries.len() < MAX_ENTRIES,
    }
}

/// Fetches a request from Zotero's local API on this computer.
///
/// # Errors
/// Returns a `ShellError` when the URL is not Zotero's local API or Zotero does not answer.
#[tauri::command]
#[specta::specta]
pub async fn zotero_local(url: String) -> Result<ZoteroLocalReply, ShellError> {
    fetch_zotero_local(&url).await.map_err(ShellError::from)
}

/// Looks for a newer release; only a packaged build checks.
///
/// # Errors
/// When the releases could not be fetched, so the page can say the check failed.
#[tauri::command]
#[specta::specta]
pub async fn update_check(app: tauri::AppHandle) -> Result<Option<Update>, ShellError> {
    let current = app.package_info().version.to_string();
    let warn = |detail: &str| {
        if let Some(log) = tauri::Manager::try_state::<AppLog>(&app) {
            log.record(LogLevel::Warn, "update", UPDATE_CHECK_FAILED, Some(detail));
        }
    };
    check_update_reply(!tauri::is_dev(), &current, warn)
        .await
        .map_err(ShellError::from)
}

/// Records a line the page reported; always `Ok`, as the TS handler sends nothing back.
///
/// # Errors
/// Never: an invalid report is dropped silently.
#[tauri::command]
#[specta::specta]
pub async fn app_log_report(
    log: tauri::State<'_, AppLog>,
    report: AppLogReport,
) -> Result<(), ShellError> {
    crate::cmd_tools::report(log.inner(), report);
    Ok(())
}

/// The application log, formatted for the panel.
///
/// # Errors
/// Never in practice; the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn app_log_read(log: tauri::State<'_, AppLog>) -> Result<AppLogText, ShellError> {
    Ok(read_log(log.inner()))
}

/// Shows the log file in the system file manager. Takes no path, so the page can open only this file.
///
/// # Errors
/// When the file manager could not be opened, for example before the log file exists.
#[tauri::command]
#[specta::specta]
pub async fn app_log_reveal(
    app: tauri::AppHandle,
    log: tauri::State<'_, AppLog>,
) -> Result<(), ShellError> {
    use tauri_plugin_opener::OpenerExt as _;
    app.opener().reveal_item_in_dir(log.path()).map_err(|_| {
        ShellError::from(
            "Could not show the log file. It may not have been written yet.".to_owned(),
        )
    })
}

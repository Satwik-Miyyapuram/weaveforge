//! Tool commands for the page: LaTeX, the local Zotero, the update check and the app log.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::app_log::{AppLog, AppLogEntry, LogLevel, MAX_ENTRIES};
use crate::commands::ShellError;
use crate::tex::{
    TexCompileResult, TexEngine, TexError, TexSourceFile, TexTool, compile_tex, probe_tex,
};
use crate::update_check::{Update, check_update_reply};
use crate::zotero_local::{ZoteroLocalReply, fetch_zotero_local};

/// A compile's outcome for the page: the PDF as base64.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TexCompileReply {
    /// Whether a PDF was made and the engine did not fail.
    pub ok: bool,
    /// The PDF as standard base64, when there is one.
    pub pdf: Option<String>,
    /// The engine's output, tail-clipped.
    pub log: String,
    /// Where the compile went wrong, per file and line.
    pub errors: Vec<TexError>,
    /// The engine that ran, when one did.
    pub engine: Option<TexEngine>,
}

impl From<TexCompileResult> for TexCompileReply {
    fn from(result: TexCompileResult) -> Self {
        Self {
            ok: result.ok,
            pdf: result.pdf.map(|pdf| STANDARD.encode(pdf)),
            log: result.log,
            errors: result.errors,
            engine: result.engine,
        }
    }
}

/// What a page reports; every field checked before use.
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

/// Compiles `files` with the best engine on this machine, or says why it cannot.
///
/// A non-array project never gets here: serde rejects it first, and the page
/// still shows `NOT_A_PROJECT` for that case.
pub async fn compile(files: Vec<TexSourceFile>, entry_file: String) -> TexCompileReply {
    TexCompileReply::from(compile_tex(&files, &entry_file).await)
}

/// Probes for a LaTeX engine; `None` when there is none.
///
/// # Errors
/// Never: the Rust probe cannot fail, so the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn tex_probe() -> Result<Option<TexTool>, ShellError> {
    Ok(probe_tex().await)
}

/// Compiles a LaTeX project the page hands over, in a directory of its own.
///
/// # Errors
/// Never: a failed compile is reported inside the reply.
#[tauri::command]
#[specta::specta]
pub async fn tex_compile(
    files: Vec<TexSourceFile>,
    entry_file: String,
) -> Result<TexCompileReply, ShellError> {
    Ok(compile(files, entry_file).await)
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
/// Never in practice; the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn update_check(app: tauri::AppHandle) -> Result<Option<Update>, ShellError> {
    let current = app.package_info().version.to_string();
    check_update_reply(!tauri::is_dev(), &current)
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

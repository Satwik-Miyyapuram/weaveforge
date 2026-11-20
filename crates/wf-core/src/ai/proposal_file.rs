//! How AI proposals and AI audit log lines are written as files (files-first, L7):
//! a proposal is one JSON object, an audit chunk one JSON object per line. Both sit
//! under `.weaveforge/ai/`, which syncs. Secrets are refused. Pure: no I/O. File
//! names are left to the caller (`sync::folder_layout`); none are keyed by id here.

use serde_json::{Map, Value};

use crate::settings::secret_guard::check_value;
use crate::settings::settings_file::{ConfigFileError, parse_object, render_object};

/// Reads a proposal file.
///
/// # Errors
///
/// As [`parse_object`].
pub fn parse_proposal_file(text: &str) -> Result<Map<String, Value>, ConfigFileError> {
    parse_object(text)
}

/// Writes a proposal file, refusing secrets.
///
/// # Errors
///
/// As [`render_object`].
pub fn render_proposal_file(proposal: &Map<String, Value>) -> Result<String, ConfigFileError> {
    render_object(proposal)
}

/// One audit-log line (compact JSON plus `\n`), refusing secrets.
///
/// # Errors
///
/// [`ConfigFileError::Secret`].
pub fn render_audit_line(entry: &Map<String, Value>) -> Result<String, ConfigFileError> {
    let value = Value::Object(entry.clone());
    check_value(&value)?;
    let mut line =
        serde_json::to_string(&value).map_err(|e| ConfigFileError::BadJson(e.to_string()))?;
    line.push('\n');
    Ok(line)
}

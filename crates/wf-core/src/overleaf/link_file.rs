//! The `.overleaf.json` file in a report folder: which Overleaf project the report is
//! linked to. It never holds the Overleaf token; that stays in the keychain under the
//! connection name. A file with any other field (a token, say) is refused. Pure.

use serde::{Deserialize, Serialize};

use crate::settings::secret_guard::check_config_write;
use crate::settings::settings_file::ConfigFileError;

/// File name of the link file inside a report folder.
pub const LINK_FILE: &str = ".overleaf.json";

/// A report's link to an Overleaf project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverleafLink {
    /// Name of the Overleaf connection; its token is in the keychain.
    pub connection: String,
    /// The Overleaf project id.
    pub overleaf_project_id: String,
    /// Shown title.
    pub title: String,
    /// The main `.tex` file.
    pub entry_file: String,
    /// The project's web address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_url: Option<String>,
    /// Whether fetching is on.
    pub enabled: bool,
    /// ISO time of the last fetch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_fetched_at: Option<String>,
}

/// Reads a link file.
///
/// # Errors
///
/// [`ConfigFileError::Secret`] when it holds a secret, [`ConfigFileError::BadShape`]
/// for unknown or missing fields.
pub fn parse_overleaf_link(text: &str) -> Result<OverleafLink, ConfigFileError> {
    check_config_write(LINK_FILE, text)?;
    serde_json::from_str(text).map_err(|e| ConfigFileError::BadShape(e.to_string()))
}

/// Writes a link file as pretty JSON with a final newline.
///
/// # Errors
///
/// [`ConfigFileError::Secret`] when a field holds a token-shaped value.
pub fn render_overleaf_link(link: &OverleafLink) -> Result<String, ConfigFileError> {
    let mut text =
        serde_json::to_string_pretty(link).map_err(|e| ConfigFileError::BadJson(e.to_string()))?;
    text.push('\n');
    check_config_write(LINK_FILE, &text)?;
    Ok(text)
}

//! Overleaf read: clones a linked project with git2 and hands back its text files.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::ShellError;
use crate::secrets::Secrets;

/// Shown when no Overleaf token is stored on this machine.
pub const NO_TOKEN: &str =
    "No Overleaf token is stored on this computer. Link the report again to add one.";
/// Shown when the project id is not a safe Overleaf id.
pub const INVALID_PROJECT_ID: &str = "Overleaf project id is invalid.";
/// Shown when the checkout holds more text files than the limit.
pub const FILE_LIMIT: &str = "Overleaf project exceeds the supported file limit.";
/// Shown when a text file or the text in total is over its size limit.
pub const SIZE_LIMIT: &str = "Overleaf project exceeds the supported text size limit.";
/// Shown when a checkout path escapes the checkout folder.
pub const UNSAFE_PATH: &str = "Overleaf checkout contained an unsafe path.";
/// The start of the message when the entry file is missing; the file name follows it.
pub const ENTRY_NOT_FOUND: &str = "Entry file not found: ";

const MAX_FILES: usize = 250;
const MAX_FILE_BYTES: u64 = 2_000_000;
const MAX_TOTAL_BYTES: u64 = 20_000_000;
const TEXT_EXTENSIONS: [&str; 7] = ["tex", "bib", "sty", "cls", "txt", "md", "cfg"];
const MAX_ERROR_CHARS: usize = 500;
const REDACTED_URL: &str = "[redacted-url]";

/// One text file of the project.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverleafFile {
    /// Path from the project root, with `/` separators.
    pub path: String,
    /// The file's text, invalid bytes replaced.
    pub content: String,
}

/// What the page gets (DesktopOverleafSource in apps/web/src/lib/desktop/desktop-bridge.ts).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverleafSource {
    /// The Overleaf project id, as given.
    pub project_id: String,
    /// The entry file, normalised to a `/` path.
    pub entry_file: String,
    /// Every text file of the project.
    pub files: Vec<OverleafFile>,
    /// The project's page on Overleaf.
    pub overleaf_url: String,
}

/// A checkout folder under the temp dir, removed when dropped.
struct Checkout(PathBuf);

impl Checkout {
    fn new() -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        Self(std::env::temp_dir().join(format!(
            "weaveforge-overleaf-{}-{nanos}-{seq}",
            std::process::id()
        )))
    }
}

impl Drop for Checkout {
    fn drop(&mut self) {
        // Git pack files are read-only, and Windows refuses to delete those.
        clear_read_only(&self.0);
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn clear_read_only(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if meta.is_dir()
        && let Ok(entries) = fs::read_dir(path)
    {
        for entry in entries.flatten() {
            clear_read_only(&entry.path());
        }
    }
    let mut permissions = meta.permissions();
    if permissions.readonly() {
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        let _ = fs::set_permissions(path, permissions);
    }
}

fn error_text<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn git_text(error: &git2::Error) -> String {
    error.message().to_owned()
}

/// Answers the token once; a second request is refused so libgit2 does not loop.
fn credentials(token: String) -> git2::RemoteCallbacks<'static> {
    let mut asked = false;
    let mut callbacks = git2::RemoteCallbacks::new();
    let _ = callbacks.credentials(move |_url, _user, _kinds| {
        if asked {
            return Err(git2::Error::from_str("The token was refused."));
        }
        asked = true;
        git2::Cred::userpass_plaintext("git", &token)
    });
    callbacks
}

/// Clones `url` shallow into `dest`, with the token as the password for user `git`.
fn clone_shallow(url: &str, token: &str, dest: &Path) -> Result<(), git2::Error> {
    let mut fetch = git2::FetchOptions::new();
    // libgit2's local transport cannot fetch shallow; only network clones are shallow.
    if url.starts_with("http://") || url.starts_with("https://") {
        let _ = fetch.depth(1);
    }
    let _ = fetch.remote_callbacks(credentials(token.to_owned()));
    let mut builder = git2::build::RepoBuilder::new();
    let _ = builder.fetch_options(fetch);
    builder.clone(url, dest).map(|_| ())
}

/// Runs the blocking clone on its own thread; the caller removes the folder.
async fn clone_into(url: &str, token: &str, dest: PathBuf) -> Result<(), String> {
    let url = url.to_owned();
    let token = token.to_owned();
    tokio::task::spawn_blocking(move || clone_shallow(&url, &token, &dest))
        .await
        .map_err(error_text)?
        .map_err(|error| git_text(&error))
}

/// The Overleaf id rule: letters, digits, `_` and `-` only, so it is safe in a clone URL.
fn is_project_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The entry file as the TS reader had it: `\` becomes `/`, then one leading `./` goes.
fn normalise_entry(entry: &str) -> String {
    let slashed = entry.replace('\\', "/");
    slashed
        .strip_prefix("./")
        .unwrap_or(slashed.as_str())
        .to_owned()
}

fn is_text(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| TEXT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// The path under `root` with `/` separators; anything outside `root` is refused.
fn relative_path(root: &Path, full: &Path) -> Result<String, String> {
    let relative = full.strip_prefix(root).map_err(|_| UNSAFE_PATH)?;
    let text = relative.to_str().ok_or(UNSAFE_PATH)?.replace('\\', "/");
    if text.is_empty()
        || text.starts_with("../")
        || text.contains("/../")
        || Path::new(&text).is_absolute()
    {
        return Err(UNSAFE_PATH.to_owned());
    }
    Ok(text)
}

/// One text file read whole, its size counted against the limits.
fn read_text(root: &Path, full: &Path, total: &mut u64) -> Result<OverleafFile, String> {
    let size = fs::metadata(full).map_err(error_text)?.len();
    if size > MAX_FILE_BYTES || total.saturating_add(size) > MAX_TOTAL_BYTES {
        return Err(SIZE_LIMIT.to_owned());
    }
    let bytes = fs::read(full).map_err(error_text)?;
    *total = total.saturating_add(size);
    Ok(OverleafFile {
        path: relative_path(root, full)?,
        content: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Walks `dir` for text files; symlinks are not followed and `.git` is skipped.
fn visit(
    root: &Path,
    dir: &Path,
    files: &mut Vec<OverleafFile>,
    total: &mut u64,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(error_text)? {
        let entry = entry.map_err(error_text)?;
        if files.len() >= MAX_FILES {
            return Err(FILE_LIMIT.to_owned());
        }
        let full = entry.path();
        let kind = entry.file_type().map_err(error_text)?;
        if kind.is_dir() {
            if entry.file_name().to_str() != Some(".git") {
                visit(root, &full, files, total)?;
            }
            continue;
        }
        if kind.is_file() && is_text(&full) {
            files.push(read_text(root, &full, total)?);
        }
    }
    Ok(())
}

/// Every text file under `root`: relative paths with `/`, `.git` skipped, sorted by path.
///
/// # Errors
/// Returns the page-safe limit message when there are too many files or too much text.
pub fn collect_text_files(root: &Path) -> Result<Vec<OverleafFile>, String> {
    let mut files = Vec::new();
    let mut total = 0_u64;
    visit(root, root, &mut files, &mut total)?;
    // Close to the TS `localeCompare`: case-insensitive first, then exact.
    files.sort_by(|a, b| {
        a.path
            .to_lowercase()
            .cmp(&b.path.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(files)
}

/// Validates the id, shallow-clones `url` into a fresh folder, collects the files and checks the entry file. The folder is removed on every path.
///
/// # Errors
/// Returns the raw message (not yet redacted) when the id is invalid, the clone fails, a limit is hit or the entry file is missing.
pub async fn read_project(
    url: &str,
    project_id: &str,
    entry_file: &str,
    token: &str,
) -> Result<OverleafSource, String> {
    if !is_project_id(project_id) {
        return Err(INVALID_PROJECT_ID.to_owned());
    }
    let checkout = Checkout::new();
    clone_into(url, token, checkout.0.clone()).await?;
    let files = collect_text_files(&checkout.0)?;
    let entry = normalise_entry(entry_file);
    if !files.iter().any(|file| file.path == entry) {
        return Err(format!("{ENTRY_NOT_FOUND}{entry}"));
    }
    Ok(OverleafSource {
        project_id: project_id.to_owned(),
        entry_file: entry,
        files,
        overleaf_url: format!("https://www.overleaf.com/project/{project_id}"),
    })
}

/// The message the page sees: the token and URL passwords removed, at most 500 characters.
#[must_use]
pub fn safe_error(message: &str, token: &str) -> String {
    // The same marker as the TS safeOverleafError.
    let redacted = if token.is_empty() {
        message.to_string()
    } else {
        message.replace(token, "[redacted]")
    };
    strip_url_credentials(&redacted)
        .chars()
        .take(MAX_ERROR_CHARS)
        .collect()
}

/// Each `http(s)://` word loses its username and password; one that does not parse becomes `[redacted-url]`.
fn strip_url_credentials(text: &str) -> String {
    text.split_inclusive(char::is_whitespace)
        .map(|piece| {
            let word = piece.trim_end();
            let gap = piece.get(word.len()..).unwrap_or("");
            format!("{}{gap}", clean_url(word))
        })
        .collect()
}

fn clean_url(word: &str) -> String {
    let lower = word.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return word.to_owned();
    }
    match reqwest::Url::parse(word) {
        Ok(mut url) => {
            let _ = url.set_username("");
            let _ = url.set_password(None);
            url.to_string()
        }
        Err(_) => REDACTED_URL.to_owned(),
    }
}

/// Reads `overleaf-token` from `secrets`, then reads the project from its Overleaf git URL. Every failure comes back redacted.
///
/// # Errors
/// Returns `NO_TOKEN` when nothing is stored, otherwise the page-safe message of the failure.
pub async fn overleaf_read_with(
    secrets: &Secrets,
    project_id: String,
    entry_file: String,
) -> Result<OverleafSource, String> {
    let stored = secrets.read("overleaf-token").map_err(error_text)?;
    let Some(token) = stored.filter(|t| !t.is_empty()) else {
        return Err(NO_TOKEN.to_owned());
    };
    let url = format!("https://git.overleaf.com/{project_id}");
    read_project(&url, &project_id, &entry_file, &token)
        .await
        .map_err(|raw| safe_error(&raw, &token))
}

/// The LaTeX source of one linked Overleaf project, cloned on this machine with the stored token.
///
/// # Errors
/// Returns the page-safe message when no token is stored, the id is invalid, or the clone or read fails.
#[tauri::command]
#[specta::specta]
pub async fn overleaf_read(
    secrets: tauri::State<'_, Secrets>,
    project_id: String,
    entry_file: String,
) -> Result<OverleafSource, ShellError> {
    overleaf_read_with(secrets.inner(), project_id, entry_file)
        .await
        .map_err(ShellError::from)
}

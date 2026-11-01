//! Reads an Overleaf project by cloning its git endpoint into a temp dir.

use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use wf_core::latex_section_tree::{LatexSectionTree, LatexSourceFile, parse_latex_section_tree};

const MAX_FILES: usize = 250;
const MAX_FILE_BYTES: u64 = 2_000_000;
const MAX_TOTAL_BYTES: u64 = 20_000_000;
const TEXT_EXTENSIONS: [&str; 7] = [".tex", ".bib", ".sty", ".cls", ".txt", ".md", ".cfg"];
const FILE_LIMIT_ERROR: &str = "Overleaf project exceeds the supported file limit.";
const SIZE_LIMIT_ERROR: &str = "Overleaf project exceeds the supported text size limit.";
const UNSAFE_PATH_ERROR: &str = "Overleaf checkout contained an unsafe path.";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// What the content route returns (spread into the JSON reply).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverleafRead {
    /// The Overleaf project id that was read.
    pub project_id: String,
    /// The entry file, with `\` as `/` and a leading `./` removed.
    pub entry_file: String,
    /// Every text file in the checkout, sorted.
    pub files: Vec<LatexSourceFile>,
    /// The LaTeX outline built from `files` starting at `entry_file`.
    pub section_tree: LatexSectionTree,
    /// The project's web URL on Overleaf.
    pub overleaf_url: String,
}

/// Removes the temp checkout directory on drop, on every path.
struct TempCheckout(PathBuf);

impl Drop for TempCheckout {
    fn drop(&mut self) {
        let _removed = std::fs::remove_dir_all(&self.0);
    }
}

/// Clones `{git_base}/{project_id}` (depth 1) into a temp dir, reads the text files, removes the dir.
pub async fn read_overleaf_project(
    git_base: &str,
    project_id: &str,
    entry_file: &str,
    token: &str,
) -> Result<OverleafRead, String> {
    if !is_valid_project_id(project_id) {
        return Err("Overleaf project id is invalid.".to_string());
    }
    let url = format!("{}/{project_id}", git_base.trim_end_matches('/'));
    let (id, token) = (project_id.to_string(), token.to_string());
    let joined = tokio::task::spawn_blocking(move || clone_and_collect(&url, &id, &token))
        .await
        .map_err(|err| err.to_string())?;
    let files = joined?;
    build_read(project_id, entry_file, files)
}

/// Text files under `root`, sorted. Exposed for tests.
pub fn collect_text_files(root: &Path) -> Result<Vec<LatexSourceFile>, String> {
    let mut files = Vec::new();
    let mut total = 0;
    visit(root, root, &mut files, &mut total)?;
    files.sort_by(|a, b| {
        a.path
            .to_lowercase()
            .cmp(&b.path.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(files)
}

fn is_valid_project_id(project_id: &str) -> bool {
    !project_id.is_empty()
        && project_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn temp_checkout_path(project_id: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("weaveforge-overleaf-{project_id}-{nanos}-{n}"))
}

/// The blocking half: clone and collect. The checkout is removed when this returns.
fn clone_and_collect(
    url: &str,
    project_id: &str,
    token: &str,
) -> Result<Vec<LatexSourceFile>, String> {
    let checkout = TempCheckout(temp_checkout_path(project_id));
    clone_project(url, &checkout.0, token)?;
    collect_text_files(&checkout.0)
}

fn clone_project(url: &str, dir: &Path, token: &str) -> Result<(), String> {
    let encoded = STANDARD.encode(format!("git:{token}"));
    let auth = format!("Authorization: Basic {encoded}");
    // No user or system git config, no tracing and no askpass, so nothing can
    // rewrite the host or echo the header. Git for Windows maps /dev/null too.
    let output = Command::new("git")
        .args(["clone", "--depth", "1", "--single-branch", "--quiet", "--"])
        .arg(url)
        .arg(dir)
        .env_remove("GIT_TRACE")
        .env_remove("GIT_TRACE_CURL")
        .env_remove("GIT_TRACE_PACKET")
        .env_remove("GIT_CURL_VERBOSE")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "http.extraHeader")
        .env("GIT_CONFIG_VALUE_0", auth)
        .output()
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                "git is not installed on the relay.".to_string()
            } else {
                err.to_string()
            }
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).replace(&encoded, "[redacted]");
    Err(format!("Overleaf git clone failed: {}", stderr.trim()))
}

fn visit(
    root: &Path,
    directory: &Path,
    files: &mut Vec<LatexSourceFile>,
    total: &mut u64,
) -> Result<(), String> {
    let entries = std::fs::read_dir(directory).map_err(|err| err.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        if files.len() >= MAX_FILES {
            return Err(FILE_LIMIT_ERROR.to_string());
        }
        let full = entry.path();
        // `file_type` does not follow symlinks, so a link cannot read outside the checkout.
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        if file_type.is_dir() {
            if entry.file_name() != ".git" {
                visit(root, &full, files, total)?;
            }
        } else if file_type.is_file() && is_text_file(&full) {
            add_file(root, &full, files, total)?;
        }
    }
    Ok(())
}

fn is_text_file(path: &Path) -> bool {
    path.extension().is_some_and(|ext| {
        let dotted = format!(".{}", ext.to_string_lossy().to_lowercase());
        TEXT_EXTENSIONS.contains(&dotted.as_str())
    })
}

fn add_file(
    root: &Path,
    full: &Path,
    files: &mut Vec<LatexSourceFile>,
    total: &mut u64,
) -> Result<(), String> {
    let size = std::fs::metadata(full)
        .map_err(|err| err.to_string())?
        .len();
    if size > MAX_FILE_BYTES || *total + size > MAX_TOTAL_BYTES {
        return Err(SIZE_LIMIT_ERROR.to_string());
    }
    let bytes = std::fs::read(full).map_err(|err| err.to_string())?;
    let path = relative_path(root, full)?;
    files.push(LatexSourceFile {
        path,
        content: String::from_utf8_lossy(&bytes).into_owned(),
    });
    *total += size;
    Ok(())
}

fn relative_path(root: &Path, full: &Path) -> Result<String, String> {
    let relative = full
        .strip_prefix(root)
        .map_err(|_| UNSAFE_PATH_ERROR.to_string())?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => return Err(UNSAFE_PATH_ERROR.to_string()),
        }
    }
    if parts.is_empty() {
        return Err(UNSAFE_PATH_ERROR.to_string());
    }
    Ok(parts.join("/"))
}

fn build_read(
    project_id: &str,
    entry_file: &str,
    files: Vec<LatexSourceFile>,
) -> Result<OverleafRead, String> {
    let slashed = entry_file.replace('\\', "/");
    let entry = slashed.strip_prefix("./").unwrap_or(&slashed).to_string();
    if !files.iter().any(|file| file.path == entry) {
        return Err(format!("Entry file not found: {entry}"));
    }
    let section_tree = parse_latex_section_tree(&files, &entry);
    Ok(OverleafRead {
        project_id: project_id.to_string(),
        entry_file: entry,
        files,
        section_tree,
        overleaf_url: format!("https://www.overleaf.com/project/{project_id}"),
    })
}

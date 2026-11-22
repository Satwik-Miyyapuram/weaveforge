//! Reads an Overleaf project by cloning its git endpoint into a temp dir.

use std::io::Read as _;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

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
const GIT_RUN_FAILED: &str = "Could not run git on the relay.";
const READ_FAILED: &str = "The Overleaf read stopped unexpectedly.";
const TIMED_OUT: &str = "Overleaf git clone timed out.";
const ENTRY_MISSING: &str = "Entry file not found.";
const DEPTH_LIMIT_ERROR: &str = "Overleaf project nests folders too deeply.";
/// Folder levels below the checkout root that are read.
const MAX_DEPTH: usize = 32;
/// The whole clone, start to end, is stopped after this long.
const GIT_TIMEOUT: Duration = Duration::from_secs(120);
/// git's stderr kept for the failure mapping; the rest is dropped.
const MAX_STDERR_BYTES: u64 = 64 * 1024;
/// How often the clone is checked while it runs.
const POLL: Duration = Duration::from_millis(50);
/// How long a failed clone's stderr is waited for after git exits.
const STDERR_WAIT: Duration = Duration::from_secs(2);

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
        // A killed clone's helpers can hold files for a moment (Windows will not delete an
        // open file), so a failed removal is retried briefly.
        for _attempt in 0..20 {
            if std::fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        eprintln!("[overleaf-git] temp checkout not removed");
    }
}

/// Clones `{git_base}/{project_id}` (depth 1) into a temp dir, reads the text files, removes the dir.
pub async fn read_overleaf_project(
    git_base: &str,
    project_id: &str,
    entry_file: &str,
    token: &str,
) -> Result<OverleafRead, String> {
    read_overleaf_project_within(git_base, project_id, entry_file, token, GIT_TIMEOUT).await
}

/// As [`read_overleaf_project`], with the clone stopped (and its checkout removed) after `limit`.
pub async fn read_overleaf_project_within(
    git_base: &str,
    project_id: &str,
    entry_file: &str,
    token: &str,
    limit: Duration,
) -> Result<OverleafRead, String> {
    if !is_valid_project_id(project_id) {
        return Err("Overleaf project id is invalid.".to_string());
    }
    let url = format!("{}/{project_id}", git_base.trim_end_matches('/'));
    let (id, token) = (project_id.to_string(), token.to_string());
    let joined = tokio::task::spawn_blocking(move || clone_and_collect(&url, &id, &token, limit))
        .await
        .map_err(|_| {
            eprintln!("[overleaf-git] read task failed");
            READ_FAILED.to_string()
        })?;
    let files = joined?;
    build_read(project_id, entry_file, files)
}

/// Text files under `root`, sorted. Exposed for tests.
pub fn collect_text_files(root: &Path) -> Result<Vec<LatexSourceFile>, String> {
    let mut files = Vec::new();
    let mut total = 0;
    visit(root, root, 0, &mut files, &mut total)?;
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

/// A temp dir named `weaveforge-overleaf-{project_id}-{32 random hex}`, so no other local
/// user can guess it and plant a file or link there first.
fn temp_checkout_path(project_id: &str) -> Result<PathBuf, String> {
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| {
        eprintln!("[overleaf-git] no random bytes for the temp dir");
        GIT_RUN_FAILED.to_string()
    })?;
    let hex: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(std::env::temp_dir().join(format!("weaveforge-overleaf-{project_id}-{hex}")))
}

/// The blocking half: clone and collect. The checkout is removed when this returns.
fn clone_and_collect(
    url: &str,
    project_id: &str,
    token: &str,
    limit: Duration,
) -> Result<Vec<LatexSourceFile>, String> {
    let checkout = TempCheckout(temp_checkout_path(project_id)?);
    clone_project(url, &checkout.0, token, limit)?;
    collect_text_files(&checkout.0)
}

/// The settings each clone runs with, passed as `GIT_CONFIG_*`: the auth header, no
/// redirects (git sends follow-up requests, header included, to a redirected host), and
/// a stop when the transfer stays under 1000 bytes/s for 30 s. Exposed for tests.
#[must_use]
pub fn clone_settings(auth: String) -> [(&'static str, String); 4] {
    [
        ("http.extraHeader", auth),
        ("http.followRedirects", "false".to_string()),
        ("http.lowSpeedLimit", "1000".to_string()),
        ("http.lowSpeedTime", "30".to_string()),
    ]
}

fn clone_project(url: &str, dir: &Path, token: &str, limit: Duration) -> Result<(), String> {
    let encoded = STANDARD.encode(format!("git:{token}"));
    let auth = format!("Authorization: Basic {encoded}");
    let mut command = Command::new("git");
    let _ = command
        .args(["clone", "--depth", "1", "--single-branch", "--quiet", "--"])
        .arg(url)
        .arg(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    configure_env(&mut command, auth);
    // Its own process group on Unix, so a timeout can stop git's helpers too.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        let _ = command.process_group(0);
    }
    let mut child = command.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "git is not installed on the relay.".to_string()
        } else {
            eprintln!("[overleaf-git] spawn failed: {:?}", err.kind());
            GIT_RUN_FAILED.to_string()
        }
    })?;
    // Read stderr on its own thread so a chatty git cannot fill the pipe and stall.
    let (sender, receiver) = std::sync::mpsc::channel();
    if let Some(mut pipe) = child.stderr.take() {
        let _reader = std::thread::spawn(move || {
            let mut text = Vec::new();
            let _ = pipe.by_ref().take(MAX_STDERR_BYTES).read_to_end(&mut text);
            let _ = sender.send(text);
            // Keep draining past the cap, so git never blocks on a full pipe.
            let _ = std::io::copy(&mut pipe, &mut std::io::sink());
        });
    }
    let status = wait_within(&mut child, limit)?;
    if status.success() {
        return Ok(());
    }
    // A helper left holding the pipe open must not hold the request: wait briefly only.
    let stderr = receiver.recv_timeout(STDERR_WAIT).unwrap_or_default();
    // git's stderr names the URL and the temp path: only a fixed message and a short code leave.
    let (message, code) = clone_failure(&String::from_utf8_lossy(&stderr));
    let exit = status.code().unwrap_or(-1);
    eprintln!("[overleaf-git] clone failed: {code} exit={exit}");
    Err(message.to_string())
}

/// No inherited git settings (config, tracing, askpass, TLS overrides) and no user or
/// system config, so nothing can rewrite the host or echo the header. Names are compared
/// ignoring case, as Windows does. The operator's proxy and CA variables (`HTTPS_PROXY`,
/// `SSL_CERT_FILE`) are kept on purpose. Git for Windows maps /dev/null too.
fn configure_env(command: &mut Command, auth: String) {
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            let _ = command.env_remove(&name);
        }
    }
    let settings = clone_settings(auth);
    let _ = command
        .env_remove("SSH_ASKPASS")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_COUNT", settings.len().to_string());
    for (index, (key, value)) in settings.into_iter().enumerate() {
        let _ = command
            .env(format!("GIT_CONFIG_KEY_{index}"), key)
            .env(format!("GIT_CONFIG_VALUE_{index}"), value);
    }
}

/// Waits for git, stopping it (and its helpers) once `limit` has passed.
fn wait_within(child: &mut Child, limit: Duration) -> Result<ExitStatus, String> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if started.elapsed() < limit => std::thread::sleep(POLL),
            Ok(None) => {
                kill_tree(child);
                eprintln!("[overleaf-git] clone timed out");
                return Err(TIMED_OUT.to_string());
            }
            Err(err) => {
                kill_tree(child);
                eprintln!("[overleaf-git] wait failed: {:?}", err.kind());
                return Err(GIT_RUN_FAILED.to_string());
            }
        }
    }
}

/// Stops git and the helpers it started (`git-remote-https`), then reaps git. The group
/// or tree is stopped first, while git's id still names it.
fn kill_tree(child: &mut Child) {
    let pid = child.id().to_string();
    #[cfg(unix)]
    let mut killer = {
        // git leads its own process group (see `clone_project`); the shell's kill takes -pgid.
        let mut killer = Command::new("sh");
        let _ = killer.args(["-c", "kill -KILL -- -\"$1\"", "sh", &pid]);
        killer
    };
    #[cfg(not(unix))]
    let mut killer = {
        let mut killer = Command::new("taskkill");
        let _ = killer.args(["/T", "/F", "/PID", &pid]);
        killer
    };
    let _ = killer
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
    let _ = child.wait();
}

/// The fixed message and log code for a failed clone, picked from git's stderr. Exposed for tests.
#[must_use]
pub fn clone_failure(stderr: &str) -> (&'static str, &'static str) {
    let text = stderr.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| text.contains(needle));
    if has(&[
        "authentication failed",
        "returned error: 401",
        "returned error: 403",
        "could not read username",
        "could not read password",
    ]) {
        ("Overleaf git clone failed: access refused.", "auth")
    } else if has(&[
        "not found",
        "returned error: 404",
        "does not exist",
        "does not appear to be a git repository",
    ]) {
        ("Overleaf git clone failed: project not found.", "not-found")
    } else if has(&[
        "could not resolve host",
        "failed to connect",
        "couldn't connect",
        "connection refused",
        "connection timed out",
        "operation timed out",
    ]) {
        ("Overleaf git clone failed: could not connect.", "network")
    } else {
        ("Overleaf git clone failed: unknown error.", "other")
    }
}

fn visit(
    root: &Path,
    directory: &Path,
    depth: usize,
    files: &mut Vec<LatexSourceFile>,
    total: &mut u64,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(DEPTH_LIMIT_ERROR.to_string());
    }
    let entries = std::fs::read_dir(directory).map_err(|err| read_failed(&err))?;
    for entry in entries {
        let entry = entry.map_err(|err| read_failed(&err))?;
        let full = entry.path();
        // `file_type` does not follow symlinks, so a link cannot read outside the checkout.
        let file_type = entry.file_type().map_err(|err| read_failed(&err))?;
        if file_type.is_dir() {
            if entry.file_name() != ".git" {
                visit(root, &full, depth + 1, files, total)?;
            }
        } else if file_type.is_file() && is_text_file(&full) {
            if files.len() >= MAX_FILES {
                return Err(FILE_LIMIT_ERROR.to_string());
            }
            add_file(root, &full, files, total)?;
        }
    }
    Ok(())
}

/// A checkout read error: logged by kind only (its text can name the temp path), fixed message out.
fn read_failed(err: &std::io::Error) -> String {
    eprintln!("[overleaf-git] checkout read failed: {:?}", err.kind());
    READ_FAILED.to_string()
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
        .map_err(|err| read_failed(&err))?
        .len();
    if size > MAX_FILE_BYTES || *total + size > MAX_TOTAL_BYTES {
        return Err(SIZE_LIMIT_ERROR.to_string());
    }
    let bytes = std::fs::read(full).map_err(|err| read_failed(&err))?;
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
        // The entry name is the caller's text: it is not echoed back.
        return Err(ENTRY_MISSING.to_string());
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

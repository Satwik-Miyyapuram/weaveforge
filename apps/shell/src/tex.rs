//! LaTeX compile. Ported from apps/desktop/src/tex.ts.

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use tokio::io::{AsyncRead, AsyncReadExt};

use crate::fetch::is_js_space;

/// Long enough for a thesis with every figure in it.
pub const COMPILE_TIMEOUT: Duration = Duration::from_secs(300);
/// How long an engine has to answer `--version`.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// The end of the log is kept, in UTF-16 units.
pub const MAX_LOG_CHARS: usize = 200_000;
/// Total source bytes a project may send.
pub const MAX_TOTAL_BYTES: usize = 40_000_000;
/// Source files a project may send.
pub const MAX_FILES: usize = 500;
/// Reason given when no engine is installed.
pub const NO_ENGINE: &str = "No TeX installation was found on this computer.";
/// Reason given when the project has too many files.
pub const TOO_MANY_FILES: &str = "That project has too many files to compile here.";
/// Reason given when the project has too many bytes.
pub const TOO_LARGE: &str = "That project is too large to compile here.";
/// Reason given when a compile fails with no parseable error.
pub const COMPILE_FAILED: &str = "The compile failed; the log below is the whole of it.";
/// Reason given when a compile runs past `COMPILE_TIMEOUT`.
pub const TIMED_OUT: &str = "The compile ran past the time limit.";
/// Reason given when the engine probe itself breaks.
pub const PROBE_FAILED: &str = "Could not look for a LaTeX engine on this computer.";
/// Reason given when the request is not a project.
pub const NOT_A_PROJECT: &str = "That is not a project to compile.";
/// Reason given when the build directory cannot be made.
pub const NOT_STARTED: &str = "The compile could not be started.";
/// Most the engine may print on each of stdout and stderr (TS `maxBuffer`); past it the compile fails.
pub const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

/// Counter that keeps build directory names unique within a process.
static BUILD_SEQ: AtomicU64 = AtomicU64::new(0);

/// The located-error shape: `file:line: message`, with an optional `./` prefix.
/// Built once; `None` only if the pattern is invalid, which would leave located errors unparsed.
static LOCATED: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^(?:\./)?([^{JS_SPACE}:][^:]*):([0-9]+):[{JS_SPACE}]*([^\n\r\x{{2028}}\x{{2029}}]+)$",
        JS_SPACE = JS_SPACE
    ))
    .ok()
});

/// JS `\s` and `trim()` whitespace, as the inside of a regex character class.
const JS_SPACE: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// The engines worth trying, best first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum TexEngine {
    /// Decides how many passes the document needs, including bibliography passes.
    Latexmk,
    /// Self-contained; does the same job as latexmk.
    Tectonic,
    /// Single pass fallback; cross-references may be one compile behind.
    Pdflatex,
}

impl TexEngine {
    /// Every engine, in probe order.
    pub const ALL: [TexEngine; 3] = [TexEngine::Latexmk, TexEngine::Tectonic, TexEngine::Pdflatex];

    /// The executable name for this engine.
    #[must_use]
    pub const fn command(self) -> &'static str {
        match self {
            TexEngine::Latexmk => "latexmk",
            TexEngine::Tectonic => "tectonic",
            TexEngine::Pdflatex => "pdflatex",
        }
    }
}

/// An engine found on this machine.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct TexTool {
    /// Which engine this is.
    pub kind: TexEngine,
    /// The executable that was run.
    pub command: String,
    /// The first line of its `--version`, for the settings panel to show.
    pub version: String,
}

/// One source file the page sent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, specta::Type)]
pub struct TexSourceFile {
    /// Path relative to the build directory.
    pub path: String,
    /// The file's text.
    pub content: String,
}

/// One error from a TeX log.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct TexError {
    /// The file the error is in.
    pub file: String,
    /// 1-based, or 0 when the engine did not say.
    pub line: u32,
    /// The engine's reason.
    pub message: String,
}

/// The outcome of a compile.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct TexCompileResult {
    /// True when a PDF was produced and the engine exited cleanly.
    pub ok: bool,
    /// The PDF bytes, or `None` when the run produced none.
    pub pdf: Option<Vec<u8>>,
    /// The engine's log, trimmed to the end where the failure is.
    pub log: String,
    /// Errors parsed from the log.
    pub errors: Vec<TexError>,
    /// The engine that ran, or `None` when none did.
    pub engine: Option<TexEngine>,
}

/// A path that stays inside the build directory, or the reason it does not.
#[must_use = "the checked path, or the refusal, is the result"]
pub fn safe_relative(candidate: &str) -> Result<String, String> {
    let slashed = candidate.replace('\\', "/");
    let c = slashed
        .strip_prefix("./")
        .unwrap_or(slashed.as_str())
        .to_string();
    if c.is_empty()
        || c.starts_with('/')
        || has_drive_letter(&c)
        || c.split('/').any(|part| part == ".." || part.is_empty())
    {
        return Err(format!(
            "Refusing to write '{candidate}': it leaves the build directory."
        ));
    }
    // latexmk's rc files are Perl; refusing them means no engine ever runs one.
    let last = c.rsplit('/').next().unwrap_or(c.as_str());
    if last.eq_ignore_ascii_case("latexmkrc") || last.eq_ignore_ascii_case(".latexmkrc") {
        return Err(format!(
            "Refusing to write '{candidate}': latexmk would run it as a script."
        ));
    }
    Ok(c)
}

/// True for a path starting with an ASCII drive letter and a colon.
fn has_drive_letter(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.first().is_some_and(u8::is_ascii_alphabetic) && bytes.get(1) == Some(&b':')
}

/// The argument vector each engine is run with, so it writes into the build directory.
#[must_use]
pub fn args_for(engine: TexEngine, entry: &str) -> Vec<String> {
    match engine {
        TexEngine::Latexmk => {
            let mut args = owned(&[
                "-norc",
                "-pdf",
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
            ]);
            args.push(format!("./{entry}"));
            args
        }
        TexEngine::Tectonic => owned(&["--keep-logs", "--", entry]),
        TexEngine::Pdflatex => {
            let mut args = owned(&[
                "-no-shell-escape",
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
            ]);
            args.push(format!("./{entry}"));
            args
        }
    }
}

/// Copies a list of string slices into owned strings.
fn owned(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

/// The errors in a TeX log, from either the `file:line:` shape or the `!` shape.
#[must_use]
pub fn parse_tex_log(log: &str, entry: &str) -> Vec<TexError> {
    let lines: Vec<&str> = log.split('\n').collect();
    let mut errors = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if let Some(caps) = LOCATED.as_ref().and_then(|re| re.captures(line)) {
            if let Some(error) = located_error(&caps) {
                errors.push(error);
            }
            continue;
        }
        let Some(rest) = line.strip_prefix('!') else {
            continue;
        };
        let message = rest.trim_matches(is_js_space);
        if message.is_empty() {
            continue;
        }
        let at = bang_line_number(&lines, i);
        errors.push(TexError {
            file: entry.to_string(),
            line: at,
            message: message.to_string(),
        });
    }
    // One report per place: a halting run prints the same error to log and stdout.
    let mut seen = HashSet::new();
    errors.retain(|e: &TexError| seen.insert((e.file.clone(), e.line, e.message.clone())));
    errors
}

/// Builds the error for a located line. A line number past `u32` is kept as `u32::MAX`.
fn located_error(caps: &regex::Captures<'_>) -> Option<TexError> {
    let file = caps.get(1)?.as_str();
    let line = caps.get(2)?.as_str().parse::<u32>().unwrap_or(u32::MAX);
    let message = caps.get(3)?.as_str().trim_matches(is_js_space);
    Some(TexError {
        file: file.strip_prefix("./").unwrap_or(file).to_string(),
        line,
        message: message.to_string(),
    })
}

/// The line number from an `l.N` line within the five lines after a `!` line, or 0.
fn bang_line_number(lines: &[&str], start: usize) -> u32 {
    let end = start.saturating_add(6).min(lines.len());
    for j in (start + 1)..end {
        let Some(line) = lines.get(j) else { continue };
        let Some(rest) = line.strip_prefix("l.") else {
            continue;
        };
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        if !digits.is_empty() {
            return digits.parse::<u32>().unwrap_or(0);
        }
    }
    0
}

/// The last `max_units` UTF-16 units of `text`, cut on a character boundary.
#[must_use]
pub fn tail(text: &str, max_units: usize) -> String {
    let mut units = 0usize;
    let mut start = text.len();
    for (at, ch) in text.char_indices().rev() {
        let width = ch.len_utf16();
        if units + width > max_units {
            break;
        }
        units += width;
        start = at;
    }
    text.get(start..).unwrap_or("").to_string()
}

/// Hides the console window a child would otherwise open on Windows.
#[cfg(windows)]
fn hide_window(cmd: &mut tokio::process::Command) {
    let _ = cmd.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
}

/// Nothing to hide on other platforms.
#[cfg(not(windows))]
fn hide_window(_cmd: &mut tokio::process::Command) {}

/// Asks one engine for its version. A missing or failing binary is `None`, not an error.
#[must_use]
pub async fn probe_engine(kind: TexEngine, command: &str) -> Option<TexTool> {
    let mut cmd = tokio::process::Command::new(command);
    let _ = cmd.arg("--version").stdin(Stdio::null()).kill_on_drop(true);
    hide_window(&mut cmd);
    let output = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    let text = String::from_utf8_lossy(raw);
    let first = text
        .split('\n')
        .next()
        .unwrap_or("")
        .trim_matches(is_js_space);
    let version = if first.is_empty() {
        kind.command()
    } else {
        first
    };
    Some(TexTool {
        kind,
        command: command.to_string(),
        version: version.to_string(),
    })
}

/// The first engine on this machine that answers `--version`, or `None`.
#[must_use]
pub async fn probe_tex() -> Option<TexTool> {
    for kind in TexEngine::ALL {
        if let Some(tool) = probe_engine(kind, kind.command()).await {
            return Some(tool);
        }
    }
    None
}

/// A result for a compile that never started: no PDF, one reason, no engine.
fn refused(file: &str, message: &str) -> TexCompileResult {
    TexCompileResult {
        ok: false,
        pdf: None,
        log: String::new(),
        errors: vec![TexError {
            file: file.to_string(),
            line: 0,
            message: message.to_string(),
        }],
        engine: None,
    }
}

/// Compiles `files` with `tool` in a fresh directory under `base_tmp`, or explains why not.
#[must_use]
pub async fn compile_tex_in(
    base_tmp: &Path,
    files: &[TexSourceFile],
    entry: &str,
    tool: Option<&TexTool>,
) -> TexCompileResult {
    let Some(tool) = tool else {
        return refused(entry, NO_ENGINE);
    };
    let relative_entry = match safe_relative(entry) {
        Ok(relative) => relative,
        Err(message) => return refused(entry, &message),
    };
    let build = match BuildDir::create(base_tmp) {
        Ok(build) => build,
        Err(_) => return refused(entry, NOT_STARTED),
    };
    if let Err(message) = write_sources(build.path(), files) {
        return refused(entry, &message);
    }
    let (failed, output) = run_engine(tool, build.path(), &relative_entry).await;
    let stem = without_tex(&relative_entry);
    let file_log = read_text(&build.path().join(format!("{stem}.log")));
    let log = tail(
        format!("{file_log}\n{output}").trim_matches(is_js_space),
        MAX_LOG_CHARS,
    );
    let pdf = fs::read(build.path().join(format!("{stem}.pdf"))).ok();
    let ok = pdf.is_some() && !failed;
    let mut errors = parse_tex_log(&log, &relative_entry);
    if failed && errors.is_empty() {
        errors.push(TexError {
            file: relative_entry.clone(),
            line: 0,
            message: COMPILE_FAILED.to_string(),
        });
    }
    TexCompileResult {
        ok,
        pdf,
        log,
        errors,
        engine: Some(tool.kind),
    }
}

/// Compiles `files` with the best engine on this machine, in the system temp directory.
#[must_use]
pub async fn compile_tex(files: &[TexSourceFile], entry: &str) -> TexCompileResult {
    let tool = probe_tex().await;
    compile_tex_in(&std::env::temp_dir(), files, entry, tool.as_ref()).await
}

/// Writes each source under `root`, refusing a project that is too big or too many.
fn write_sources(root: &Path, files: &[TexSourceFile]) -> Result<(), String> {
    if files.len() > MAX_FILES {
        return Err(TOO_MANY_FILES.to_string());
    }
    let mut total = 0usize;
    for file in files {
        total = total.saturating_add(file.content.len());
        if total > MAX_TOTAL_BYTES {
            return Err(TOO_LARGE.to_string());
        }
        let at = root.join(safe_relative(&file.path)?);
        if let Some(parent) = at.parent() {
            fs::create_dir_all(parent).map_err(|_| NOT_STARTED.to_string())?;
        }
        fs::write(&at, file.content.as_bytes()).map_err(|_| NOT_STARTED.to_string())?;
    }
    Ok(())
}

/// Runs the engine in `dir`; answers whether it failed and its combined output.
/// Output past [`MAX_OUTPUT_BYTES`] on either stream stops the engine (dropping the child kills it).
async fn run_engine(tool: &TexTool, dir: &Path, entry: &str) -> (bool, String) {
    let mut cmd = tokio::process::Command::new(&tool.command);
    let _ = cmd
        .args(args_for(tool.kind, entry))
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hide_window(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => return (true, format!("\n{err}")),
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let run = async move {
        let (out, err) =
            tokio::try_join!(read_stream(stdout, "stdout"), read_stream(stderr, "stderr"))?;
        let status = child.wait().await.map_err(|e| e.to_string())?;
        Ok::<_, String>((status.success(), out, err))
    };
    match tokio::time::timeout(COMPILE_TIMEOUT, run).await {
        Err(_) => (true, TIMED_OUT.to_string()),
        Ok(Err(message)) => (true, format!("\n{message}")),
        Ok(Ok((success, out, err))) => (
            !success,
            format!(
                "{}\n{}",
                String::from_utf8_lossy(&out),
                String::from_utf8_lossy(&err)
            ),
        ),
    }
}

/// Reads one output stream, failing once it passes [`MAX_OUTPUT_BYTES`] (Node's maxBuffer error text).
async fn read_stream<R: AsyncRead + Unpin>(
    stream: Option<R>,
    name: &str,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let Some(stream) = stream else {
        return Ok(bytes);
    };
    let limit = u64::try_from(MAX_OUTPUT_BYTES)
        .unwrap_or(u64::MAX)
        .saturating_add(1);
    let _ = stream
        .take(limit)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(format!("{name} maxBuffer length exceeded"));
    }
    Ok(bytes)
}

/// Reads a file as text, or `""` when it is missing.
fn read_text(path: &Path) -> String {
    fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// The entry name without a trailing `.tex` (any case), as the engine names its outputs.
fn without_tex(entry: &str) -> &str {
    let at = entry.len().saturating_sub(4);
    match entry.get(at..) {
        Some(tail) if tail.eq_ignore_ascii_case(".tex") => entry.get(..at).unwrap_or(entry),
        _ => entry,
    }
}

/// Makes one directory only its owner can enter (TS `mkdtemp` is 0700).
fn create_private_dir(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new().mode(0o700).create(path)
    }
    #[cfg(not(unix))]
    {
        fs::create_dir(path)
    }
}

/// A fresh directory under the base temp dir, removed when dropped.
struct BuildDir(PathBuf);

impl BuildDir {
    /// Makes a uniquely named directory, retrying past any name already taken.
    fn create(base: &Path) -> std::io::Result<Self> {
        loop {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let seq = BUILD_SEQ.fetch_add(1, Ordering::Relaxed);
            let path = base.join(format!(
                "weaveforge-tex-{}-{nanos}-{seq}",
                std::process::id()
            ));
            match create_private_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            }
        }
    }

    /// The directory itself.
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for BuildDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

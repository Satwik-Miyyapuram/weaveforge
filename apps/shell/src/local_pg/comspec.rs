//! Runs the Postgres tools' shell commands without the user's `cmd.exe` AutoRun.
//!
//! `initdb`, `postgres` and `pg_ctl` check `postgres -V` through `popen`, which starts
//! `%ComSpec% /c …`. A cmd AutoRun that prints (a banner, say) lands in that output, and the tool
//! then fails ("was not the same version", "could not locate matching postgres executable"). So
//! every Postgres tool gets `ComSpec` pointed at the shell's own exe with `MARKER` set, and that
//! exe, started as `<exe> /c <command>`, runs `cmd.exe /d /c <command>`: `/d` skips AutoRun. The
//! user's registry is never touched.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Set (to `1`) in the environment of a tool whose `ComSpec` is the shim.
pub const MARKER: &str = "WEAVEFORGE_COMSPEC_SHIM";

static SHIM_EXE: OnceLock<PathBuf> = OnceLock::new();

/// Makes `exe` the shim for tools started after this; the app passes its own exe, which calls
/// `run_if_requested` first thing. Only the first call counts.
pub fn enable(exe: PathBuf) {
    let _ = SHIM_EXE.set(exe);
}

/// The environment a Postgres tool gets: `ComSpec` and `MARKER`, once `enable` was called and only
/// on Windows; nothing otherwise.
#[must_use]
pub fn env() -> Vec<(&'static str, OsString)> {
    match SHIM_EXE.get() {
        Some(exe) if cfg!(windows) => vec![
            ("ComSpec", exe.clone().into_os_string()),
            (MARKER, "1".into()),
        ],
        _ => Vec::new(),
    }
}

/// The command after `<program> /c` in a raw command line, untouched (quotes and all), as
/// `cmd.exe` would see it; `None` when the line is not of that form.
#[must_use]
pub fn command_after_c(line: &str) -> Option<&str> {
    let line = line.trim_start();
    // The program: quoted up to the next quote, else up to whitespace (the CRT's rule for argv[0]).
    let rest = match line.strip_prefix('"') {
        Some(quoted) => &quoted[quoted.find('"')? + 1..],
        None => line.find(char::is_whitespace).map_or("", |i| &line[i..]),
    };
    let rest = rest.trim_start();
    let flag = rest.get(..2)?;
    if !flag.eq_ignore_ascii_case("/c") {
        return None;
    }
    let after = &rest[2..];
    match after.chars().next() {
        None => Some(""),
        Some(c) if c.is_whitespace() => Some(after.trim_start()),
        Some(_) => None,
    }
}

/// When this process was started as the shim, runs the command through `cmd.exe /d /c` with the
/// same stdio and returns its exit code; `None` for a normal start.
#[must_use]
pub fn run_if_requested() -> Option<i32> {
    if std::env::var_os(MARKER).is_none_or(|v| v != "1") {
        return None;
    }
    run_without_autorun()
}

#[cfg(windows)]
fn run_without_autorun() -> Option<i32> {
    use std::os::windows::process::CommandExt;

    // SAFETY: GetCommandLineW returns this process's command line, valid for its lifetime.
    #[allow(unsafe_code)]
    let line =
        unsafe { windows::Win32::System::Environment::GetCommandLineW().to_string() }.ok()?;
    let command = command_after_c(&line)?;
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let cmd = PathBuf::from(root).join("System32").join("cmd.exe");
    let status = std::process::Command::new(cmd)
        .env_remove(MARKER)
        .raw_arg("/d /c")
        .raw_arg(command)
        // The release exe has no console, so cmd would open one; pipes still pass through.
        .creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0)
        .status();
    Some(status.map_or(1, |s| s.code().unwrap_or(1)))
}

#[cfg(not(windows))]
fn run_without_autorun() -> Option<i32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_command_after_a_quoted_or_bare_program() {
        let quoted = r#""C:\Program Files\WF\wf.exe" /c ""C:\pg\postgres.exe" -V""#;
        assert_eq!(
            command_after_c(quoted),
            Some(r#"""C:\pg\postgres.exe" -V""#)
        );
        assert_eq!(command_after_c(r"wf.exe /C dir  x"), Some("dir  x"));
        assert_eq!(command_after_c("wf.exe /c"), Some(""));
    }

    #[test]
    fn other_lines_are_not_shim_calls() {
        assert_eq!(command_after_c("wf.exe"), None);
        assert_eq!(command_after_c("wf.exe --mcp-bridge"), None);
        assert_eq!(command_after_c("wf.exe /cx dir"), None);
        assert_eq!(command_after_c(r#""unterminated /c dir"#), None);
    }

    #[test]
    fn a_normal_start_is_not_the_shim() {
        // Tests run without the marker.
        assert_eq!(run_if_requested(), None);
    }
}

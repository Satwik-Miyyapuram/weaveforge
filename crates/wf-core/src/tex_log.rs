//! TeX engine argument vectors and TeX log error parsing. Pure: the probe, the compile and the
//! file writes stay in the desktop shell.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

/// The TeX engines the desktop shell knows how to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "TexEngineKind"))]
pub enum TexEngine {
    /// `latexmk`, which runs the whole build.
    Latexmk,
    /// `tectonic`, a self-contained engine.
    Tectonic,
    /// `pdflatex`, run once.
    Pdflatex,
}

/// One error read from a TeX log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "TexErrorRow"))]
pub struct TexError {
    /// The file the error is in, relative to the project.
    pub file: String,
    /// The line number, or `0` when the log does not give one.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub line: u64,
    /// The error message, trimmed.
    pub message: String,
}

/// The argument vector for `engine` compiling `entry`.
///
/// `./` is put before a latexmk or pdflatex entry so a file named `-something.tex` is a file,
/// not an option. Neither runs an rc file or a shell escape. Tectonic gets `--keep-logs`, so
/// the `.log` sits beside the PDF, and `--` before the entry, for the same reason as `./`.
#[must_use]
pub fn engine_args(engine: TexEngine, entry: &str) -> Vec<String> {
    let dotted = format!("./{entry}");
    let args: &[&str] = match engine {
        TexEngine::Latexmk => &[
            "-norc",
            "-pdf",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
        ],
        TexEngine::Tectonic => return vec!["--keep-logs".into(), "--".into(), entry.into()],
        TexEngine::Pdflatex => &[
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
        ],
    };
    let mut out: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
    out.push(dotted);
    out
}

/// `file:line: message`, as `-file-line-error` prints it. The message may not run into a line
/// break; `.` excludes `\r`, `\n`, U+2028 and U+2029, as JavaScript's does.
static LOCATED_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"^(?:\./)?([^\s:][^:]*):(\d+):\s*([^\r\n\x{2028}\x{2029}]+)$").ok()
});

/// `l.12` on the line after a `!` error, carrying its line number.
static NUMBERED_RE: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"^l\.(\d+)").ok());

/// The errors out of a TeX log, one per place.
///
/// Two shapes, because the engines disagree. `-file-line-error` gives `./main.tex:12: message`.
/// Without it, an error is a line starting `!`, with its line number on a later `l.12` line
/// within the next five lines. A run that halts prints the same error to the log and to stdout,
/// so duplicates by file, line and message are dropped.
#[must_use]
pub fn parse_tex_log(log: &str, entry: &str) -> Vec<TexError> {
    let lines: Vec<&str> = log.split('\n').collect();
    let mut errors = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if let Some(caps) = LOCATED_RE.as_ref().and_then(|re| re.captures(line)) {
            let file = caps.get(1).map_or("", |m| m.as_str());
            let file = file.strip_prefix("./").unwrap_or(file);
            let number = caps.get(2).map_or("", |m| m.as_str());
            let message = caps.get(3).map_or("", |m| m.as_str());
            errors.push(TexError {
                file: file.to_owned(),
                line: saturating_number(number),
                message: message.trim().to_owned(),
            });
            continue;
        }
        let Some(rest) = line.strip_prefix('!') else {
            continue;
        };
        let message = rest.trim();
        if message.is_empty() {
            continue;
        }
        let at = lines
            .iter()
            .skip(i + 1)
            .take(5)
            .find_map(|next| {
                NUMBERED_RE
                    .as_ref()
                    .and_then(|re| re.captures(next))
                    .and_then(|caps| caps.get(1))
                    .map(|m| saturating_number(m.as_str()))
            })
            .unwrap_or(0);
        errors.push(TexError {
            file: entry.to_owned(),
            line: at,
            message: message.to_owned(),
        });
    }
    let mut seen = HashSet::new();
    errors.retain(|error| seen.insert(format!("{}:{}:{}", error.file, error.line, error.message)));
    errors
}

/// A run of ASCII digits as a number, saturating at `u64::MAX` rather than failing.
fn saturating_number(digits: &str) -> u64 {
    digits.bytes().fold(0_u64, |acc, b| {
        acc.saturating_mul(10)
            .saturating_add(u64::from(b.saturating_sub(b'0')))
    })
}

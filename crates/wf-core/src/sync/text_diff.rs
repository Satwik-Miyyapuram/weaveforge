//! Port of `packages/core/src/workspace/text-diff.ts`: the body line diff, its
//! hunks, per-hunk merges and git-style conflict markers.

use std::collections::BTreeMap;

use crate::search::js_text::is_js_whitespace;

/// Label on the opening marker this app writes; detection matches it exactly.
pub const MARKER_OURS: &str = "<<<<<<< this app";
/// The separator line between the two copies.
pub const MARKER_SEPARATOR: &str = "=======";
/// Label on the closing marker this app writes; detection matches it exactly.
pub const MARKER_THEIRS: &str = ">>>>>>> the folder";

/// Ceiling on the LCS table; past it the diff is one hunk holding both copies whole.
const MAX_DIFF_CELLS: usize = 4_000_000;

/// Which side a diff line belongs to, or whether both sides agree on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffOp {
    /// Present on both sides at this point.
    Same,
    /// Only in ours.
    Ours,
    /// Only in theirs.
    Theirs,
}

/// One line of the interleaved view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffLine {
    /// Which side the line belongs to.
    pub op: DiffOp,
    /// The line text, without its newline.
    pub text: String,
}

/// A run of disagreeing lines; either side may be empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffHunk {
    /// Position of the hunk among the hunks, from zero.
    pub index: usize,
    /// Ours lines in this run, in order.
    pub ours: Vec<String>,
    /// Theirs lines in this run, in order.
    pub theirs: Vec<String>,
}

/// The interleaved lines and the hunks grouped from them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodyDiff {
    /// Every line, agreed and disagreeing, in order.
    pub lines: Vec<DiffLine>,
    /// The runs of disagreeing lines.
    pub hunks: Vec<DiffHunk>,
}

/// What a hunk may be resolved to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HunkPick {
    /// Keep ours.
    Ours,
    /// Take theirs.
    Theirs,
    /// Ours, then theirs.
    Both,
}

/// Normalises line endings to `\n` and splits; `""` is one empty line, as in JS.
fn split_lines(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_owned)
        .collect()
}

fn line(op: DiffOp, text: &str) -> DiffLine {
    DiffLine {
        op,
        text: text.to_owned(),
    }
}

/// Suffix LCS lengths as a flat `(n + 1) x (m + 1)` table, so out-of-range reads are 0.
struct Lcs {
    cols: usize,
    cells: Vec<u32>,
}

impl Lcs {
    fn at(&self, i: usize, j: usize) -> u32 {
        self.cells.get(i * self.cols + j).copied().unwrap_or(0)
    }

    fn set(&mut self, i: usize, j: usize, value: u32) {
        if let Some(cell) = self.cells.get_mut(i * self.cols + j) {
            *cell = value;
        }
    }
}

fn lcs_table(ours: &[String], theirs: &[String]) -> Lcs {
    let (n, m) = (ours.len(), theirs.len());
    let cols = m + 1;
    let mut table = Lcs {
        cols,
        cells: vec![0; (n + 1) * cols],
    };
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            let value = match (ours.get(i), theirs.get(j)) {
                (Some(a), Some(b)) if a == b => table.at(i + 1, j + 1) + 1,
                _ => table.at(i + 1, j).max(table.at(i, j + 1)),
            };
            table.set(i, j, value);
        }
    }
    table
}

/// The interleaved line view, with no hunk grouping.
fn diff_lines(ours_text: &str, theirs_text: &str) -> Vec<DiffLine> {
    let ours = split_lines(ours_text);
    let theirs = split_lines(theirs_text);

    // Past the ceiling no clever answer is worth the memory: one run holding both copies.
    if ours.len().saturating_mul(theirs.len()) > MAX_DIFF_CELLS {
        return ours
            .iter()
            .map(|t| line(DiffOp::Ours, t))
            .chain(theirs.iter().map(|t| line(DiffOp::Theirs, t)))
            .collect();
    }

    let table = lcs_table(&ours, &theirs);
    let mut out = Vec::with_capacity(ours.len() + theirs.len());
    let (mut i, mut j) = (0, 0);
    while let (Some(a), Some(b)) = (ours.get(i), theirs.get(j)) {
        if a == b {
            out.push(line(DiffOp::Same, a));
            i += 1;
            j += 1;
        } else if table.at(i + 1, j) >= table.at(i, j + 1) {
            out.push(line(DiffOp::Ours, a));
            i += 1;
        } else {
            out.push(line(DiffOp::Theirs, b));
            j += 1;
        }
    }
    out.extend(ours.iter().skip(i).map(|t| line(DiffOp::Ours, t)));
    out.extend(theirs.iter().skip(j).map(|t| line(DiffOp::Theirs, t)));
    out
}

fn agreed(line: &DiffLine) -> bool {
    line.op == DiffOp::Same
}

fn side_texts(run: &[DiffLine], op: DiffOp) -> Vec<String> {
    run.iter()
        .filter(|l| l.op == op)
        .map(|l| l.text.clone())
        .collect()
}

/// The interleaved lines, grouped into the runs a person chooses between.
#[must_use]
pub fn diff_body(ours_text: &str, theirs_text: &str) -> BodyDiff {
    let lines = diff_lines(ours_text, theirs_text);
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut open = false;

    for line in &lines {
        if agreed(line) {
            open = false;
            continue;
        }
        if !open {
            hunks.push(DiffHunk {
                index: hunks.len(),
                ours: Vec::new(),
                theirs: Vec::new(),
            });
            open = true;
        }
        if let Some(hunk) = hunks.last_mut() {
            let side = if line.op == DiffOp::Ours {
                &mut hunk.ours
            } else {
                &mut hunk.theirs
            };
            side.push(line.text.clone());
        }
    }

    BodyDiff { lines, hunks }
}

fn resolve(run: &[DiffLine], pick: HunkPick) -> Vec<String> {
    match pick {
        HunkPick::Ours => side_texts(run, DiffOp::Ours),
        HunkPick::Theirs => side_texts(run, DiffOp::Theirs),
        HunkPick::Both => {
            let mut texts = side_texts(run, DiffOp::Ours);
            texts.extend(side_texts(run, DiffOp::Theirs));
            texts
        }
    }
}

/// Compose the body from a choice per hunk; an unchosen hunk keeps ours, so an
/// unsettled difference never writes a guess.
#[must_use]
pub fn merge_hunks(
    ours_text: &str,
    theirs_text: &str,
    picks: &BTreeMap<usize, HunkPick>,
) -> String {
    let lines = diff_lines(ours_text, theirs_text);
    let mut out: Vec<String> = Vec::new();
    let mut index: usize = 0;

    for run in lines.chunk_by(|a, b| agreed(a) == agreed(b)) {
        if run.first().is_some_and(agreed) {
            out.extend(run.iter().map(|l| l.text.clone()));
        } else {
            let pick = picks.get(&index).copied().unwrap_or(HunkPick::Ours);
            out.extend(resolve(run, pick));
            index += 1;
        }
    }

    out.join("\n")
}

/// Write git-style conflict markers around the disagreeing hunks only, leaving
/// agreed lines as clean context. If nothing agrees, the markers wrap everything.
#[must_use]
pub fn write_conflict_markers(ours_text: &str, theirs_text: &str) -> String {
    let lines = diff_lines(ours_text, theirs_text);
    if lines.is_empty() {
        return String::new();
    }
    if lines.iter().all(agreed) {
        return ours_text.to_owned();
    }

    let mut out: Vec<String> = Vec::new();
    for run in lines.chunk_by(|a, b| agreed(a) == agreed(b)) {
        if run.first().is_some_and(agreed) {
            out.extend(run.iter().map(|l| l.text.clone()));
            continue;
        }
        out.push(MARKER_OURS.to_owned());
        out.extend(side_texts(run, DiffOp::Ours));
        out.push(MARKER_SEPARATOR.to_owned());
        out.extend(side_texts(run, DiffOp::Theirs));
        out.push(MARKER_THEIRS.to_owned());
    }

    out.join("\n")
}

/// Seven `ch` in a row, then whitespace or the end of the line.
fn marker_run(line: &str, ch: char) -> bool {
    let mut rest = line.chars();
    for _ in 0..7 {
        if rest.next() != Some(ch) {
            return false;
        }
    }
    rest.next().is_none_or(is_js_whitespace)
}

/// Whether the text still holds conflict markers, this app's or git's standard ones.
/// A bare `=======` is a markdown setext heading, so it is not matched alone.
#[must_use]
pub fn has_conflict_markers(text: &str) -> bool {
    let lines = split_lines(text);
    let Some(open) = lines
        .iter()
        .position(|l| l.starts_with(MARKER_OURS) || marker_run(l, '<'))
    else {
        return false;
    };
    lines
        .iter()
        .skip(open + 1)
        .any(|l| l.starts_with(MARKER_THEIRS) || marker_run(l, '>'))
}

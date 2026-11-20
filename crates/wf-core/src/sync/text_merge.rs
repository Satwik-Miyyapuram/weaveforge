//! Three-way line merge of a note body (diff3): two copies edited from one base.
//!
//! A run of lines only one side changed takes that side; a run both sides
//! changed the same way takes it once; a run both changed differently is a
//! conflict, and the caller keeps both copies rather than picking one. Lines
//! are compared whole, after `\r\n` and `\r` are read as `\n`, so the merged
//! text always uses `\n`.

use super::text_diff::{MAX_DIFF_CELLS, lcs_table, split_lines};

/// What merging two edits of one base gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextMerge {
    /// Every change fitted together; this is the merged text.
    Clean(String),
    /// Both sides changed the same lines differently (or the texts were too
    /// large to compare); nothing was merged.
    Conflict,
}

/// For each line of `base`, the line of `side` it was kept as, if any.
fn kept_lines(base: &[String], side: &[String]) -> Vec<Option<usize>> {
    let table = lcs_table(base, side);
    let mut kept = vec![None; base.len()];
    let (mut i, mut j) = (0, 0);
    while let (Some(a), Some(b)) = (base.get(i), side.get(j)) {
        if a == b {
            if let Some(slot) = kept.get_mut(i) {
                *slot = Some(j);
            }
            i += 1;
            j += 1;
        } else if table.at(i + 1, j) >= table.at(i, j + 1) {
            i += 1;
        } else {
            j += 1;
        }
    }
    kept
}

fn slice(lines: &[String], from: usize, to: usize) -> &[String] {
    lines.get(from..to).unwrap_or(&[])
}

fn too_big(base: &[String], side: &[String]) -> bool {
    base.len().saturating_mul(side.len()) > MAX_DIFF_CELLS
}

/// True when base line `bk` is the end of the text: past the last line, or
/// the empty line a trailing newline leaves.
fn at_tail(base: &[String], bk: usize) -> bool {
    bk == base.len() || (bk + 1 == base.len() && base.get(bk).is_some_and(String::is_empty))
}

/// Both sides appended at the end: keep both, without repeating a shared start.
fn append_both(out: &mut Vec<String>, mine: &[String], theirs: &[String]) {
    if theirs.starts_with(mine) {
        out.extend_from_slice(theirs);
    } else if mine.starts_with(theirs) {
        out.extend_from_slice(mine);
    } else {
        out.extend_from_slice(mine);
        out.extend_from_slice(theirs);
    }
}

/// Merges `mine` and `theirs`, both edited from `base`. Lines both sides
/// appended at the end are kept, mine first, rather than called a conflict.
#[must_use]
pub fn merge_text(base: &str, mine: &str, theirs: &str) -> TextMerge {
    if mine == theirs || base == theirs {
        return TextMerge::Clean(mine.to_owned());
    }
    if base == mine {
        return TextMerge::Clean(theirs.to_owned());
    }
    let b = split_lines(base);
    let m = split_lines(mine);
    let t = split_lines(theirs);
    if too_big(&b, &m) || too_big(&b, &t) {
        return TextMerge::Conflict;
    }
    let in_mine = kept_lines(&b, &m);
    let in_theirs = kept_lines(&b, &t);

    let mut out: Vec<String> = Vec::with_capacity(m.len().max(t.len()));
    let (mut bi, mut mi, mut ti) = (0, 0, 0);
    loop {
        // The next base line both sides kept, in order: where the copies agree again.
        let anchor = (bi..b.len()).find_map(|k| match (in_mine.get(k), in_theirs.get(k)) {
            (Some(Some(mk)), Some(Some(tk))) if *mk >= mi && *tk >= ti => Some((k, *mk, *tk)),
            _ => None,
        });
        let (bk, mk, tk) = anchor.unwrap_or((b.len(), m.len(), t.len()));
        let base_run = slice(&b, bi, bk);
        let mine_run = slice(&m, mi, mk);
        let theirs_run = slice(&t, ti, tk);
        if mine_run == base_run {
            out.extend_from_slice(theirs_run);
        } else if theirs_run == base_run || mine_run == theirs_run {
            out.extend_from_slice(mine_run);
        } else if base_run.is_empty() && at_tail(&b, bk) {
            append_both(&mut out, mine_run, theirs_run);
        } else {
            return TextMerge::Conflict;
        }
        let Some(line) = b.get(bk) else { break };
        out.push(line.clone());
        (bi, mi, ti) = (bk + 1, mk + 1, tk + 1);
    }
    TextMerge::Clean(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::{TextMerge, merge_text};

    fn clean(base: &str, mine: &str, theirs: &str) -> String {
        match merge_text(base, mine, theirs) {
            TextMerge::Clean(text) => text,
            TextMerge::Conflict => panic!("expected a clean merge"),
        }
    }

    #[test]
    fn takes_the_only_side_that_changed() {
        assert_eq!(clean("a\nb", "a\nB", "a\nb"), "a\nB");
        assert_eq!(clean("a\nb", "a\nb", "A\nb"), "A\nb");
    }

    #[test]
    fn identical_edits_are_taken_once() {
        assert_eq!(clean("a\nb", "a\nX\nb", "a\nX\nb"), "a\nX\nb");
    }

    #[test]
    fn edits_to_different_lines_both_land() {
        let base = "one\ntwo\nthree\nfour\nfive";
        let mine = "ONE\ntwo\nthree\nfour\nfive";
        let theirs = "one\ntwo\nthree\nfour\nFIVE";
        assert_eq!(clean(base, mine, theirs), "ONE\ntwo\nthree\nfour\nFIVE");
    }

    #[test]
    fn an_insert_and_a_delete_elsewhere_both_land() {
        let base = "# T\n\npara one\n\npara two\n";
        let mine = "# T\n\npara one\nadded by me\n\npara two\n";
        let theirs = "# T\n\npara one\n\n";
        assert_eq!(
            clean(base, mine, theirs),
            "# T\n\npara one\nadded by me\n\n"
        );
    }

    #[test]
    fn a_delete_on_one_side_and_no_change_on_the_other_deletes() {
        assert_eq!(clean("a\nb\nc", "a\nc", "a\nb\nc"), "a\nc");
    }

    #[test]
    fn both_changing_one_line_differently_conflicts() {
        assert_eq!(
            merge_text("a\nb\nc", "a\nX\nc", "a\nY\nc"),
            TextMerge::Conflict
        );
    }

    #[test]
    fn merge_both_append_is_clean() {
        assert_eq!(clean("a", "a\nmine", "a\ntheirs"), "a\nmine\ntheirs");
        assert_eq!(
            clean("a\n", "a\nmine\n", "a\ntheirs\n"),
            "a\nmine\ntheirs\n"
        );
        assert_eq!(clean("a", "a\nx", "a\nx\ny"), "a\nx\ny");
        assert_eq!(clean("a", "a\nx\ny", "a\nx"), "a\nx\ny");
    }

    #[test]
    fn both_inserting_mid_text_still_conflicts() {
        assert_eq!(
            merge_text("a\nb", "a\nm\nb", "a\nt\nb"),
            TextMerge::Conflict
        );
    }

    #[test]
    fn one_side_editing_a_line_the_other_deleted_conflicts() {
        assert_eq!(
            merge_text("a\nb\nc", "a\nB\nc", "a\nc"),
            TextMerge::Conflict
        );
    }

    #[test]
    fn an_empty_base_with_two_different_bodies_conflicts() {
        assert_eq!(merge_text("", "mine", "theirs"), TextMerge::Conflict);
    }

    #[test]
    fn handles_empty_sides() {
        assert_eq!(clean("a", "", "a"), "");
        assert_eq!(clean("", "", "x"), "x");
    }

    #[test]
    fn reads_crlf_as_lf_when_lines_must_be_compared() {
        assert_eq!(
            clean("a\r\nb\r\nc", "A\r\nb\r\nc", "a\r\nb\r\nC"),
            "A\nb\nC"
        );
    }

    #[test]
    fn repeated_lines_merge_by_position() {
        let base = "x\nx\nx\nx";
        let mine = "x\nM\nx\nx";
        let theirs = "x\nx\nx\nT";
        assert_eq!(clean(base, mine, theirs), "x\nM\nx\nT");
    }

    #[test]
    fn is_symmetric_in_whether_it_conflicts() {
        let cases = [
            ("a\nb\nc", "a\nX\nc", "a\nY\nc"),
            ("a\nb\nc", "A\nb\nc", "a\nb\nC"),
            ("a", "a\nm", "a\nt"),
            ("1\n2\n3\n4", "1\n3\n4", "1\n2\n3\n4\n5"),
        ];
        for (base, mine, theirs) in cases {
            let forward = matches!(merge_text(base, mine, theirs), TextMerge::Conflict);
            let back = matches!(merge_text(base, theirs, mine), TextMerge::Conflict);
            assert_eq!(forward, back, "{base:?} {mine:?} {theirs:?}");
        }
    }

    #[test]
    fn texts_too_large_to_compare_conflict_instead_of_hanging() {
        let base: String = (0..2_100).map(|n| format!("{n}\n")).collect();
        let mine = format!("start\n{base}");
        let theirs = format!("{base}end\n");
        assert_eq!(merge_text(&base, &mine, &theirs), TextMerge::Conflict);
    }
}

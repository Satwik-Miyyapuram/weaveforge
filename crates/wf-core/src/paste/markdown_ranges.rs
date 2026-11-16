//! The parts of a Markdown document that are syntax, data or verbatim content
//! rather than prose.
//!
//! Port of `packages/core/src/paste/markdown-ranges.ts`. Every range is a byte
//! offset into the `&str` it was taken from. Line splits are on `\n` only, as
//! `split("\n")` was.

use std::sync::LazyLock;

use regex_lite::Regex;

use crate::papers::js_regex::{compile, space_class};
use crate::search::js_text::is_js_whitespace;

use super::text_range::{TextRange, index_ranges, merge_ranges};

/// Markdown treats four or more leading spaces as an indented code block.
pub const INDENTED_CODE_WIDTH: usize = 4;

/// A code fence line: its marker, run length and the info string after it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodeFence {
    /// The fence character: a backtick or a tilde.
    pub marker: char,
    /// Length of the fence run.
    pub length: usize,
    /// The text after the fence run.
    pub info: String,
}

static WIKILINK_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"!?\[\[[^\]\[\n]+\]\]").ok());

static LINK_DESTINATION_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(&format!(
        concat!(
            r#"\]\(\s*(?:<[^>\n]*>|(?:[^()\n{ws}]|\([^()\n{ws}]*\))*)"#,
            r#"(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)"#
        ),
        ws = space_class()
    ))
    .ok()
});

static HTML_TAG_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"<\/?[A-Za-z][^<>\n]*>").ok());

static LATEX_COMMAND_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"\\[A-Za-z@]+(?:\[[^\]\n]*\])?\{[^{}\n]*\}").ok());

static PANDOC_KEY_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\[[@^][^\]\n]+\]").ok());

/// The fence a line opens or closes, or `None` when it is not a fence line.
#[must_use]
pub fn fence_of(line: &str) -> Option<CodeFence> {
    let bytes = line.as_bytes();
    let pos = fence_start(bytes);
    if run_at(bytes, pos, b' ') > 3 {
        return None;
    }
    let run_start = pos + run_at(bytes, pos, b' ');
    let marker_byte = bytes.get(run_start).copied()?;
    if marker_byte != b'`' && marker_byte != b'~' {
        return None;
    }
    let length = run_at(bytes, run_start, marker_byte);
    if length < 3 {
        return None;
    }
    let info = line.get(run_start + length..)?;
    // `(.*)$` cannot cross a JS line terminator.
    if info.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    // An info string may not contain a backtick on a backtick fence, otherwise
    // `` `a` `` in prose would open one.
    let marker = char::from(marker_byte);
    if marker == '`' && info.contains('`') {
        return None;
    }
    Some(CodeFence {
        marker,
        length,
        info: info.to_string(),
    })
}

/// A closing fence uses the opening marker, is at least as long and has no info.
#[must_use]
pub fn closes_fence(line: &str, opening: &CodeFence) -> bool {
    fence_of(line).is_some_and(|candidate| {
        candidate.marker == opening.marker
            && candidate.length >= opening.length
            && candidate.info.trim_matches(is_js_whitespace).is_empty()
    })
}

/// Everything Markdown renders as code: fenced blocks with their fences,
/// indented blocks, and inline backtick spans.
///
/// An indented block only counts after a blank line, because an indented line
/// under a paragraph or a list item is a continuation of it, not code.
#[must_use]
pub fn markdown_code_ranges(text: &str) -> Vec<TextRange> {
    let mut ranges: Vec<TextRange> = Vec::new();
    let mut offset = 0;
    let mut fence: Option<(CodeFence, usize)> = None;
    let mut indented: Option<TextRange> = None;
    let mut previous_blank = true;

    for line in text.split('\n') {
        let start = offset;
        let end = offset + line.len();
        offset = end + 1;
        let blank = line.trim_matches(is_js_whitespace).is_empty();

        if let Some((opening, fence_start)) = &fence {
            if closes_fence(line, opening) {
                ranges.push(TextRange {
                    start: *fence_start,
                    end,
                });
                fence = None;
            }
            previous_blank = false;
            continue;
        }

        if let Some(opening) = fence_of(line) {
            if let Some(range) = indented.take() {
                ranges.push(range);
            }
            fence = Some((opening, start));
            previous_blank = false;
            continue;
        }

        let indent_width = leading_width(line);
        if !blank && indent_width >= INDENTED_CODE_WIDTH && (previous_blank || indented.is_some()) {
            indented = Some(match indented {
                Some(range) => TextRange {
                    start: range.start,
                    end,
                },
                None => TextRange { start, end },
            });
            previous_blank = false;
            continue;
        }
        // A blank line inside an indented block does not end it; the next
        // non-indented line does.
        if indented.is_some() && blank {
            previous_blank = true;
            continue;
        }
        if let Some(range) = indented.take() {
            ranges.push(range);
        }

        inline_code_ranges(line, start, &mut ranges);
        previous_blank = blank;
    }

    // An unclosed fence protects to the end of the text: a half-pasted block is
    // still code, and rewriting its tail is the worst possible reading.
    if let Some((_, start)) = fence {
        ranges.push(TextRange {
            start,
            end: text.len(),
        });
    }
    if let Some(range) = indented {
        ranges.push(range);
    }

    merge_ranges(&ranges)
}

/// Visual indent width, counting a tab as four columns.
#[must_use]
pub fn leading_width(line: &str) -> usize {
    let mut width = 0;
    for ch in line.chars() {
        match ch {
            ' ' => width += 1,
            '\t' => width += INDENTED_CODE_WIDTH,
            _ => break,
        }
    }
    width
}

/// The leading YAML frontmatter block, including both `---` lines.
///
/// Leading blank lines are skipped before looking, because the trim rule removes
/// them later, which promotes the block to real frontmatter once the text lands
/// in a note.
#[must_use]
pub fn frontmatter_range(text: &str) -> Option<TextRange> {
    let body_start = text.len() - text.trim_start_matches(is_frontmatter_lead).len();
    let body = text.get(body_start..)?;
    if !opens_frontmatter(body) {
        return None;
    }
    let body_end = closing_frontmatter_end(body)?;
    Some(TextRange {
        start: body_start,
        end: body_start + body_end,
    })
}

/// LaTeX maths, block and inline.
///
/// `$\alpha - \beta$` is subtraction and `$x'$` is a prime, so the dash and
/// quote rules must not reach inside. Inline maths is recognised conservatively:
/// same line, no space just inside the delimiters, and at least one non-digit,
/// so that "$5 to $10" stays prose.
#[must_use]
pub fn math_ranges(text: &str) -> Vec<TextRange> {
    let blocks = display_math_blocks(text);
    // Indexed, not scanned: a document can hold tens of thousands of matches.
    let in_block = index_ranges(&blocks);
    let bytes = text.as_bytes();
    let mut inline: Vec<TextRange> = Vec::new();
    let mut pos = 0;
    while let Some(start) = next_index(bytes, pos, b'$') {
        let Some((end, body)) = inline_math_at(text, start) else {
            pos = start + 1;
            continue;
        };
        // The match is consumed even when it is dropped below.
        pos = end;
        if in_block.overlaps(start, end) {
            continue;
        }
        // Currency runs like "$5" or "$1,200" have nothing else in them.
        if body
            .chars()
            .all(|ch| ch.is_ascii_digit() || ch == '.' || ch == ',' || is_js_whitespace(ch))
        {
            continue;
        }
        inline.push(TextRange { start, end });
    }

    let mut all = blocks;
    all.extend(inline);
    merge_ranges(&all)
}

/// Link and citation syntax whose text is a name or a key rather than prose:
/// wikilinks, Markdown link destinations, HTML tags, and the LaTeX citation and
/// reference commands the report export depends on.
#[must_use]
pub fn markdown_syntax_ranges(text: &str) -> Vec<TextRange> {
    let patterns = [
        // [[Note name|alias]] and ![[embed]]
        &WIKILINK_RE,
        // ](destination "optional title"), allowing one nested paren for paths
        &LINK_DESTINATION_RE,
        // <a href="...">, <img ...>
        &HTML_TAG_RE,
        // \cite{key}, \ref{fig:1}, \label{...}, \includegraphics{...}
        &LATEX_COMMAND_RE,
        // [@pandoc-key] and [^footnote]
        &PANDOC_KEY_RE,
    ];

    let mut ranges: Vec<TextRange> = Vec::new();
    for pattern in patterns {
        if let Some(re) = &**pattern {
            ranges.extend(re.find_iter(text).map(|found| TextRange {
                start: found.start(),
                end: found.end(),
            }));
        }
    }
    // A reference definition's target: [label]: https://...
    ranges.extend(reference_target_ranges(text));
    merge_ranges(&ranges)
}

/// The number of leading `byte`s in `bytes` starting at `from`.
fn run_at(bytes: &[u8], from: usize, byte: u8) -> usize {
    bytes
        .get(from..)
        .unwrap_or_default()
        .iter()
        .take_while(|&&b| b == byte)
        .count()
}

/// The index of the next `byte` at or after `from`.
fn next_index(bytes: &[u8], from: usize, byte: u8) -> Option<usize> {
    bytes
        .get(from..)?
        .iter()
        .position(|&b| b == byte)
        .map(|offset| from + offset)
}

/// The index of the next two-byte pair `first second` at or after `from`.
fn next_pair(bytes: &[u8], from: usize, first: u8, second: u8) -> Option<usize> {
    bytes
        .get(from..)?
        .windows(2)
        .position(|pair| matches!(pair, [a, b] if *a == first && *b == second))
        .map(|offset| from + offset)
}

/// Where the quote prefix (`> ` markers, up to three columns each) ends.
fn fence_start(bytes: &[u8]) -> usize {
    let mut pos = 0;
    loop {
        let spaces = run_at(bytes, pos, b' ');
        if spaces > 3 || bytes.get(pos + spaces).copied() != Some(b'>') {
            return pos;
        }
        pos += spaces + 1;
        if matches!(bytes.get(pos).copied(), Some(b' ' | b'\t')) {
            pos += 1;
        }
    }
}

/// True when an odd run of backslashes escapes the byte at `index`.
fn is_escaped(bytes: &[u8], index: usize) -> bool {
    let slashes = bytes
        .get(..index)
        .unwrap_or_default()
        .iter()
        .rev()
        .take_while(|&&b| b == b'\\')
        .count();
    slashes % 2 == 1
}

/// The start of a closing backtick run of exactly `open_length`, if any.
fn closing_run(bytes: &[u8], from: usize, open_length: usize) -> Option<usize> {
    let mut search = from;
    while let Some(candidate) = next_index(bytes, search, b'`') {
        let close_length = run_at(bytes, candidate, b'`');
        // A closing run has to be exactly as long, so ``a ` b`` keeps its inner tick.
        if !is_escaped(bytes, candidate) && close_length == open_length {
            return Some(candidate);
        }
        search = candidate + close_length;
    }
    None
}

/// Backtick code spans on one line. A span never crosses a line break.
fn inline_code_ranges(line: &str, line_start: usize, into: &mut Vec<TextRange>) {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes.get(index).copied() != Some(b'`') || is_escaped(bytes, index) {
            index += 1;
            continue;
        }
        let open_length = run_at(bytes, index, b'`');
        if let Some(candidate) = closing_run(bytes, index + open_length, open_length) {
            into.push(TextRange {
                start: line_start + index,
                end: line_start + candidate + open_length,
            });
            index = candidate + open_length;
        } else {
            // An unclosed run is literal text, so only the run itself is skipped.
            index += open_length;
        }
    }
}

/// True for the JS line terminators.
fn is_line_terminator(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// True for the leading characters the frontmatter trim skips.
fn is_frontmatter_lead(ch: char) -> bool {
    is_js_whitespace(ch) || matches!(ch, '\u{AD}' | '\u{200B}')
}

/// True when `body` opens with `---` (up to three spaces, then only blanks).
fn opens_frontmatter(body: &str) -> bool {
    let indent = run_at(body.as_bytes(), 0, b' ');
    if indent > 3 {
        return false;
    }
    let Some(rest) = body
        .get(indent..)
        .and_then(|after| after.strip_prefix("---"))
    else {
        return false;
    };
    let tail = rest.trim_start_matches([' ', '\t']);
    tail.is_empty() || tail.starts_with('\n')
}

/// The byte offset in `body` just past the closing `---` or `...` line.
fn closing_frontmatter_end(body: &str) -> Option<usize> {
    for (index, _) in body.match_indices('\n') {
        let Some(after) = body.get(index + 1..) else {
            continue;
        };
        let indent = run_at(after.as_bytes(), 0, b' ');
        if indent > 3 {
            continue;
        }
        let Some(rest) = after.get(indent..) else {
            continue;
        };
        let Some(rest) = rest
            .strip_prefix("---")
            .or_else(|| rest.strip_prefix("..."))
        else {
            continue;
        };
        let tail = rest.trim_start_matches([' ', '\t']);
        if tail.is_empty() || tail.starts_with('\n') {
            return Some(body.len() - tail.len());
        }
    }
    None
}

/// Every `$$...$$` block, lazily matched: each runs to the next `$$`.
fn display_math_blocks(text: &str) -> Vec<TextRange> {
    let bytes = text.as_bytes();
    let mut blocks = Vec::new();
    let mut pos = 0;
    while let Some(open) = next_pair(bytes, pos, b'$', b'$') {
        let Some(close) = next_pair(bytes, open + 2, b'$', b'$') else {
            break;
        };
        blocks.push(TextRange {
            start: open,
            end: close + 2,
        });
        pos = close + 2;
    }
    blocks
}

/// The inline math match that opens at `start`, as its end offset and body.
///
/// Mirrors `\$(?![\s$])((?:\\.|[^\\$\n])*?)(?<![\s$])\$`, which regex-lite
/// cannot express because of the lookarounds.
fn inline_math_at(text: &str, start: usize) -> Option<(usize, &str)> {
    let rest = text.get(start + 1..)?;
    let first = rest.chars().next()?;
    if first == '$' || is_js_whitespace(first) {
        return None;
    }
    let mut prev = '$';
    let mut offset = 0;
    let mut chars = rest.chars();
    while let Some(ch) = chars.next() {
        if ch == '$' {
            if prev == '$' || is_js_whitespace(prev) {
                return None;
            }
            let body = rest.get(..offset)?;
            return Some((start + 1 + offset + 1, body));
        }
        match ch {
            '\\' => {
                // `\\.`: an escape of any character but a JS line terminator.
                let escaped = chars.next()?;
                if is_line_terminator(escaped) {
                    return None;
                }
                offset += ch.len_utf8() + escaped.len_utf8();
                prev = escaped;
            }
            '\n' => return None,
            _ => {
                offset += ch.len_utf8();
                prev = ch;
            }
        }
    }
    None
}

/// The target of each reference definition line, as the `m`-flag regex found it.
fn reference_target_ranges(text: &str) -> Vec<TextRange> {
    let line_starts = std::iter::once(0).chain(
        text.char_indices()
            .filter(|&(_, ch)| is_line_terminator(ch))
            .map(|(index, ch)| index + ch.len_utf8()),
    );
    let mut ranges = Vec::new();
    let mut pos = 0;
    for line_start in line_starts {
        if line_start < pos {
            continue;
        }
        if let Some(end) = reference_target_at(text, line_start) {
            ranges.push(TextRange {
                start: line_start,
                end,
            });
            pos = end;
        }
    }
    ranges
}

/// The end of a reference definition that starts its line at `start`.
///
/// Mirrors `^ {0,3}\[[^\]\n]+\]:[ \t]*\S+.*$` under the `m` flag, where `.*$`
/// runs to the next JS line terminator.
fn reference_target_at(text: &str, start: usize) -> Option<usize> {
    let rest = text.get(start..)?;
    let indent = run_at(rest.as_bytes(), 0, b' ');
    if indent > 3 {
        return None;
    }
    let after_bracket = rest.get(indent..)?.strip_prefix('[')?;
    let close = after_bracket.find(']')?;
    let label = after_bracket.get(..close)?;
    if label.is_empty() || label.contains('\n') {
        return None;
    }
    let after_colon = after_bracket.get(close + 1..)?.strip_prefix(':')?;
    let target = after_colon.trim_start_matches([' ', '\t']);
    if is_js_whitespace(target.chars().next()?) {
        return None;
    }
    let run = target.find(is_line_terminator).unwrap_or(target.len());
    Some(start + (rest.len() - target.len()) + run)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn range(start: usize, end: usize) -> TextRange {
        TextRange { start, end }
    }

    #[test]
    fn fence_lines_are_recognised_by_marker_and_info() {
        assert_eq!(
            fence_of("```ts"),
            Some(CodeFence {
                marker: '`',
                length: 3,
                info: "ts".to_string(),
            })
        );
        assert_eq!(
            fence_of("> > ~~~~"),
            Some(CodeFence {
                marker: '~',
                length: 4,
                info: String::new(),
            })
        );
        assert_eq!(
            fence_of("```a`b"),
            None,
            "a backtick fence's info has no backtick"
        );
        assert!(fence_of("~~~a`b").is_some(), "a tilde fence's info may");
        assert_eq!(fence_of("    ```"), None, "four columns is indented code");
        assert_eq!(fence_of("``"), None);
        assert_eq!(fence_of(""), None);
    }

    #[test]
    fn closing_fence_needs_marker_length_and_no_info() {
        let opening = fence_of("````").expect("a fence");
        assert!(closes_fence("`````  ", &opening), "longer closes");
        assert!(!closes_fence("```", &opening), "shorter does not");
        assert!(!closes_fence("~~~~", &opening), "other marker does not");
        assert!(!closes_fence("```` x", &opening), "info does not close");
        assert!(!closes_fence("text", &opening));
    }

    #[test]
    fn inline_code_span_is_one_range() {
        assert_eq!(markdown_code_ranges("a `b` c"), vec![range(2, 5)]);
    }

    #[test]
    fn fenced_block_includes_both_fences() {
        assert_eq!(markdown_code_ranges("```\nx\n```"), vec![range(0, 9)]);
        assert_eq!(
            markdown_code_ranges("```\nx"),
            vec![range(0, 5)],
            "unclosed runs to end"
        );
        assert!(markdown_code_ranges("").is_empty());
    }

    #[test]
    fn indented_block_needs_a_blank_line_before_it() {
        assert_eq!(
            markdown_code_ranges("para\n\n    code\n"),
            vec![range(6, 14)]
        );
        assert!(markdown_code_ranges("para\n    cont\n").is_empty());
    }

    #[test]
    fn inline_math_skips_currency_and_takes_maths() {
        assert!(math_ranges("cost $5 and $10").is_empty());
        assert_eq!(math_ranges("$x^2$ and $$\ny\n$$").len(), 2);
        // Byte offsets: the two-byte "é" moves the dollar to byte 3.
        assert_eq!(math_ranges("é $x$"), vec![range(3, 6)]);
    }

    #[test]
    fn frontmatter_must_open_the_document() {
        assert_eq!(
            frontmatter_range("---\na: 1\n---\nbody"),
            Some(range(0, 12))
        );
        assert_eq!(frontmatter_range("body\n---\na: 1\n---"), None);
        assert_eq!(frontmatter_range(""), None);
    }

    #[test]
    fn wikilinks_and_pandoc_keys_are_syntax() {
        assert_eq!(
            markdown_syntax_ranges("see [[Note|alias]] and [@key]"),
            vec![range(4, 18), range(23, 29)]
        );
    }

    #[test]
    fn reference_target_stops_at_a_carriage_return() {
        assert_eq!(markdown_syntax_ranges("[a]: x\r\nnext"), vec![range(0, 6)]);
        assert_eq!(
            markdown_syntax_ranges("[label]: https://x.org\nnext"),
            vec![range(0, 22)]
        );
    }

    #[test]
    fn every_pattern_compiles() {
        assert!(WIKILINK_RE.is_some(), "WIKILINK_RE");
        assert!(LINK_DESTINATION_RE.is_some(), "LINK_DESTINATION_RE");
        assert!(HTML_TAG_RE.is_some(), "HTML_TAG_RE");
        assert!(LATEX_COMMAND_RE.is_some(), "LATEX_COMMAND_RE");
        assert!(PANDOC_KEY_RE.is_some(), "PANDOC_KEY_RE");
    }
}

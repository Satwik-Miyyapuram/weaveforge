//! Putting hard-wrapped text back together.
//!
//! Terminals and PDF layouts both break a paragraph at a fixed column and there
//! is nothing in the result that says which breaks were the author's. The rule
//! used here is that a line long enough to have *reached* the wrap column was
//! broken by the margin, and every other break was meant. The wrap column is
//! inferred from the text itself, because it depends on how wide a window
//! happened to be when somebody pressed copy.
//!
//! Everything that is structure rather than prose stops a rejoin: headings,
//! lists, tables, fences, block maths, frontmatter, and Markdown's own
//! two-space hard break.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use unicode_properties::{GeneralCategory, GeneralCategoryGroup, UnicodeGeneralCategory};

use super::TextResult;
use super::control_characters::strip_control_sequences;
use super::markdown_ranges::{
    CodeFence, INDENTED_CODE_WIDTH, closes_fence, fence_of, frontmatter_range, leading_width,
    markdown_code_ranges, markdown_syntax_ranges,
};
use super::text_range::{TextRange, index_ranges};
use crate::papers::js_regex::compile;
use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Characters that open a list item.
///
/// The en and em dash are deliberately absent: a line opening with a long dash
/// is far more often prose than a bullet, and reading it as a list item both
/// blocks a legitimate rejoin and mangles the sentence.
pub const LIST_MARKERS: &[&str] = &[
    "\u{2022}", "\u{2023}", "\u{25AA}", "\u{25AB}", "\u{25B8}", "\u{25E6}", "\u{B7}", "-", "*", "+",
];

/// Shortest line a terminal could plausibly have broken.
pub const MIN_WRAP_WIDTH: usize = 60;

/// The same floor for a PDF. A two-column journal layout wraps prose at about
/// 45 characters, so the terminal floor would refuse every rejoin that matters.
pub const PDF_MIN_WRAP_WIDTH: usize = 35;

/// How far below the longest line still counts as a full line.
///
/// A wrapped line falls short of the wrap column by roughly the length of the
/// word that did not fit, while a paragraph's genuinely last line usually falls
/// much further. Twenty-four leaves room for a long word without reaching far
/// enough down to swallow the end of a paragraph.
pub const WRAP_TOLERANCE: usize = 24;

/// U+00AD, written as an escape because it is invisible in a source file.
pub const SOFT_HYPHEN: char = '\u{AD}';

/// How a rejoin decides which lines belong to the same paragraph.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rejoin {
    /// Rejoins every line that looks wrapped.
    Any,
    /// Rejoins only lines indented past their paragraph's first line.
    Indented,
    /// Strips and dedents without joining anything.
    Never,
}

/// What to do with bullet characters such as U+2022.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Bullets {
    /// Leave the bullet characters as written.
    Preserve,
    /// Rewrite them as Markdown list items.
    Markdown,
}

/// Options for [`clean_wrapped_text`].
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedTextOptions {
    /// Which wrapped lines are rejoined.
    pub rejoin: Rejoin,
    /// Whether bullets become Markdown list items.
    pub bullets: Bullets,
    /// Repairs words the layout hyphenated at a line end. PDF text wants this.
    #[serde(default)]
    pub merge_hyphens: bool,
    /// Collapses the space runs justified text leaves between words.
    #[serde(default)]
    pub collapse_spaces: bool,
    /// Lower bound for the inferred wrap column; `None` uses [`MIN_WRAP_WIDTH`].
    #[serde(default)]
    pub min_wrap_width: Option<usize>,
    /// Treat a lone `$$` line as a maths delimiter.
    #[serde(default)]
    pub protect_math: bool,
}

/// `\s*\d{1,9}[.)]\s` — a numbered list item.
static NUMBERED_LIST: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^\s*\d{1,9}[.)]\s").ok());
/// `(a)`, `(12)`, `[3]` or `c)` — how PDF lists number their items.
static ENUMERATOR: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)^\s*(?:\([a-z0-9]{1,4}\)|\[\d{1,4}\]|[a-z0-9]{1,4}\))\s").ok());
static HEADING: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"^\s{0,3}#{1,6}(\s|$)").ok());
static BLOCKQUOTE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"^\s{0,3}>").ok());
static TABLE_ROW: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"^\s*\|").ok());
static THEMATIC_BREAK: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$").ok());
static FRONTMATTER_FENCE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^ {0,3}(?:---|\.\.\.)\s*$").ok());
static FRONTMATTER_OPEN: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^ {0,3}---\s*$").ok());
/// A run of `=` or `-` that turns the line above it into a heading.
static SETEXT_UNDERLINE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^ {0,3}(?:=+|-+)[ \t]*$").ok());
/// Leading blockquote markers and whitespace, kept verbatim when a line is rewritten.
static LINE_PREFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(?: {0,3}>[ \t]?)*[ \t]*").ok());
/// Any depth of list or quote markers in front of a heading.
static HEADING_STRIP: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(?: {0,3}(?:>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+))*[ \t]*").ok());
/// Blockquote markers at the start of a line.
static QUOTE_PREFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(?: {0,3}>[ \t]?)+").ok());

/// True when `text` matches `re`. A pattern that failed to compile matches nothing.
fn matches_re(re: &LazyLock<Option<Regex>>, text: &str) -> bool {
    let compiled: &Option<Regex> = re;
    compiled.as_ref().is_some_and(|r| r.is_match(text))
}

/// Byte length of the match of `re` at the start of `text`, or 0 when there is none.
fn prefix_len(re: &LazyLock<Option<Regex>>, text: &str) -> usize {
    let compiled: &Option<Regex> = re;
    compiled
        .as_ref()
        .and_then(|r| r.find(text))
        .map_or(0, |m| m.end())
}

/// True for a line that is empty or only whitespace.
fn is_blank(line: &str) -> bool {
    line.trim_matches(is_js_whitespace).is_empty()
}

/// Markdown renders two trailing spaces or a trailing backslash as a hard break.
fn has_hard_break(line: &str) -> bool {
    line.ends_with("  ") || line.ends_with('\\')
}

/// The hyphen forms a layout breaks a word with, as listed in the TypeScript.
const HYPHEN_FORMS: &[char] = &['-', '\u{AD}', '\u{2010}', '\u{FE63}', '\u{FF0D}'];

/// Scripts that wrap without spaces: Thai, kana, Han and the fullwidth forms.
fn is_unspaced(ch: char) -> bool {
    matches!(
        ch,
        '\u{0E00}'..='\u{0E7F}'
            | '\u{3000}'..='\u{30FF}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{FF00}'..='\u{FFEF}'
    )
}

/// True when a line ends with a word broken at the margin.
///
/// A letter, digit or combining mark then a hyphen — including the forms PDF
/// fonts emit. U+2011, the non-breaking hyphen, is excluded on purpose: its
/// whole meaning is that the word must *not* break there. Requiring a letter in
/// front keeps `---` out, because a thematic break is not a broken word.
#[must_use]
pub fn ends_hyphenated(line: &str) -> bool {
    let trimmed = line.trim_end_matches(is_js_whitespace);
    let mut rev = trimmed.chars().rev();
    matches!(rev.next(), Some(hyphen) if HYPHEN_FORMS.contains(&hyphen))
        && matches!(rev.next(), Some(ch) if is_word_end(ch))
}

/// A letter, digit or combining mark: what a broken word ends with before its hyphen.
fn is_word_end(ch: char) -> bool {
    ch.is_ascii_digit()
        || matches!(
            ch.general_category_group(),
            GeneralCategoryGroup::Letter | GeneralCategoryGroup::Mark
        )
}

/// True when the line's last word carries a web address. Such a line never
/// rejoins: a space join buries the break inside the address, and a bare join
/// could fuse an address that really ended there with the next word.
fn ends_with_url(line: &str) -> bool {
    let trimmed = line.trim_end_matches(is_js_whitespace);
    let last_word = trimmed.rsplit(is_js_whitespace).next().unwrap_or("");
    last_word.contains("://")
        || (last_word
            .get(..4)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("www."))
            && last_word.len() > 4)
}

/// How two fragments join across a removed break.
///
/// The hyphen decision is the interesting one. After a digit it is content — a
/// range or a compound such as `10-20` or `5-fold` — so it stays and only the
/// break goes. After a letter it is the layout's own when the word resumes in
/// lowercase, so it goes; in front of a capital it belongs to a compound such as
/// `Navier-Stokes` or `RNA-Seq`, so it stays too.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FragmentJoin {
    /// Inserted between the two fragments.
    pub separator: String,
    /// True when the previous fragment's last character, a hyphen, must go.
    pub drop_hyphen: bool,
}

/// Decides how `fragment` joins onto `previous_tail`, the previous fragment.
///
/// Everything here reads the *end* of what came before, which is why the caller
/// passes the last fragment rather than the paragraph built so far.
#[must_use]
pub fn fragment_join(previous_tail: &str, fragment: &str) -> FragmentJoin {
    // A soft hyphen exists only to mark where a word may break, so it goes
    // whatever follows — unlike a visible hyphen, which may belong to a compound.
    if previous_tail.ends_with(SOFT_HYPHEN) {
        return FragmentJoin {
            separator: String::new(),
            drop_hyphen: true,
        };
    }
    if ends_with_url(previous_tail) {
        return FragmentJoin {
            separator: "\n".to_string(),
            drop_hyphen: false,
        };
    }
    if ends_hyphenated(previous_tail) {
        let after_digit = previous_tail_after_digit(previous_tail);
        let broken_word = !after_digit
            && fragment
                .chars()
                .next()
                .is_some_and(|ch| ch.general_category() == GeneralCategory::LowercaseLetter);
        return FragmentJoin {
            separator: String::new(),
            drop_hyphen: broken_word,
        };
    }
    // A dash set tight against its word is a style; joining with a space breaks it.
    if tight_dash(previous_tail) {
        return FragmentJoin {
            separator: String::new(),
            drop_hyphen: false,
        };
    }
    let tail_unspaced = previous_tail.chars().next_back().is_some_and(is_unspaced);
    let head_unspaced = fragment.chars().next().is_some_and(is_unspaced);
    if tail_unspaced && head_unspaced {
        return FragmentJoin {
            separator: String::new(),
            drop_hyphen: false,
        };
    }
    FragmentJoin {
        separator: " ".to_string(),
        drop_hyphen: false,
    }
}

/// True when the untrimmed text ends with a hyphen form directly after a digit.
fn previous_tail_after_digit(text: &str) -> bool {
    let mut rev = text.chars().rev();
    matches!(rev.next(), Some(hyphen) if HYPHEN_FORMS.contains(&hyphen))
        && rev.next().is_some_and(|ch| ch.is_ascii_digit())
}

/// True when the untrimmed text ends with an en or em dash set against a non-space.
fn tight_dash(text: &str) -> bool {
    let mut rev = text.chars().rev();
    matches!(rev.next(), Some('\u{2013}' | '\u{2014}'))
        && rev.next().is_some_and(|ch| !is_js_whitespace(ch))
}

/// Joins a run of already-trimmed fragments in one pass.
///
/// Each decision reads only the fragment before it, so the cost is linear in the
/// text rather than in the square of the number of lines.
#[must_use]
pub fn join_pieces(fragments: &[String]) -> String {
    let Some(first) = fragments.first() else {
        return String::new();
    };
    let mut pieces: Vec<String> = vec![first.clone()];
    let mut previous = first.as_str();
    for fragment in fragments.iter().skip(1) {
        let join = fragment_join(previous, fragment.as_str());
        if join.drop_hyphen
            && let Some(last) = pieces.last_mut()
        {
            let _dropped = last.pop();
        }
        if !join.separator.is_empty() {
            pieces.push(join.separator);
        }
        pieces.push(fragment.clone());
        previous = fragment.as_str();
    }
    pieces.concat()
}

/// Block maths spans, from a lone `$$` line to its closer.
fn block_math_ranges(text: &str) -> Vec<TextRange> {
    let mut ranges = Vec::new();
    let mut offset = 0;
    let mut open: Option<usize> = None;
    for line in text.split('\n') {
        if line.trim_matches(is_js_whitespace) == "$$" {
            match open.take() {
                None => open = Some(offset),
                Some(start) => ranges.push(TextRange {
                    start,
                    end: offset + line.len(),
                }),
            }
        }
        offset += line.len() + 1;
    }
    ranges
}

/// Works out the column the text was wrapped at.
///
/// When at least two lines cluster near the longest one, that length is the wrap
/// column. A single long line is an outlier rather than evidence, so the floor is
/// used instead — which is also the right answer for text that was never wrapped.
#[must_use]
pub fn infer_wrap_width(lines: &[&str], floor: usize) -> usize {
    // Fenced content is copied verbatim, so one long JSON line inside a log dump
    // must not drag the threshold above the prose the reader wants rejoined.
    let mut prose: Vec<&str> = Vec::new();
    let mut fence: Option<CodeFence> = None;
    for &line in lines {
        if let Some(open) = fence.as_ref() {
            if closes_fence(line, open) {
                fence = None;
            }
            continue;
        }
        if let Some(opening) = fence_of(line) {
            fence = Some(opening);
            continue;
        }
        if !is_blank(line) {
            prose.push(line);
        }
    }

    let lengths: Vec<usize> = prose
        .iter()
        .map(|line| utf16_len(line.trim_end_matches(is_js_whitespace)))
        .collect();
    if lengths.len() < 2 {
        return floor;
    }

    // Reduced rather than spread: a large pasted log would blow the argument limit.
    let longest = lengths.iter().copied().fold(0, usize::max);
    let threshold = longest.saturating_sub(WRAP_TOLERANCE);
    let near_longest = lengths
        .iter()
        .filter(|&&length| length >= threshold)
        .count();
    if near_longest < 2 {
        return floor;
    }

    floor.max(threshold)
}

/// The bullet a line opens with, or `None`. A marker only counts before whitespace.
fn list_marker_of(line: &str) -> Option<&'static str> {
    let body = line.get(prefix_len(&LINE_PREFIX, line)..).unwrap_or("");
    LIST_MARKERS.iter().copied().find(|marker| {
        body.starts_with(marker)
            && body
                .get(marker.len()..)
                .and_then(|rest| rest.chars().next())
                .is_some_and(is_js_whitespace)
    })
}

/// True when the line is a heading, behind any depth of list or quote markers.
fn is_heading_line(line: &str) -> bool {
    let rest = line.get(prefix_len(&HEADING_STRIP, line)..).unwrap_or(line);
    matches_re(&HEADING, rest)
}

/// True when the line opens a block that must not be merged into the paragraph above.
fn starts_new_block(line: &str) -> bool {
    list_marker_of(line).is_some()
        || matches_re(&NUMBERED_LIST, line)
        || matches_re(&ENUMERATOR, line)
        || matches_re(&HEADING, line)
        || matches_re(&BLOCKQUOTE, line)
        || fence_of(line).is_some()
        || matches_re(&TABLE_ROW, line)
        || matches_re(&THEMATIC_BREAK, line)
        || matches_re(&FRONTMATTER_FENCE, line)
        // Joining a setext underline onto the line above erases the heading it makes.
        || matches_re(&SETEXT_UNDERLINE, line)
        || leading_width(line) >= INDENTED_CODE_WIDTH
}

/// The leading spaces and tabs of `line`.
fn leading_blanks(line: &str) -> &str {
    let rest = line.trim_start_matches([' ', '\t']);
    line.get(..line.len() - rest.len()).unwrap_or("")
}

/// Removes the longest leading whitespace every non-blank line shares.
#[must_use]
pub fn dedent_lines(lines: &[&str]) -> Vec<String> {
    let copy = || {
        lines
            .iter()
            .map(|line| (*line).to_string())
            .collect::<Vec<String>>()
    };
    let prefixes: Vec<&str> = lines
        .iter()
        .filter(|&&line| !is_blank(line))
        .map(|&line| leading_blanks(line))
        .collect();
    let Some(&first) = prefixes.first() else {
        return copy();
    };

    let mut common = first;
    for prefix in &prefixes {
        while !common.is_empty() && !prefix.starts_with(common) {
            common = common.get(..common.len() - 1).unwrap_or("");
        }
        if common.is_empty() {
            break;
        }
    }
    if common.is_empty() {
        return copy();
    }
    lines
        .iter()
        .map(|line| {
            if is_blank(line) {
                (*line).to_string()
            } else {
                line.get(common.len()..).unwrap_or("").to_string()
            }
        })
        .collect()
}

/// Rewrites a non-Markdown bullet to a dash, keeping the line's indentation.
fn to_markdown_bullet(line: &str) -> String {
    let Some(marker) = list_marker_of(line) else {
        return line.to_string();
    };
    if matches!(marker, "-" | "*" | "+") {
        return line.to_string();
    }
    let prefix = line.get(..prefix_len(&LINE_PREFIX, line)).unwrap_or("");
    let body = line
        .get(prefix.len() + marker.len()..)
        .unwrap_or("")
        .trim_start_matches(is_js_whitespace);
    format!("{prefix}- {body}")
}

/// Rewrites bullets outside code, maths and frontmatter into Markdown list items.
fn convert_bullets(text: &str, protect_math: bool) -> String {
    let mut ranges = markdown_code_ranges(text);
    ranges.extend(frontmatter_range(text));
    if protect_math {
        ranges.extend(block_math_ranges(text));
    }
    let index = index_ranges(&ranges);
    let mut offset = 0;
    text.split('\n')
        .map(|line| {
            let start = offset;
            offset += line.len() + 1;
            if index.overlaps(start, start + 1) {
                line.to_string()
            } else {
                to_markdown_bullet(line)
            }
        })
        .collect::<Vec<String>>()
        .join("\n")
}

/// Collapses the space runs justified text leaves between words. Runs at a line
/// start are indentation and runs at a line end are Markdown hard breaks, so only
/// runs between visible characters collapse — and never inside code, maths,
/// frontmatter or a link target, where one space fewer silently points a
/// wikilink at a different note.
#[must_use]
fn collapse_space_runs(text: &str, protect_math: bool) -> String {
    let mut ranges = markdown_code_ranges(text);
    ranges.extend(markdown_syntax_ranges(text));
    ranges.extend(frontmatter_range(text));
    if protect_math {
        ranges.extend(block_math_ranges(text));
    }
    let index = index_ranges(&ranges);

    // Equivalent to `/(\S) {2,}(?=\S)/g`: a visible character, two or more spaces,
    // then a visible character that is not consumed.
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut i = 0;
    while let Some(&(offset, before)) = chars.get(i) {
        let run_start = i + 1;
        let mut next = run_start;
        while chars.get(next).is_some_and(|&(_, ch)| ch == ' ') {
            next += 1;
        }
        let run = next - run_start;
        let lookahead = chars.get(next).copied();
        let matched = !is_js_whitespace(before)
            && run >= 2
            && lookahead.is_some_and(|(_, ch)| !is_js_whitespace(ch));
        if !matched {
            i += 1;
            continue;
        }
        let end = lookahead.map_or(text.len(), |(byte, _)| byte);
        out.push_str(text.get(copied..offset).unwrap_or(""));
        if index.overlaps(offset + before.len_utf8(), end) {
            out.push_str(text.get(offset..end).unwrap_or(""));
        } else {
            out.push(before);
            out.push(' ');
        }
        copied = end;
        i = next;
    }
    out.push_str(text.get(copied..).unwrap_or(""));
    out
}

/// A run of source lines that renders as one block.
struct Paragraph<'a> {
    lines: Vec<&'a str>,
    /// True when the lines pass through untouched.
    verbatim: bool,
}

/// Groups lines into paragraphs, continuing one only across a wrap-looking break.
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
fn group_paragraphs<'a>(
    lines: &[&'a str],
    options: &WrappedTextOptions,
    wrap_width: usize,
) -> Vec<Paragraph<'a>> {
    let require_indent = options.rejoin == Rejoin::Indented;
    let mut paragraphs: Vec<Paragraph<'a>> = Vec::new();
    // True while the last paragraph still accepts continuation lines.
    let mut current = false;
    let mut fence: Option<CodeFence> = None;
    let mut math = false;

    // Leading frontmatter is data: rejoining a long value with the key below it
    // merges two YAML entries into one. Blank lines in front count as leading,
    // because the trim rule removes them and promotes the block.
    let mut consumed = 0;
    let mut opener = 0;
    while lines.get(opener).is_some_and(|line| is_blank(line)) {
        opener += 1;
    }
    if lines
        .get(opener)
        .is_some_and(|line| matches_re(&FRONTMATTER_OPEN, line))
    {
        for &line in lines.iter().take(opener + 1) {
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
        }
        consumed = opener + 1;
        for &line in lines.iter().skip(consumed) {
            consumed += 1;
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
            if matches_re(&FRONTMATTER_FENCE, line) {
                break;
            }
        }
    }

    for &line in lines.iter().skip(consumed) {
        if math {
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
            if line.trim_matches(is_js_whitespace) == "$$" {
                math = false;
            }
            continue;
        }

        if is_blank(line) && fence.is_none() {
            current = false;
            // Runs of blank lines collapse here rather than over the rendered text,
            // because a fence's interior blank lines never reach this branch.
            let last_blank = paragraphs.last().is_some_and(|last| {
                last.verbatim
                    && last.lines.len() == 1
                    && last.lines.first().is_some_and(|only| is_blank(only))
            });
            if !last_blank {
                paragraphs.push(Paragraph {
                    lines: vec![line],
                    verbatim: true,
                });
            }
            continue;
        }

        if fence.is_some() {
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
            if fence.as_ref().is_some_and(|open| closes_fence(line, open)) {
                fence = None;
            }
            continue;
        }

        if options.protect_math && line.trim_matches(is_js_whitespace) == "$$" {
            current = false;
            math = true;
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
            continue;
        }

        if let Some(opening) = fence_of(line) {
            current = false;
            fence = Some(opening);
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
            continue;
        }

        if has_hard_break(line) {
            current = false;
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
            continue;
        }

        // A rule or setext underline is complete in itself, also inside a quote.
        // Absorbing the next line would fabricate a heading out of two blocks.
        let unquoted = line.get(prefix_len(&QUOTE_PREFIX, line)..).unwrap_or(line);
        if matches_re(&THEMATIC_BREAK, unquoted) || matches_re(&SETEXT_UNDERLINE, unquoted) {
            current = false;
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: true,
            });
            continue;
        }

        let active = if current { paragraphs.last() } else { None };
        let previous = active.and_then(|p| p.lines.last().copied());
        let first = active.and_then(|p| p.lines.first().copied());
        let continues = match (active, previous, first) {
            (Some(_), Some(previous), Some(first)) => {
                options.rejoin != Rejoin::Never
                    // A heading is complete in itself; absorbing the line below would
                    // swallow a paragraph into it.
                    && !is_heading_line(first)
                    && !starts_new_block(line)
                    && !(options.merge_hyphens && ends_with_url(previous))
                    // A trailing hyphen is wrap evidence on its own: a layout hyphenates
                    // only when the line has reached the margin, so the width test would
                    // reject exactly the narrow columns that need the repair most.
                    && (utf16_len(previous.trim_end_matches(is_js_whitespace)) >= wrap_width
                        || (options.merge_hyphens && ends_hyphenated(previous)))
                    && (!require_indent || leading_width(line) > leading_width(first))
            }
            _ => false,
        };

        if continues {
            if let Some(last) = paragraphs.last_mut() {
                last.lines.push(line);
            }
        } else {
            current = true;
            paragraphs.push(Paragraph {
                lines: vec![line],
                verbatim: false,
            });
        }
    }

    paragraphs
}

/// Joins a paragraph's wrapped lines and drops the indentation the wrap left.
fn render_paragraph(paragraph: &Paragraph<'_>, options: &WrappedTextOptions) -> String {
    if paragraph.verbatim {
        return paragraph.lines.join("\n");
    }
    let Some(&first) = paragraph.lines.first() else {
        return String::new();
    };

    if paragraph.lines.len() == 1 {
        let only = first.trim_end_matches(is_js_whitespace);
        let keep_indent = options.rejoin == Rejoin::Never
            || list_marker_of(first).is_some()
            || matches_re(&NUMBERED_LIST, first)
            || leading_width(first) >= INDENTED_CODE_WIDTH;
        return if keep_indent {
            only.to_string()
        } else {
            only.trim_start_matches([' ', '\t']).to_string()
        };
    }

    let mut fragments: Vec<String> = vec![first.trim_end_matches(is_js_whitespace).to_string()];
    fragments.extend(
        paragraph
            .lines
            .iter()
            .skip(1)
            .map(|line| line.trim_matches(is_js_whitespace).to_string()),
    );

    let joined = if options.merge_hyphens {
        join_pieces(&fragments)
    } else {
        fragments.join(" ")
    };

    // With no rejoin the breaks are the layout, so what is left of the
    // indentation after the shared dedent is content too.
    if options.rejoin == Rejoin::Never {
        return joined;
    }

    let structural = list_marker_of(first).is_some() || matches_re(&NUMBERED_LIST, first);
    if structural || leading_width(first) >= INDENTED_CODE_WIDTH {
        return joined;
    }
    joined.trim_start_matches([' ', '\t']).to_string()
}

/// Strips escape sequences, removes the shared indentation, and rejoins the
/// paragraphs the margin broke.
///
/// Dedenting, trimming and collapsing blank lines only make sense on text that
/// really came from a terminal or a PDF. Nothing identifies itself as such
/// unless it carried escape sequences or was actually rejoined, so on anything
/// else only the explicitly requested rules run — otherwise this would quietly
/// flatten pasted code, nested lists and Markdown's own line breaks.
#[must_use]
pub fn clean_wrapped_text(input: &str, options: &WrappedTextOptions) -> TextResult {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let text = strip_control_sequences(&normalized);
    let had_escapes = text != normalized;

    let pieces: Vec<&str> = text.split('\n').collect();
    let lines = dedent_lines(&pieces);
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let wrap_width = infer_wrap_width(&refs, options.min_wrap_width.unwrap_or(MIN_WRAP_WIDTH));
    let paragraphs = group_paragraphs(&refs, options, wrap_width);
    let rejoined = paragraphs
        .iter()
        .any(|paragraph| !paragraph.verbatim && paragraph.lines.len() > 1);

    if options.rejoin != Rejoin::Never && !had_escapes && !rejoined {
        let mut converted = input.to_string();
        if options.bullets == Bullets::Markdown {
            converted = convert_bullets(&converted, options.protect_math);
        }
        if options.collapse_spaces {
            converted = collapse_space_runs(&converted, options.protect_math);
        }
        return TextResult::new(input, converted);
    }

    let mut output = paragraphs
        .iter()
        .map(|paragraph| render_paragraph(paragraph, options))
        .collect::<Vec<String>>()
        .join("\n");
    if options.bullets == Bullets::Markdown {
        output = convert_bullets(&output, options.protect_math);
    }
    if options.collapse_spaces {
        output = collapse_space_runs(&output, options.protect_math);
    }

    TextResult::new(input, output)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn terminal() -> WrappedTextOptions {
        WrappedTextOptions {
            rejoin: Rejoin::Any,
            bullets: Bullets::Markdown,
            merge_hyphens: false,
            collapse_spaces: false,
            min_wrap_width: None,
            protect_math: false,
        }
    }

    #[test]
    fn rejoins_a_line_a_terminal_broke_at_its_window_width() {
        let wrapped = "npm warn deprecated inflight@1.0.6: This module is not supported and \
            leaks memory. Do\n  not use it. Check out lru-cache instead.";
        assert_eq!(
            clean_wrapped_text(wrapped, &terminal()).text,
            "npm warn deprecated inflight@1.0.6: This module is not supported and leaks \
            memory. Do not use it. Check out lru-cache instead."
        );
    }

    #[test]
    fn a_short_line_was_the_authors_break_and_stays_one() {
        let short = "one\ntwo\nthree";
        assert_eq!(clean_wrapped_text(short, &terminal()).text, short);
    }

    #[test]
    fn structure_stops_a_rejoin() {
        let long = "x".repeat(MIN_WRAP_WIDTH + 5);
        let breakers = [
            "- item",
            "1. item",
            "# Heading",
            "> quote",
            "| a | b |",
            "```",
            "---",
            "    code",
        ];
        for next in breakers {
            let text = format!("{long}\n{next}");
            assert_eq!(clean_wrapped_text(&text, &terminal()).text, text, "{next}");
        }
    }

    #[test]
    fn a_fenced_block_passes_through_verbatim() {
        let text = "```js\nconst a =\n  1;\n```";
        assert_eq!(clean_wrapped_text(text, &terminal()).text, text);
    }

    #[test]
    fn terminal_bullets_become_markdown_list_items() {
        assert_eq!(
            clean_wrapped_text("\u{2022} first\n\u{2022} second", &terminal()).text,
            "- first\n- second"
        );
        // Markers Markdown already understands are left exactly as written.
        assert_eq!(clean_wrapped_text("* first", &terminal()).text, "* first");
    }

    #[test]
    fn escape_sequences_are_removed_and_the_shared_indent_goes_with_them() {
        let text = "    \u{1B}[32mok\u{1B}[0m one\n    two";
        assert_eq!(clean_wrapped_text(text, &terminal()).text, "ok one\ntwo");
    }

    #[test]
    fn dedent_keeps_relative_indentation() {
        assert_eq!(
            dedent_lines(&["    a", "      b", "", "    c"]),
            vec![
                "a".to_string(),
                "  b".to_string(),
                String::new(),
                "c".to_string()
            ]
        );
    }

    #[test]
    fn the_wrap_column_is_inferred_from_the_text_with_a_floor() {
        assert_eq!(
            infer_wrap_width(&["short", "lines"], MIN_WRAP_WIDTH),
            MIN_WRAP_WIDTH
        );
        let wide = ["y".repeat(100), "z".repeat(96), "end".to_string()];
        let refs: Vec<&str> = wide.iter().map(String::as_str).collect();
        assert_eq!(infer_wrap_width(&refs, MIN_WRAP_WIDTH), 76);
    }

    #[test]
    fn a_trailing_hyphen_marks_a_broken_word() {
        assert!(ends_hyphenated("expo-"));
        assert!(ends_hyphenated("caf\u{E9}-"));
        assert!(ends_hyphenated("word\u{AD}"));
        assert!(!ends_hyphenated("---"));
        assert!(!ends_hyphenated(""));
    }

    #[test]
    fn join_pieces_repairs_a_hyphen_before_a_lowercase_word() {
        let fragments = ["expo-".to_string(), "sure".to_string()];
        assert_eq!(join_pieces(&fragments), "exposure");
    }

    #[test]
    fn fragments_of_unspaced_scripts_join_without_a_space() {
        assert_eq!(
            fragment_join("\u{6F22}\u{5B57}", "\u{30C6}\u{30AD}\u{30B9}\u{30C8}"),
            FragmentJoin {
                separator: String::new(),
                drop_hyphen: false
            }
        );
        assert_eq!(
            fragment_join("ex\u{AD}", "ample"),
            FragmentJoin {
                separator: String::new(),
                drop_hyphen: true
            }
        );
    }

    #[test]
    fn empty_input_is_reported_unchanged() {
        let result = clean_wrapped_text("", &terminal());
        assert_eq!(result.text, "");
        assert!(!result.changed);
    }

    #[test]
    fn a_paste_that_needed_nothing_is_reported_unchanged() {
        let text = "one\ntwo";
        let result = clean_wrapped_text(text, &terminal());
        assert!(!result.changed);
        assert_eq!(result.text, text);
    }

    #[test]
    fn every_static_pattern_compiles() {
        assert!(NUMBERED_LIST.is_some());
        assert!(ENUMERATOR.is_some());
        assert!(HEADING.is_some());
        assert!(BLOCKQUOTE.is_some());
        assert!(TABLE_ROW.is_some());
        assert!(THEMATIC_BREAK.is_some());
        assert!(FRONTMATTER_FENCE.is_some());
        assert!(FRONTMATTER_OPEN.is_some());
        assert!(SETEXT_UNDERLINE.is_some());
        assert!(LINE_PREFIX.is_some());
        assert!(HEADING_STRIP.is_some());
        assert!(QUOTE_PREFIX.is_some());
    }

    #[test]
    fn every_pattern_compiles() {
        assert!(NUMBERED_LIST.is_some(), "NUMBERED_LIST");
        assert!(ENUMERATOR.is_some(), "ENUMERATOR");
        assert!(HEADING.is_some(), "HEADING");
        assert!(BLOCKQUOTE.is_some(), "BLOCKQUOTE");
        assert!(TABLE_ROW.is_some(), "TABLE_ROW");
        assert!(THEMATIC_BREAK.is_some(), "THEMATIC_BREAK");
        assert!(FRONTMATTER_FENCE.is_some(), "FRONTMATTER_FENCE");
        assert!(FRONTMATTER_OPEN.is_some(), "FRONTMATTER_OPEN");
        assert!(SETEXT_UNDERLINE.is_some(), "SETEXT_UNDERLINE");
        assert!(LINE_PREFIX.is_some(), "LINE_PREFIX");
        assert!(HEADING_STRIP.is_some(), "HEADING_STRIP");
        assert!(QUOTE_PREFIX.is_some(), "QUOTE_PREFIX");
    }
}

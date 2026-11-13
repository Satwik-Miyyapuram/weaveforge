//! Google Docs-style formatting for the markdown editor: the pure half of
//! `components/markdown/markdown-format.ts`.
//!
//! Every format takes the document, the selection and the main head, and returns the edits and
//! the selection after them ([`Outcome`]). The caller applies both in one transaction, so no
//! position is mapped on the JavaScript side. Offsets are UTF-16 code units, the unit CodeMirror
//! counts in. The markers are ASCII, so unit-level care is only needed when slicing text.

#![allow(
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation,
    reason = "UTF-16 offsets are far below isize::MAX; signed deltas are only applied to positions that stay in range"
)]

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

const NEWLINE: u16 = 0x0A;
const STAR: u16 = 0x2A;
const URL: &str = "https://";

/// A selection range in UTF-16 code units, `from <= to`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename = "MarkdownSpan")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Span {
    /// Start, inclusive.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub from: usize,
    /// End, exclusive.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub to: usize,
}

/// One replacement: the units `from..to` of the document before the change become `insert`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename = "MarkdownEdit")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Edit {
    /// Start of the replaced units, inclusive.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub from: usize,
    /// End of the replaced units, exclusive; equal to `from` for an insertion.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub to: usize,
    /// The text put in their place.
    pub insert: String,
}

impl Edit {
    fn insert_len(&self) -> usize {
        self.insert.encode_utf16().count()
    }

    fn delta(&self) -> isize {
        self.insert_len() as isize - (self.to - self.from) as isize
    }
}

/// What a format did: the edits (positions in the document before them) and the selection after them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename = "MarkdownOutcome")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Outcome {
    /// Edits in ascending order, none overlapping.
    pub changes: Vec<Edit>,
    /// Selection ranges in the document after `changes`, in the order they were given.
    pub ranges: Vec<Span>,
    /// Index into `ranges` of the main selection.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub main: usize,
}

/// An inline marker pair that wraps selected text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wrap {
    /// `**`.
    Bold,
    /// `*`.
    Italic,
    /// `<u>` and `</u>`.
    Underline,
    /// `~~`.
    Strike,
    /// Backticks.
    Code,
    /// `<sup>` and `</sup>`.
    Superscript,
    /// `<sub>` and `</sub>`.
    Subscript,
}

impl Wrap {
    /// The marker that opens the pair.
    #[must_use]
    pub const fn open(self) -> &'static str {
        match self {
            Self::Bold => "**",
            Self::Italic => "*",
            Self::Underline => "<u>",
            Self::Strike => "~~",
            Self::Code => "`",
            Self::Superscript => "<sup>",
            Self::Subscript => "<sub>",
        }
    }

    /// The marker that closes the pair.
    #[must_use]
    pub const fn close(self) -> &'static str {
        match self {
            Self::Underline => "</u>",
            Self::Superscript => "</sup>",
            Self::Subscript => "</sub>",
            _ => self.open(),
        }
    }
}

/// The kind of list a line becomes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListKind {
    /// `- item`.
    Bullet,
    /// `1. item`, numbered by position among the selected lines.
    Ordered,
    /// `- [ ] item`.
    Task,
    /// `> item`.
    Quote,
}

/// One format the editor offers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    /// Adds the marker pair around each selection, or takes it off when it is already there.
    Wrap(Wrap),
    /// Makes each selected line a heading of this level (1 to 6), or plain text at 0.
    Heading(u8),
    /// Turns the selected lines into this kind of list, or takes the markers off.
    List(ListKind),
    /// Wraps the selection as a link.
    Link,
    /// Strips the inline markers from the selection.
    ClearFormatting,
}

/// One named format with its keymap key and the menu's accelerator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Action {
    /// Stable id, used to name the action across the wasm boundary.
    pub id: &'static str,
    /// The menu label.
    pub label: &'static str,
    /// CodeMirror key name, when the action has a key.
    pub key: Option<&'static str>,
    /// The key as printed in a menu.
    pub accelerator: Option<&'static str>,
    /// What the action does.
    pub format: Format,
}

/// An [`Action`] without its format, for the editor's keymap and menus.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename = "MarkdownActionInfo")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ActionInfo {
    /// Stable id, as passed back to [`apply`] through [`format_for`].
    pub id: &'static str,
    /// The menu label.
    pub label: &'static str,
    /// CodeMirror key name, when the action has one.
    pub key: Option<&'static str>,
    /// The key as printed in a menu.
    pub accelerator: Option<&'static str>,
}

const fn bound(
    id: &'static str,
    label: &'static str,
    key: &'static str,
    accelerator: &'static str,
    format: Format,
) -> Action {
    Action {
        id,
        label,
        key: Some(key),
        accelerator: Some(accelerator),
        format,
    }
}

/// Google Docs' formatting keys, in the order the keymap lists them: inline, headings, lists.
pub const ACTIONS: &[Action] = &[
    bound("bold", "Bold", "Mod-b", "Ctrl+B", Format::Wrap(Wrap::Bold)),
    bound(
        "italic",
        "Italic",
        "Mod-i",
        "Ctrl+I",
        Format::Wrap(Wrap::Italic),
    ),
    bound(
        "underline",
        "Underline",
        "Mod-u",
        "Ctrl+U",
        Format::Wrap(Wrap::Underline),
    ),
    bound(
        "strike",
        "Strikethrough",
        "Alt-Shift-5",
        "Alt+Shift+5",
        Format::Wrap(Wrap::Strike),
    ),
    bound(
        "code",
        "Inline code",
        "Mod-Shift-`",
        "Ctrl+Shift+`",
        Format::Wrap(Wrap::Code),
    ),
    bound(
        "sup",
        "Superscript",
        "Mod-.",
        "Ctrl+.",
        Format::Wrap(Wrap::Superscript),
    ),
    bound(
        "sub",
        "Subscript",
        "Mod-,",
        "Ctrl+,",
        Format::Wrap(Wrap::Subscript),
    ),
    bound("link", "Insert link", "Mod-k", "Ctrl+K", Format::Link),
    bound(
        "clear",
        "Clear formatting",
        "Mod-\\",
        "Ctrl+\\",
        Format::ClearFormatting,
    ),
    bound(
        "normal",
        "Normal text",
        "Mod-Alt-0",
        "Ctrl+Alt+0",
        Format::Heading(0),
    ),
    bound(
        "h1",
        "Heading 1",
        "Mod-Alt-1",
        "Ctrl+Alt+1",
        Format::Heading(1),
    ),
    bound(
        "h2",
        "Heading 2",
        "Mod-Alt-2",
        "Ctrl+Alt+2",
        Format::Heading(2),
    ),
    bound(
        "h3",
        "Heading 3",
        "Mod-Alt-3",
        "Ctrl+Alt+3",
        Format::Heading(3),
    ),
    bound(
        "h4",
        "Heading 4",
        "Mod-Alt-4",
        "Ctrl+Alt+4",
        Format::Heading(4),
    ),
    bound(
        "h5",
        "Heading 5",
        "Mod-Alt-5",
        "Ctrl+Alt+5",
        Format::Heading(5),
    ),
    bound(
        "h6",
        "Heading 6",
        "Mod-Alt-6",
        "Ctrl+Alt+6",
        Format::Heading(6),
    ),
    bound(
        "ordered",
        "Numbered list",
        "Mod-Shift-7",
        "Ctrl+Shift+7",
        Format::List(ListKind::Ordered),
    ),
    bound(
        "bullet",
        "Bulleted list",
        "Mod-Shift-8",
        "Ctrl+Shift+8",
        Format::List(ListKind::Bullet),
    ),
    bound(
        "task",
        "Checklist",
        "Mod-Shift-9",
        "Ctrl+Shift+9",
        Format::List(ListKind::Task),
    ),
    Action {
        id: "quote",
        label: "Quote",
        key: None,
        accelerator: None,
        format: Format::List(ListKind::Quote),
    },
];

/// The format behind an action id, or `None` for an unknown id.
#[must_use]
pub fn format_for(id: &str) -> Option<Format> {
    ACTIONS
        .iter()
        .find(|action| action.id == id)
        .map(|action| action.format)
}

/// Every action as the editor's keymap and menus list it.
#[must_use]
pub fn action_infos() -> Vec<ActionInfo> {
    ACTIONS
        .iter()
        .map(|action| ActionInfo {
            id: action.id,
            label: action.label,
            key: action.key,
            accelerator: action.accelerator,
        })
        .collect()
}

/// Applies `format` to `doc` with the selection `ranges` (UTF-16 offsets, in document order) and
/// the main selection's head `main_head`.
///
/// Returns `None` where the editor does nothing: a heading the selected lines already have, or
/// Clear formatting with no selection. Empty `ranges` also gives `None`.
#[must_use]
pub fn apply(format: Format, doc: &str, ranges: &[Span], main_head: usize) -> Option<Outcome> {
    if ranges.is_empty() {
        return None;
    }
    let units: Vec<u16> = doc.encode_utf16().collect();
    let ranges: Vec<Span> = ranges
        .iter()
        .map(|range| clamp(*range, units.len()))
        .collect();
    let head = main_head.min(units.len());
    let main = main_index(&ranges, head);
    match format {
        Format::Wrap(wrap) => Some(toggle_wrap(&units, &ranges, main, wrap)),
        Format::Heading(level) => set_heading(&units, &ranges, main, level),
        Format::List(kind) => Some(toggle_list(&units, &ranges, main, head, kind)),
        Format::Link => Some(insert_link(&units, &ranges, main)),
        Format::ClearFormatting => clear_formatting(&units, &ranges, main),
    }
}

/// One range's share of a `changeByRange`: its edits, and its selection after them.
struct Piece {
    changes: Vec<Edit>,
    range: Span,
}

fn clamp(range: Span, len: usize) -> Span {
    let a = range.from.min(len);
    let b = range.to.min(len);
    Span {
        from: a.min(b),
        to: a.max(b),
    }
}

/// The index of the range holding `head`, or 0 when none does.
fn main_index(ranges: &[Span], head: usize) -> usize {
    ranges
        .iter()
        .position(|range| range.from <= head && head <= range.to)
        .unwrap_or(0)
}

/// `changeByRange`: each range's piece, with the selections shifted by the edits of the ranges
/// before them.
fn by_range(ranges: &[Span], mut each: impl FnMut(Span) -> Piece) -> (Vec<Edit>, Vec<Span>) {
    let mut changes = Vec::new();
    let mut out = Vec::with_capacity(ranges.len());
    let mut shift: isize = 0;
    for &range in ranges {
        let piece = each(range);
        let own: isize = piece.changes.iter().map(Edit::delta).sum();
        out.push(Span {
            from: offset(piece.range.from, shift),
            to: offset(piece.range.to, shift),
        });
        shift += own;
        changes.extend(piece.changes);
    }
    (changes, out)
}

fn offset(pos: usize, shift: isize) -> usize {
    usize::try_from(pos as isize + shift).unwrap_or(0)
}

/// Maps a position through `changes` (ascending, non-overlapping). A position at an insertion
/// point moves past the inserted text only when `after` is set.
fn map_pos(pos: usize, changes: &[Edit], after: bool) -> usize {
    let mut shift: isize = 0;
    for change in changes {
        let inserted = change.insert_len() as isize;
        if pos < change.from {
            break;
        }
        if pos == change.from {
            return offset(pos, shift + if after { inserted } else { 0 });
        }
        if pos < change.to {
            return offset(change.from, shift + if after { inserted } else { 0 });
        }
        shift += change.delta();
    }
    offset(pos, shift)
}

/// Where a selection range ends up after `changes`: an empty range stays before insertions at
/// its caret, a non-empty one keeps its text (the start moves past an insertion at it).
fn map_range(range: Span, changes: &[Edit]) -> Span {
    if range.from == range.to {
        let pos = map_pos(range.from, changes, false);
        Span { from: pos, to: pos }
    } else {
        Span {
            from: map_pos(range.from, changes, true),
            to: map_pos(range.to, changes, false),
        }
    }
}

/// An outcome for line edits: the selection is mapped through them.
fn with_changes(ranges: &[Span], main: usize, changes: Vec<Edit>) -> Outcome {
    let ranges = ranges
        .iter()
        .map(|range| map_range(*range, &changes))
        .collect();
    Outcome {
        changes,
        ranges,
        main,
    }
}

fn at(units: &[u16], pos: usize, marker: &str) -> bool {
    // Markers are ASCII, so each byte is one UTF-16 unit.
    let needle = marker.as_bytes();
    units.get(pos..pos + needle.len()).is_some_and(|slice| {
        slice
            .iter()
            .zip(needle)
            .all(|(&unit, &byte)| unit == u16::from(byte))
    })
}

fn to_text(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn star_run_after(units: &[u16], pos: usize) -> usize {
    units
        .iter()
        .skip(pos)
        .take_while(|&&unit| unit == STAR)
        .count()
}

fn star_run_before(units: &[u16], pos: usize) -> usize {
    units[..pos]
        .iter()
        .rev()
        .take_while(|&&unit| unit == STAR)
        .count()
}

/// Whether `[from, to)` already sits inside `wrap`. `*` and `**` share a character, so a star run
/// is counted: italic is an odd run (1 or 3), bold a run of 2 or 3.
fn is_wrapped(units: &[u16], from: usize, to: usize, wrap: Wrap) -> bool {
    match wrap {
        Wrap::Italic => star_run_before(units, from) % 2 == 1 && star_run_after(units, to) % 2 == 1,
        Wrap::Bold => star_run_before(units, from) >= 2 && star_run_after(units, to) >= 2,
        _ => {
            let (open, close) = (wrap.open(), wrap.close());
            from >= open.len() && at(units, from - open.len(), open) && at(units, to, close)
        }
    }
}

fn wrap_range(units: &[u16], range: Span, wrap: Wrap) -> Piece {
    let (open, close) = (wrap.open(), wrap.close());
    let (open_len, close_len) = (open.len(), close.len());
    let Span { from, to } = range;
    if is_wrapped(units, from, to, wrap) {
        let start = from - open_len;
        return Piece {
            changes: vec![
                Edit {
                    from: start,
                    to: from,
                    insert: String::new(),
                },
                Edit {
                    from: to,
                    to: to + close_len,
                    insert: String::new(),
                },
            ],
            range: Span {
                from: start,
                to: to - open_len,
            },
        };
    }
    let inner_len = to - from;
    if inner_len >= open_len + close_len
        && at(units, from, open)
        && at(units, to - close_len, close)
    {
        let inner = to_text(&units[from + open_len..to - close_len]);
        return Piece {
            changes: vec![Edit {
                from,
                to,
                insert: inner,
            }],
            range: Span {
                from,
                to: from + inner_len - open_len - close_len,
            },
        };
    }
    let inner = to_text(&units[from..to]);
    let start = from + open_len;
    Piece {
        changes: vec![Edit {
            from,
            to,
            insert: format!("{open}{inner}{close}"),
        }],
        range: Span {
            from: start,
            to: start + inner_len,
        },
    }
}

/// Adds `wrap` around each selection, or takes it off when it is already there.
fn toggle_wrap(units: &[u16], ranges: &[Span], main: usize, wrap: Wrap) -> Outcome {
    let (changes, ranges) = by_range(ranges, |range| wrap_range(units, range, wrap));
    Outcome {
        changes,
        ranges,
        main,
    }
}

/// Clear formatting: strips inline markers from each selection. `_` is kept, as it is often part
/// of a word.
#[allow(
    clippy::unnecessary_wraps,
    reason = "Option matches the other formats; None is the no-selection case"
)]
fn clear_formatting(units: &[u16], ranges: &[Span], main: usize) -> Option<Outcome> {
    if ranges.iter().all(|range| range.from == range.to) {
        return None;
    }
    let (changes, ranges) = by_range(ranges, |range| {
        let stripped = INLINE_MARKS
            .replace_all(&to_text(&units[range.from..range.to]), "")
            .into_owned();
        let len = stripped.encode_utf16().count();
        Piece {
            changes: vec![Edit {
                from: range.from,
                to: range.to,
                insert: stripped,
            }],
            range: Span {
                from: range.from,
                to: range.from + len,
            },
        }
    });
    Some(Outcome {
        changes,
        ranges,
        main,
    })
}

/// Inserts a link around each selection and selects what is still to type: the address for
/// selected words, the label for a selected URL.
fn insert_link(units: &[u16], ranges: &[Span], main: usize) -> Outcome {
    let (changes, ranges) = by_range(ranges, |range| {
        let text = to_text(&units[range.from..range.to]);
        let len = range.to - range.from;
        if URL_LIKE.is_match(&text) {
            Piece {
                changes: vec![Edit {
                    from: range.from,
                    to: range.to,
                    insert: format!("[]({text})"),
                }],
                range: Span {
                    from: range.from + 1,
                    to: range.from + 1,
                },
            }
        } else {
            let start = range.from + len + 3;
            Piece {
                changes: vec![Edit {
                    from: range.from,
                    to: range.to,
                    insert: format!("[{text}]({URL})"),
                }],
                range: Span {
                    from: start,
                    to: start + URL.len(),
                },
            }
        }
    });
    Outcome {
        changes,
        ranges,
        main,
    }
}

/// Makes each selected line a heading of `level`, or plain text at 0. `None` when every line
/// already has it.
fn set_heading(units: &[u16], ranges: &[Span], main: usize, level: u8) -> Option<Outcome> {
    let prefix = if level == 0 {
        String::new()
    } else {
        format!("{} ", "#".repeat(usize::from(level.min(6))))
    };
    let changes: Vec<Edit> = selected_lines(units, ranges)
        .iter()
        .filter_map(|line| {
            let old = HEADING.find(&line.text).map_or("", |found| found.as_str());
            (old != prefix).then(|| Edit {
                from: line.from,
                to: line.from + old.len(),
                insert: prefix.clone(),
            })
        })
        .collect();
    (!changes.is_empty()).then(|| with_changes(ranges, main, changes))
}

/// Turns the selected lines into a list of `kind`, numbering an ordered one. When every non-blank
/// line already is one, the markers come off instead.
fn toggle_list(
    units: &[u16],
    ranges: &[Span],
    main: usize,
    head: usize,
    kind: ListKind,
) -> Outcome {
    let mut lines: Vec<Line> = selected_lines(units, ranges)
        .into_iter()
        .filter(|line| kind == ListKind::Quote || !line.text.trim().is_empty())
        .collect();
    if lines.is_empty() {
        lines.extend(line_at(units, head));
    }
    let remove = lines.iter().all(|line| is_kind(&line.text, kind));
    let changes = lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let indent_len = line.text.len() - line.text.trim_start_matches([' ', '\t']).len();
            let old_len = LIST_MARK
                .find(&line.text)
                .map_or(indent_len, |found| found.len());
            let insert = if remove {
                String::new()
            } else {
                match kind {
                    ListKind::Bullet => "- ".to_owned(),
                    ListKind::Ordered => format!("{}. ", i + 1),
                    ListKind::Task => "- [ ] ".to_owned(),
                    ListKind::Quote => "> ".to_owned(),
                }
            };
            Edit {
                from: line.from + indent_len,
                to: line.from + old_len,
                insert,
            }
        })
        .collect();
    with_changes(ranges, main, changes)
}

/// Whether `text` already is a list or quote of `kind`, after its indent.
fn is_kind(text: &str, kind: ListKind) -> bool {
    let rest = text.trim_start_matches([' ', '\t']);
    match kind {
        ListKind::Bullet => is_bullet(rest),
        ListKind::Ordered => ORDERED.is_match(rest),
        ListKind::Task => TASK.is_match(rest),
        ListKind::Quote => QUOTE.is_match(rest),
    }
}

/// `- ` or `* ` or `+ ` not followed by a checkbox. The check is written out because `regex-lite`
/// has no lookahead.
fn is_bullet(rest: &str) -> bool {
    let bytes = rest.as_bytes();
    bytes.len() >= 2
        && matches!(bytes[0], b'-' | b'*' | b'+')
        && bytes[1] == b' '
        && !is_checkbox(&rest[2..])
}

fn is_checkbox(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() >= 4
        && bytes[0] == b'['
        && matches!(bytes[1], b' ' | b'x' | b'X')
        && bytes[2] == b']'
        && bytes[3] == b' '
}

/// One line of the document: its index, where it starts, and its text without the newline.
#[derive(Clone, Debug)]
struct Line {
    index: usize,
    from: usize,
    text: String,
}

fn lines(units: &[u16]) -> Vec<Line> {
    let mut out = Vec::new();
    let mut from = 0;
    for (i, &unit) in units.iter().enumerate() {
        if unit == NEWLINE {
            out.push(Line {
                index: out.len(),
                from,
                text: to_text(&units[from..i]),
            });
            from = i + 1;
        }
    }
    out.push(Line {
        index: out.len(),
        from,
        text: to_text(&units[from..]),
    });
    out
}

/// The index of the line holding `pos`: the number of newlines before it.
fn line_index(units: &[u16], pos: usize) -> usize {
    units[..pos].iter().filter(|&&unit| unit == NEWLINE).count()
}

fn line_at(units: &[u16], pos: usize) -> Option<Line> {
    lines(units).into_iter().nth(line_index(units, pos))
}

/// The lines the selections touch, each once, top to bottom.
fn selected_lines(units: &[u16], ranges: &[Span]) -> Vec<Line> {
    let wanted: BTreeSet<usize> = ranges
        .iter()
        .flat_map(|range| line_index(units, range.from)..=line_index(units, range.to))
        .collect();
    lines(units)
        .into_iter()
        .filter(|line| wanted.contains(&line.index))
        .collect()
}

/// Applies `changes` (ascending, non-overlapping) to `units`.
#[cfg(test)]
fn apply_changes(units: &[u16], changes: &[Edit]) -> Vec<u16> {
    let mut out = Vec::new();
    let mut cursor = 0;
    for change in changes {
        out.extend_from_slice(&units[cursor..change.from]);
        out.extend(change.insert.encode_utf16());
        cursor = change.to;
    }
    out.extend_from_slice(&units[cursor..]);
    out
}

static HEADING: LazyLock<Regex> = LazyLock::new(|| compile(r"^#{1,6}[ \t]+"));
static LIST_MARK: LazyLock<Regex> =
    LazyLock::new(|| compile(r"^[ \t]*(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)"));
static ORDERED: LazyLock<Regex> = LazyLock::new(|| compile(r"^\d+[.)] "));
static TASK: LazyLock<Regex> = LazyLock::new(|| compile(r"^[-*+] \[[ xX]\] "));
static QUOTE: LazyLock<Regex> = LazyLock::new(|| compile(r"^> ?"));
static URL_LIKE: LazyLock<Regex> = LazyLock::new(|| compile(r"(?i)^(https?://|www\.)\S+$"));
static INLINE_MARKS: LazyLock<Regex> = LazyLock::new(|| compile(r"</?(?:u|sup|sub)>|\*\*|~~|\*|`"));

/// Compiles one of this module's fixed patterns. They are literals checked by the tests, so a
/// failure is a programming error caught before release.
#[allow(
    clippy::expect_used,
    reason = "fixed literal patterns, each exercised by the module tests"
)]
fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).expect("fixed markdown format pattern")
}

#[cfg(test)]
#[allow(
    clippy::expect_used,
    reason = "test fixtures; a bad marker is a test bug"
)]
mod tests {
    use super::*;

    /// The document and selection a marked string stands for: `|` for a caret, or `[`/`]` for a
    /// selection, as the TypeScript tests wrote them.
    fn parse(marked: &str) -> (String, Span) {
        if let Some(at) = marked.find('|') {
            let doc = marked.replacen('|', "", 1);
            let pos = utf16_len(&marked[..at]);
            return (doc, Span { from: pos, to: pos });
        }
        let open_at = marked.find('[').expect("selection marker `[`");
        let without_open = marked.replacen('[', "", 1);
        let close_at = without_open.find(']').expect("selection marker `]`");
        let from = utf16_len(&marked[..open_at]);
        let to = utf16_len(&without_open[..close_at]);
        let doc = without_open.replacen(']', "", 1);
        (doc, Span { from, to })
    }

    fn utf16_len(text: &str) -> usize {
        text.encode_utf16().count()
    }

    /// The marked string the format leaves: `|` for a caret, `[`/`]` around a selection.
    fn format_marked(marked: &str, format: Format) -> Option<String> {
        let (doc, selection) = parse(marked);
        let outcome = apply(format, &doc, &[selection], selection.to)?;
        let units: Vec<u16> = doc.encode_utf16().collect();
        let next = apply_changes(&units, &outcome.changes);
        let main = outcome.ranges[outcome.main];
        let text = |from: usize, to: usize| String::from_utf16_lossy(&next[from..to]);
        let end = next.len();
        Some(if main.from == main.to {
            format!("{}|{}", text(0, main.from), text(main.from, end))
        } else {
            format!(
                "{}[{}]{}",
                text(0, main.from),
                text(main.from, main.to),
                text(main.to, end)
            )
        })
    }

    fn check(marked: &str, format: Format, want: &str) {
        assert_eq!(
            format_marked(marked, format).as_deref(),
            Some(want),
            "input {marked:?}"
        );
    }

    fn none(marked: &str, format: Format) {
        assert_eq!(format_marked(marked, format), None, "input {marked:?}");
    }

    #[test]
    fn bold_wraps_the_selection_and_keeps_the_words_selected() {
        check("a [word] b", Format::Wrap(Wrap::Bold), "a **[word]** b");
    }

    #[test]
    fn bold_again_takes_it_off() {
        check("a **[word]** b", Format::Wrap(Wrap::Bold), "a [word] b");
        check("a [**word**] b", Format::Wrap(Wrap::Bold), "a [word] b");
    }

    #[test]
    fn bold_with_no_selection_leaves_the_caret_between_the_markers() {
        check("a |b", Format::Wrap(Wrap::Bold), "a **|**b");
    }

    #[test]
    fn italic_inside_bold_adds_a_star_rather_than_unwrapping_the_bold() {
        check("**[word]**", Format::Wrap(Wrap::Italic), "***[word]***");
        check("***[word]***", Format::Wrap(Wrap::Italic), "**[word]**");
        check("***[word]***", Format::Wrap(Wrap::Bold), "*[word]*");
    }

    #[test]
    fn underline_and_strikethrough_use_u_and_tilde() {
        check("[x]", Format::Wrap(Wrap::Underline), "<u>[x]</u>");
        check("<u>[x]</u>", Format::Wrap(Wrap::Underline), "[x]");
        check("[x]", Format::Wrap(Wrap::Strike), "~~[x]~~");
    }

    #[test]
    fn a_heading_replaces_any_heading_the_line_had() {
        check("ti|tle", Format::Heading(2), "## ti|tle");
        check("### ti|tle", Format::Heading(1), "# ti|tle");
        check("## ti|tle", Format::Heading(0), "ti|tle");
    }

    #[test]
    fn a_heading_the_line_already_has_changes_nothing() {
        none("## ti|tle", Format::Heading(2));
    }

    #[test]
    fn headings_apply_to_every_selected_line() {
        check("[a\nb]", Format::Heading(3), "### [a\n### b]");
    }

    #[test]
    fn a_numbered_list_counts_the_selected_lines() {
        check(
            "[a\nb\nc]",
            Format::List(ListKind::Ordered),
            "1. [a\n2. b\n3. c]",
        );
    }

    #[test]
    fn a_list_again_removes_the_markers() {
        check("[- a\n- b]", Format::List(ListKind::Bullet), "[a\nb]");
    }

    #[test]
    fn switching_list_kind_swaps_the_marker_and_keeps_the_indent() {
        check("  - |a", Format::List(ListKind::Ordered), "  1. |a");
        check("1. |a", Format::List(ListKind::Task), "- [ ] |a");
    }

    #[test]
    fn a_bullet_toggle_does_not_treat_a_checklist_item_as_a_bullet() {
        check("- [ ] |a", Format::List(ListKind::Bullet), "- |a");
    }

    #[test]
    fn blank_lines_are_left_out_of_a_list() {
        check("[a\n\nb]", Format::List(ListKind::Bullet), "- [a\n\n- b]");
    }

    #[test]
    fn a_link_selects_the_address_to_type_over() {
        check("see [docs] now", Format::Link, "see [docs]([https://]) now");
    }

    #[test]
    fn a_selected_url_becomes_the_link_target_caret_on_the_label() {
        check("[https://x.org]", Format::Link, "[|](https://x.org)");
    }

    #[test]
    fn clear_formatting_strips_inline_markers_but_keeps_underscores() {
        check(
            "[**a** *b* <u>c</u> ~~d~~ `e` f_g]",
            Format::ClearFormatting,
            "[a b c d e f_g]",
        );
    }

    #[test]
    fn clear_formatting_with_no_selection_does_nothing() {
        none("**a|**", Format::ClearFormatting);
    }

    #[test]
    fn the_keymap_carries_google_docs_keys() {
        let keys: Vec<&str> = ACTIONS.iter().filter_map(|action| action.key).collect();
        for key in [
            "Mod-b",
            "Mod-i",
            "Mod-u",
            "Alt-Shift-5",
            "Mod-k",
            "Mod-\\",
            "Mod-Alt-0",
            "Mod-Alt-1",
            "Mod-Alt-6",
            "Mod-Shift-7",
            "Mod-Shift-8",
            "Mod-Shift-9",
        ] {
            assert!(keys.contains(&key), "{key}");
        }
        let unique: BTreeSet<&str> = keys.iter().copied().collect();
        assert_eq!(unique.len(), keys.len(), "no key bound twice");
    }
}

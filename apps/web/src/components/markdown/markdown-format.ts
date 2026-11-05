import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";

/**
 * Formatting for the markdown editor, with Google Docs' keys.
 *
 * Each format is a pure `(state) => spec | null` so it is testable without a
 * DOM; `run` turns one into a CodeMirror command. Null means "nothing to do",
 * and the key falls through to the next binding.
 */
export type Format = (state: EditorState) => TransactionSpec | null;

/** A marker pair that wraps inline text: `**` for bold, `<u>`/`</u>` for underline. */
interface Wrap {
  open: string;
  close: string;
}

export const BOLD: Wrap = { open: "**", close: "**" };
export const ITALIC: Wrap = { open: "*", close: "*" };
export const UNDERLINE: Wrap = { open: "<u>", close: "</u>" };
export const STRIKE: Wrap = { open: "~~", close: "~~" };
export const CODE: Wrap = { open: "`", close: "`" };
export const SUPERSCRIPT: Wrap = { open: "<sup>", close: "</sup>" };
export const SUBSCRIPT: Wrap = { open: "<sub>", close: "</sub>" };

/** How many `ch` sit in a row starting at `pos` and walking `step` (±1). */
function runOf(doc: string, pos: number, step: 1 | -1, ch: string): number {
  let n = 0;
  for (let i = step === 1 ? pos : pos - 1; i >= 0 && i < doc.length && doc[i] === ch; i += step) n++;
  return n;
}

/**
 * Whether `[from, to)` already sits inside `wrap`.
 *
 * `*` and `**` share a character, so a star run is counted rather than
 * matched: italic is an odd run (1 or 3), bold a run of 2 or 3.
 */
function isWrapped(doc: string, from: number, to: number, wrap: Wrap): boolean {
  if (wrap.open === "*" || wrap.open === "**") {
    const before = runOf(doc, from, -1, "*");
    const after = runOf(doc, to, 1, "*");
    const has = (run: number) => (wrap.open === "*" ? run % 2 === 1 : run >= 2);
    return has(before) && has(after);
  }
  return (
    doc.slice(from - wrap.open.length, from) === wrap.open && doc.slice(to, to + wrap.close.length) === wrap.close
  );
}

/** Adds `wrap` around each selection, or takes it off when it is already there. */
export function toggleWrap(wrap: Wrap): Format {
  return (state) => {
    const doc = state.doc.toString();
    return state.changeByRange((range) => {
      const { from, to } = range;
      if (isWrapped(doc, from, to, wrap)) {
        const start = from - wrap.open.length;
        return {
          changes: [
            { from: start, to: from },
            { from: to, to: to + wrap.close.length },
          ],
          range: EditorSelection.range(start, to - wrap.open.length),
        };
      }
      const inner = doc.slice(from, to);
      if (
        inner.length >= wrap.open.length + wrap.close.length &&
        inner.startsWith(wrap.open) &&
        inner.endsWith(wrap.close)
      ) {
        const text = inner.slice(wrap.open.length, inner.length - wrap.close.length);
        return {
          changes: { from, to, insert: text },
          range: EditorSelection.range(from, from + text.length),
        };
      }
      const start = from + wrap.open.length;
      return {
        changes: { from, to, insert: wrap.open + inner + wrap.close },
        range: EditorSelection.range(start, start + inner.length),
      };
    });
  };
}

/** The lines the selection touches, each once, top to bottom. */
function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines = [];
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  return lines.sort((a, b) => a.number - b.number);
}

const HEADING = /^#{1,6}[ \t]+/;

/** Makes each selected line a heading of `level` (1–6), or plain text at 0. */
export function setHeading(level: number): Format {
  return (state) => {
    const prefix = level > 0 ? `${"#".repeat(Math.min(level, 6))} ` : "";
    const changes = selectedLines(state).flatMap((line) => {
      const old = HEADING.exec(line.text)?.[0] ?? "";
      return old === prefix ? [] : [{ from: line.from, to: line.from + old.length, insert: prefix }];
    });
    return changes.length ? { changes, userEvent: "input.format" } : null;
  };
}

export type ListKind = "bullet" | "ordered" | "task" | "quote";

/** Any list or quote marker at a line's start, after its indent. */
const LIST_MARK = /^([ \t]*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)/;

const MARK_OF: Record<ListKind, RegExp> = {
  bullet: /^[-*+] (?!\[[ xX]\] )/,
  ordered: /^\d+[.)] /,
  task: /^[-*+] \[[ xX]\] /,
  quote: /^> ?/,
};

/**
 * Turns the selected lines into a list of `kind`, numbering an ordered one.
 * When every non-blank line already is one, the markers come off instead.
 */
export function toggleList(kind: ListKind): Format {
  return (state) => {
    const lines = selectedLines(state).filter((line) => line.text.trim() !== "" || kind === "quote");
    if (lines.length === 0) {
      const line = state.doc.lineAt(state.selection.main.head);
      lines.push(line);
    }
    const isKind = (text: string) => {
      const indent = /^[ \t]*/.exec(text)![0];
      return MARK_OF[kind].test(text.slice(indent.length));
    };
    const remove = lines.every((line) => isKind(line.text));
    const changes = lines.map((line, i) => {
      const match = LIST_MARK.exec(line.text);
      const indent = match?.[1] ?? /^[ \t]*/.exec(line.text)![0];
      const oldEnd = line.from + (match ? match[0].length : indent.length);
      const mark = remove
        ? ""
        : kind === "bullet"
          ? "- "
          : kind === "ordered"
            ? `${i + 1}. `
            : kind === "task"
              ? "- [ ] "
              : "> ";
      return { from: line.from + indent.length, to: oldEnd, insert: mark };
    });
    return { changes, userEvent: "input.format" };
  };
}

const URL_LIKE = /^(https?:\/\/|www\.)\S+$/i;

/**
 * Wraps the selection as a link and selects the part still to type: the
 * address for selected words, the label for a selected URL.
 */
export const insertLink: Format = (state) =>
  state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (URL_LIKE.test(text)) {
      return {
        changes: { from: range.from, to: range.to, insert: `[](${text})` },
        range: EditorSelection.cursor(range.from + 1),
      };
    }
    const url = "https://";
    const start = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert: `[${text}](${url})` },
      range: EditorSelection.range(start, start + url.length),
    };
  });

/** Inline markers Clear formatting removes. `_` is left: it is too often part of a word. */
const INLINE_MARKS = /<\/?(?:u|sup|sub)>|\*\*|~~|\*|`/g;

/** Strips bold, italic, underline, strike, code and super/subscript from the selection. */
export const clearFormatting: Format = (state) => {
  if (state.selection.ranges.every((range) => range.empty)) return null;
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to).replace(INLINE_MARKS, "");
    return {
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.range(range.from, range.from + text.length),
    };
  });
};

/** A `Format` as a CodeMirror command. */
export function run(format: Format): Command {
  return (view) => {
    if (view.state.readOnly) return false;
    const spec = format(view.state);
    if (!spec) return false;
    view.dispatch(view.state.update(spec, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** One named format, shared by the keymap and the right-click menu so both say the same key. */
export interface FormatAction {
  id: string;
  label: string;
  /** CodeMirror key name. */
  key?: string;
  /** The key as printed in a menu. */
  accelerator?: string;
  format: Format;
}

export const INLINE_ACTIONS: readonly FormatAction[] = [
  { id: "bold", label: "Bold", key: "Mod-b", accelerator: "Ctrl+B", format: toggleWrap(BOLD) },
  { id: "italic", label: "Italic", key: "Mod-i", accelerator: "Ctrl+I", format: toggleWrap(ITALIC) },
  { id: "underline", label: "Underline", key: "Mod-u", accelerator: "Ctrl+U", format: toggleWrap(UNDERLINE) },
  {
    id: "strike",
    label: "Strikethrough",
    key: "Alt-Shift-5",
    accelerator: "Alt+Shift+5",
    format: toggleWrap(STRIKE),
  },
  { id: "code", label: "Inline code", key: "Mod-Shift-`", accelerator: "Ctrl+Shift+`", format: toggleWrap(CODE) },
  { id: "sup", label: "Superscript", key: "Mod-.", accelerator: "Ctrl+.", format: toggleWrap(SUPERSCRIPT) },
  { id: "sub", label: "Subscript", key: "Mod-,", accelerator: "Ctrl+,", format: toggleWrap(SUBSCRIPT) },
  { id: "link", label: "Insert link", key: "Mod-k", accelerator: "Ctrl+K", format: insertLink },
  { id: "clear", label: "Clear formatting", key: "Mod-\\", accelerator: "Ctrl+\\", format: clearFormatting },
];

export const HEADING_ACTIONS: readonly FormatAction[] = [
  { id: "normal", label: "Normal text", key: "Mod-Alt-0", accelerator: "Ctrl+Alt+0", format: setHeading(0) },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({
    id: `h${level}`,
    label: `Heading ${level}`,
    key: `Mod-Alt-${level}`,
    accelerator: `Ctrl+Alt+${level}`,
    format: setHeading(level),
  })),
];

export const LIST_ACTIONS: readonly FormatAction[] = [
  {
    id: "ordered",
    label: "Numbered list",
    key: "Mod-Shift-7",
    accelerator: "Ctrl+Shift+7",
    format: toggleList("ordered"),
  },
  { id: "bullet", label: "Bulleted list", key: "Mod-Shift-8", accelerator: "Ctrl+Shift+8", format: toggleList("bullet") },
  { id: "task", label: "Checklist", key: "Mod-Shift-9", accelerator: "Ctrl+Shift+9", format: toggleList("task") },
  { id: "quote", label: "Quote", format: toggleList("quote") },
];

/** Google Docs' formatting keys. Goes ahead of the default keymap, so `Mod-i` and `Mod-u` are ours. */
export const markdownFormatKeymap: readonly KeyBinding[] = [...INLINE_ACTIONS, ...HEADING_ACTIONS, ...LIST_ACTIONS]
  .filter((action): action is FormatAction & { key: string } => Boolean(action.key))
  .map((action) => ({ key: action.key, run: run(action.format) }));

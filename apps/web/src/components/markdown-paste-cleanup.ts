"use client";

import { EditorSelection, type ChangeSpec, type StateCommand } from "@codemirror/state";
import { EditorView, type Command, type KeyBinding } from "@codemirror/view";
import {
  applyCommaPlacement,
  cleanPastedText,
  cleanPdfText,
  cleanWrappedText,
  pasteLandsInVerbatimContext,
  type CommaPlacement,
  type PasteSettings,
  type PdfTextOptions,
} from "@weaveforge/core";

/**
 * Paste cleanup for the note editor.
 *
 * All the judgement lives in `@weaveforge/core/paste`, which is pure text in
 * and text out. This file is only the wiring: it decides *whether* a given
 * paste is eligible, and turns a cleaned string into a single CodeMirror
 * transaction.
 *
 * One transaction, not several, because that is what makes an automatic
 * rewrite acceptable: one Ctrl+Z takes the whole paste back out, rather than
 * peeling off a rule at a time and leaving the writer somewhere in between.
 * Getting the untouched clipboard in is a separate, deliberate act —
 * Ctrl+Shift+V.
 */

/**
 * Pastes larger than this are inserted as they came.
 *
 * The rules scan the text several times and the reader is watching the caret,
 * so there is a size past which a correct answer arrives too late to be the
 * right one. Half a megabyte is far beyond any quotation and well inside a
 * frame at the sizes measured here.
 */
const MAX_CLEANED_PASTE = 500_000;

/** Replaces the current selection with `text` as one undoable step. */
function insertAsOneStep(view: EditorView, text: string): void {
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + text.length),
    })),
    { userEvent: "input.paste" },
  );
}

/** One http(s) address and nothing else. */
const BARE_URL = /^https?:\/\/\S+$/;

/**
 * Makes a string safe to sit inside a link label. Single-line only; a label
 * spanning lines is not a label, and such a selection is pasted over normally.
 */
function linkLabel(selected: string): string | null {
  if (!selected || /[\r\n]/.test(selected)) return null;
  return selected.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/**
 * Pasting a URL over selected text makes a link of it.
 *
 * CodeMirror's markdown package offers this, and it is why this handler is
 * registered in front of it rather than behind: theirs reads the raw clipboard,
 * so a link built by it kept the campaign tag the cleanup had just been asked
 * to remove. Selecting a paper title and pasting the tracked link you copied
 * from a newsletter is the exact case, and it produced a tracked citation.
 *
 * Each selection range gets its own label, so a multiple selection links every
 * piece rather than the first one.
 */
function insertAsLink(view: EditorView, url: string): boolean {
  // Keyed by start offset because `changeByRange` hands back a range and not
  // its index, and selection ranges are disjoint so a start is unique.
  const labels = new Map<number, string>();
  for (const range of view.state.selection.ranges) {
    if (range.empty) continue;
    const label = linkLabel(view.state.sliceDoc(range.from, range.to));
    if (label !== null) labels.set(range.from, label);
  }
  if (labels.size === 0) return false;

  view.dispatch(
    view.state.changeByRange((range) => {
      const label = labels.get(range.from);
      const insert = label === undefined ? url : `[${label}](${url})`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      };
    }),
    { userEvent: "input.paste" },
  );
  return true;
}

/**
 * The paste handler.
 *
 * Returns false — letting CodeMirror do its own thing — whenever the paste is
 * not eligible: no plain text on the clipboard (a bitmap is not this file's
 * business), the rules are off, the text is enormous, or the caret sits inside
 * a code block or frontmatter, where the pasted text is being *shown* rather
 * than written.
 */
function handlePaste(view: EditorView, event: ClipboardEvent, settings: () => PasteSettings): boolean {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;

  const raw = clipboard.getData("text/plain");
  if (!raw || raw.length > MAX_CLEANED_PASTE) return false;

  const current = settings();
  if (!current.cleanOnPaste) return false;

  const document = view.state.doc.toString();
  if (pasteLandsInVerbatimContext(document, view.state.selection.main.from)) return false;

  const result = cleanPastedText(raw, current);

  // A cleaned URL dropped onto selected text becomes a link around it. Done
  // here rather than left to the markdown package, which would wrap the
  // clipboard's own spelling and put the tracker back.
  if (BARE_URL.test(result.text)) {
    if (insertAsLink(view, result.text)) {
      event.preventDefault();
      return true;
    }
  }

  if (!result.changed) return false;

  event.preventDefault();
  insertAsOneStep(view, result.text);
  return true;
}

/**
 * Runs `transform` over the selection, or over the whole document when there is
 * none — "clean this up" with nothing selected means the note, not nothing.
 */
function transformSelection(transform: (text: string) => string): StateCommand {
  return ({ state, dispatch }) => {
    const ranges = state.selection.ranges.filter((range) => !range.empty);
    if (ranges.length === 0) {
      const whole = state.doc.toString();
      const next = transform(whole);
      if (next === whole) return false;
      dispatch(
        state.update({
          changes: { from: 0, to: whole.length, insert: next },
          selection: EditorSelection.cursor(Math.min(state.selection.main.head, next.length)),
          userEvent: "input.cleanup",
        }),
      );
      return true;
    }

    const changes: ChangeSpec[] = [];
    for (const range of ranges) {
      const text = state.sliceDoc(range.from, range.to);
      const next = transform(text);
      if (next !== text) changes.push({ from: range.from, to: range.to, insert: next });
    }
    if (changes.length === 0) return false;
    dispatch(state.update({ changes, userEvent: "input.cleanup" }));
    return true;
  };
}

/** Runs the automatic rules over the selection on demand. */
export function cleanSelection(settings: () => PasteSettings): StateCommand {
  return transformSelection((text) => cleanPastedText(text, { ...settings(), cleanOnPaste: true }).text);
}

/**
 * Rejoins terminal output. On demand, never automatic: only the writer knows
 * that the short lines in front of them came from a terminal window rather
 * than from a person who meant them.
 */
export const cleanTerminalSelection: StateCommand = transformSelection(
  (text) =>
    cleanWrappedText(text, {
      rejoin: "any",
      bullets: "markdown",
      // `$$` in terminal output is the shell's process id, not maths.
      protectMath: false,
    }).text,
);

/** Repairs text copied out of a PDF. */
export function cleanPdfSelection(options: PdfTextOptions): StateCommand {
  return transformSelection((text) => cleanPdfText(text, options).text);
}

/** Moves commas to the chosen side of a closing quote. */
export function moveCommas(placement: CommaPlacement): StateCommand {
  return transformSelection((text) => applyCommaPlacement(text, placement).text);
}

/** Pastes the clipboard with no rules applied at all. */
export const pasteWithoutCleanup: Command = (view) => {
  void navigator.clipboard
    ?.readText()
    .then((text) => {
      if (text) insertAsOneStep(view, text);
    })
    .catch(() => {
      // No clipboard permission. The browser's own paste still works, and this
      // command simply does nothing rather than reporting a failure the reader
      // cannot act on.
    });
  return true;
};

export interface PasteCleanupOptions {
  /**
   * Read through a callback rather than captured, so a settings change reaches
   * editors that are already open without rebuilding them.
   */
  settings: () => PasteSettings;
}

/** Keys for the on-demand cleanups. */
export function pasteCleanupKeymap(options: PasteCleanupOptions): KeyBinding[] {
  return [
    { key: "Mod-Shift-v", run: pasteWithoutCleanup, preventDefault: true },
    { key: "Mod-Alt-c", run: cleanSelection(options.settings), preventDefault: true },
    { key: "Mod-Alt-t", run: cleanTerminalSelection, preventDefault: true },
    {
      key: "Mod-Alt-p",
      run: cleanPdfSelection({ removePageNumbers: false, singleParagraph: false }),
      preventDefault: true,
    },
  ];
}

/** The paste interception itself. */
export function pasteCleanup(options: PasteCleanupOptions) {
  return EditorView.domEventHandlers({
    paste: (event, view) => handlePaste(view, event, options.settings),
  });
}

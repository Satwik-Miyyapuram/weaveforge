/**
 * CodeMirror glue for the markdown formatting actions. The action list, its keys and the
 * edits all come from Rust (`wf_core::markdown_format`); this file dispatches what Rust returns.
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { readyCore } from "@/lib/rust-core";

/** One formatting action as Rust lists it: its id, its label and its keys. */
export interface FormatAction {
  id: string;
  label: string;
  /** CodeMirror key name. */
  key?: string | null;
  /** The key as printed in a menu. */
  accelerator?: string | null;
}

/** Every formatting action, in keymap order. */
export function markdownFormatActions(): readonly FormatAction[] {
  return readyCore().markdownFormatActions();
}

/** Applies action `id` to the editor. False when it does nothing here (read-only, or no match). */
export function applyMarkdownAction(view: EditorView, id: string): boolean {
  if (view.state.readOnly) return false;
  const { selection } = view.state;
  const outcome = readyCore().markdownFormatAction(
    id,
    view.state.doc.toString(),
    selection.ranges.map((range) => ({ from: range.from, to: range.to })),
    selection.main.head,
  );
  if (!outcome) return false;
  view.dispatch({
    changes: outcome.changes,
    selection: EditorSelection.create(
      outcome.ranges.map((range) => EditorSelection.range(range.from, range.to)),
      outcome.main,
    ),
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
}

/** The actions whose id is in `ids`, in Rust's order. */
export function actionsIn(ids: readonly string[]): readonly FormatAction[] {
  return markdownFormatActions().filter((action) => ids.includes(action.id));
}

/** Google Docs' formatting keys, from the Rust action list. Built per call so it reads the loaded core. */
export function markdownFormatKeymap(): readonly KeyBinding[] {
  return markdownFormatActions()
    .filter((action): action is FormatAction & { key: string } => Boolean(action.key))
    .map((action) => ({ key: action.key, run: (view: EditorView) => applyMarkdownAction(view, action.id) }));
}

import { EditorView, ViewPlugin } from "@codemirror/view";

import { readStored, writeStored } from "@/lib/safe-storage";

/** Per device, like the theme: on unless turned off in the editor menu. */
const STORAGE_KEY = "weaveforge.spellcheck";

let on = readStored(STORAGE_KEY) !== "off";
const views = new Set<EditorView>();

export function spellcheckOn(): boolean {
  return on;
}

/** Saves the setting and applies it to every open note editor. */
export function setSpellcheck(next: boolean): void {
  on = next;
  writeStored(STORAGE_KEY, next ? "on" : "off");
  // An empty update makes each view re-read its content attributes.
  for (const view of views) view.dispatch({});
}

export function spellcheckAttrs(): { spellcheck: "true" | "false" } {
  return { spellcheck: on ? "true" : "false" };
}

/**
 * The browser's own spell check on the note text. CodeMirror turns it off by
 * default; this facet value wins over that default.
 */
export const spellcheck = [
  EditorView.contentAttributes.of(spellcheckAttrs),
  ViewPlugin.define((view) => {
    views.add(view);
    return { destroy: () => views.delete(view) };
  }),
];

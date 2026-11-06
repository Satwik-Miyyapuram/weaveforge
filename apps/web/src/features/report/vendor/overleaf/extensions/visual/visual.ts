import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { atomicDecorations } from "./atomic-decorations";
import { listItemMarker } from "./list-item-marker";
import { markDecorations } from "./mark-decorations";
import { mousedown, mouseDownEffect } from "./selection";
import { visualKeymap } from "./visual-keymap";
import { visualHighlightStyle, visualTheme } from "./visual-theme";

/**
 * Overleaf's Visual Editor for LaTeX, cut down from its `visual.ts`: the
 * decorations, theme and keymap, without the command tooltip, HTML paste,
 * table generator or module hooks. The host turns it on and off through a
 * compartment instead of Overleaf's `toggleVisualEffect`.
 */

/** Scrolls a mouse selection into view, as showing or hiding decorations can move it. */
const scrollJumpAdjuster = EditorState.transactionExtender.of((tr) => {
  if (!tr.scrollIntoView) {
    for (const effect of tr.effects) {
      if (effect.is(mouseDownEffect) && effect.value === false) {
        return { effects: EditorView.scrollIntoView(tr.newSelection.main.head) };
      }
    }
  }
  return {};
});

export const latexVisual: Extension = [
  visualTheme,
  visualHighlightStyle,
  mousedown,
  scrollJumpAdjuster,
  EditorView.editorAttributes.of({ class: "ol-cm-parsed" }),
  EditorView.contentAttributes.of({ "aria-label": "Visual Editor editing" }),
  listItemMarker,
  atomicDecorations,
  markDecorations, // after atomicDecorations, so marks wrap inline widgets
  visualKeymap,
];

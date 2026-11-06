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

/**
 * English for the phrase keys the vendored widgets ask for. Overleaf reads
 * these from its locale files; we have none, so the text sits here.
 */
const visualPhrases = EditorState.phrases.of({
  show_document_preamble: "Show document preamble",
  hide_document_preamble: "Hide document preamble",
  end_of_document: "End of document",
  expand: "Expand",
  learn_more: "Learn more",
  the_visual_editor_cant_preview_this_type_of_image_file:
    "The Visual Editor can't preview this type of image file",
  click_recompile_and_check_your_pdf_to_see_how_its_looking:
    "Click Recompile and check your PDF to see how it's looking",
});

/** Bootstrap's screen-reader-only class, which the preamble widget's label uses. */
const visuallyHidden = EditorView.baseTheme({
  ".visually-hidden": {
    position: "absolute !important",
    width: "1px !important",
    height: "1px !important",
    padding: "0 !important",
    margin: "-1px !important",
    overflow: "hidden !important",
    clip: "rect(0, 0, 0, 0) !important",
    whiteSpace: "nowrap !important",
    border: "0 !important",
  },
});

export const latexVisual: Extension = [
  visualPhrases,
  visuallyHidden,
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

"use client";

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { acceptImageFiles, type ImagePasteConfig } from "./markdown-image-paste";
import type { EditorHandle, EditorHandleRef } from "./editor-handle";

/**
 * Fills in a screen's handle for as long as the view is alive.
 *
 * Returns the undo: the handle is cleared when the editor goes away, so a
 * button pressed after the note was closed does nothing rather than dispatching
 * into a destroyed view.
 *
 * The image config is read through a getter because the screens rebuild theirs
 * whenever the note changes, while the editor — and therefore this handle — is
 * built once.
 */
export function bindEditorHandle(
  ref: EditorHandleRef | undefined,
  view: EditorView,
  images: () => ImagePasteConfig | undefined,
): () => void {
  if (!ref) return () => {};

  const handle: EditorHandle = {
    insert(markdown) {
      const range = view.state.selection.main;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: markdown },
        selection: EditorSelection.cursor(range.from + markdown.length),
        userEvent: "input.paste",
      });
      view.focus();
    },
    insertFiles(files) {
      const config = images();
      if (!config || files.length === 0) return;
      // Focus first: the caret is where the writer left it, and the file dialog
      // took focus away to get here.
      view.focus();
      acceptImageFiles(view, files, config);
    },
    focus: () => view.focus(),
  };

  ref.current = handle;
  return () => {
    // Only if it is still ours: two editors can overlap for a render while one
    // is being swapped for the other, and the newer one wins.
    if (ref.current === handle) ref.current = null;
  };
}

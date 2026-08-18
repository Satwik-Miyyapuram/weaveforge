"use client";

/**
 * A way for a screen to put something into the editor it is showing.
 *
 * Everything else about the editing surface is declarative — the screen holds
 * the text, the editor reports changes — and that is right for text. It is
 * wrong for a toolbar button, because "insert this here" is about the caret,
 * and the caret is the editor's state, not the screen's. The attach-image
 * button appended to the end of the note for exactly that reason: the screen
 * only had the string.
 *
 * Deliberately free of CodeMirror types. A screen importing `EditorView` to
 * hold a reference would pull the whole editor into that route's first-load
 * bundle, which is the thing `CollabBodyHost` exists to avoid — so this file
 * has no imports at all, and the binding lives in `markdown-editor-handle`,
 * next to the editor.
 */
export interface EditorHandle {
  /** Puts `markdown` where the caret is, as one undoable step, and focuses. */
  insert(markdown: string): void;
  /**
   * Stores `files` and puts their markdown where the caret is.
   *
   * The same path a paste takes, placeholders and all, so a picture chosen from
   * the file dialog behaves like one off the clipboard. Does nothing on a
   * surface with nowhere to store images.
   */
  insertFiles(files: readonly File[]): void;
  focus(): void;
}

/**
 * Where a screen keeps the handle. A plain box rather than React's `RefObject`
 * so the type says only what it is: null until the editor is on screen, null
 * again once it is gone.
 */
export interface EditorHandleRef {
  current: EditorHandle | null;
}

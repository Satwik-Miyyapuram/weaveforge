/**
 * Map keyboard events to reader viewport commands.
 * The mapping lives in the Rust core (`reader::annotation`); this file keeps
 * the types and the signatures callers reach through `typedCore()`.
 */

export type ReaderKeyboardCommand =
  | { type: "page_delta"; delta: number }
  | { type: "page_home" }
  | { type: "page_end" }
  | { type: "zoom_in" }
  | { type: "zoom_out" }
  | { type: "fit_width" }
  | { type: "rotate" };

export interface ReaderKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is an editable field. */
  fromEditable?: boolean;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ReaderKeyboardFns {
  /**
   * Whether an event target owns its keystrokes: INPUT, TEXTAREA, SELECT or
   * OPTION in any case, or anything contenteditable.
   */
  isEditableReaderTarget(
    target: { tagName?: string; isContentEditable?: boolean } | null | undefined,
  ): boolean;
  /**
   * Return a command for navigable keys, or null when the event should pass through.
   * Ignores events from editable fields so page-jump inputs keep working.
   */
  readerKeyboardCommand(event: ReaderKeyEvent): ReaderKeyboardCommand | null;
}

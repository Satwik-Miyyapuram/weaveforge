/**
 * Reader annotation type guards and keyboard command mapping (step 5-2e),
 * re-exported from index.ts. The command type comes from ./bindings.ts; the
 * guards take any string and narrow it to the TS annotation unions inline.
 */
import {
  isReaderAnnotationType as rawIsReaderAnnotationType,
  isAnnotationSyncState as rawIsAnnotationSyncState,
  isEditableReaderTarget as rawIsEditableReaderTarget,
  readerKeyboardCommand as rawReaderKeyboardCommand,
} from "../pkg/wf_wasm.js";
import type { ReaderKeyboardCommand } from "./bindings.js";

/** Whether `value` is Zotero's six annotation types, no strikeout (Rust `is_reader_annotation_type`). */
export function isReaderAnnotationType(
  value: string,
): value is "highlight" | "underline" | "note" | "image" | "ink" | "text" {
  return rawIsReaderAnnotationType(value);
}

/** Whether `value` is an R5 write-back sync state (Rust `is_annotation_sync_state`). */
export function isAnnotationSyncState(value: string): value is "local" | "synced" | "pending" | "conflict" {
  return rawIsAnnotationSyncState(value);
}

/**
 * Whether an event target owns its keystrokes: a text field, a select or its
 * option, or anything contenteditable (Rust `is_editable_reader_target`).
 */
export function isEditableReaderTarget(
  target: EventTarget | { tagName?: unknown; isContentEditable?: unknown } | null | undefined,
): boolean {
  if (!target) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === "string" ? el.tagName : undefined;
  return rawIsEditableReaderTarget(tag, Boolean(el.isContentEditable));
}

/**
 * Return a command for navigable keys, or null when the event should pass through
 * (Rust `reader_keyboard_command`). Editable and Alt events always pass through.
 */
export function readerKeyboardCommand(event: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is an editable field. */
  fromEditable?: boolean;
}): ReaderKeyboardCommand | null {
  return rawReaderKeyboardCommand({
    key: event.key,
    code: event.code,
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    altKey: Boolean(event.altKey),
    fromEditable: Boolean(event.fromEditable),
  }) as ReaderKeyboardCommand | null;
}

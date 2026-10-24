import { isEditableReaderTarget } from "@weaveforge/core";

/**
 * Whether an event's target owns its keystrokes and clipboard: a text field,
 * a select or its option, or anything contenteditable. Keyboard shortcuts and
 * paste handlers step aside for it. A window, a document or a button does not.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return isEditableReaderTarget(target as { tagName?: string; isContentEditable?: boolean } | null);
}

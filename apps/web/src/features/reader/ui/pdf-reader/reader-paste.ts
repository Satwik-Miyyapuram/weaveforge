import { imageFileFromClipboard } from "@/features/ink/application/parts-2";

/** What the reader knows about a paste before it takes it. */
export interface ReaderPasteGate {
  /** The paper may be drawn on. */
  canCreate: boolean;
  /** Focus sits in the reader or its chrome. */
  ownsFocus: boolean;
  /** The paste is aimed at a text field. */
  editableTarget: boolean;
}

/**
 * The image a Ctrl+V in the reader lays on the page, or null when the paste
 * belongs elsewhere: already handled, aimed at a text field, the reader not
 * focused, a read-only paper, or no image on the clipboard.
 */
export function readerPasteImage(
  event: { defaultPrevented: boolean; clipboardData: Parameters<typeof imageFileFromClipboard>[0] },
  gate: ReaderPasteGate,
): File | null {
  if (event.defaultPrevented || !gate.canCreate || gate.editableTarget || !gate.ownsFocus) return null;
  return imageFileFromClipboard(event.clipboardData);
}

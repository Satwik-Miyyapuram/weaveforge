import type { ReaderAnnotation } from "@weaveforge/core";

import { picturePath } from "./reader-picture";

/** What the popover on a tapped mark offers; null when it shows none. */
export interface MarkActions {
  /** The label over the popover: what the mark is. */
  kind: string;
  colour: boolean;
  /** The comment button's label, or null when the mark takes no comment. */
  comment: "Comment" | "Edit comment" | null;
  /** The composer's starting text: the comment already there. */
  prefill: string;
}

const KIND = { highlight: "Highlight", underline: "Underline", note: "Comment", image: "Clip", text: "Text box" } as const;

/**
 * Highlights, underlines, comments and clips take colour, comment and delete;
 * a text box takes delete only (its words are edited in place). Ink has the
 * lasso, a placed picture its own editor, and Zotero's marks are read-only.
 */
export function markActions(
  ann: Pick<ReaderAnnotation, "type" | "origin" | "comment">,
): MarkActions | null {
  if (ann.origin !== "local") return null;
  if (ann.type === "text") return { kind: KIND.text, colour: false, comment: null, prefill: "" };
  if (ann.type === "ink" || picturePath(ann)) return null;
  const prefill = ann.comment.trim() ? ann.comment : "";
  return { kind: KIND[ann.type], colour: true, comment: prefill ? "Edit comment" : "Comment", prefill };
}

/** A text box's popover shows under Select or Text; other marks under any tool. */
export function markPopoverShown(ann: Pick<ReaderAnnotation, "type">, tool: string): boolean {
  return ann.type !== "text" || tool === "select" || tool === "text";
}

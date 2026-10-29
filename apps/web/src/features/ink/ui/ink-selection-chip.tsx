"use client";

/**
 * What the lasso caught can be copied or deleted from a small menu at the
 * selection itself, the same on a note and on a paper, so the toolbar keeps
 * one shape whether anything is selected or not. The host places it (`left`,
 * `top`, in CSS px of the sheet) at the selection's top-right corner.
 */
import type { CSSProperties } from "react";
import { Button } from "@/components/button";

export interface InkSelectionChipProps {
  count: number;
  /** Copy the strokes, to paste into any note (Ctrl+C). */
  onCopy?: () => void;
  /** Copy the strokes' recognised text (the note's). */
  onCopyAsText?: () => void;
  onDelete?: () => void;
  style?: CSSProperties;
}

export function InkSelectionChip({ count, onCopy, onCopyAsText, onDelete, style }: InkSelectionChipProps) {
  if (count <= 0 || !(onCopy || onCopyAsText || onDelete)) return null;
  const strokes = `${count} stroke${count === 1 ? "" : "s"}`;
  return (
    <div
      className="ink-selection-chip"
      role="toolbar"
      aria-label="Selection"
      style={style}
      // A press here is on the menu, not the page: no lasso, no drag.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {onCopy ? (
        <Button variant="ghost" size="sm" onClick={onCopy} title="Copy the selected strokes to paste into any note (Ctrl+C)">
          Copy
        </Button>
      ) : null}
      {onCopyAsText ? (
        <Button variant="ghost" size="sm" onClick={onCopyAsText} title="Copy the selected strokes' recognised text">
          Copy as text
        </Button>
      ) : null}
      {onDelete ? (
        <Button variant="ghost" size="sm" onClick={onDelete} title={`Delete the ${strokes} (Delete)`}>
          Delete {strokes}
        </Button>
      ) : null}
    </div>
  );
}

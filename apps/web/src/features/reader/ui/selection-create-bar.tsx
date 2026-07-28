"use client";

import type { ReaderAnnotationType } from "@thesis/core";
import { READER_ANNOTATION_COLORS } from "../application/reader-annotation-helpers";

export interface PendingSelectionCreate {
  pageNumber: number;
  quote: string;
}

interface SelectionCreateBarProps {
  pending: PendingSelectionCreate;
  busy?: boolean;
  onCreate: (type: Extract<ReaderAnnotationType, "highlight" | "underline" | "note">, color: string) => void;
  onCancel: () => void;
}

export function SelectionCreateBar({ pending, busy, onCreate, onCancel }: SelectionCreateBarProps) {
  return (
    <div className="pdf-reader-create-bar" role="toolbar" aria-label="Create annotation">
      <span className="pdf-reader-create-quote muted" title={pending.quote}>
        {pending.quote.slice(0, 80)}
        {pending.quote.length > 80 ? "…" : ""}
      </span>
      <div className="pdf-reader-create-colors" role="group" aria-label="Colour">
        {READER_ANNOTATION_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="pdf-reader-create-swatch"
            style={{ background: color }}
            aria-label={`Highlight ${color}`}
            disabled={busy}
            onClick={() => onCreate("highlight", color)}
          />
        ))}
      </div>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={() => onCreate("underline", READER_ANNOTATION_COLORS[0])}
      >
        Underline
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={() => onCreate("note", READER_ANNOTATION_COLORS[3])}
      >
        Note
      </button>
      <button type="button" className="link-btn" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

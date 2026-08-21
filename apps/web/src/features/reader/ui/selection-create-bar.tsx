"use client";

import type { ReaderAnnotationType } from "@weaveforge/core";
import { READER_ANNOTATION_COLORS } from "../application/reader-annotation-helpers";

interface PendingSelectionCreate {
  pageNumber: number;
  quote: string;
}

interface SelectionCreateBarProps {
  pending: PendingSelectionCreate;
  busy?: boolean;
  /** Active colour from the toolbar picker. */
  color?: string;
  onCreate: (type: Extract<ReaderAnnotationType, "highlight" | "underline" | "note">, color: string) => void;
  onCancel: () => void;
}

export function SelectionCreateBar({
  pending,
  busy,
  color = READER_ANNOTATION_COLORS[0],
  onCreate,
  onCancel,
}: SelectionCreateBarProps) {
  return (
    <div className="pdf-reader-create-bar" role="toolbar" aria-label="Create annotation">
      <span className="pdf-reader-create-quote muted" title={pending.quote}>
        {pending.quote.slice(0, 80)}
        {pending.quote.length > 80 ? "…" : ""}
      </span>
      <div className="pdf-reader-create-colors" role="group" aria-label="Colour">
        {READER_ANNOTATION_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`pdf-reader-create-swatch${swatch === color ? " is-active" : ""}`}
            style={{ background: swatch }}
            aria-label={`Highlight ${swatch}`}
            aria-pressed={swatch === color}
            disabled={busy}
            onClick={() => onCreate("highlight", swatch)}
          />
        ))}
      </div>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={() => onCreate("underline", color)}
      >
        Underline
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={() => onCreate("note", color)}
      >
        Note
      </button>
      <button type="button" className="link-btn" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

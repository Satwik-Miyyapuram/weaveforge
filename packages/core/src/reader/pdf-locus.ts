/**
 * W3C Web Annotation selectors used as durable PDF text anchors.
 * Pure types — no I/O. See docs/plans/completed/pdf-viewer-plan.md §5.1.
 */

/** Primary anchor: quote + optional context snippets (W3C TextQuoteSelector). */
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Fallback anchor: character offsets into extracted page/document text
 * (W3C TextPositionSelector). Brittle across re-extraction; keep as hint.
 */
export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

/**
 * A stored locus for jump-to-source. Rects (when present elsewhere) are
 * rendering hints only — never the authoritative anchor.
 */
export interface PdfLocus {
  quote: TextQuoteSelector;
  position?: TextPositionSelector;
}

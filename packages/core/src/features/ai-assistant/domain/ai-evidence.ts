import type { PdfLocus } from "../../../reader/pdf-locus.js";
import { resolveTextAnchor, type AnchorConfidence } from "../../../reader/anchor-resolution.js";

/**
 * Claim-level provenance attached to an AI proposal. Optional on the proposal
 * so existing drafts remain valid; the review UI renders it when present.
 * `excerpt` is the surrounding source text; `locus` pinpoints the sentence the
 * proposal actually relied on, for highlight + jump-to-source.
 */
export interface AiEvidence {
  /** Stable id of the workspace source this evidence came from. */
  sourceId: string;
  /** Human label for the source (e.g. paper title). */
  label?: string;
  /** Paper this evidence belongs to, when the source is a paper/annotation. */
  paperId?: string;
  /** Same-origin deep link opening the source at the locus (read-only). */
  href?: string;
  /** Verbatim source text shown to the reviewer as context. */
  excerpt: string;
  /** The exact sentence(s) used, located within `excerpt`. */
  locus?: PdfLocus;
  /** 0-based page hint for the reader. */
  page?: number;
}

/** Excerpt split around the used sentence, for a highlight + dimmed context. */
export interface ExcerptHighlight {
  before: string;
  match: string;
  after: string;
  /** `low` when only a position fallback or an ambiguous quote resolved it. */
  confidence: AnchorConfidence;
}

/**
 * Locate the used sentence inside an excerpt for the provenance highlight.
 * Returns null when there is no excerpt/locus or the quote cannot be found —
 * the caller then shows the plain excerpt rather than guessing a span.
 */
export function highlightWithinExcerpt(
  excerpt: string,
  locus: PdfLocus | undefined,
): ExcerptHighlight | null {
  if (!excerpt || !locus) return null;
  const anchor = resolveTextAnchor(excerpt, locus);
  if (!anchor) return null;
  return {
    before: excerpt.slice(0, anchor.start),
    match: excerpt.slice(anchor.start, anchor.end),
    after: excerpt.slice(anchor.end),
    confidence: anchor.confidence,
  };
}

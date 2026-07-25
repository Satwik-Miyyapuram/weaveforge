import type { PdfLocus, TextPositionSelector, TextQuoteSelector } from "./pdf-locus.js";

/** Character span in extracted document (or page) text. */
export interface TextSpan {
  start: number;
  end: number;
}

export type AnchorConfidence = "high" | "low";

export interface ResolvedAnchor extends TextSpan {
  /** How the span was obtained. */
  via: "quote" | "position";
  /**
   * `high` — quote matched (unique or disambiguated).
   * `low` — position fallback only; surface "source may have changed".
   */
  confidence: AnchorConfidence;
}

/**
 * Find every occurrence of `quote.exact` whose immediate prefix/suffix match.
 * Empty `exact` yields no matches. Absent prefix/suffix impose no constraint.
 */
export function findQuoteMatches(text: string, quote: TextQuoteSelector): TextSpan[] {
  const exact = quote.exact;
  if (!exact) return [];

  const matches: TextSpan[] = [];
  const prefix = quote.prefix ?? "";
  const suffix = quote.suffix ?? "";

  let from = 0;
  while (true) {
    const start = text.indexOf(exact, from);
    if (start < 0) break;
    const end = start + exact.length;
    from = start + 1;
    if (prefix) {
      if (start < prefix.length) continue;
      if (text.slice(start - prefix.length, start) !== prefix) continue;
    }
    if (suffix) {
      if (end + suffix.length > text.length) continue;
      if (text.slice(end, end + suffix.length) !== suffix) continue;
    }
    matches.push({ start, end });
  }
  return matches;
}

/**
 * Among quote matches, pick the span whose `start` is nearest the stored
 * position offset. Ties keep document order (first wins).
 */
export function pickNearestMatch(
  matches: readonly TextSpan[],
  position: TextPositionSelector | undefined,
): TextSpan | undefined {
  if (matches.length === 0) return undefined;
  if (matches.length === 1 || position == null) return matches[0];

  let best = matches[0]!;
  let bestDist = Math.abs(best.start - position.start);
  for (let i = 1; i < matches.length; i++) {
    const m = matches[i]!;
    const dist = Math.abs(m.start - position.start);
    if (dist < bestDist) {
      best = m;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Resolve a TextPositionSelector when it lies within `text` bounds and
 * `start <= end`. Returns null when the span is unusable.
 */
export function resolvePositionSelector(
  text: string,
  position: TextPositionSelector,
): TextSpan | null {
  const { start, end } = position;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    end > text.length
  ) {
    return null;
  }
  return { start, end };
}

/**
 * Resolve a locus against extracted text: quote first (with nearest-position
 * disambiguation), then position fallback. Never throws.
 */
export function resolveTextAnchor(text: string, locus: PdfLocus): ResolvedAnchor | null {
  const matches = findQuoteMatches(text, locus.quote);
  const picked = pickNearestMatch(matches, locus.position);
  if (picked) {
    return { ...picked, via: "quote", confidence: "high" };
  }
  if (locus.position) {
    const span = resolvePositionSelector(text, locus.position);
    if (span) return { ...span, via: "position", confidence: "low" };
  }
  return null;
}

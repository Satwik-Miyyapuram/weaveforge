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

export interface NormaliseWhitespaceOptions {
  /**
   * When true (default), drop leading/trailing whitespace from the result.
   * Prefix/suffix must use `trim: false` so the space abutting `exact` is kept.
   */
  trim?: boolean;
}

/**
 * Soft hyphen (U+00AD) immediately before a linebreak — PDF extractors use
 * this at mid-word line wraps. Treated as whitespace for matching.
 */
function isSoftHyphenAtLineEnd(text: string, index: number): boolean {
  if (text[index] !== "\u00AD") return false;
  const next = text[index + 1];
  return next === "\n" || next === "\r";
}

function isNormalisableWhitespace(text: string, index: number): boolean {
  const ch = text[index];
  if (ch === undefined) return false;
  // \s covers space, tab, newlines, NBSP, and other Unicode Space_Separator.
  if (/\s/u.test(ch)) return true;
  return isSoftHyphenAtLineEnd(text, index);
}

/**
 * Collapse whitespace runs (newlines, tabs, NBSP, soft hyphens at line ends)
 * to a single space. `map[i]` is the original-string index of the i-th
 * normalised character; `map[normalised.length]` is the exclusive end offset
 * in the original for a span covering the whole normalised string.
 */
export function normaliseWhitespace(
  text: string,
  options: NormaliseWhitespaceOptions = {},
): {
  normalised: string;
  map: number[];
} {
  const trim = options.trim !== false;
  const map: number[] = [];
  let normalised = "";
  let i = 0;

  if (trim) {
    while (i < text.length && isNormalisableWhitespace(text, i)) i++;
  }

  // Exclusive end in the original for a span covering all normalised chars —
  // must not include trailing whitespace that trim discards.
  let endInOriginal = i;

  while (i < text.length) {
    if (isNormalisableWhitespace(text, i)) {
      const runStart = i;
      while (i < text.length && isNormalisableWhitespace(text, i)) i++;
      const atEnd = i >= text.length;
      if (atEnd && trim) continue;
      map.push(runStart);
      normalised += " ";
      if (!atEnd) continue;
      // Exclusive end covers the whole trailing whitespace run when trim is off.
      endInOriginal = i;
      break;
    }
    map.push(i);
    normalised += text[i]!;
    i++;
    endInOriginal = i;
  }

  map.push(endInOriginal);
  return { normalised, map };
}

function toOriginalSpan(map: readonly number[], normStart: number, normEnd: number): TextSpan {
  return { start: map[normStart]!, end: map[normEnd]! };
}

/**
 * Find every occurrence of `quote.exact` whose immediate prefix/suffix match.
 * Empty `exact` yields no matches. Absent prefix/suffix impose no constraint.
 * Matching uses whitespace-normalised text; returned spans are original offsets.
 */
export function findQuoteMatches(text: string, quote: TextQuoteSelector): TextSpan[] {
  const exactNorm = normaliseWhitespace(quote.exact).normalised;
  if (!exactNorm) return [];

  const { normalised, map } = normaliseWhitespace(text);
  // Keep spaces that abut `exact` — trimming would drop "The " → "The" and
  // break the immediate-neighbourhood check against the normalised document.
  const prefixNorm =
    quote.prefix != null ? normaliseWhitespace(quote.prefix, { trim: false }).normalised : "";
  const suffixNorm =
    quote.suffix != null ? normaliseWhitespace(quote.suffix, { trim: false }).normalised : "";

  const matches: TextSpan[] = [];
  let from = 0;
  while (true) {
    const start = normalised.indexOf(exactNorm, from);
    if (start < 0) break;
    const end = start + exactNorm.length;
    from = start + 1;
    if (prefixNorm) {
      if (start < prefixNorm.length) continue;
      if (normalised.slice(start - prefixNorm.length, start) !== prefixNorm) continue;
    }
    if (suffixNorm) {
      if (end + suffixNorm.length > normalised.length) continue;
      if (normalised.slice(end, end + suffixNorm.length) !== suffixNorm) continue;
    }
    matches.push(toOriginalSpan(map, start, end));
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
 * Multiple quote hits without a position selector are `low` confidence —
 * the caller should warn rather than treat the first hit as authoritative.
 */
export function resolveTextAnchor(text: string, locus: PdfLocus): ResolvedAnchor | null {
  const matches = findQuoteMatches(text, locus.quote);
  const usablePosition =
    locus.position && resolvePositionSelector(text, locus.position)
      ? locus.position
      : undefined;
  const picked = pickNearestMatch(matches, usablePosition);
  if (picked) {
    const ambiguous = matches.length > 1 && usablePosition == null;
    return {
      ...picked,
      via: "quote",
      confidence: ambiguous ? "low" : "high",
    };
  }
  if (usablePosition) {
    const span = resolvePositionSelector(text, usablePosition);
    if (span) return { ...span, via: "position", confidence: "low" };
  }
  return null;
}

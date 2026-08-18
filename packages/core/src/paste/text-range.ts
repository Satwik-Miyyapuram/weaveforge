/**
 * Spans of text a cleanup rule must not touch.
 *
 * Every rule in this folder is a search-and-replace over a whole document, and
 * every one of them has places where its own character means something else: a
 * hyphen inside `$x - y$` is subtraction, a curly quote inside a `[[note]]`
 * name is part of the name, an invisible character inside a code fence is the
 * bug the reader pasted the block to show. Rules therefore collect ranges
 * first and consult them per match, rather than trying to express "except
 * here" inside the pattern.
 */

export interface TextRange {
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

/**
 * True when `[start, end)` touches any of the ranges.
 *
 * Zero-length probes are supported — a caller testing a single position passes
 * the same offset twice — which is why the comparison is not strict on both
 * sides.
 */
export function overlapsRange(
  ranges: readonly TextRange[],
  start: number,
  end: number,
): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

/** Merges overlapping and touching ranges so callers can scan them in order. */
export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

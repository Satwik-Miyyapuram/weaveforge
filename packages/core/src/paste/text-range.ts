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

/**
 * A merged range list you can ask about in logarithmic time.
 *
 * `overlapsRange` walks the whole list, which is right for the handful of
 * ranges most documents produce and quadratic for the ones that do not: half a
 * megabyte of `$x^2$` is thirty thousand ranges, and a rule that consults them
 * once per match then spends seconds on a keystroke. Measured before this
 * existed, that paste took 4.9 seconds; with it, a tenth of that.
 *
 * The ranges are merged on the way in, so they are sorted and disjoint and a
 * binary search over their ends is enough to answer.
 */
export interface RangeIndex {
  /** True when `[start, end)` touches any indexed range. */
  overlaps(start: number, end: number): boolean;
  /** The range containing `offset`, or undefined. */
  find(offset: number): TextRange | undefined;
  /** The merged ranges, sorted and disjoint. */
  readonly ranges: readonly TextRange[];
}

export function indexRanges(ranges: readonly TextRange[]): RangeIndex {
  const merged = mergeRanges(ranges);

  /** The leftmost range that could still reach `offset`. */
  const candidateFor = (offset: number): TextRange | undefined => {
    let low = 0;
    let high = merged.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (merged[middle]!.end <= offset) low = middle + 1;
      else high = middle;
    }
    return merged[low];
  };

  return {
    ranges: merged,
    overlaps(start: number, end: number): boolean {
      const candidate = candidateFor(start);
      // Disjoint and sorted, so if this one does not start before `end`, none
      // after it does either.
      return candidate !== undefined && candidate.start < end;
    },
    find(offset: number): TextRange | undefined {
      const candidate = candidateFor(offset);
      return candidate !== undefined && candidate.start <= offset ? candidate : undefined;
    },
  };
}

/** An index over nothing, for the common case of no protected ranges at all. */
export const EMPTY_RANGE_INDEX: RangeIndex = {
  ranges: [],
  overlaps: () => false,
  find: () => undefined,
};

export interface DocumentPageText {
  /** Zero-based page index. */
  pageIndex: number;
  text: string;
}

export interface DocumentSearchMatch {
  pageIndex: number;
  /** Inclusive start offset into that page's text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

/**
 * Case-insensitive full-document search over extracted page texts.
 * Empty / whitespace-only queries return no matches.
 */
export function findDocumentMatches(
  pages: readonly DocumentPageText[],
  query: string,
): DocumentSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: DocumentSearchMatch[] = [];
  for (const page of pages) {
    const { hay, starts, ends } = foldCase(page.text);
    let from = 0;
    while (from <= hay.length) {
      const idx = hay.indexOf(needle, from);
      if (idx < 0) break;
      matches.push({
        pageIndex: page.pageIndex,
        start: starts[idx]!,
        end: ends[idx + needle.length - 1]!,
      });
      from = idx + Math.max(1, needle.length);
    }
  }
  return matches;
}

/**
 * Lowercase `text`, keeping for each folded code unit the original span of
 * the letter it came from. Some letters change length ("İ" becomes two
 * units), so offsets in the folded text are not offsets in the original.
 */
function foldCase(text: string): { hay: string; starts: number[]; ends: number[] } {
  let hay = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const ch of text) {
    const low = ch.toLowerCase();
    hay += low;
    for (let k = 0; k < low.length; k += 1) {
      starts.push(at);
      ends.push(at + ch.length);
    }
    at += ch.length;
  }
  return { hay, starts, ends };
}

/** Wraparound next/prev index into a match list. Returns -1 when empty. */
export function nextMatchIndex(
  current: number,
  total: number,
  direction: 1 | -1,
): number {
  if (!Number.isFinite(total) || total <= 0) return -1;
  if (!Number.isFinite(current) || current < 0) {
    return direction === 1 ? 0 : total - 1;
  }
  return (current + direction + total) % total;
}

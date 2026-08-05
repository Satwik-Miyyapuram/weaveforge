/**
 * Highlighted result snippets.
 *
 * Reuses `findDocumentMatches` from the PDF reader by treating a body as a
 * single page — same case-insensitive offset scan, one implementation.
 */

import { findDocumentMatches } from "../reader/document-search.js";

export interface ExcerptRange {
  start: number;
  end: number;
}

export interface SearchExcerpt {
  /** The snippet, with leading/trailing ellipses where it was cut. */
  text: string;
  /** Highlight ranges, as offsets into `text`. */
  highlights: ExcerptRange[];
}

export interface ExcerptOptions {
  /** Target snippet length. */
  maxChars?: number;
  /** Collapse newlines so a snippet stays one line. */
  singleLine?: boolean;
}

/** Merge overlapping/adjacent ranges so highlights never double-wrap. */
function mergeRanges(ranges: ExcerptRange[]): ExcerptRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ExcerptRange[] = [sorted[0]!];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Pick the window containing the most matches. A snippet showing one hit when
 * three sit together a line later is the common failure of naive
 * first-match-wins excerpting.
 */
function bestWindowStart(ranges: ExcerptRange[], span: number, textLength: number): number {
  if (ranges.length === 0) return 0;
  let bestStart = Math.max(0, ranges[0]!.start - Math.floor(span * 0.3));
  let bestCount = 0;
  for (const range of ranges) {
    const start = Math.max(0, range.start - Math.floor(span * 0.3));
    const end = start + span;
    const count = ranges.filter((r) => r.start >= start && r.end <= end).length;
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
  }
  return Math.min(bestStart, Math.max(0, textLength - span));
}

/**
 * Build a snippet around the densest cluster of matches for `terms`.
 * Returns the head of the text when nothing matches, so a result always shows
 * some context rather than an empty line.
 */
export function buildExcerpt(
  body: string,
  terms: readonly string[],
  options: ExcerptOptions = {},
): SearchExcerpt {
  const maxChars = Math.max(40, options.maxChars ?? 240);
  const source = options.singleLine === false ? body : body.replace(/\s+/g, " ");
  const text = source.trim();
  if (!text) return { text: "", highlights: [] };

  const pages = [{ pageIndex: 0, text }];
  const raw: ExcerptRange[] = [];
  for (const term of terms) {
    const needle = term.trim();
    if (needle.length < 2) continue;
    for (const match of findDocumentMatches(pages, needle)) {
      raw.push({ start: match.start, end: match.end });
    }
  }

  const ranges = mergeRanges(raw);

  if (ranges.length === 0) {
    const head = text.slice(0, maxChars);
    return { text: head + (text.length > maxChars ? "…" : ""), highlights: [] };
  }

  const start = bestWindowStart(ranges, maxChars, text.length);
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const slice = text.slice(start, end);

  // Re-base offsets onto the snippet, dropping ranges that fell outside it and
  // clamping one that straddles the edge.
  const highlights = ranges
    .filter((range) => range.end > start && range.start < end)
    .map((range) => ({
      start: Math.max(0, range.start - start) + prefix.length,
      end: Math.min(end, range.end) - start + prefix.length,
    }));

  return { text: `${prefix}${slice}${suffix}`, highlights };
}

/**
 * Split an excerpt into alternating plain/highlighted segments, so a renderer
 * can mark matches without doing offset arithmetic (or setting raw HTML).
 */
export function excerptSegments(
  excerpt: SearchExcerpt,
): { text: string; highlighted: boolean }[] {
  const segments: { text: string; highlighted: boolean }[] = [];
  let cursor = 0;
  for (const range of excerpt.highlights) {
    if (range.start > cursor) {
      segments.push({ text: excerpt.text.slice(cursor, range.start), highlighted: false });
    }
    segments.push({ text: excerpt.text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < excerpt.text.length) {
    segments.push({ text: excerpt.text.slice(cursor), highlighted: false });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

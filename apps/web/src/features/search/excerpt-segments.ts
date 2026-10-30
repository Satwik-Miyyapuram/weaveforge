import type { SearchExcerpt } from "@weaveforge/core";

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

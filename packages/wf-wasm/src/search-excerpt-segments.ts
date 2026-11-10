/**
 * Excerpt splitting (Rust `excerpt_segments`). Alternating plain and highlighted
 * runs let a renderer mark matches without offset arithmetic or raw HTML.
 */
import { excerptSegments as rawExcerptSegments } from "../pkg/wf_wasm.js";

/** Runs covering the excerpt, with empty runs dropped. Highlight offsets are UTF-16 units. */
export function excerptSegments(excerpt: {
  text: string;
  highlights: readonly { start: number; end: number }[];
}): { text: string; highlighted: boolean }[] {
  return rawExcerptSegments({ text: excerpt.text, highlights: excerpt.highlights });
}

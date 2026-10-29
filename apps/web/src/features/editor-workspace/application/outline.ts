/**
 * The Outline section: the headings of the document on screen.
 *
 * Read from the same markdown the Read view renders, so the two agree by
 * construction — there is no second parse and no second source of truth about
 * what a heading is. An ink note, or any document with no headings, returns an
 * empty list and the section says so.
 *
 * Pure: no React, no DOM, and no markdown renderer, because this runs on every
 * keystroke in the editor.
 */

import { headingSlug } from "@/lib/heading-slug";

export interface OutlineHeading {
  level: number;
  text: string;
  /** The anchor `VaultMarkdown` gives the heading, so a click can scroll to it. */
  slug: string;
}

/** The heading slug `markdown.tsx` writes as the element id. */
export { headingSlug };

// The closing `#`s count only after a space: "C#" keeps its `#`.
const ATX = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Headings in document order.
 *
 * Fenced code blocks are skipped: a `# comment` inside a shell snippet is not a
 * heading, and listing it would send the reader to a line that is not one.
 */
export function outlineOf(body: string, maxLevel = 3): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  // The run that opened the current fence; only the same marker, at least as
  // long and alone on its line, closes it.
  let fence: string | null = null;
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const match = ATX.exec(line);
    if (!match) continue;
    const level = match[1]!.length;
    if (level > maxLevel) continue;
    const text = match[2]!.trim();
    // "### #" is an empty heading whose only content is its closing sequence.
    if (!text || /^#+$/.test(text)) continue;
    out.push({ level, text, slug: headingSlug(text) });
  }
  return out;
}

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

export interface OutlineHeading {
  level: number;
  text: string;
  /** The anchor `VaultMarkdown` gives the heading, so a click can scroll to it. */
  slug: string;
}

/** The heading slug `markdown.tsx` writes as the element id. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const ATX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Headings in document order.
 *
 * Fenced code blocks are skipped: a `# comment` inside a shell snippet is not a
 * heading, and listing it would send the reader to a line that is not one.
 */
export function outlineOf(body: string, maxLevel = 3): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  let fenced = false;
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = ATX.exec(line);
    if (!match) continue;
    const level = match[1]!.length;
    if (level > maxLevel) continue;
    const text = match[2]!.replace(/\s+#+$/, "").trim();
    if (!text) continue;
    out.push({ level, text, slug: headingSlug(text) });
  }
  return out;
}

/** Outline rows as workspace tree nodes, so one renderer paints both sections. */
export function outlineRows(body: string): OutlineHeading[] {
  return outlineOf(body);
}

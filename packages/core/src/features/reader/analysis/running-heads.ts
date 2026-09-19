/**
 * Remove repeated headers/footers and page furniture.
 *
 * Journals repeat a running head, the page number and a banner on every page;
 * a section detector that can see them invents sections out of "Smith et al.
 * 12". Two signals: a line that recurs (near-)verbatim on three or more pages
 * is furniture wherever it sits, and inside the outer margin band of a page
 * only what looks like furniture is dropped — bare numbers and lines that
 * recur in the band elsewhere. The band stands in for the page box, which the
 * text layer does not carry.
 */

import { levenshtein } from "../outline-from-text.js";
import { STRUCTURAL_HEADING } from "./reference-section.js";
import type { TextLine } from "./line-reconstruction.js";

/** Fraction of each page's text extent, on every side, treated as margin. */
const MARGIN = 0.06;

function normalise(str: string): string {
  return str.toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#");
}

/**
 * The lines that are page furniture rather than content. Identity is the
 * normalised text with digits masked, matched within a fifth of the shorter
 * line's length, so "Smith et al. 12" and "Smith et al. 13" are the same
 * head. The returned set holds object references from the input.
 */
export function furnitureLines(lines: readonly TextLine[]): Set<TextLine> {
  const furniture = new Set<TextLine>();
  const groups: { key: string; pages: Set<number>; members: TextLine[] }[] = [];
  for (const line of lines) {
    const key = normalise(line.text);
    if (key.length < 4) continue;
    const limit = Math.floor(Math.min(key.length, 80) * 0.2);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = groups.find(
        (g) => Math.abs(g.key.length - key.length) <= limit && levenshtein(g.key, key, limit) <= limit,
      );
    }
    if (!group) {
      group = { key, pages: new Set(), members: [] };
      groups.push(group);
    }
    group.pages.add(line.page);
    group.members.push(line);
  }
  for (const group of groups) {
    if (group.pages.size < 3) continue;
    for (const member of group.members) {
      // A heading is not furniture however many pages it recurs on. This is the
      // other half of the same bug the margin band had: a paper that prints a
      // "References" heading in the appendix as well as the main text repeated
      // it on enough pages for the recurrence rule, and `findReferenceSection`
      // refuses a heading that is furniture.
      if (STRUCTURAL_HEADING.test(member.text)) continue;
      furniture.add(member);
    }
  }

  // Margin bands: within the outer 6% of a page's extent, drop bare page
  // numbers and band lines that recur on another page; keep everything else —
  // the topmost line of a page is always "in the band", titles included.
  const byPage = new Map<number, TextLine[]>();
  for (const line of lines) {
    const list = byPage.get(line.page) ?? [];
    list.push(line);
    byPage.set(line.page, list);
  }
  const inBand = new Set<TextLine>();
  for (const page of byPage.values()) {
    if (page.length < 8) continue;
    const minX = Math.min(...page.map((l) => l.x));
    const maxX = Math.max(...page.map((l) => l.right));
    const minY = Math.min(...page.map((l) => l.y));
    const maxY = Math.max(...page.map((l) => l.y));
    const dx = (maxX - minX) * MARGIN;
    const dy = (maxY - minY) * MARGIN;
    for (const line of page) {
      if (line.x < minX + dx || line.right > maxX - dx || line.y < minY + dy || line.y > maxY - dy) {
        inBand.add(line);
      }
    }
  }
  const bandPages = new Map<string, Set<number>>();
  for (const line of inBand) {
    const key = normalise(line.text);
    const seen = bandPages.get(key) ?? new Set<number>();
    seen.add(line.page);
    bandPages.set(key, seen);
  }
  for (const line of inBand) {
    if (/^[\divxlc]+$/i.test(line.text.trim())) {
      furniture.add(line);
      continue;
    }
    // A band line that recurs is usually a running head — but a *heading* is
    // not furniture, however often it appears and wherever it sits. The
    // bibliography's own heading is the case that matters: it starts at the
    // page's left margin, so it counts as "in the band", and one paper with a
    // reference section in the appendix repeats it, which was enough to delete
    // it. With it went the whole list: `findReferenceSection` refuses a heading
    // that is furniture, so the document looked like it had no bibliography at
    // all. Structural headings are recognised here and never dropped.
    if (STRUCTURAL_HEADING.test(line.text)) continue;
    if ((bandPages.get(normalise(line.text))?.size ?? 0) >= 2) furniture.add(line);
  }
  return furniture;
}

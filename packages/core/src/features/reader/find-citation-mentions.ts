import type { OutlineTextItem } from "./outline-from-text.js";
import type { ParsedReference } from "./parse-reference-list.js";

export interface CitationMention {
  page: number;
  start: number;
  end: number;
  refIndexes: number[];
}

function numericIndexes(value: string, valid: Set<number>): number[] {
  const out = new Set<number>();
  for (const part of value.split(",")) {
    const [first, last = first] = part.split(/[-–]/).map(Number);
    if (!first || !last || last < first || last - first > valid.size) return [];
    for (let n = first; n <= last; n++) {
      if (!valid.has(n)) return [];
      out.add(n);
    }
  }
  return [...out];
}

const surnameKey = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Offsets refer to the supplied text, not a reconstructed or normalized copy. */
export function findCitationMentions(
  page: { number: number; text: string; items: OutlineTextItem[] },
  refs: readonly ParsedReference[],
  bodyFontSize: number,
): CitationMention[] {
  if (!refs.length || page.number >= Math.min(...refs.map((ref) => ref.page))) return [];
  const out: CitationMention[] = [];
  const valid = new Set(refs.map((ref) => ref.index));
  const add = (start: number, end: number, refIndexes: number[]) => {
    if (refIndexes.length && !out.some((mention) => start < mention.end && end > mention.start)) {
      out.push({ page: page.number, start, end, refIndexes: [...new Set(refIndexes)] });
    }
  };
  for (const match of page.text.matchAll(/\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\]/g)) {
    add(match.index!, match.index! + match[0].length, numericIndexes(match[1]!, valid));
  }
  const matchAuthor = (text: string): number[] => {
    const author = /^([\p{Lu}][\p{L}'’\-]+)(?:\s+(?:et\s+al\.|(?:and|&)\s+[\p{Lu}][\p{L}'’\-]+))?,?\s+\(?((?:19|20)\d\d)[a-z]?\)?$/u.exec(text.trim());
    if (!author) return [];
    return refs.filter((ref) => ref.year === Number(author[2]) && ref.authors[0] &&
      surnameKey(ref.authors[0]) === surnameKey(author[1]!)).map((ref) => ref.index);
  };
  for (const match of page.text.matchAll(/\(([^()]+)\)/g)) {
    add(match.index!, match.index! + match[0].length, match[1]!.split(";").flatMap(matchAuthor));
  }
  for (const match of page.text.matchAll(/[\p{Lu}][\p{L}'’\-]+(?:\s+et\s+al\.)?\s+\((?:19|20)\d\d[a-z]?\)/gu)) {
    add(match.index!, match.index! + match[0].length, matchAuthor(match[0]));
  }
  if (refs.some((ref) => ref.label)) {
    let cursor = 0;
    for (const item of page.items) {
      if (!item.str) continue;
      const start = page.text.indexOf(item.str, cursor);
      if (start < 0) continue;
      cursor = start + item.str.length;
      if (item.fontSize > 0 && item.fontSize <= 0.75 * bodyFontSize && /^\d+$/.test(item.str)) {
        add(start, cursor, numericIndexes(item.str, valid));
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

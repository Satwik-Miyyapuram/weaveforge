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

export type CitationStyle = "numeric" | "author-year" | "both";

const NUMERIC_TOKEN = /\[\d+(?:\s*[-–,]\s*\d+)*\]/g;
const AUTHOR_YEAR_TOKEN = /\([\p{Lu}][\p{L}'’\-]+(?:\s+et\s+al\.|\s+(?:and|&)\s+[\p{Lu}][\p{L}'’\-]+)?,?\s+(?:19|20)\d\d[a-z]?(?:;[^()]*)?\)/gu;

/**
 * Which citation convention the body uses, by tallying `[n]` against
 * `(Author year)` over the whole text. A style counts once it has at least two
 * hits and a fifth of all tokens; brackets weigh three times an author-year
 * hit because a `[3]` is rarely anything else while "(Smith 2019)" also
 * appears in prose. Both can coexist — a survey quoting other papers'
 * conventions — in which case both are looked for.
 */
export function detectCitationStyle(texts: readonly string[]): CitationStyle | null {
  let numeric = 0;
  let authorYear = 0;
  for (const text of texts) {
    numeric += 3 * (text.match(NUMERIC_TOKEN)?.length ?? 0);
    authorYear += text.match(AUTHOR_YEAR_TOKEN)?.length ?? 0;
  }
  const threshold = Math.max(2, (numeric + authorYear) / 5);
  const hasNumeric = numeric >= threshold;
  const hasAuthorYear = authorYear >= threshold;
  if (hasNumeric && hasAuthorYear) return "both";
  if (hasNumeric) return "numeric";
  if (hasAuthorYear) return "author-year";
  return null;
}

/** Offsets refer to the supplied text, not a reconstructed or normalized copy. */
export function findCitationMentions(
  page: { number: number; text: string; items: readonly OutlineTextItem[] },
  refs: readonly ParsedReference[],
  bodyFontSize: number,
  style: CitationStyle | null = "both",
): CitationMention[] {
  if (!refs.length || !style || page.number >= Math.min(...refs.map((ref) => ref.page))) return [];
  const numeric = style !== "author-year";
  const authorYear = style !== "numeric";
  const out: CitationMention[] = [];
  const valid = new Set(refs.map((ref) => ref.index));
  const add = (start: number, end: number, refIndexes: number[]) => {
    if (refIndexes.length && !out.some((mention) => start < mention.end && end > mention.start)) {
      out.push({ page: page.number, start, end, refIndexes: [...new Set(refIndexes)] });
    }
  };
  if (numeric) {
    for (const match of page.text.matchAll(/\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\]/g)) {
      add(match.index!, match.index! + match[0].length, numericIndexes(match[1]!, valid));
    }
  }
  const matchAuthor = (text: string): number[] => {
    const author = /^([\p{Lu}][\p{L}'’\-]+)(?:\s+(?:et\s+al\.|(?:and|&)\s+[\p{Lu}][\p{L}'’\-]+))?,?\s+\(?((?:19|20)\d\d)[a-z]?\)?$/u.exec(text.trim());
    if (!author) return [];
    return refs.filter((ref) => ref.year === Number(author[2]) && ref.authors[0] &&
      surnameKey(ref.authors[0]) === surnameKey(author[1]!)).map((ref) => ref.index);
  };
  if (authorYear) {
    for (const match of page.text.matchAll(/\(([^()]+)\)/g)) {
      add(match.index!, match.index! + match[0].length, match[1]!.split(";").flatMap(matchAuthor));
    }
    for (const match of page.text.matchAll(/[\p{Lu}][\p{L}'’\-]+(?:\s+et\s+al\.)?\s+\((?:19|20)\d\d[a-z]?\)/gu)) {
      add(match.index!, match.index! + match[0].length, matchAuthor(match[0]));
    }
  }
  // Superscript numbers only where the page cites no other way: a paper that
  // writes `[13]` does not also cite by superscript, and reading every small
  // digit on such a page as a citation turned the `1` of `h_{t-1}` and the
  // exponents in a FLOPs table into forty phantom links.
  if (numeric && !out.length && refs.some((ref) => ref.label)) {
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

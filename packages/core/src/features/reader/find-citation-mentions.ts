import type { OutlineTextItem } from "./outline-from-text.js";
import type { ParsedReference } from "./parse-reference-list.js";

export interface CitationMention {
  page: number;
  start: number;
  end: number;
  refIndexes: number[];
}

/**
 * `12`, `3-5`, `1, 4, 7–9`: the numbers inside a bracket, expanded and checked
 * against the list. A range longer than the list, a zero, or a number the
 * list has no entry for means the bracket is not a citation — `[0, 1]` is a
 * unit interval and `[10 mm]` a measurement.
 */
function numericIndexes(value: string, valid: ReadonlySet<number>): number[] {
  const out = new Set<number>();
  for (const part of value.split(/[,;]/)) {
    const ends = part.split(/[-–—]/).map((n) => Number(n.trim()));
    const first = ends[0];
    const last = ends[ends.length - 1];
    if (!first || !last || last < first || last - first > valid.size) return [];
    for (let n = first; n <= last; n++) {
      if (!valid.has(n)) return [];
      out.add(n);
    }
  }
  return [...out];
}

const PARTICLES = /^(?:(?:van|von|de|der|den|del|da|di|la|le|du|dos|das|te|ter|al|el|bin|ibn)\s+)+/iu;

/** "van der Maaten", "Maaten" and "Máaten" compare equal: the list may keep or drop the particle. */
const surnameKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(PARTICLES, "")
    .toLowerCase();

export type CitationStyle = "numeric" | "author-year" | "both";

/**
 * A surname as it appears in a citation: capitalised, possibly with a
 * particle ("van der Maaten", "de Vries"), an apostrophe or a hyphen.
 */
const SURNAME = String.raw`(?:(?:van|von|de|der|den|del|da|di|la|le|du|dos|das|te|ter|al|el|bin|ibn)\s+)*\p{Lu}[\p{L}'’\-]+`;
/** "et al." and the abbreviations and typos it is set as. */
const ET_AL = String.raw`(?:et\.?\s*al\.?|et\s+alii|and\s+colleagues|and\s+others|&\s+al\.?)`;
/** One, two, or "A, B, and C" authors, or a leading author with "et al.". */
const AUTHORS = String.raw`${SURNAME}(?:\s+${ET_AL}|(?:,\s*${SURNAME})*,?\s+(?:and|&)\s+${SURNAME})?`;
const YEAR = String.raw`(?:19|20)\d\d[a-z]?`;
const LEAD_IN = String.raw`(?:(?:e\.g\.|see also|see|cf\.|but see),?\s+)?`;

/**
 * Numbers in brackets, tolerant of the whitespace pdf.js puts around them.
 * The text layer splits a linked `[16]` into `[`, `16`, a zero-width space
 * and `]`, so the page text reads `[16 ]`; a bracket across a line break
 * reads `[16,\n18]`.
 */
const NUMBER_LIST = String.raw`\s*\d{1,4}(?:\s*[-–—]\s*\d{1,4})?(?:\s*[,;]\s*\d{1,4}(?:\s*[-–—]\s*\d{1,4})?)*\s*`;
const BRACKET_TOKEN = new RegExp(String.raw`\[${NUMBER_LIST}\]`, "g");
const PAREN_NUMBER_TOKEN = new RegExp(String.raw`\(${NUMBER_LIST}\)`, "g");
const PAREN_AUTHOR_YEAR_TOKEN = new RegExp(
  String.raw`\(${LEAD_IN}${AUTHORS},?\s+${YEAR}[^()]*\)`,
  "gu",
);
const NARRATIVE_TOKEN = new RegExp(String.raw`${AUTHORS}\s+\(${YEAR}(?:[,;]\s*[^()]*)?\)`, "gu");
const AUTHOR_YEAR_GROUP = new RegExp(
  String.raw`^${LEAD_IN}(${SURNAME})((?:,\s*${SURNAME})*)(?:\s+(${ET_AL})|,?\s+(?:and|&)\s+(${SURNAME}))?,?\s+\(?(${YEAR})\)?(?:[,:]\s*(?:pp?\.|ch\.|§)?\s*[\d\-–, ]+)?$`,
  "u",
);

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
    numeric += 3 * (text.match(BRACKET_TOKEN)?.length ?? 0);
    authorYear += text.match(PAREN_AUTHOR_YEAR_TOKEN)?.length ?? 0;
  }
  const threshold = Math.max(2, (numeric + authorYear) / 5);
  const hasNumeric = numeric >= threshold;
  const hasAuthorYear = authorYear >= threshold;
  if (hasNumeric && hasAuthorYear) return "both";
  if (hasNumeric) return "numeric";
  if (hasAuthorYear) return "author-year";
  return null;
}

/**
 * Entries cited by "Smith 2019", "Smith and Jones 2019" or "Smith et al.
 * 2019": the year must match and the first surname must be the entry's first
 * author; a second named surname must be its second author. A year suffix
 * ("2019a") is ignored — the list does not carry it — so both entries of a
 * 2019a/2019b pair are returned and the popover shows the choice.
 */
function matchAuthorYear(refs: readonly ParsedReference[], text: string): number[] {
  const match = AUTHOR_YEAR_GROUP.exec(text.trim());
  if (!match) return [];
  const [, first, middle, , last, year] = match;
  const second =
    middle
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? last;
  const yearNumber = Number(year!.slice(0, 4));
  return refs
    .filter(
      (ref) =>
        ref.year === yearNumber &&
        ref.authors[0] &&
        surnameKey(ref.authors[0]) === surnameKey(first!),
    )
    .filter((ref) => !second || !ref.authors[1] || surnameKey(ref.authors[1]) === surnameKey(second))
    .map((ref) => ref.index);
}

/**
 * Find citation markers in one page's text by pattern. Offsets refer to the
 * supplied text, not a reconstructed or normalized copy.
 *
 * This is the fallback for documents without their own links: a PDF whose
 * citations are `/Link` annotations is handled first by `linkCitationMentions`
 * (exact, since the link names the entry), and what it produces is merged
 * ahead of this by the caller.
 */
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
    for (const match of page.text.matchAll(BRACKET_TOKEN)) {
      add(match.index!, match.index! + match[0].length, numericIndexes(match[0].slice(1, -1), valid));
    }
    // `(12)` only where the list itself is labelled that way, since in every
    // other document a parenthesised number is an equation.
    if (refs.some((ref) => ref.label?.startsWith("("))) {
      for (const match of page.text.matchAll(PAREN_NUMBER_TOKEN)) {
        const before = page.text.slice(Math.max(0, match.index! - 12), match.index!);
        if (/(?:Eq|Equation|Fig|Figure|Table|Section|Sec)\.?\s*$/i.test(before)) continue;
        add(match.index!, match.index! + match[0].length, numericIndexes(match[0].slice(1, -1), valid));
      }
    }
  }
  if (authorYear) {
    // "(Smith 2019; Lee and Kim, 2020, p. 4)" — one group per semicolon.
    for (const match of page.text.matchAll(/\(([^()]+)\)/g)) {
      add(
        match.index!,
        match.index! + match[0].length,
        match[1]!.split(";").flatMap((part) => matchAuthorYear(refs, part)),
      );
    }
    // Narrative: "Smith et al. (2019)", "Smith and Jones (2019)".
    for (const match of page.text.matchAll(NARRATIVE_TOKEN)) {
      add(match.index!, match.index! + match[0].length, matchAuthorYear(refs, match[0]));
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
      if (
        item.fontSize > 0 &&
        item.fontSize <= 0.75 * bodyFontSize &&
        /^\d{1,3}(?:\s*[,–\-]\s*\d{1,3})*$/.test(item.str)
      ) {
        add(start, cursor, numericIndexes(item.str, valid));
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

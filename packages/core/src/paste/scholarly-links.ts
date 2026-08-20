/**
 * Making a pasted identifier resolvable.
 *
 * A DOI or an arXiv id copied out of a paper's front matter, a reference list
 * or an email arrives as bare text, and bare text is where it stays: nobody
 * reading the note a year later can click it, and search cannot tell it from a
 * version number. Both have exactly one canonical resolver, so turning them
 * into links needs no network and makes no guess.
 *
 * The label keeps the identifier rather than a title, because the identifier is
 * what somebody quoting this note will need to copy back out.
 */

import { markdownCodeRanges, mathRanges, markdownSyntaxRanges, frontmatterRange } from "./markdown-ranges.js";
import { indexRanges, type TextRange } from "./text-range.js";

/**
 * A DOI: the `10.` registrant prefix, four to nine digits, then a suffix.
 *
 * The lookbehind keeps it off things that merely contain the shape — a path
 * segment, a longer number, an existing `doi.org/` URL — because those are
 * matched by their own rules or protected outright.
 */
const DOI = /(?<![\w/.:-])10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/g;

/**
 * An arXiv id, only ever with its prefix.
 *
 * A bare `1706.03762` is a decimal number as readily as an identifier, and a
 * note about measurements is full of decimal numbers, so the prefix is
 * required. Both the modern `YYMM.NNNNN` form and the old `math.GT/0309136`
 * form are recognised.
 */
const ARXIV = /(?<![\w/:-])arXiv:\s?((?:\d{4}\.\d{4,5}(?:v\d+)?)|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?))/gi;

/**
 * A whole inline link or image, label included.
 *
 * `markdownSyntaxRanges` protects a link's destination but deliberately leaves
 * its label workable, because the character rules should still straighten a
 * curly quote inside one. For this rule the label matters too: a DOI is very
 * often the label of the link it already points at, and linking it again nests
 * one link inside another.
 */
const INLINE_LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/g;

/** Punctuation that ends the sentence rather than the identifier. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "'", '"']);

/**
 * Trims what the greedy suffix pattern swallowed from the prose after it.
 *
 * A closing bracket only goes when the identifier did not open one: DOIs really
 * do contain balanced parentheses, as in `10.1002/(SICI)1097-0258`.
 */
function trimIdentifier(value: string): string {
  let end = value.length;
  while (end > 0) {
    const char = value[end - 1]!;
    if (TRAILING.has(char)) {
      end -= 1;
      continue;
    }
    if (char === ")") {
      let open = 0;
      let close = 0;
      for (let i = 0; i < end; i++) {
        if (value[i] === "(") open += 1;
        else if (value[i] === ")") close += 1;
      }
      if (close > open) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return value.slice(0, end);
}

export interface ScholarlyLinkResult {
  text: string;
  /** How many identifiers were linked. */
  count: number;
}

/**
 * Links every bare DOI and arXiv id in `text`.
 *
 * `protect` carries the ranges the caller has already claimed — the URLs it
 * found, most importantly, so a DOI that is already inside `https://doi.org/…`
 * is left exactly as it is rather than nested inside a second link.
 */
export function linkScholarlyIdentifiers(
  text: string,
  protect: readonly TextRange[] = [],
): ScholarlyLinkResult {
  const frontmatter = frontmatterRange(text);
  const links: TextRange[] = [];
  INLINE_LINK.lastIndex = 0;
  for (let match = INLINE_LINK.exec(text); match; match = INLINE_LINK.exec(text)) {
    links.push({ start: match.index, end: match.index + match[0].length });
  }

  const ranges = indexRanges([
    ...protect,
    ...links,
    ...markdownCodeRanges(text),
    ...mathRanges(text),
    ...markdownSyntaxRanges(text),
    ...(frontmatter ? [frontmatter] : []),
  ]);

  interface Hit {
    start: number;
    end: number;
    replacement: string;
  }
  const hits: Hit[] = [];

  DOI.lastIndex = 0;
  for (let match = DOI.exec(text); match; match = DOI.exec(text)) {
    const doi = trimIdentifier(match[0]);
    if (!doi.includes("/")) continue;
    const start = match.index;
    const end = start + doi.length;
    if (ranges.overlaps(start, end)) continue;
    hits.push({ start, end, replacement: `[${doi}](https://doi.org/${doi})` });
  }

  // Overlapping a DOI hit is impossible as the two patterns stand, but two
  // patterns over one string is exactly where that assumption stops being free
  // — and a scan per match would be quadratic on a reference list.
  const claimed = indexRanges(hits.map((hit) => ({ start: hit.start, end: hit.end })));

  ARXIV.lastIndex = 0;
  for (let match = ARXIV.exec(text); match; match = ARXIV.exec(text)) {
    const id = match[1]!;
    const start = match.index;
    const end = start + match[0].length;
    if (ranges.overlaps(start, end) || claimed.overlaps(start, end)) continue;
    hits.push({ start, end, replacement: `[arXiv:${id}](https://arxiv.org/abs/${id})` });
  }

  if (hits.length === 0) return { text, count: 0 };

  hits.sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const hit of hits) {
    parts.push(text.slice(cursor, hit.start), hit.replacement);
    cursor = hit.end;
  }
  parts.push(text.slice(cursor));
  return { text: parts.join(""), count: hits.length };
}

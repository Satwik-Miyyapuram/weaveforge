/**
 * Citation candidates and pattern mentions, ported from the reference
 * Scholar reader (`citations.ts`). Candidates are found in the normalized
 * search text and mapped back to raw page offsets; a candidate becomes a
 * mention when its authors/year or bracket numbers name entries in the list.
 */
import type { CitationMention, PageTextRange, ParsedReference } from "./analysis-types.js";
import { mentionRects, originalRange, searchTextFromItems, stripInvisible, surnameKey, type PdfItem } from "./citation-text.js";

export type CitationStyle = "numeric" | "author-year" | "both";
export type EngineMode = "legacy" | "fixed";

export interface CitationCandidate {
  start: number;
  end: number;
  text: string;
  source: "numeric" | "author-year";
  authors?: string;
  year?: string;
}
const NAME = String.raw`(?:(?:van|von|de|der|den|del|da|di|la|le|du|dos|das)\s+)*(?:\p{Lu}[\p{L}'’-]+|\p{Lu}\.)`;
const ET_AL = String.raw`et\.?\s*al\.?`;
const AUTHORS = String.raw`${NAME}(?:\s+${ET_AL}|(?:,\s*${NAME})*,?\s*(?:and|&)\s*${NAME})?`;
const YEAR = String.raw`(?:19|20)\d{2}[a-z]?(?![\p{L}\d])`;
const AUTHOR_YEAR = String.raw`(${AUTHORS})\s*(?:,\s*|\(\s*|\s+)(${YEAR})(?:\s*\))?`;
const NUMBER_LIST = /\[\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*[,;]\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)*\s*\]/g;

export function detectCitationStyle(texts: readonly string[]): CitationStyle | null {
  let numeric = 0;
  let authorYear = 0;
  for (const text of texts) {
    numeric += [...text.matchAll(NUMBER_LIST)].length;
    authorYear += [...text.matchAll(new RegExp(AUTHOR_YEAR, "gu"))].length;
  }
  if (numeric && authorYear) return "both";
  return authorYear ? "author-year" : numeric ? "numeric" : null;
}

function referenceIndexes(authors: string, year: string, refs: readonly ParsedReference[]): number[] {
  const etAl = /et\.?\s*al\.?/i.test(authors);
  const names = [...authors.replace(/et\.?\s*al\.?/gi, "").matchAll(new RegExp(NAME, "gu"))]
    .map((match) => surnameKey(match[0]));
  const suffix = year.slice(4);
  return refs.filter((ref) => {
    if (ref.year !== Number(year.slice(0, 4)) || surnameKey(ref.authors[0] ?? "") !== names[0]) return false;
    if (suffix && ref.yearSuffix && ref.yearSuffix !== suffix) return false;
    if (!etAl && names.length > 1) {
      return names.every((name, i) => surnameKey(ref.authors[i] ?? "") === name);
    }
    return true;
  }).map((ref) => ref.index);
}

export function matchAuthorYearText(text: string, refs: readonly ParsedReference[]): number[] {
  const normalized = stripInvisible(text.normalize("NFKC")).replace(/\s+/g, " ");
  return [...new Set([...normalized.matchAll(new RegExp(AUTHOR_YEAR, "gu"))]
    .flatMap((match) => referenceIndexes(match[1]!, match[2]!, refs)))];
}

function numericIndexes(value: string, refs: readonly ParsedReference[]): number[] {
  const valid = new Set(refs.filter((ref) => ref.label).map((ref) => ref.index));
  const result = new Set<number>();
  for (const part of value.replace(/[\[\]]/g, "").split(/[,;]/)) {
    const ends = part.split(/[-–—]/).map((number) => Number(number.trim()));
    const first = ends[0]!;
    const last = ends[ends.length - 1]!;
    if (!first || !last || last < first || last - first > valid.size) return [];
    for (let n = first; n <= last; n++) {
      if (!valid.has(n)) return [];
      result.add(n);
    }
  }
  return [...result];
}

export function inReferenceList(page: number, start: number, end: number, ranges: readonly PageTextRange[]): boolean {
  return ranges.some((range) => range.page === page && start < range.end && end > range.start);
}

export function findCitationCandidates(items: readonly PdfItem[]): CitationCandidate[] {
  const search = searchTextFromItems(items);
  const raw = items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
  const candidates: CitationCandidate[] = [];
  for (const match of search.text.matchAll(NUMBER_LIST)) {
    const [start, end] = originalRange(search, match.index!, match.index! + match[0].length);
    candidates.push({ start, end, text: raw.slice(start, end), source: "numeric" });
  }
  for (const match of search.text.matchAll(new RegExp(AUTHOR_YEAR, "gu"))) {
    if (match.index! > 0 && /[\p{L}\d]/u.test(search.text[match.index! - 1]!)) continue;
    const [start, end] = originalRange(search, match.index!, match.index! + match[0].length);
    candidates.push({ start, end, text: raw.slice(start, end), source: "author-year", authors: match[1], year: match[2] });
  }
  return candidates.sort((a, b) => a.start - b.start);
}

export function findPatternCitationMentions(
  page: { number: number; text: string; items: readonly PdfItem[] },
  refs: readonly ParsedReference[],
  style: CitationStyle | null,
  mode: EngineMode,
  excluded: readonly PageTextRange[] = [],
): CitationMention[] {
  if (!refs.length) return [];
  if (mode === "legacy" && (!style || page.number >= Math.min(...refs.map((ref) => ref.page)))) return [];
  const out: CitationMention[] = [];
  const add = (start: number, end: number, indexes: number[], source: CitationMention["source"]) => {
    if (!indexes.length) return;
    if (inReferenceList(page.number, start, end, excluded) || end <= start) return;
    if (out.some((hit) => start < hit.end && end > hit.start)) return;
    const rects = mentionRects(page.items, start, end);
    out.push({
      id: `pattern:${page.number}:${start}:${end}`,
      page: page.number, start, end, text: page.text.slice(start, end), rects,
      referenceIndexes: indexes,
      source,
      confidence: indexes.length > 1 ? 0.72 : 0.9,
      spanSource: "text",
    });
  };
  for (const candidate of findCitationCandidates(page.items)) {
    const indexes = candidate.source === "numeric" ? numericIndexes(candidate.text, refs)
      : referenceIndexes(candidate.authors!, candidate.year!, refs);
    add(candidate.start, candidate.end, indexes, candidate.source);
  }
  return out.sort((a, b) => a.start - b.start);
}

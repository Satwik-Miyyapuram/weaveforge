/**
 * Split bibliography entries and parse their fields.
 *
 * Splitting is tried in the order the formats demand: numeric labels first
 * (`[1]`, `1.`, `(3)`, bare `12 Smith`), then left-margin jumps — a hanging
 * indent or a column change both show as the margin moving back — and last an
 * author/year start on every entry of an unnumbered list. Page breaks are no
 * obstacle: entries run across them as ordinary lines. Fields parsed from
 * each entry: DOI, arXiv ID, URL, authors, title, venue and year.
 */

import { normalizeDoi } from "../../papers/index.js";
import type { ParsedReference } from "./analysis-types.js";
import type { TextLine } from "./line-reconstruction.js";

/**
 * `[12]`, `12.`, `(12)`, and the bare `12 Smith` / `12-Smith` that some
 * journals set. The bare form insists on a capital or whitespace after the
 * separator so `12.5 mm` in a stray body line never reads as entry twelve.
 */
export const LABEL = /^(?:(\[(\d+)\]|\((\d+)\)|(\d+)\.(?=\s))\s*|(\d+)[ .-](?=\s|\p{Lu}))/u;

export function labelNumber(match: RegExpExecArray): number {
  return Number(match[2] ?? match[3] ?? match[4] ?? match[5]);
}

const YEAR = /\b(?:19|20)\d\d[a-z]?\b/;

/** Venue words that make a segment after the title read as the venue. */
const VENUE_WORDS =
  /(?:Proceedings|Journal|Transactions|Symposium|Congress|Workshop|Conference|NeurIPS|ICML|ICLR|CVPR|ICCV|ECCV|ACL|EMNLP|NAACL|AAAI|IJCAI|KDD|SIGIR|SIGMOD|CHI|WWW|Nature|Science|Cell|IEEE|ACM|Springer|Elsevier|arXiv preprint|Technical Report|Tech\. Rep)/i;

function splitEntries(
  lines: readonly TextLine[],
  starts: (line: TextLine, previous: readonly TextLine[]) => boolean,
): TextLine[][] {
  const entries: TextLine[][] = [];
  let current: TextLine[] = [];
  for (const line of lines) {
    if (starts(line, current)) {
      if (current.length) entries.push(current);
      current = [line];
    } else if (current.length) current.push(line);
  }
  if (current.length) entries.push(current);
  return entries;
}

/**
 * Entries by label, insisting on a monotonic sequence (1, 2, 3…) so a year
 * like "2020." inside an entry never splits it, and small skips (a missing
 * number in the text layer) are tolerated.
 */
export function splitNumberedEntries(lines: readonly TextLine[]): TextLine[][] {
  const entries: TextLine[][] = [];
  let current: TextLine[] = [];
  let expected = 1;
  for (const line of lines) {
    const match = LABEL.exec(line.text);
    if (match) {
      const num = labelNumber(match);
      const isStart = entries.length === 0 && current.length === 0;
      if ((isStart && num === 1) || (!isStart && num >= expected && num <= expected + 5)) {
        if (current.length) entries.push(current);
        current = [line];
        expected = num + 1;
        continue;
      }
    }
    if (current.length) current.push(line);
  }
  if (current.length) entries.push(current);
  return entries;
}

/**
 * Unnumbered entries by geometry: a new entry starts where the left margin
 * jumps back after a continuation. A backwards baseline jump marks the next
 * column in PDF reading order, so column changes start entries too — hanging
 * indents and columns are the same signal read two ways.
 */
export function splitByMargins(lines: readonly TextLine[]): TextLine[][] {
  const margins = new Map<TextLine, number>();
  let column: TextLine[] = [];
  const finish = () => {
    if (!column.length) return;
    const min = Math.min(...column.map((line) => line.x));
    column.forEach((line) => margins.set(line, min));
    column = [];
  };
  for (const line of lines) {
    const previous = column[column.length - 1];
    if (previous && (line.page !== previous.page || line.y > previous.y + 20)) finish();
    column.push(line);
  }
  finish();
  return splitEntries(lines, (line) => Math.abs(line.x - (margins.get(line) ?? line.x)) <= 2);
}

/** Entries by the surname/year that opens each one in author-year lists. */
export function splitByAuthorStart(lines: readonly TextLine[]): TextLine[][] {
  return splitEntries(
    lines,
    (line, previous) =>
      /^[A-Z][\p{L}'’\-]+(?:,\s+[A-Z]\.|\s+[A-Z]\.|\s+et\s+al)/u.test(line.text) &&
      (!previous.length || YEAR.test(previous.map((part) => part.text).join(" "))),
  );
}

/** Try the splitters in the order the formats demand. */
export function splitBibliographyEntries(lines: readonly TextLine[]): TextLine[][] {
  let entries = splitNumberedEntries(lines);
  if (entries.length < 3) entries = splitByMargins(lines);
  if (entries.length < 3) entries = splitByAuthorStart(lines);
  return entries;
}

function cleanTitle(str: string | undefined): string | undefined {
  if (!str) return undefined;
  const t = str.replace(/[.,;:]+$/, "").replace(/^["“']+|["”']+$/g, "").trim();
  return t.length > 3 ? t : undefined;
}

function extractAuthors(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/\bet\s+al\.?/gi, "")
    .split(/\s+(?:and|&)\s+|;/i)
    .flatMap((part) => {
      // Surname, Given in author-year lists; Given Surname in numbered ones.
      if (/^[\p{L}'’–-]+,\s/u.test(part.trim())) return [part.trim().split(",")[0]!];
      return part.split(",").map((name) => name.trim().replace(/[.\s]+$/, "").split(/\s+/).pop() ?? "");
    })
    .filter((name) => /^[\p{L}'’–-]{2,}$/u.test(name) && !/^(al|et|In|and|the|of|for|with)$/i.test(name));
}

/**
 * The venue, if one is printed: an explicit "In Proceedings of …" beats the
 * first later segment carrying a venue word ("Nature", "IEEE …", "arXiv
 * preprint"). Kept conservative — a wrong venue is worse than none.
 */
export function extractVenue(afterTitle: string): string | undefined {
  const inMatch = /\bIn\s+(.{3,90}?)(?:\.|,\s*\d{4}|$)/i.exec(afterTitle);
  if (inMatch && VENUE_WORDS.test(inMatch[1]!)) return inMatch[1]!.trim().replace(/[.,]+$/, "");
  for (const segment of afterTitle.split(/\.\s+/)) {
    const trimmed = segment.trim().replace(/[.,]+$/, "");
    if (trimmed.length >= 3 && trimmed.length <= 90 && VENUE_WORDS.test(trimmed) && !/^\d+$/.test(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * One entry's fields. Three shapes are recognised, in order of reliability:
 * a quoted title, an early year (APA/Harvard "Surname, A. (2019). Title."),
 * and the late-year conference form ("A. Surname. Title. In Venue, 2017.").
 */
export function parseBibliographyEntry(
  entryLines: readonly TextLine[],
  index: number,
  withOffsets = true,
): ParsedReference {
  const raw = entryLines
    .map((line) => line.text)
    .join("\n")
    .replace(/-\n/g, "")
    .replace(/\n/g, " ")
    .trim();
  const labelMatch = LABEL.exec(raw);
  const text = raw.slice(labelMatch?.[0].length ?? 0).trim();

  const doi = normalizeDoi(/10\.\d{4,9}\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;)]+$/, ""));
  const arxivId = /(?:arXiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i.exec(text)?.[1];
  const url = /https?:\/\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;)]+$/, "");

  const yearMatches = [...text.matchAll(/\b((?:19|20)\d\d)([a-z]?)\b/g)];
  let year = yearMatches[0]?.[1] ? Number(yearMatches[0][1]) : undefined;
  /** `2014a` — the letter that tells two same-year entries apart. */
  const suffixOf = (match: RegExpMatchArray | undefined) => match?.[2] || undefined;
  let yearSuffix = suffixOf(yearMatches[0]);

  let authors: string[] = [];
  let title: string | undefined;
  let venue: string | undefined;

  const base: ParsedReference = {
    index: labelMatch ? labelNumber(labelMatch) : index,
    ...(labelMatch ? { label: labelMatch[1] ?? labelMatch[5]! } : {}),
    raw,
    page: entryLines[0]!.page,
    x: entryLines[0]!.x,
    y: entryLines[0]!.y,
    ...(withOffsets ? { start: entryLines[0]!.start, end: entryLines[entryLines.length - 1]!.end } : {}),
    authors: [],
    doi, arxivId, url,
  };

  // 1. Quoted title: "Attention is all you need" or “Title”.
  const quote = /["“]([^"”]+)["”]/.exec(text);
  if (quote) {
    title = quote[1]!.trim();
    const authorText = text.slice(0, quote.index).replace(/[,.:\s]+$/, "");
    authors = extractAuthors(authorText);
    venue = extractVenue(text.slice(quote.index + quote[0].length));
    const last = yearMatches[yearMatches.length - 1];
    return {
      ...base, authors, year: last ? Number(last[1]) : year, yearSuffix: last ? suffixOf(last) : yearSuffix,
      title: cleanTitle(title), venue,
    };
  }

  // 2. Early year (APA / Harvard): "Surname, A. (2019). Title."
  const earlyYearMatch = text.match(/^([^\d]{3,120}?)[\s,]*[\(\[]?((?:19|20)\d\d)([a-z]?)[\)\]]?[.:]\s+(.+)$/);
  if (earlyYearMatch) {
    authors = extractAuthors(earlyYearMatch[1]!);
    year = Number(earlyYearMatch[2]);
    yearSuffix = earlyYearMatch[3] || undefined;
    const afterYear = earlyYearMatch[4]!;
    title = afterYear.split(/\.\s+(?=[A-Z0-9"“]|In\s|in\s)|\.\s*$/)[0];
    venue = extractVenue(afterYear.slice(title?.length ?? 0));
    return { ...base, authors, year, yearSuffix, title: cleanTitle(title), venue };
  }

  // 3. Late year / conference form. Cut the venue clause off first.
  let preVenue = text;
  const inMatch = text.search(/\.\s+(?:In|in)\s+|\s+,\s*(?:in|In)\s+/);
  if (inMatch !== -1) preVenue = text.slice(0, inMatch);

  const etAlMatch = preVenue.match(/^(.+?\bet\s+al\.?)[,.:\s]+(.+)$/i);
  const andMatch = !etAlMatch &&
    preVenue.match(/^(.+?\b(?:and|&)\s+(?:(?:[A-Z]\.\s*)+[\p{L}'’\-]+|[\p{L}'’\-]+(?:,\s+[A-Z]\.)?))\.\s+([\p{Lu}].+)$/u);
  const authorListMatch = !etAlMatch && !andMatch &&
    preVenue.match(/^((?:[\p{L}'’\-]+,\s+[A-Z]\.\s*,?\s*)+)\s*([\p{Lu}].+)$/u);
  const dotMatch = !etAlMatch && !andMatch && !authorListMatch &&
    preVenue.match(/^([^\n.]{3,100}\.)\s+([\p{Lu}].+)$/u);
  if (etAlMatch) {
    authors = extractAuthors(etAlMatch[1]!);
    title = etAlMatch[2];
  } else if (andMatch) {
    authors = extractAuthors(andMatch[1]!);
    title = andMatch[2];
  } else if (authorListMatch) {
    authors = extractAuthors(authorListMatch[1]!);
    title = authorListMatch[2];
  } else if (dotMatch) {
    authors = extractAuthors(dotMatch[1]!);
    title = dotMatch[2];
  } else {
    title = preVenue;
  }

  if (title) title = title.split(/\.\s+(?=[A-Z]|In\s|in\s)|\.\s*$/)[0];
  venue = extractVenue(text.slice((title ? text.indexOf(title) + title.length : 0)));
  const last = yearMatches[yearMatches.length - 1];

  return {
    ...base,
    authors,
    year: last ? Number(last[1]) : year,
    yearSuffix: last ? suffixOf(last) : yearSuffix,
    title: cleanTitle(title),
    venue,
  };
}

/** Split then parse; fewer than three entries means it was not a bibliography. */
export function parseBibliography(lines: readonly TextLine[], withOffsets = true): ParsedReference[] {
  const entries = splitBibliographyEntries(lines);
  return entries.length >= 3
    ? entries.map((entry, i) => parseBibliographyEntry(entry, i + 1, withOffsets))
    : [];
}

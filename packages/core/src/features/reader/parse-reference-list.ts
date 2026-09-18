import { normalizeDoi } from "../papers/index.js";
import { outlineTextLines, type OutlineTextItem } from "./outline-from-text.js";

export interface ParsedReference {
  index: number;
  label?: string;
  raw: string;
  page: number;
  /** Left edge and baseline of the entry's first line, PDF user space. */
  x: number;
  y: number;
  authors: string[];
  year?: number;
  title?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
}

/**
 * `[12]`, `12.`, `(12)`, and the bare `12 Smith` / `12-Smith` that some
 * journals set. The bare form insists on a capital or whitespace after the
 * separator so `12.5 mm` in a stray body line never reads as entry twelve.
 */
const LABEL = /^(?:(\[(\d+)\]|\((\d+)\)|(\d+)\.(?=\s))\s*|(\d+)[ .-](?=\s|\p{Lu}))/u;
const YEAR = /\b(?:19|20)\d\d[a-z]?\b/;
/**
 * The bibliography heading, with the section number some templates prefix
 * and the qualifiers journals add ("References and Notes", "Literature
 * Cited"). Case-insensitive because many templates set it in small caps,
 * which the text layer reports as upper case.
 */
const HEADING =
  /^(?:\d+\.?\s+|[IVX]+\.\s+)?(?:References?|Bibliography|Bibliographie|Works Cited|Literature Cited|Literatur(?:verzeichnis)?|Referencias|Références|Riferimenti|Referências|Bibliografia|Bibliografía|Cited Literature|Sources|Notes and References)(?:\s+(?:and|&)\s+(?:Notes|Further Reading|Bibliography))?\s*:?$/iu;

function labelNumber(match: RegExpExecArray): number {
  return Number(match[2] ?? match[3] ?? match[4] ?? match[5]);
}

export function referenceListLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  const lines = outlineTextLines(pages);
  let start = -1;
  lines.forEach((line, i) => {
    if (HEADING.test(line.str)) start = i;
  });
  if (start < 0) return fallbackReferenceLines(pages, lines);
  const end = lines.findIndex((line, i) => i > start && /^(?:[A-Z\d]+\.?\s+)?Appendix\b/i.test(line.str));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/**
 * No heading: some PDFs set "References" as an image, or the text layer
 * splits it. Scan the last third of the document (two to twenty pages) for a
 * numbered run that starts at 1 and counts up without gaps; that is a
 * bibliography whatever it is called. Gives up when more than two thirds of
 * the lines in that run carry no label — a numbered list in prose, say.
 */
function fallbackReferenceLines(
  pages: readonly (readonly OutlineTextItem[])[],
  lines: readonly OutlineTextItem[],
): OutlineTextItem[] {
  const span = Math.min(20, Math.max(2, Math.ceil(pages.length / 3)));
  const firstPage = Math.max(1, pages.length - span + 1);
  const tail = lines.filter((line) => line.page >= firstPage);
  const one = tail.findIndex((line) => {
    const label = LABEL.exec(line.str);
    return label !== null && labelNumber(label) === 1;
  });
  if (one < 0) return [];
  const candidate = tail.slice(one);
  let expected = 1;
  let end = candidate.length;
  for (let i = 0; i < candidate.length; i++) {
    const label = LABEL.exec(candidate[i]!.str);
    if (!label) continue;
    const n = labelNumber(label);
    if (n === expected + 1) { expected = n; continue; }
    if (n === expected) continue;
    end = i;
    break;
  }
  const run = candidate.slice(0, end);
  if (expected < 3) return [];
  const unlabelled = run.filter((line) => !LABEL.test(line.str)).length;
  return unlabelled > (run.length * 2) / 3 ? [] : run;
}

function splitNumberedEntries(lines: OutlineTextItem[]): OutlineTextItem[][] {
  const entries: OutlineTextItem[][] = [];
  let current: OutlineTextItem[] = [];
  let expected = 1;

  for (const line of lines) {
    const match = LABEL.exec(line.str);
    if (match) {
      const num = labelNumber(match);
      const isStart = entries.length === 0 && current.length === 0;
      // Ensure monotonic sequence (e.g. 1, 2, 3...) so years like "2020." inside an entry do not split it
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

function splitEntries(lines: OutlineTextItem[], starts: (line: OutlineTextItem, previous: OutlineTextItem[]) => boolean): OutlineTextItem[][] {
  const entries: OutlineTextItem[][] = [];
  let current: OutlineTextItem[] = [];
  for (const line of lines) {
    if (starts(line, current)) {
      if (current.length) entries.push(current);
      current = [line];
    } else if (current.length) current.push(line);
  }
  if (current.length) entries.push(current);
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

function parseEntry(lines: OutlineTextItem[], index: number): ParsedReference {
  const raw = lines.map((line) => line.str).join("\n").replace(/-\n/g, "").replace(/\n/g, " ").trim();
  const labelMatch = LABEL.exec(raw);
  const text = raw.slice(labelMatch?.[0].length ?? 0).trim();

  const doi = normalizeDoi(/10\.\d{4,9}\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;)]+$/, ""));
  const arxivId = /(?:arXiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i.exec(text)?.[1];
  const url = /https?:\/\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;)]+$/, "");

  const yearMatches = [...text.matchAll(/\b((?:19|20)\d\d)[a-z]?\b/g)];
  const firstYearStr = yearMatches[0]?.[1];
  let year = firstYearStr ? Number(firstYearStr) : undefined;

  let authors: string[] = [];
  let title: string | undefined;

  // 1. Quoted title: "Attention is all you need" or “Title”
  const quote = /["“]([^"”]+)["”]/.exec(text);
  if (quote) {
    title = quote[1]!.trim();
    const authorText = text.slice(0, quote.index).replace(/[,.:\s]+$/, "");
    authors = extractAuthors(authorText);
    const lastYearStr = yearMatches[yearMatches.length - 1]?.[1];
    const lastYear = lastYearStr ? Number(lastYearStr) : undefined;
    return {
      index: labelMatch ? labelNumber(labelMatch) : index,
      ...(labelMatch ? { label: labelMatch[1] ?? labelMatch[5]! } : {}),
      raw, page: lines[0]!.page, x: lines[0]!.x, y: lines[0]!.y, authors,
      year: lastYear ?? year,
      title: cleanTitle(title),
      doi, arxivId, url,
    };
  }

  // 2. Early year format (APA / Harvard): "Surname, A. (2019). Title." or "Surname 2019. Title."
  const earlyYearMatch = text.match(/^([^\d]{3,120}?)[\s,]*[\(\[]?((?:19|20)\d\d)[a-z]?[\)\]]?[.:]\s+(.+)$/);
  if (earlyYearMatch) {
    authors = extractAuthors(earlyYearMatch[1]!);
    year = Number(earlyYearMatch[2]);
    const afterYear = earlyYearMatch[3]!;
    title = afterYear.split(/\.\s+(?=[A-Z0-9"“]|In\s|in\s)|\.\s*$/)[0];
    return {
      index: labelMatch ? labelNumber(labelMatch) : index,
      ...(labelMatch ? { label: labelMatch[1] ?? labelMatch[5]! } : {}),
      raw, page: lines[0]!.page, x: lines[0]!.x, y: lines[0]!.y, authors,
      year,
      title: cleanTitle(title),
      doi, arxivId, url,
    };
  }

  // 3. Late year / Standard conference format:
  // e.g. "A. Vaswani, ..., and I. Polosukhin. Attention is all you need. In NeurIPS, 2017."
  let preVenue = text;
  const inMatch = text.search(/\.\s+(?:In|in)\s+|\s+,\s*(?:in|In)\s+/);
  if (inMatch !== -1) {
    preVenue = text.slice(0, inMatch);
  }

  // Case A: "et al."
  const etAlMatch = preVenue.match(/^(.+?\bet\s+al\.?)[,.:\s]+(.+)$/i);
  if (etAlMatch) {
    authors = extractAuthors(etAlMatch[1]!);
    title = etAlMatch[2];
  } else {
    // Case B: "... and Surname, I. Title" or "... and I. Surname. Title"
    const andMatch = preVenue.match(/^(.+?\b(?:and|&)\s+(?:(?:[A-Z]\.\s*)+[\p{L}'’\-]+|[\p{L}'’\-]+(?:,\s+[A-Z]\.)?))\.\s+([\p{Lu}].+)$/u);
    if (andMatch) {
      authors = extractAuthors(andMatch[1]!);
      title = andMatch[2];
    } else {
      // Case C: Look for the last author pattern e.g. "Surname, I. Title"
      const authorListMatch = preVenue.match(/^((?:[\p{L}'’\-]+,\s+[A-Z]\.\s*,?\s*)+)\s*([\p{Lu}].+)$/u);
      if (authorListMatch) {
        authors = extractAuthors(authorListMatch[1]!);
        title = authorListMatch[2];
      } else {
        // Case D: General split on first period followed by capital letter
        const dotMatch = preVenue.match(/^([^\n.]{3,100}\.)\s+([\p{Lu}].+)$/u);
        if (dotMatch) {
          authors = extractAuthors(dotMatch[1]!);
          title = dotMatch[2];
        } else {
          title = preVenue;
        }
      }
    }
  }

  // Clean trailing venue fragments if any
  if (title) {
    title = title.split(/\.\s+(?=[A-Z]|In\s|in\s)|\.\s*$/)[0];
  }
  const lastYearStr = yearMatches[yearMatches.length - 1]?.[1];
  const lastYear = lastYearStr ? Number(lastYearStr) : undefined;

  return {
    index: labelMatch ? labelNumber(labelMatch) : index,
    ...(labelMatch ? { label: labelMatch[1] ?? labelMatch[5]! } : {}),
    raw, page: lines[0]!.page, x: lines[0]!.x, y: lines[0]!.y, authors,
    year: lastYear ?? year,
    title: cleanTitle(title),
    doi, arxivId, url,
  };
}

/** Best-effort bibliography parsing; needs a heading or a numbered run in the last third. */
export function parseReferenceList(pages: readonly (readonly OutlineTextItem[])[]): ParsedReference[] {
  const lines = referenceListLines(pages);
  // Try sequential numbered splitting first
  let entries = splitNumberedEntries(lines);
  if (entries.length < 3) {
    // A backwards baseline jump marks the next column in PDF reading order.
    const margins = new Map<OutlineTextItem, number>();
    let column: OutlineTextItem[] = [];
    const finish = () => {
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
    entries = splitEntries(lines, (line) => Math.abs(line.x - (margins.get(line) ?? line.x)) <= 2);
  }
  if (entries.length < 3) {
    entries = splitEntries(lines, (line, previous) => /^[A-Z][\p{L}'’\-]+(?:,\s+[A-Z]\.|\s+[A-Z]\.|\s+et\s+al)/u.test(line.str) &&
      (!previous.length || YEAR.test(previous.map((part) => part.str).join(" "))));
  }
  return entries.length >= 3 ? entries.map((entry, i) => parseEntry(entry, i + 1)) : [];
}


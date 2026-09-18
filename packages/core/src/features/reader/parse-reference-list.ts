import { normalizeDoi } from "../papers/index.js";
import { outlineTextLines, type OutlineTextItem } from "./outline-from-text.js";

export interface ParsedReference {
  index: number;
  label?: string;
  raw: string;
  page: number;
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
const HEADING = /^(?:\d+\.?\s+)?(References|Bibliography|Works Cited)$/i;

function labelNumber(match: RegExpExecArray): number {
  return Number(match[2] ?? match[3] ?? match[4] ?? match[5]);
}

export function referenceListLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  const lines = outlineTextLines(pages);
  let start = -1;
  lines.forEach((line, i) => { if (HEADING.test(line.str)) start = i; });
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

function parseEntry(lines: OutlineTextItem[], index: number): ParsedReference {
  const raw = lines.map((line) => line.str).join("\n").replace(/-\n/g, "").replace(/\n/g, " ").trim();
  const label = LABEL.exec(raw);
  const text = raw.slice(label?.[0].length ?? 0);
  const year = YEAR.exec(text);
  const quote = /["“]([^"”]+)["”]/.exec(text);
  const authorEnd = Math.min(year?.index ?? Infinity, quote?.index ?? Infinity);
  const authorText = Number.isFinite(authorEnd) ? text.slice(0, authorEnd) : "";
  const authors = authorText.split(/\s+(?:and|&)\s+|;/i).flatMap((part) => {
    // Surname, Given is common in author-year lists; initials-first in numbered ones.
    if (/^[\p{L}'’–-]+,\s/u.test(part.trim())) return [part.trim().split(",")[0]!];
    return part.split(",").map((name) => name.trim().replace(/[.\s]+$/, "").split(/\s+/).pop() ?? "");
  }).filter((name) => /^[\p{L}'’–-]{2,}$/u.test(name) && !/^(al|et|In)$/i.test(name));
  const afterYear = year ? text.slice(year.index + year[0].length).replace(/^[).,:;\s]+/, "") : "";
  const title = quote?.[1] ?? afterYear.split(/\.\s+(?=[A-Z]|In\s)/)[0]?.replace(/[.\s]+$/, "");
  return {
    index: label ? labelNumber(label) : index,
    ...(label ? { label: label[1] ?? label[5]! } : {}),
    raw, page: lines[0]!.page, authors,
    year: year ? Number(year[0].slice(0, 4)) : undefined,
    title: title || undefined,
    doi: normalizeDoi(/10\.\d{4,9}\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;]+$/, "")),
    arxivId: /(?:arXiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i.exec(text)?.[1],
    url: /https?:\/\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;]+$/, ""),
  };
}

/** Best-effort bibliography parsing; needs a heading or a numbered run in the last third. */
export function parseReferenceList(pages: readonly (readonly OutlineTextItem[])[]): ParsedReference[] {
  const lines = referenceListLines(pages);
  let entries = splitEntries(lines, (line) => LABEL.test(line.str));
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
    entries = splitEntries(lines, (line, previous) => /^[A-Z][^,]+,\s/.test(line.str) &&
      (!previous.length || YEAR.test(previous.map((part) => part.str).join(" "))));
  }
  return entries.length >= 3 ? entries.map((entry, i) => parseEntry(entry, i + 1)) : [];
}

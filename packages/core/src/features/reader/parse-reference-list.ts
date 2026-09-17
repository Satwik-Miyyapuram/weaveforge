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

const LABEL = /^(\[(\d+)\]|(\d+)\.)\s*/;
const YEAR = /\b(?:19|20)\d\d[a-z]?\b/;
const HEADING = /^(References|Bibliography|Works Cited)$/i;

export function referenceListLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  const lines = outlineTextLines(pages);
  let start = -1;
  lines.forEach((line, i) => { if (HEADING.test(line.str)) start = i; });
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && /^(?:[A-Z\d]+\.?\s+)?Appendix\b/i.test(line.str));
  return lines.slice(start + 1, end < 0 ? undefined : end);
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
    index: label ? Number(label[2] ?? label[3]) : index,
    ...(label ? { label: label[1] } : {}),
    raw, page: lines[0]!.page, authors,
    year: year ? Number(year[0].slice(0, 4)) : undefined,
    title: title || undefined,
    doi: normalizeDoi(/10\.\d{4,9}\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;]+$/, "")),
    arxivId: /(?:arXiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i.exec(text)?.[1],
    url: /https?:\/\/[^\s"<>]+/i.exec(text)?.[0]?.replace(/[.,;]+$/, ""),
  };
}

/** Best-effort bibliography parsing; never manufactures entries without a heading. */
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

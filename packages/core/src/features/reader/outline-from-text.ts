export interface OutlineTextItem {
  str: string;
  fontSize: number;
  fontName?: string;
  x: number;
  y: number;
  page: number;
}

export interface ReaderOutlineItem {
  title: string;
  pageNumber: number | null;
  y?: number;
  items?: ReaderOutlineItem[];
}

/** Fewer characters than this and there is no body to find sections in. */
export const MIN_ANALYSABLE_CHARS = 300;

function isBold(fontName: string | undefined): boolean {
  return /bold|black|heavy/i.test(fontName ?? "");
}

/**
 * Consecutive text runs on a baseline, in the supplied reading order. Two
 * passes: a loose one that joins runs within three quarters of a line, so a
 * heading set in a display face with a raised numeral still reads as one line,
 * then a tight half-line pass on lines the loose pass left short — those are
 * the body set at a smaller leading, where the loose band would swallow the
 * line below.
 */
export function outlineTextLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  const lines: OutlineTextItem[] = [];
  for (const page of pages) {
    for (const tolerance of [0.75, 0.5]) {
      const joined = joinLines(page, tolerance);
      // The loose pass is the answer unless it fused what should be two lines,
      // which shows as a line whose runs span more than one font height.
      if (tolerance === 0.75 && !joined.some((line) => line.spread > line.fontSize * 0.5)) {
        lines.push(...joined.map(({ spread: _spread, ...line }) => line));
        break;
      }
      if (tolerance === 0.5) lines.push(...joined.map(({ spread: _spread, ...line }) => line));
    }
  }
  return lines;
}

function joinLines(
  page: readonly OutlineTextItem[],
  tolerance: number,
): (OutlineTextItem & { spread: number })[] {
  const lines: (OutlineTextItem & { spread: number; minY: number; maxY: number })[] = [];
  let line: (typeof lines)[number] | undefined;
  for (const item of page) {
    if (!item.str.trim()) continue;
    const band = Math.max(1, tolerance * Math.max(line?.fontSize ?? 0, item.fontSize));
    if (line && line.page === item.page && Math.abs(line.y - item.y) <= band && item.x >= line.x) {
      line.str = `${line.str.trimEnd()} ${item.str.trimStart()}`;
      line.fontSize = Math.max(line.fontSize, item.fontSize);
      if (isBold(item.fontName)) line.fontName = item.fontName;
      line.minY = Math.min(line.minY, item.y);
      line.maxY = Math.max(line.maxY, item.y);
      line.spread = line.maxY - line.minY;
    } else {
      line = { ...item, str: item.str.trim(), spread: 0, minY: item.y, maxY: item.y };
      lines.push(line);
    }
  }
  return lines.map(({ minY: _a, maxY: _b, ...rest }) => rest);
}

export function bodyFontSize(pages: readonly (readonly OutlineTextItem[])[]): number {
  const counts = new Map<number, number>();
  for (const item of pages.flat()) {
    if (!item.str.trim() || !Number.isFinite(item.fontSize) || item.fontSize <= 0) continue;
    const size = Math.round(item.fontSize * 2) / 2;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

/** Edit distance, capped at `limit` so the running-head test stays cheap on long lines. */
export function levenshtein(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length]!;
}

const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+\S/;
const SECTION = /^(Abstract|Introduction|Related Work|Method|Results|Discussion|Conclusion|References|Appendix)\b/i;
const REFERENCES = /^(?:\d+(?:\.\d+)*\.?\s+)?(References|Bibliography)\b/i;
/** A table-of-contents entry: title, a run of dots, a page number. */
const DOTTED_LEADER = /(\.\s*){5,}\d*$/;
/** Fraction of each page's text extent, on every side, treated as margin. */
const MARGIN = 0.06;

function normalise(str: string): string {
  return str.toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#");
}

/**
 * Lines that appear (near-)verbatim on three or more pages: running heads,
 * footers, journal banners. "Near" is an edit distance within a fifth of the
 * shorter line, so "Smith et al. 12" and "Smith et al. 13" still count as
 * the same head once page numbers are masked.
 */
function runningHeads(lines: readonly OutlineTextItem[]): Set<OutlineTextItem> {
  const groups: { key: string; pages: Set<number>; members: OutlineTextItem[] }[] = [];
  for (const line of lines) {
    const key = normalise(line.str);
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
  const heads = new Set<OutlineTextItem>();
  for (const group of groups) {
    if (group.pages.size >= 3) for (const member of group.members) heads.add(member);
  }
  return heads;
}

/**
 * Runs in the outer 6% of a page's text extent: page numbers, banners, side
 * notes. The extent stands in for the page box, which the text layer does not
 * carry, so the topmost line of a page is always in the band — a title or the
 * first heading included. Only what looks like furniture is dropped from it:
 * bare numbers, and lines that recur in the band on another page.
 */
function cropMargins(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[][] {
  const inBand = new Set<OutlineTextItem>();
  for (const page of pages) {
    if (page.length < 8) continue;
    const xs = page.map((item) => item.x);
    const ys = page.map((item) => item.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const dx = (maxX - minX) * MARGIN, dy = (maxY - minY) * MARGIN;
    for (const item of page) {
      if (item.x < minX + dx || item.x > maxX - dx || item.y < minY + dy || item.y > maxY - dy) inBand.add(item);
    }
  }
  const bandPages = new Map<string, Set<number>>();
  for (const item of inBand) {
    const key = normalise(item.str);
    const seen = bandPages.get(key) ?? new Set<number>();
    seen.add(item.page);
    bandPages.set(key, seen);
  }
  return pages.map((page) => page.filter((item) => {
    if (!inBand.has(item)) return true;
    if (/^[\divxlc]+$/i.test(item.str.trim())) return false;
    return (bandPages.get(normalise(item.str))?.size ?? 0) < 2;
  }));
}

/** Infer an outline only when a document supplies no bookmarks. No pdf.js dependency. */
export function outlineFromText(pages: readonly (readonly OutlineTextItem[])[]): ReaderOutlineItem[] {
  const chars = pages.reduce((n, page) => n + page.reduce((m, item) => m + item.str.length, 0), 0);
  if (chars < MIN_ANALYSABLE_CHARS) return [];
  const body = bodyFontSize(pages);
  if (!body) return [];
  const lines = outlineTextLines(cropMargins(pages));
  const heads = runningHeads(lines);
  const headings = lines.filter((line) => {
    if (heads.has(line)) return false;
    const numbered = NUMBERED.test(line.str);
    if (line.str.length > 120 || (!numbered && line.str.endsWith("."))) return false;
    if (DOTTED_LEADER.test(line.str)) return false;
    return line.fontSize >= 1.12 * body || (isBold(line.fontName) && (numbered || SECTION.test(line.str)));
  });
  const references = headings.findIndex((heading) => REFERENCES.test(heading.str));
  if (references >= 0) headings.splice(references + 1);
  if (!outlineIsPlausible(headings, pages.length)) return [];
  const sizes = [...new Set(headings.map((line) => line.fontSize))].sort((a, b) => b - a);
  const roots: ReaderOutlineItem[] = [];
  const stack: { level: number; node: ReaderOutlineItem }[] = [];
  for (const heading of headings) {
    const number = NUMBERED.exec(heading.str)?.[1];
    const level = number ? number.split(".").length : sizes.indexOf(heading.fontSize) + 1;
    const node: ReaderOutlineItem = { title: heading.str, pageNumber: heading.page, y: heading.y };
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (parent) (parent.items ??= []).push(node);
    else roots.push(node);
    stack.push({ level, node });
    if (REFERENCES.test(heading.str)) break;
  }
  return roots;
}

/**
 * An outline is worth showing when it has at least three sections and no
 * stretch without one longer than half the document — otherwise it is a
 * couple of stray large lines, and an empty sidebar beats a misleading one.
 */
function outlineIsPlausible(headings: readonly OutlineTextItem[], pageCount: number): boolean {
  if (headings.length < 3) return false;
  if (pageCount < 4) return true;
  const allowed = Math.ceil(pageCount * 0.5);
  let previous = 1;
  for (const heading of headings) {
    if (heading.page - previous > allowed) return false;
    previous = heading.page;
  }
  return pageCount - previous <= allowed;
}

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

/** Consecutive text runs on a baseline, in the supplied reading order. */
export function outlineTextLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  const lines: OutlineTextItem[] = [];
  for (const page of pages) {
    let line: OutlineTextItem | undefined;
    for (const item of page) {
      if (!item.str.trim()) continue;
      if (line && line.page === item.page && Math.abs(line.y - item.y) <= 1 && item.x >= line.x) {
        line.str = `${line.str.trimEnd()} ${item.str.trimStart()}`;
        line.fontSize = Math.max(line.fontSize, item.fontSize);
        if (/bold|black|heavy/i.test(item.fontName ?? "")) line.fontName = item.fontName;
      } else {
        line = { ...item, str: item.str.trim() };
        lines.push(line);
      }
    }
  }
  return lines;
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

const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+\S/;
const SECTION = /^(Abstract|Introduction|Related Work|Method|Results|Discussion|Conclusion|References|Appendix)\b/i;

/** Infer an outline only when a document supplies no bookmarks. No pdf.js dependency. */
export function outlineFromText(pages: readonly (readonly OutlineTextItem[])[]): ReaderOutlineItem[] {
  const body = bodyFontSize(pages);
  if (!body) return [];
  const lines = outlineTextLines(pages);
  const occurrences = new Map<string, Set<number>>();
  for (const line of lines) {
    const key = line.str.toLowerCase().replace(/\s+/g, " ");
    const seen = occurrences.get(key) ?? new Set<number>();
    seen.add(line.page);
    occurrences.set(key, seen);
  }
  const headings = lines.filter((line) => {
    const numbered = NUMBERED.test(line.str);
    if (line.str.length > 120 || (!numbered && line.str.endsWith("."))) return false;
    if ((occurrences.get(line.str.toLowerCase().replace(/\s+/g, " "))?.size ?? 0) >= 3) return false;
    return line.fontSize >= 1.12 * body ||
      (/bold|black|heavy/i.test(line.fontName ?? "") && (numbered || SECTION.test(line.str)));
  });
  const references = headings.findIndex((heading) => /^(?:\d+(?:\.\d+)*\.?\s+)?References\b/i.test(heading.str));
  if (references >= 0) headings.splice(references + 1);
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
    if (/^(?:\d+(?:\.\d+)*\.?\s+)?References\b/i.test(heading.str)) break;
  }
  return roots;
}

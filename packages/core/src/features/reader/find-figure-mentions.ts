import { outlineFromText, outlineTextLines, type OutlineTextItem, type ReaderOutlineItem } from "./outline-from-text.js";

export interface FigureTarget {
  page: number;
  y: number;
  x?: number;
  height?: number;
}

export interface FigureMention {
  page: number;
  start: number;
  end: number;
  kind: "figure" | "table" | "equation" | "section" | "algorithm";
  target: FigureTarget;
}

function kindOf(value: string): FigureMention["kind"] {
  if (/^fig/i.test(value)) return "figure";
  if (/^tab/i.test(value)) return "table";
  if (/^eq/i.test(value)) return "equation";
  if (/^sec/i.test(value)) return "section";
  return "algorithm";
}

export function findFigureMentions(
  pages: readonly { number: number; text: string; items: readonly OutlineTextItem[] }[],
  outline: readonly ReaderOutlineItem[] = outlineFromText(pages.map((page) => page.items)),
): FigureMention[] {
  const targets = new Map<string, FigureTarget>();
  const put = (key: string, page: number, y: number, x?: number, height?: number) => {
    if (!targets.has(key)) targets.set(key, { page, y, ...(x != null ? { x } : {}), ...(height != null ? { height } : {}) });
  };
  for (const page of pages) {
    const right = Math.max(...page.items.map((item) => item.x));
    for (const line of outlineTextLines([page.items])) {
      const caption = /^(Figure|Fig\.|Table|Algorithm)\s+(\d+[a-z]?)\b/i.exec(line.str);
      if (caption) put(`${kindOf(caption[1]!)}:${caption[2]!.toLowerCase()}`, page.number, line.y, line.x, line.fontSize);
    }
    for (const item of page.items) {
      const equation = /^\((\d+[a-z]?)\)$/.exec(item.str.trim());
      if (equation && item.x >= right - 20) put(`equation:${equation[1]}`, page.number, item.y, item.x, item.fontSize);
    }
  }
  const sections = (nodes: readonly ReaderOutlineItem[]) => {
    for (const node of nodes) {
      const number = /^(\d+(?:\.\d+)*)\.?\s/.exec(node.title)?.[1];
      if (number && node.pageNumber != null && node.y != null) put(`section:${number}`, node.pageNumber, node.y);
      if (node.items) sections(node.items);
    }
  };
  sections(outline);
  return pages.flatMap((page) => [...page.text.matchAll(/\b(Fig(?:ure)?s?|Tab(?:le)?s?|Eq(?:uation)?s?|Sec(?:tion)?s?|Alg(?:orithm)?s?)\.?\s*\(?(\d+(?:\.\d+)*[a-z]?)\)?/gi)].flatMap((match): FigureMention[] => {
    const kind = kindOf(match[1]!);
    const target = targets.get(`${kind}:${match[2]!.toLowerCase()}`);
    if (!target) return [];
    // The caption itself — "Figure 2: ..." at the head of a line — is the
    // target, not a link to it.
    const atLineStart = match.index === 0 || page.text[match.index! - 1] === "\n";
    if (atLineStart && /^[:.]/.test(page.text.slice(match.index! + match[0].length))) return [];
    return [{ page: page.number, start: match.index!, end: match.index! + match[0].length, kind, target }];
  }));
}

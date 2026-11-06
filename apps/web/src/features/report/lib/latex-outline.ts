/** One heading in a LaTeX file: its depth (part 0 … paragraph 5), text and 1-based line. */
export type OutlineItem = { level: number; title: string; line: number };
export type OutlineNode = OutlineItem & { children: OutlineNode[] };

export const HEADING_LEVELS = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
} as const;

export type HeadingCommand = keyof typeof HEADING_LEVELS;

const HEADING = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/;

/** The line before its first unescaped %. */
export function stripComment(line: string): string {
  const at = line.search(/(?<!\\)%/);
  return at < 0 ? line : line.slice(0, at);
}

/** The text inside the brace group that opens at `open`, or null if it never closes on this line. */
function braced(line: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") i++;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return line.slice(open + 1, i);
  }
  return null;
}

/** Heading text as Overleaf shows it: commands and braces dropped, \% as %. */
const plain = (tex: string) =>
  tex
    .replace(/\\([%&#_$])/g, "$1")
    .replace(/\\[a-zA-Z]+\*?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** A line's heading command and title, or null when it is not a heading. */
export function parseHeading(line: string): { command: HeadingCommand; title: string } | null {
  const code = stripComment(line);
  const match = HEADING.exec(code);
  if (!match) return null;
  const inner = braced(code, match[0].length - 1);
  if (inner === null) return null;
  return { command: match[1] as HeadingCommand, title: inner };
}

/** The file outline, as Overleaf's: every heading outside a comment, in order. */
export function latexOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  text.split("\n").forEach((line, index) => {
    const heading = parseHeading(line);
    if (heading) items.push({ level: HEADING_LEVELS[heading.command], title: plain(heading.title), line: index + 1 });
  });
  return items;
}

/** Nests each heading under the nearest one above it with a lower level. */
export function nestOutline(items: readonly OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const item of items) {
    const node: OutlineNode = { ...item, children: [] };
    while (stack.length && stack[stack.length - 1]!.level >= node.level) stack.pop();
    (stack.length ? stack[stack.length - 1]!.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** The heading a 1-based line sits under, or null above the first heading. */
export function sectionAt(items: readonly OutlineItem[], line: number): OutlineItem | null {
  let found: OutlineItem | null = null;
  for (const item of items) {
    if (item.line > line) break;
    found = item;
  }
  return found;
}

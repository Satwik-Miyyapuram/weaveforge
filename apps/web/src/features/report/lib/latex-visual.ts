/**
 * What Overleaf's Visual Editor renders in a LaTeX source: headings, bold and
 * italic text, list items and inline math. Each span says which characters to
 * hide; the editor draws the rest. A span the cursor touches is left out, so
 * its source shows while it is being edited.
 */
export type VisualSpan =
  | { kind: "heading"; level: number; from: number; to: number; hide: [number, number][] }
  | { kind: "bold" | "italic"; from: number; to: number; hide: [number, number][] }
  | { kind: "item"; from: number; to: number }
  | { kind: "math"; from: number; to: number; tex: string };

type Range = { from: number; to: number };

const HEADINGS: Record<string, number> = { section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
const INLINE: Record<string, "bold" | "italic"> = { textbf: "bold", textit: "italic", emph: "italic" };

/** The index just past the brace that closes the one at `open`, or -1. */
function closeBrace(line: string, open: number): number {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "{") depth++;
    else if (line[i] === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** The line up to its comment, if any. */
function codeOf(line: string): string {
  const m = /(?<!\\)%/.exec(line);
  return m ? line.slice(0, m.index) : line;
}

function spansOfLine(line: string, at: number): VisualSpan[] {
  const out: VisualSpan[] = [];
  const heading = /^\s*\\(section|subsection|subsubsection|paragraph)\*?\{/.exec(line);
  if (heading) {
    const start = heading[0].indexOf("\\");
    const end = closeBrace(line, heading[0].length - 1);
    if (end > 0) out.push({ kind: "heading", level: HEADINGS[heading[1]!]!, from: at + start, to: at + end, hide: [[at + start, at + heading[0].length], [at + end - 1, at + end]] });
  }
  for (const m of line.matchAll(/\\(textbf|textit|emph)\{/g)) {
    const open = m.index + m[0].length - 1;
    const end = closeBrace(line, open);
    if (end > 0) out.push({ kind: INLINE[m[1]!]!, from: at + m.index, to: at + end, hide: [[at + m.index, at + open + 1], [at + end - 1, at + end]] });
  }
  for (const m of line.matchAll(/\\item(?![a-zA-Z])/g)) out.push({ kind: "item", from: at + m.index, to: at + m.index + m[0].length });
  for (const m of line.matchAll(/(?<![\\$])\$(?!\$)((?:\\.|[^$\\])+)\$(?!\$)/g)) {
    out.push({ kind: "math", from: at + m.index, to: at + m.index + m[0].length, tex: m[1]! });
  }
  return out;
}

export function latexVisualSpans(text: string, cursors: readonly Range[]): VisualSpan[] {
  const out: VisualSpan[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    out.push(...spansOfLine(codeOf(line), at));
    at += line.length + 1;
  }
  const touched = (s: VisualSpan) => cursors.some((c) => c.from <= s.to && c.to >= s.from);
  return out.filter((s) => !touched(s)).sort((a, b) => a.from - b.from);
}

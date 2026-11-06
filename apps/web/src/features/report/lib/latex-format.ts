import { parseHeading, type HeadingCommand } from "./latex-outline";

/** One replacement and the selection after it, in the new document's positions. */
export type LatexEdit = { from: number; to: number; insert: string; anchor: number; head: number };

export type TextStyle = "normal" | Exclude<HeadingCommand, "part" | "chapter">;
export type LatexFormat = "bold" | "italic" | "math" | "displayMath" | "link" | "itemize" | "enumerate" | "comment" | TextStyle;

/** Wraps the selection in before…after and keeps the wrapped text selected. */
function wrap(from: number, to: number, selected: string, before: string, after: string): LatexEdit {
  const start = from + before.length;
  return { from, to, insert: before + selected + after, anchor: start, head: start + selected.length };
}

const lineStart = (doc: string, pos: number) => doc.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (doc: string, pos: number) => {
  const at = doc.indexOf("\n", pos);
  return at < 0 ? doc.length : at;
};

/** The heading style of one line, for the toolbar's text style menu. */
export function headingOf(line: string): TextStyle | "other" {
  const heading = parseHeading(line);
  if (!heading) return "normal";
  return heading.command === "part" || heading.command === "chapter" ? "other" : heading.command;
}

/** Toggles a % at the start of every line the selection touches. */
function toggleComment(doc: string, from: number, to: number): LatexEdit {
  const start = lineStart(doc, from);
  const end = lineEnd(doc, Math.max(from, to - (to > from && doc[to - 1] === "\n" ? 1 : 0)));
  const lines = doc.slice(start, end).split("\n");
  const commented = lines.filter((l) => l.trim()).every((l) => /^\s*%/.test(l));
  const insert = lines
    .map((l) => (!l.trim() ? l : commented ? l.replace(/^(\s*)% ?/, "$1") : l.replace(/^(\s*)/, "$1% ")))
    .join("\n");
  return { from: start, to: end, insert, anchor: start, head: start + insert.length };
}

/** Sets the cursor line's heading style, keeping its text. */
function setHeading(doc: string, pos: number, style: TextStyle): LatexEdit {
  const start = lineStart(doc, pos);
  const end = lineEnd(doc, pos);
  const line = doc.slice(start, end);
  const text = parseHeading(line)?.title ?? line.trim();
  const insert = style === "normal" ? text : `\\${style}{${text}}`;
  const cursor = start + insert.length - (style === "normal" ? 0 : 1);
  return { from: start, to: end, insert, anchor: cursor, head: cursor };
}

/** The edit one toolbar button makes on `doc` with the selection from…to. */
export function latexFormat(kind: LatexFormat, doc: string, from: number, to: number): LatexEdit {
  const selected = doc.slice(from, to);
  switch (kind) {
    case "bold":
      return wrap(from, to, selected, "\\textbf{", "}");
    case "italic":
      return wrap(from, to, selected, "\\textit{", "}");
    case "math":
      return wrap(from, to, selected, "$", "$");
    case "displayMath":
      return wrap(from, to, selected, "\\[\n  ", "\n\\]");
    case "itemize":
    case "enumerate":
      return wrap(from, to, selected, `\\begin{${kind}}\n  \\item `, `\n\\end{${kind}}`);
    case "link": {
      const cursor = from + "\\href{".length;
      return { from, to, insert: `\\href{}{${selected}}`, anchor: cursor, head: cursor };
    }
    case "comment":
      return toggleComment(doc, from, to);
    default:
      return setHeading(doc, from, kind);
  }
}

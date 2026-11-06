import { HEADING_LEVELS, parseHeading, stripComment } from "./latex-outline";

const BEGIN = /\\begin\{([^}]+)\}/;
const END_DOCUMENT = /^\s*\\end\{document\}/;

/**
 * Where a fold that starts on line `index` (0-based) ends, as Overleaf folds
 * LaTeX: a heading folds up to the next heading of the same or a higher level
 * (or \end{document}); \begin{x} folds to its matching \end{x}. Null when the
 * line does not fold or the fold would be empty.
 */
export function latexFoldEnd(lineAt: (index: number) => string, count: number, index: number): number | null {
  const first = lineAt(index);
  const heading = parseHeading(first);
  if (heading) {
    const level = HEADING_LEVELS[heading.command];
    let end = count - 1;
    for (let i = index + 1; i < count; i++) {
      const line = lineAt(i);
      const next = parseHeading(line);
      if ((next && HEADING_LEVELS[next.command] <= level) || END_DOCUMENT.test(line)) {
        end = i - 1;
        break;
      }
    }
    return end > index ? end : null;
  }
  const begin = BEGIN.exec(stripComment(first));
  if (!begin) return null;
  const name = begin[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`\\\\(begin|end)\\{${name}\\}`, "g");
  let depth = 0;
  for (let i = index; i < count; i++) {
    for (const match of stripComment(lineAt(i)).matchAll(tag)) {
      depth += match[1] === "begin" ? 1 : -1;
      if (depth === 0) return i - 1 > index ? i - 1 : null;
    }
  }
  return null;
}

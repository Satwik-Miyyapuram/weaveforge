import type { LatexSectionNode } from "@weaveforge/core";

export type SourceFile = { path: string; content: string };

/**
 * The LaTeX text that belongs to a section itself — from just after its heading
 * up to its first child (or its end if it has none). Children render their own
 * bodies, so slicing here to the first child keeps each block non-overlapping.
 */
export function sectionBody(node: LatexSectionNode, files: readonly SourceFile[]): string {
  const file = files.find((f) => f.path === node.file);
  return file ? bodyOf(node, fileLines(file)) : "";
}

/**
 * Words per section id, each including its subsections — the length a writer
 * tracks. One pass over the tree; each file is split into lines once.
 */
export function sectionWordCounts(roots: readonly LatexSectionNode[], files: readonly SourceFile[]): Map<string, number> {
  const linesByPath = new Map(files.map((f) => [f.path, fileLines(f)] as const));
  const counts = new Map<string, number>();
  const visit = (node: LatexSectionNode): number => {
    const lines = linesByPath.get(node.file);
    const own = lines ? proseWords(bodyOf(node, lines)) : 0;
    const total = node.children.reduce((sum, child) => sum + visit(child), own);
    counts.set(node.id, total);
    return total;
  };
  roots.forEach(visit);
  return counts;
}

function fileLines(file: SourceFile): string[] {
  return file.content.replace(/\r\n/g, "\n").split("\n");
}

function bodyOf(node: LatexSectionNode, lines: readonly string[]): string {
  const firstChild = node.children[0];
  const end = firstChild ? firstChild.startLine - 1 : node.endLine;
  // startLine is the heading line (1-based); body starts on the next line.
  return lines.slice(node.startLine, end).join("\n").trim();
}

/** Strip comments, commands and math punctuation so a word count reflects prose. */
function proseWords(latex: string): number {
  const text = latex
    .replace(/%.*$/gm, "")
    .replace(/\\[a-zA-Z]+\*?(\s*\[[^\]]*\])?(\s*\{[^}]*\})?/g, " ")
    .replace(/[{}$&~^_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").length : 0;
}

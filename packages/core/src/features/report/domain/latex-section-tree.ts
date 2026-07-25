export interface LatexSourceFile {
  path: string;
  content: string;
}

export interface LatexSectionNode {
  id: string;
  title: string;
  command: string;
  level: number;
  file: string;
  startLine: number;
  endLine: number;
  preview: string;
  children: LatexSectionNode[];
}

export interface LatexSectionTreeResult {
  roots: LatexSectionNode[];
  files: string[];
  warnings: string[];
}

const LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*)?\s*\{([^{}]*)\}/;

function normalizePath(path: string): string | null {
  const withExtension = path.endsWith(".tex") ? path : `${path}.tex`;
  const parts = withExtension.replaceAll("\\", "/").split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!normalized.length) return null;
      normalized.pop();
    } else if (part !== "\\") {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

function resolveInclude(currentFile: string, includePath: string): string | null {
  const base = currentFile.includes("/") ? currentFile.slice(0, currentFile.lastIndexOf("/")) : "";
  return normalizePath(base ? `${base}/${includePath}` : includePath);
}

function cleanTitle(title: string): string {
  return title
    .replace(/%.*$/, "")
    .replace(/\\[a-zA-Z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function previewBody(lines: readonly string[], start: number, end: number): string {
  return lines
    .slice(start, end)
    .join(" ")
    .replace(/%.*$/gm, "")
    .replace(/\\[a-zA-Z]+(?:\s|\[[^]]*\]|\{[^}]*\})*/g, " ")
    .replace(/[{}$]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/**
 * Builds a best-effort, provenance-preserving tree from a LaTeX source graph.
 * It deliberately does not compile or execute TeX; unresolved includes become
 * warnings and dynamic macro-generated headings remain ordinary source text.
 */
export function parseLatexSectionTree(
  sources: readonly LatexSourceFile[],
  entryFile = "main.tex",
): LatexSectionTreeResult {
  const byPath = new Map(sources.map((source) => [normalizePath(source.path), source] as const));
  const roots: LatexSectionNode[] = [];
  const warnings: string[] = [];
  const files: string[] = [];
  const stack: LatexSectionNode[] = [];
  const active = new Set<string>();

  const visit = (filePath: string) => {
    const normalized = normalizePath(filePath);
    if (!normalized) {
      warnings.push(`Unsafe include path ignored: ${filePath}`);
      return;
    }
    if (active.has(normalized)) {
      warnings.push(`Circular include ignored: ${normalized}`);
      return;
    }
    const source = byPath.get(normalized);
    if (!source) {
      warnings.push(`Included file not found: ${normalized}`);
      return;
    }
    active.add(normalized);
    files.push(normalized);
    const lines = source.content.replace(/\r\n/g, "\n").split("\n");
    const localSections: LatexSectionNode[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const section = SECTION_RE.exec(lines[index]!);
      if (section) {
        const command = section[1]!;
        const level = LEVELS[command]!;
        while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
        const node: LatexSectionNode = {
          id: `${normalized}:${index + 1}:${localSections.length + 1}`,
          title: cleanTitle(section[3]!),
          command,
          level,
          file: normalized,
          startLine: index + 1,
          endLine: lines.length,
          preview: "",
          children: [],
        };
        if (stack.length) stack[stack.length - 1]!.children.push(node);
        else roots.push(node);
        localSections.push(node);
        stack.push(node);
      }
      const includeRe = /\\(?:input|include)\s*(?:\{([^}]+)\}|([^\s%]+))/g;
      let include: RegExpExecArray | null;
      while ((include = includeRe.exec(lines[index]!)) !== null) {
        const child = resolveInclude(normalized, include[1] ?? include[2] ?? "");
        if (child) visit(child);
        else warnings.push(`Unsafe include path ignored: ${include[1] ?? include[2] ?? ""}`);
      }
    }
    for (let index = 0; index < localSections.length; index += 1) {
      const node = localSections[index]!;
      const next = localSections[index + 1];
      node.endLine = next ? next.startLine - 1 : lines.length;
      node.preview = previewBody(lines, node.startLine, node.endLine);
    }
    for (let index = localSections.length; index > 0; index -= 1) {
      if (stack[stack.length - 1] === localSections[index - 1]) stack.pop();
    }
    active.delete(normalized);
  };

  visit(entryFile);
  return { roots, files, warnings };
}

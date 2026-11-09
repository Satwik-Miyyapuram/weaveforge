// The parser runs in Rust (wf-core `latex_section_tree`); these are its JS-facing types.

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

export interface LatexSectionTreeFns {
  /**
   * Builds a best-effort, provenance-preserving tree from a LaTeX source graph, starting at
   * `entryFile` (default `main.tex`). It does not compile TeX; unresolved includes become warnings.
   */
  parseLatexSectionTree(
    sources: readonly LatexSourceFile[],
    entryFile?: string,
  ): LatexSectionTreeResult;
}
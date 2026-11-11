/** Types for markdown-to-latex. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

export interface MarkdownToLatexImageRef {
  /** Storage path after `reportimg:`. */
  path: string;
  /** Relative path used in `\includegraphics{...}` (under `figures/`). */
  fileName: string;
}

export interface MarkdownToLatexOptions {
  /**
   * Map of `normalizeTitleKey(paper.title)` → biblatex cite key.
   * When set, matching `[[wikilinks]]` become `\cite{key}`.
   */
  citeByTitle?: ReadonlyMap<string, string>;
}

export interface MarkdownToLatexResult {
  latex: string;
  warnings: string[];
  images: MarkdownToLatexImageRef[];
  /** Bib keys emitted via `\cite{...}` (unique, insertion order). */
  citedKeys: string[];
}


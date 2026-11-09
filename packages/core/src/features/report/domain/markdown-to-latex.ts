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

const VERBATIM_END = "\\end{verbatim}";

const UNSUPPORTED = [
  { re: /\|.+\|[\r\n]+\|[-:| ]+\|/m, label: "markdown table" },
  { re: /<[^>]+>/, label: "raw HTML" },
  { re: /!\[[^\]]*\]\((?!reportimg:)[^)\s]+\)/, label: "non-report image (include assets separately)" },
];

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface MarkdownToLatexFns {
  escapeLatexText(s: string): string;
  /**
 * A figure file name safe in a LaTeX project and unique within `used`: unsafe
 * runs become `_`, and a repeat gets `_2`, `_3`, ... before its extension.
 * The Overleaf export names its zip entries with this too.
 */
  uniqueFigureName(raw: string, used: Set<string>): string;
  /** Convert a limited Markdown subset to LaTeX body (no document wrapper). */
  markdownToLatex(md: string, opts?: MarkdownToLatexOptions): MarkdownToLatexResult;
}

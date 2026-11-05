/**
 * Report Markdown to LaTeX (Rust `report::markdown_to_latex`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/report/domain/markdown-to-latex.ts.
 * Object shapes come from ./bindings.ts.
 */
import {
  escapeLatexText as rawEscapeLatexText,
  markdownToLatex as rawMarkdownToLatex,
} from "../pkg/wf_wasm.js";
import type { MarkdownToLatexResult } from "./bindings.js";

/** Escapes LaTeX special characters in plain text. */
export function escapeLatexText(s: string): string {
  return rawEscapeLatexText(s);
}

/**
 * The report Markdown as a LaTeX body, with warnings, figures and cited keys. `citeByTitle`
 * maps normalized paper titles to bib keys.
 */
export function markdownToLatex(
  md: string,
  opts: { citeByTitle?: ReadonlyMap<string, string> } = {},
): MarkdownToLatexResult {
  const citeByTitle = opts.citeByTitle ? Object.fromEntries(opts.citeByTitle) : undefined;
  return rawMarkdownToLatex(md ?? "", { citeByTitle }) as MarkdownToLatexResult;
}

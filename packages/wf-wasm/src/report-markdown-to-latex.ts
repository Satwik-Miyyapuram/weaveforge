/**
 * Report Markdown to LaTeX (Rust `report::markdown_to_latex`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/report/domain/markdown-to-latex.ts.
 * Object shapes come from ./bindings.ts.
 */
import {
  uniqueFigureNameIn as rawUniqueFigureNameIn,
  markdownToLatex as rawMarkdownToLatex,
} from "../pkg/wf_wasm.js";
import type {
  MarkdownToLatexResult,
} from "./bindings.js";

export {
  escapeLatexText,
} from "../pkg/wf_wasm.js";

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

/** A file-safe figure name not in `used`; the name is added to `used`. */
export function uniqueFigureName(raw: string, used: Set<string>): string {
  const name = rawUniqueFigureNameIn(raw, [...used]);
  used.add(name);
  return name;
}

/** A file-safe figure name not in `used` (Rust `unique_figure_name`); `used` is not changed. */
export function uniqueFigureNameIn(raw: string, used: readonly string[]): string {
  return rawUniqueFigureNameIn(raw, [...used]);
}

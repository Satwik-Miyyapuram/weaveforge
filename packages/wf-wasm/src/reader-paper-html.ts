/**
 * Paper HTML framing (Rust `reader_paper_html`), re-exported from index.ts. Keeps the signatures of
 * the former apps/web/src/features/reader/application/paper-html.ts. The thresholds and the frame CSP
 * are read from Rust through getters, not module-level constants: the wasm module is not initialised
 * when this file is imported, so each getter must be called after loadCore.
 */
import {
  buildPaperHtmlDocument as rawBuildPaperHtmlDocument,
  isSubstantialPaperText as rawIsSubstantialPaperText,
  minArticleTextChars as rawMinArticleTextChars,
  minPaperTextChars as rawMinPaperTextChars,
  paperHtmlCsp as rawPaperHtmlCsp,
  parsePaperHtmlDocument as rawParsePaperHtmlDocument,
} from "../pkg/wf_wasm.js";
import type { PaperHtmlPage } from "./bindings.js";

export type { PaperHtmlPage } from "./bindings.js";

/** How much text a page must carry to count as the paper. */
export function minPaperTextChars(): number {
  return rawMinPaperTextChars();
}

/** The text a paper's own web page must carry to be kept. */
export function minArticleTextChars(): number {
  return rawMinArticleTextChars();
}

/** The frame's own content security policy. */
export function paperHtmlCsp(): string {
  return rawPaperHtmlCsp();
}

/** Whether the text reaches `minChars` once whitespace is collapsed. */
export function isSubstantialPaperText(text: string, minChars: number): boolean {
  return rawIsSubstantialPaperText(text, minChars);
}

/** The framed, self-contained document for one kept paper. */
export function buildPaperHtmlDocument(
  page: PaperHtmlPage,
  options: { scheme?: "light" | "dark"; print?: boolean } = {},
): string {
  return rawBuildPaperHtmlDocument(page, options);
}

/** The paper a kept file holds, or null for a file this app did not write. */
export function parsePaperHtmlDocument(paperId: string, text: string): PaperHtmlPage | null {
  return rawParsePaperHtmlDocument(paperId, text) as PaperHtmlPage | null;
}

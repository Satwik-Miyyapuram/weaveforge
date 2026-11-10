/**
 * Paper HTML framing (Rust `reader_paper_html`), re-exported from index.ts. Keeps the signatures of
 * the former apps/web/src/features/reader/application/paper-html.ts. The thresholds and the frame CSP
 * are read from Rust through getters, not module-level constants: the wasm module is not initialised
 * when this file is imported, so each getter must be called after loadCore.
 */
import {
  buildPaperHtmlDocument as rawBuildPaperHtmlDocument,
} from "../pkg/wf_wasm.js";
import type {
  PaperHtmlPage,
} from "./bindings.js";

export {
  isSubstantialPaperText,
  minArticleTextChars,
  minPaperTextChars,
  paperHtmlCsp,
  parsePaperHtmlDocument,
} from "../pkg/wf_wasm.js";

export type { PaperHtmlPage } from "./bindings.js";

/** The framed, self-contained document for one kept paper. */
export function buildPaperHtmlDocument(
  page: PaperHtmlPage,
  options: { scheme?: "light" | "dark"; print?: boolean } = {},
): string {
  return rawBuildPaperHtmlDocument(page, options);
}


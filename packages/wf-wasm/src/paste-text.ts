/**
 * Paste and text clean-up (Rust `paste`), re-exported from index.ts.
 */
import {
  normalizePasteSettings as rawNormalizePasteSettings,
  pasteLandsInVerbatimContext as rawPasteLandsInVerbatimContext,
} from "../pkg/wf_wasm.js";
import type {
  PasteSettings,
} from "./bindings.js";

export {
  applyCommaPlacement,
  cleanPastedText,
  cleanPdfText,
  cleanUrlsWithRules,
  cleanWrappedText,
  escapeLinkLabel,
  isBareUrl,
  linkLabel,
  markdownLink,
  parseLinkRemovalText,
  tabSeparatedToMarkdownTable,
} from "../pkg/wf_wasm.js";

export {
  defaultPasteSettings,
} from "../pkg/wf_wasm.js";

/** Whether a paste at UTF-16 `offset` lands in code or frontmatter (Rust `paste_lands_in_verbatim_context`). */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean {
  return rawPasteLandsInVerbatimContext(document, Math.max(0, Math.floor(offset)));
}

/** Settings the pipeline can trust from whatever was stored (Rust `normalize_paste_settings`). */
export function normalizePasteSettings(raw: unknown): PasteSettings {
  const json = JSON.stringify(raw) ?? "null";
  return rawNormalizePasteSettings(json) as PasteSettings;
}

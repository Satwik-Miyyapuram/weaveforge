/**
 * Paste and text clean-up (Rust `paste`), re-exported from index.ts.
 */
import {
  applyCommaPlacement as rawApplyCommaPlacement,
  cleanPastedText as rawCleanPastedText,
  cleanPdfText as rawCleanPdfText,
  cleanUrlsWithRules as rawCleanUrlsWithRules,
  cleanWrappedText as rawCleanWrappedText,
  defaultPasteSettings as rawDefaultPasteSettings,
  escapeLinkLabel as rawEscapeLinkLabel,
  isBareUrl as rawIsBareUrl,
  linkLabel as rawLinkLabel,
  markdownLink as rawMarkdownLink,
  normalizePasteSettings as rawNormalizePasteSettings,
  parseLinkRemovalText as rawParseLinkRemovalText,
  pasteLandsInVerbatimContext as rawPasteLandsInVerbatimContext,
  tabSeparatedToMarkdownTable as rawTabSeparatedToMarkdownTable,
} from "../pkg/wf_wasm.js";
import type {
  CleanPasteResult,
  CommaPlacement,
  PasteSettings,
  PdfTextOptions,
  TextResult,
  UrlCleanupResult,
  WrappedTextOptions,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

/** The automatic paste rules over `input` (Rust `clean_pasted_text`). */
export function cleanPastedText(input: string, settings: PasteSettings): CleanPasteResult {
  checkIndexText(input);
  return rawCleanPastedText(input, settings) as CleanPasteResult;
}

/** Whether a paste at UTF-16 `offset` lands in code or frontmatter (Rust `paste_lands_in_verbatim_context`). */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean {
  checkIndexText(document);
  return rawPasteLandsInVerbatimContext(document, Math.max(0, Math.floor(offset)));
}

/** Rejoins wrapped terminal or PDF lines (Rust `clean_wrapped_text`). */
export function cleanWrappedText(input: string, options: WrappedTextOptions): TextResult {
  checkIndexText(input);
  return rawCleanWrappedText(input, options) as TextResult;
}

/** Repairs text copied out of a PDF (Rust `clean_pdf_text`). */
export function cleanPdfText(input: string, options: PdfTextOptions): TextResult {
  checkIndexText(input);
  return rawCleanPdfText(input, options) as TextResult;
}

/** Moves commas to the chosen side of a closing quote (Rust `apply_comma_placement`). */
export function applyCommaPlacement(input: string, placement: CommaPlacement): TextResult {
  checkIndexText(input);
  return rawApplyCommaPlacement(input, placement) as TextResult;
}

/** A tab-separated text as a Markdown table, or unchanged (Rust `tab_separated_to_markdown_table`). */
export function tabSeparatedToMarkdownTable(input: string): TextResult {
  checkIndexText(input);
  return rawTabSeparatedToMarkdownTable(input) as TextResult;
}

/** The URLs in `text` cleaned by the built-in rules plus `rules` (Rust `clean_urls_in_text`). */
export function cleanUrlsWithRules(text: string, rules: readonly string[]): UrlCleanupResult {
  checkIndexText(text);
  return rawCleanUrlsWithRules(text, rules) as UrlCleanupResult;
}

/** The default paste settings (Rust `PasteSettings::default`). */
export function defaultPasteSettings(): PasteSettings {
  return rawDefaultPasteSettings() as PasteSettings;
}

/** Settings the pipeline can trust from whatever was stored (Rust `normalize_paste_settings`). */
export function normalizePasteSettings(raw: unknown): PasteSettings {
  const json = JSON.stringify(raw) ?? "null";
  checkIndexText(json);
  return rawNormalizePasteSettings(json) as PasteSettings;
}

/** The link removal rules in a textarea, one per line (Rust `parse_link_removal_text`). */
export function parseLinkRemovalText(text: string): string[] {
  checkIndexText(text);
  return rawParseLinkRemovalText(text) as string[];
}

/** Whether `text` is one http(s) address and nothing else (Rust `is_bare_url`). */
export function isBareUrl(text: string): boolean {
  checkIndexText(text);
  return rawIsBareUrl(text);
}

/** Escapes `\`, `[` and `]` for a Markdown link label (Rust `escape_link_label`). */
export function escapeLinkLabel(label: string): string {
  checkIndexText(label);
  return rawEscapeLinkLabel(label);
}

/** `[label](url)` with the label folded to one line, escaped and trimmed (Rust `markdown_link`). */
export function markdownLink(label: string, url: string): string {
  checkIndexText(label);
  checkIndexText(url);
  return rawMarkdownLink(label, url);
}

/** The escaped label for a single-line selection, or `null` when it cannot be a label (Rust `link_label`). */
export function linkLabel(selected: string): string | null {
  checkIndexText(selected);
  return rawLinkLabel(selected) ?? null;
}

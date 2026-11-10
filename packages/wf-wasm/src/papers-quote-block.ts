/**
 * Quotation blocks for note markdown (Rust `papers::quote_block`), re-exported
 * from index.ts.
 */
import {
  formatQuoteBlock as rawFormatQuoteBlock,
  formatQuoteCiteClipboard as rawFormatQuoteCiteClipboard,
} from "../pkg/wf_wasm.js";

/** A highlight's text repaired from the PDF text layer, as `> ` lines. */
export function formatQuoteBlock(quote: string): string {
  return rawFormatQuoteBlock(quote);
}

/** The quote block, then a `[[paper title]]` wikilink line, for the clipboard. */
export function formatQuoteCiteClipboard(quote: string, paperTitle: string): string {
  return rawFormatQuoteCiteClipboard(quote, paperTitle);
}

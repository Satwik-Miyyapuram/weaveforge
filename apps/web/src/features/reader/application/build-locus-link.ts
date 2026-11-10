import type { PdfLocus } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

/**
 * Build a same-origin deep link into the read-only reader at a specific locus.
 * Thin shim: the rule (PDF allowlist, inline locus, page hint) lives in Rust
 * (`reader::build_locus_link`), reached through wasm.
 */
export function buildLocusLink(input: {
  paperId?: string;
  /** Direct PDF URL to render, when known (e.g. open-access / arXiv). */
  pdfUrl?: string;
  locus?: PdfLocus;
  /** 0-based page hint. */
  page?: number;
}): string {
  return readyCore().buildLocusLink(input);
}

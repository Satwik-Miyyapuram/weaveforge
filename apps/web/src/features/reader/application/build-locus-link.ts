import { encodeLocus, type PdfLocus } from "@thesis/core";
import { sanitizePdfUrl } from "./sanitize-reader-url";

/**
 * Build a same-origin deep link into the read-only reader at a specific locus.
 * The locus is encoded inline (see core `encodeLocus`) so the link is
 * self-contained and needs no stored anchor row to resolve.
 * PDF URLs are allowlisted (http/s only) before being put in the query string.
 */
export function buildLocusLink(input: {
  paperId?: string;
  /** Direct PDF URL to render, when known (e.g. open-access / arXiv). */
  pdfUrl?: string;
  locus?: PdfLocus;
  /** 0-based page hint. */
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (input.paperId) params.set("paper", input.paperId);
  const safePdf = sanitizePdfUrl(input.pdfUrl);
  if (safePdf) params.set("pdf", safePdf);
  if (input.locus) params.set("locus", encodeLocus(input.locus));
  if (typeof input.page === "number" && Number.isInteger(input.page) && input.page >= 0) {
    params.set("page", String(input.page));
  }
  const query = params.toString();
  return query ? `/reader?${query}` : "/reader";
}

/** True when a link has enough to render something in the reader. */
export function locusLinkIsResolvable(input: { paperId?: string; pdfUrl?: string }): boolean {
  return Boolean(input.paperId || sanitizePdfUrl(input.pdfUrl));
}

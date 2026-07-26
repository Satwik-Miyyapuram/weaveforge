import { encodeLocus, type PdfLocus } from "@thesis/core";

/**
 * Build a same-origin deep link into the read-only reader at a specific locus.
 * The locus is encoded inline (see core `encodeLocus`) so the link is
 * self-contained and needs no stored anchor row to resolve.
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
  if (input.pdfUrl) params.set("pdf", input.pdfUrl);
  if (input.locus) params.set("locus", encodeLocus(input.locus));
  if (typeof input.page === "number" && Number.isInteger(input.page) && input.page >= 0) {
    params.set("page", String(input.page));
  }
  const query = params.toString();
  return query ? `/reader?${query}` : "/reader";
}

/** True when a link has enough to render something in the reader. */
export function locusLinkIsResolvable(input: { paperId?: string; pdfUrl?: string }): boolean {
  return Boolean(input.paperId || input.pdfUrl);
}

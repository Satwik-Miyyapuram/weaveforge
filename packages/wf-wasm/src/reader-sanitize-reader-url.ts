/**
 * Reader URL allowlists (Rust `reader_sanitize_reader_url`). Keeps the pure rules of
 * apps/web/src/features/reader/application/sanitize-reader-url.ts.
 */
import {
  resolvePaperPdfUrl as rawResolvePaperPdfUrl,
} from "../pkg/wf_wasm.js";

export {
  isAllowedPdfProxyUrl,
  looksLikePdfUrl,
  sanitizeAppHref,
  sanitizePdfUrl,
  sanitizeReaderHref,
} from "../pkg/wf_wasm.js";

/** The paper fields a PDF URL is derived from. `pdfPath` is ignored and not passed. */
export interface PaperPdfSource {
  url?: string | null;
  arxivId?: string | null;
  openAccessPdf?: string | null;
}

/** Best-effort map from a paper's links and arXiv id to a PDF URL the reader can open. */
export function resolvePaperPdfUrl(source: PaperPdfSource): string | null {
  return rawResolvePaperPdfUrl({
    url: source.url ?? null,
    arxivId: source.arxivId ?? null,
    openAccessPdf: source.openAccessPdf ?? null,
  }) ?? null;
}

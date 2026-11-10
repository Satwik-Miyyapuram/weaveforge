/**
 * Reader URL allowlists (Rust `reader_sanitize_reader_url`). Keeps the pure rules of
 * apps/web/src/features/reader/application/sanitize-reader-url.ts.
 */
import {
  isAllowedPdfProxyUrl as rawIsAllowedPdfProxyUrl,
  looksLikePdfUrl as rawLooksLikePdfUrl,
  resolvePaperPdfUrl as rawResolvePaperPdfUrl,
  sanitizeAppHref as rawSanitizeAppHref,
  sanitizePdfUrl as rawSanitizePdfUrl,
  sanitizeReaderHref as rawSanitizeReaderHref,
} from "../pkg/wf_wasm.js";

/** The paper fields a PDF URL is derived from. `pdfPath` is ignored and not passed. */
export interface PaperPdfSource {
  url?: string | null;
  arxivId?: string | null;
  openAccessPdf?: string | null;
}

/** True when `raw` is an https URL on the PDF proxy's host allowlist, with no credentials. */
export function isAllowedPdfProxyUrl(raw: string): boolean {
  return rawIsAllowedPdfProxyUrl(raw);
}

/** Accept only https PDF URLs for pdf.js and "open original" links. */
export function sanitizePdfUrl(raw: string | null | undefined): string | null {
  return rawSanitizePdfUrl(raw ?? undefined) ?? null;
}

/** Only same-origin `/reader` paths may be used as evidence deep links. */
export function sanitizeReaderHref(raw: string | null | undefined): string | null {
  return rawSanitizeReaderHref(raw ?? undefined) ?? null;
}

/** Same-origin app paths safe to render as evidence "Open source" links. */
export function sanitizeAppHref(raw: string | null | undefined): string | null {
  return rawSanitizeAppHref(raw ?? undefined) ?? null;
}

/** True when a URL's path looks like a direct PDF resource, not an HTML landing page. */
export function looksLikePdfUrl(url: string): boolean {
  return rawLooksLikePdfUrl(url);
}

/** Best-effort map from a paper's links and arXiv id to a PDF URL the reader can open. */
export function resolvePaperPdfUrl(source: PaperPdfSource): string | null {
  return rawResolvePaperPdfUrl({
    url: source.url ?? null,
    arxivId: source.arxivId ?? null,
    openAccessPdf: source.openAccessPdf ?? null,
  }) ?? null;
}

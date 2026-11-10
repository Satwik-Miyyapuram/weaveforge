/**
 * URL allowlists for the read-only reader. Query params and AI evidence hrefs
 * are untrusted — never put them in `<a href>` or pdf.js without checking.
 *
 * The rules (host list, https-only, same-origin paths, PDF-looking paths, paper
 * PDF resolution) live in wf-core (`reader::sanitize_reader_url`). This module
 * keeps the browser parts: `location` and the relay path.
 */

import { relayPath, relayUrl } from "@/lib/relay-url";
import { readyCore } from "@/lib/rust-core";

/** Hard stream cap for proxied PDFs (also enforced when Content-Length is absent). */
export const PDF_PROXY_MAX_BYTES = 80 * 1024 * 1024; // 80 MiB

/** True when `raw` is an https URL on the PDF proxy's host allowlist with no credentials. */
export function isAllowedPdfProxyUrl(raw: string): boolean {
  return readyCore().isAllowedPdfProxyUrl(raw);
}

/** Accept only https PDF URLs for pdf.js / "open original" links. */
export function sanitizePdfUrl(raw: string | null | undefined): string | null {
  return readyCore().sanitizePdfUrl(raw);
}

/**
 * True for an object URL this page minted (`blob:<origin>/<uuid>`).
 *
 * The reader's source ladder caches PDF bytes in IndexedDB and materialises
 * them through `URL.createObjectURL`, so the second open of any paper hands
 * pdf.js a `blob:` URL rather than an https one. Those are same-origin handles
 * to bytes already in this tab — there is no network fetch and no host to
 * allowlist — but they are not `https:`, so the plain PDF-URL check rejected
 * them and the reader refused to open a paper it had itself cached.
 *
 * Deliberately narrower than "starts with blob:": a blob URL carries the origin
 * that created it, and only our own is accepted.
 */
export function isReaderObjectUrl(raw: string | null | undefined): boolean {
  if (!raw || !raw.startsWith("blob:")) return false;
  if (typeof location === "undefined") return false;
  try {
    return new URL(raw.slice("blob:".length)).origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * Only same-origin `/reader…` paths may be used as evidence deep links into the
 * PDF reader. Rebuild via {@link buildLocusLink} when the stored href is untrusted.
 */
export function sanitizeReaderHref(raw: string | null | undefined): string | null {
  return readyCore().sanitizeReaderHref(raw);
}

/**
 * Same-origin app paths safe to render as evidence "Open source" links
 * (`/papers`, `/notes`, `/reader`, …). Rejects scheme smuggling and unknown roots.
 */
export function sanitizeAppHref(raw: string | null | undefined): string | null {
  return readyCore().sanitizeAppHref(raw);
}

/** True when a URL pathname looks like a direct PDF resource, not an HTML landing page. */
export function looksLikePdfUrl(url: string): boolean {
  return readyCore().looksLikePdfUrl(url);
}

/**
 * Rewrite an allowlisted remote PDF URL through the same-origin proxy so pdf.js
 * does not hit CORS. Unknown hosts are returned unchanged (caller may still fail).
 */
export function proxiedPdfUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!isAllowedPdfProxyUrl(u.toString())) return url;
    return relayUrl(`/api/pdf-proxy?url=${encodeURIComponent(u.toString())}`);
  } catch {
    return url;
  }
}

/** Recover the original https PDF URL from a same-origin proxy path, if present. */
export function originalUrlFromProxy(url: string): string | null {
  if (!relayPath(url).startsWith("/api/pdf-proxy?")) return null;
  try {
    const target = new URL(url, "https://local.invalid").searchParams.get("url");
    return sanitizePdfUrl(target);
  } catch {
    return null;
  }
}

/**
 * Best-effort map from a paper landing URL / arXiv id to a PDF URL the reader
 * can open. Returns null when we cannot derive a PDF (caller surfaces an error).
 */
export function resolvePaperPdfUrl(input: {
  url?: string | null;
  arxivId?: string | null;
  /** @deprecated Ignored until storage-backed PDFs are wired; kept for call-site stability. */
  pdfPath?: string | null;
  /**
   * The open-access copy a metadata source reported (Semantic Scholar's
   * `openAccessPdf`). A paper added from a reference list often has only a
   * DOI and a landing page; this is the one direct PDF link it carries.
   */
  openAccessPdf?: string | null;
}): string | null {
  return readyCore().resolvePaperPdfUrl(input);
}

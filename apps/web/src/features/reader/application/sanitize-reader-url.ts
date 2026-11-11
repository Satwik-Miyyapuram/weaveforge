/**
 * URL allowlists for the read-only reader. Query params and AI evidence hrefs
 * are untrusted — never put them in `<a href>` or pdf.js without checking.
 *
 * The rules (host list, https-only, same-origin paths, PDF-looking paths, paper
 * PDF resolution) live in wf-core (`reader::sanitize_reader_url`); callers use
 * `readyCore().sanitizePdfUrl`, `isAllowedPdfProxyUrl`, `sanitizeReaderHref`,
 * `sanitizeAppHref`, `looksLikePdfUrl` and `resolvePaperPdfUrl` directly. This
 * module keeps the browser parts: `location` and the relay path.
 */

import { relayPath, relayUrl } from "@/lib/parts";
import { readyCore } from "@/lib/rust-core";

/** Hard stream cap for proxied PDFs (also enforced when Content-Length is absent). */
export const PDF_PROXY_MAX_BYTES = 80 * 1024 * 1024; // 80 MiB

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
 * Rewrite an allowlisted remote PDF URL through the same-origin proxy so pdf.js
 * does not hit CORS. Unknown hosts are returned unchanged (caller may still fail).
 */
export function proxiedPdfUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!readyCore().isAllowedPdfProxyUrl(u.toString())) return url;
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
    return readyCore().sanitizePdfUrl(target);
  } catch {
    return null;
  }
}

/**
 * Resolve a PDF via the ladder and materialise `cache://` hits into blob URLs
 * pdf.js can open. Also seeds the cache when a network URL wins.
 */

import type { IPdfByteCache, PdfSourceResolution } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { IndexedDbPdfByteCache } from "../infrastructure/indexeddb-pdf-byte-cache";
import {
  RoutedPdfByteCache,
  WorkspacePdfStore,
} from "../infrastructure/workspace-pdf-store";
import { resolvePaperPdfSource, paperToPdfSourcePaper } from "./resolve-paper-pdf-source";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { pdfProxyNeedsToken } from "./pdf-download-consent";
import { isAllowedPdfProxyUrl, proxiedPdfUrl } from "./sanitize-reader-url";

const CACHE_CAP = 64;
let sharedCache: IPdfByteCache | null = null;

/**
 * Where a paper's bytes are kept between opens. With a workspace folder open
 * — the desktop build, once set up — that is the folder itself, `papers/pdf/`,
 * so the PDF is fetched once and read from disk after, offline included. In a
 * browser it is IndexedDB, a bounded cache, and the network when that is
 * cold: the web build fetches online, the desktop build does not have to.
 */
export function getReaderPdfByteCache(): IPdfByteCache | undefined {
  const hasBrowser = typeof indexedDB !== "undefined";
  if (!hasBrowser && !activeWorkspaceFs()) return undefined;
  if (!sharedCache) {
    const browser = hasBrowser ? new IndexedDbPdfByteCache(CACHE_CAP) : null;
    const folder = new WorkspacePdfStore(activeWorkspaceFs);
    sharedCache = new RoutedPdfByteCache(() =>
      activeWorkspaceFs() ? folder : (browser ?? folder),
    );
  }
  return sharedCache;
}

export function isCachePdfUrl(url: string): boolean {
  return url.startsWith("cache://");
}

/** A URL the reader answers from this app's own store, with no network hop. */
export function isStoredPdfUrl(url: string): boolean {
  return url.startsWith("blob:") || isCachePdfUrl(url);
}

/**
 * The bytes behind a `cache://` URL, for pdf.js to take as `data`.
 *
 * The bundled app cannot go through a blob URL: on its `app://` origin a
 * `blob:` fetch fails with status 0, from the page and from pdf.js alike, so
 * the reader is handed the URL unmaterialised and asks here instead.
 */
export async function readStoredPdfBytes(url: string): Promise<ArrayBuffer | null> {
  const cache = getReaderPdfByteCache();
  if (!cache || !isCachePdfUrl(url)) return null;
  const bytes = await cache.get(decodeURIComponent(url.slice("cache://".length)));
  return bytes && bytes.byteLength > 0 ? bytes : null;
}

async function materializeCachePdfUrl(
  url: string,
  cache: IPdfByteCache,
): Promise<string | null> {
  if (!isCachePdfUrl(url)) return url;
  const key = decodeURIComponent(url.slice("cache://".length));
  const bytes = await cache.get(key);
  if (!bytes || bytes.byteLength === 0) return null;
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

/**
 * Drop a paper's cached bytes.
 *
 * Used when the cached copy fails to open: a truncated or evicted entry would
 * otherwise be re-served on every future visit, so the reader would stay broken
 * for that paper until storage was cleared by hand.
 */
export async function evictReaderPdfCache(paperId: string): Promise<void> {
  const cache = getReaderPdfByteCache();
  if (!cache) return;
  try {
    await cache.remove(paperId);
  } catch {
    // Best-effort: the fallback fetch matters, the eviction is housekeeping.
  }
}

/**
 * Resolve + materialise; populate cache when a remote URL wins.
 *
 * `skipCache` bypasses the cache tier entirely, so the ladder resolves to a
 * network URL. That is the retry path when a cached blob will not open.
 */
export async function resolvePaperPdfSourceForReader(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
  options: { skipCache?: boolean } = {},
): Promise<PdfSourceResolution & { revokeUrl?: string }> {
  const cache = options.skipCache ? undefined : getReaderPdfByteCache();
  const resolution = await resolvePaperPdfSource(paper, cache);
  if (!resolution.ok) return resolution;

  // The desktop shell's origin cannot fetch a blob URL; its reader takes the
  // `cache://` URL as it is and reads the bytes itself (`readStoredPdfBytes`).
  if (isCachePdfUrl(resolution.hit.url) && cache && desktop()) return resolution;

  if (isCachePdfUrl(resolution.hit.url) && cache) {
    const blobUrl = await materializeCachePdfUrl(resolution.hit.url, cache);
    if (!blobUrl) return { ok: false, reason: "no_source" };
    return {
      ok: true,
      hit: { url: blobUrl, contentHash: resolution.hit.contentHash },
      resolverId: resolution.resolverId,
      revokeUrl: blobUrl,
    };
  }

  // Best-effort: seed cache from a successful remote resolve. Not from the
  // no-account copy, which asks first and then fetches on purpose — see
  // `downloadPaperPdfToCache`.
  const remote =
    /^https?:\/\//i.test(resolution.hit.url) || resolution.hit.url.startsWith("/");
  if (cache && paper.id && remote && !isLocalMode()) {
    void seedCacheFromUrl(cache, paper.id, resolution.hit.url);
  }

  return resolution;
}

/**
 * Rewrite a cross-origin PDF URL through the same-origin proxy before fetching
 * it. Fetching the publisher directly is blocked by CORS on every allowlisted
 * host, so the seed silently failed for arXiv and OpenReview — which is every
 * source the ladder can actually resolve — leaving the cache permanently empty.
 * The proxy is the same hop pdf.js is given, and it needs the same bearer token.
 */
export async function fetchPdfBytesForCache(
  url: string,
  /** Injected so the proxy hop can be tested without a container. */
  getAccessToken: () => Promise<string | null> = () =>
    getContainer().auth.auth.getAccessToken(),
): Promise<ArrayBuffer | null> {
  const target = url.startsWith("/") ? url : proxiedPdfUrl(url);
  // Still cross-origin after the rewrite — an unallowlisted host. CORS would
  // reject it, so do not spend a request on it.
  if (!target.startsWith("/")) return null;

  const headers: Record<string, string> = {};
  if (target.startsWith("/api/pdf-proxy?") && pdfProxyNeedsToken()) {
    const token = await getAccessToken();
    if (!token) return null;
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(target, Object.keys(headers).length ? { headers } : undefined);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  return bytes.byteLength > 0 ? bytes : null;
}

/**
 * Fetch a paper's PDF into the cache on request — the no-account copy's way
 * of getting a document, after the person has said yes. False when the
 * source did not answer with a PDF.
 */
export async function downloadPaperPdfToCache(paperId: string, url: string): Promise<boolean> {
  const cache = getReaderPdfByteCache();
  if (!cache) return false;
  const bytes = await fetchPdfBytesForCache(url);
  if (!bytes) return false;
  await cache.set(paperId, bytes);
  return true;
}

/**
 * Fetch a PDF from an address the person typed, into the cache under the
 * paper's id.
 *
 * An allowlisted host goes through the proxy like any other. Any other
 * https host: the desktop shell's proxy fetches it (`typed=1`, see
 * `apps/desktop/src/pdf-proxy.ts`); a browser has no such relay — the web
 * server's proxy is deliberately allowlisted — so it asks the host directly
 * and gets the PDF only if the host sends CORS headers, which repositories
 * often do and publishers mostly do not. The answer says which it was, so
 * the pane can suggest the file route when the address one is closed.
 */
export async function fetchTypedPdfToCache(
  paperId: string,
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: "no-cache" | "not-pdf" | "blocked" | "failed" }> {
  const cache = getReaderPdfByteCache();
  if (!cache) return { ok: false, reason: "no-cache" };
  let bytes: ArrayBuffer | null = null;
  if (isAllowedPdfProxyUrl(url)) {
    bytes = await fetchPdfBytesForCache(url);
    if (!bytes) return { ok: false, reason: "not-pdf" };
  } else if (desktop() !== null) {
    const res = await fetchFn(`/api/pdf-proxy?url=${encodeURIComponent(url)}&typed=1`);
    if (!res.ok) return { ok: false, reason: res.status === 415 ? "not-pdf" : "failed" };
    bytes = await res.arrayBuffer();
  } else {
    let res: Response;
    try {
      res = await fetchFn(url, { headers: { accept: "application/pdf" } });
    } catch {
      // A network error on a cross-origin fetch is what CORS looks like.
      return { ok: false, reason: "blocked" };
    }
    if (!res.ok) return { ok: false, reason: "failed" };
    bytes = await res.arrayBuffer();
  }
  if (!bytes || !looksLikePdfBytes(bytes)) return { ok: false, reason: "not-pdf" };
  await cache.set(paperId, bytes);
  return { ok: true };
}

/** `%PDF` somewhere in the first kilobyte, the reader's own magic check. */
export function looksLikePdfBytes(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength));
  const text = String.fromCharCode(...head);
  return text.includes("%PDF");
}

async function seedCacheFromUrl(cache: IPdfByteCache, key: string, url: string): Promise<void> {
  try {
    // Only the first open of a paper pays for a second download; afterwards the
    // ladder resolves `cache://` before it ever reaches a network step. pdf.js
    // keeps its own URL so it can still range-request and paint page one early.
    const existing = await cache.get(key);
    if (existing && existing.byteLength > 0) return;
    const bytes = await fetchPdfBytesForCache(url);
    if (bytes) await cache.set(key, bytes);
  } catch {
    /* cache seed is best-effort */
  }
}

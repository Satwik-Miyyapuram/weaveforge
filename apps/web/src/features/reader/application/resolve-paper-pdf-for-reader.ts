/**
 * Resolve a PDF via the ladder and materialise `cache://` hits into blob URLs
 * pdf.js can open. Also seeds the cache when a network URL wins.
 */

import type { IPdfByteCache, PdfSourceResolution } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { IndexedDbPdfByteCache } from "../infrastructure/indexeddb-pdf-byte-cache";
import { resolvePaperPdfSource, paperToPdfSourcePaper } from "./resolve-paper-pdf-source";
import { proxiedPdfUrl } from "./sanitize-reader-url";

const CACHE_CAP = 32;
let sharedCache: IPdfByteCache | null = null;

export function getReaderPdfByteCache(): IPdfByteCache | undefined {
  if (typeof indexedDB === "undefined") return undefined;
  if (!sharedCache) sharedCache = new IndexedDbPdfByteCache(CACHE_CAP);
  return sharedCache;
}

export function isCachePdfUrl(url: string): boolean {
  return url.startsWith("cache://");
}

export async function materializeCachePdfUrl(
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

  // Best-effort: seed cache from a successful remote resolve.
  const remote =
    /^https?:\/\//i.test(resolution.hit.url) || resolution.hit.url.startsWith("/");
  if (cache && paper.id && remote) {
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
  if (target.startsWith("/api/pdf-proxy?")) {
    const token = await getAccessToken();
    if (!token) return null;
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(target, Object.keys(headers).length ? { headers } : undefined);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  return bytes.byteLength > 0 ? bytes : null;
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

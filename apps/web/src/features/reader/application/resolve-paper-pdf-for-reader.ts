/**
 * Resolve a PDF via the ladder and materialise `cache://` hits into blob URLs
 * pdf.js can open. Also seeds the cache when a network URL wins.
 */

import type { IPdfByteCache, PdfSourceResolution } from "@thesis/core";
import { IndexedDbPdfByteCache } from "../infrastructure/indexeddb-pdf-byte-cache";
import { resolvePaperPdfSource, paperToPdfSourcePaper } from "./resolve-paper-pdf-source";

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

/** Resolve + materialise; populate cache when a remote URL wins. */
export async function resolvePaperPdfSourceForReader(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
): Promise<PdfSourceResolution & { revokeUrl?: string }> {
  const cache = getReaderPdfByteCache();
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

  // Best-effort: seed cache from a successful remote resolve (same-origin proxy OK).
  const remote =
    /^https?:\/\//i.test(resolution.hit.url) || resolution.hit.url.startsWith("/");
  if (cache && paper.id && remote) {
    void seedCacheFromUrl(cache, paper.id, resolution.hit.url);
  }

  return resolution;
}

async function seedCacheFromUrl(cache: IPdfByteCache, key: string, url: string): Promise<void> {
  try {
    const existing = await cache.get(key);
    if (existing && existing.byteLength > 0) return;
    const res = await fetch(url);
    if (!res.ok) return;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 0) await cache.set(key, bytes);
  } catch {
    /* cache seed is best-effort */
  }
}

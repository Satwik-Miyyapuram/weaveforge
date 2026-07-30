import type { IPdfSourceResolver, PdfSourceHit, PdfSourcePaper } from "./pdf-source-ladder.js";

export interface IPdfByteCache {
  get(key: string): Promise<ArrayBuffer | null>;
  set(key: string, bytes: ArrayBuffer): Promise<void>;
  /**
   * Drop one entry.
   *
   * Needed to recover from a cached copy that will not open — a truncated or
   * partially written entry is otherwise served again on every visit, and
   * `clear()` is too blunt to use for one bad document.
   */
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Approximate entry count — for tests / diagnostics. */
  size(): Promise<number>;
}

/**
 * In-memory LRU byte cache. The browser IndexedDB implementation lives in the
 * web app and implements the same interface.
 */
export class InMemoryPdfByteCache implements IPdfByteCache {
  private readonly map = new Map<string, ArrayBuffer>();

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("InMemoryPdfByteCache maxEntries must be a positive integer");
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const hit = this.map.get(key);
    if (!hit) return null;
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  async set(key: string, bytes: ArrayBuffer): Promise<void> {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, bytes);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest == null) break;
      this.map.delete(oldest);
    }
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  async size(): Promise<number> {
    return this.map.size;
  }
}

/**
 * Ladder step: return a `cache://<paperId>` hit when bytes are present.
 * Callers that understand the scheme materialise a blob URL; others skip it.
 */
export class PdfByteCacheResolver implements IPdfSourceResolver {
  readonly id = "browser-cache";

  constructor(private readonly cache: IPdfByteCache) {}

  supports(paper: PdfSourcePaper): boolean {
    return Boolean(paper.id);
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const bytes = await this.cache.get(paper.id);
    if (!bytes || bytes.byteLength === 0) return null;
    return { url: `cache://${encodeURIComponent(paper.id)}` };
  }
}

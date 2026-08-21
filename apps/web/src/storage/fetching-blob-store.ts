import type { IBlobStore, IBlobFetcher } from "@weaveforge/core";
import { guessBlobContentType } from "@weaveforge/core";

const FETCH_TTL_S = 300;

/**
 * Reads blobs back out of any {@link IBlobStore}, through a signed URL.
 *
 * Writes pass straight through to the inner store; the additions are the read
 * side, which fetches the bytes and wraps them in a Blob whose content type is
 * guessed from the path when the caller does not know it.
 */
export class FetchingBlobStore implements IBlobFetcher {
  constructor(private readonly inner: IBlobStore) {}

  upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    return this.inner.upload(bucket, path, blob, contentType);
  }

  remove(bucket: string, path: string): Promise<void> {
    return this.inner.remove(bucket, path);
  }

  signedUrls(bucket: string, paths: string[], ttlSeconds: number): Promise<(string | null)[]> {
    return this.inner.signedUrls(bucket, paths, ttlSeconds);
  }

  async fetchBytes(bucket: string, path: string): Promise<Uint8Array> {
    const [url] = await this.inner.signedUrls(bucket, [path], FETCH_TTL_S);
    if (!url) throw new Error(`Blob not found: ${bucket}/${path}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob> {
    const bytes = await this.fetchBytes(bucket, path);
    const type = fallbackContentType ?? guessBlobContentType(path);
    return new Blob([bytes.slice()], { type });
  }

  async fetchBlobs(
    bucket: string,
    paths: readonly string[],
    fallbackContentType?: string,
  ): Promise<Map<string, Blob>> {
    const out = new Map<string, Blob>();
    if (paths.length === 0) return out;
    const urls = await this.inner.signedUrls(bucket, [...paths], FETCH_TTL_S);
    await Promise.all(
      paths.map(async (path, i) => {
        const url = urls[i];
        if (!url) return;
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const bytes = new Uint8Array(await res.arrayBuffer());
          const type = fallbackContentType ?? guessBlobContentType(path);
          out.set(path, new Blob([bytes.slice()], { type }));
        } catch {
          // skip broken assets
        }
      }),
    );
    return out;
  }
}

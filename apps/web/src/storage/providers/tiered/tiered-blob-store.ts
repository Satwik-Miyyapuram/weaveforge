import type { IBlobRegistry, IBlobStore } from "@weaveforge/core";

export interface TieredBlobStoreOptions {
  hot: IBlobStore;
  cold: IBlobStore;
  registry: IBlobRegistry;
  /** Default business priority for new uploads (0–100). */
  defaultPriority?: number;
}

/**
 * Hot/cold facade: new uploads → hot; reads route by registry tier;
 * records access for eviction scoring.
 */
export class TieredBlobStore implements IBlobStore {
  constructor(private readonly opts: TieredBlobStoreOptions) {}

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    await this.opts.hot.upload(bucket, path, blob, contentType);
    await this.opts.registry.register({
      bucket,
      path,
      tier: "hot",
      sizeBytes: blob.size,
      priority: this.opts.defaultPriority ?? 50,
    });
  }

  async remove(bucket: string, path: string): Promise<void> {
    const rec = await this.opts.registry.get(bucket, path);
    if (rec?.tier === "cold") {
      try {
        await this.opts.cold.remove(bucket, path);
      } catch {
        /* best-effort */
      }
    } else {
      try {
        await this.opts.hot.remove(bucket, path);
      } catch {
        /* best-effort */
      }
    }
    await this.opts.registry.remove(bucket, path);
  }

  async signedUrls(
    bucket: string,
    paths: string[],
    ttlSeconds: number,
  ): Promise<(string | null)[]> {
    const records = await Promise.all(paths.map((path) => this.opts.registry.get(bucket, path)));
    return Promise.all(
      paths.map(async (path, i) => {
        const rec = records[i];
        if (!rec) return null;
        const store = rec.tier === "cold" ? this.opts.cold : this.opts.hot;
        const [url] = await store.signedUrls(bucket, [path], ttlSeconds);
        if (url) await this.opts.registry.recordAccess(bucket, path);
        return url ?? null;
      }),
    );
  }
}

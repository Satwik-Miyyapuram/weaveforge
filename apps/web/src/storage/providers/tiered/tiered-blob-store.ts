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

  /**
   * Delete the object, then forget it.
   *
   * In that order, and only in that order. This used to swallow a failure from
   * the underlying store and drop the registry row anyway, which is the one
   * arrangement that loses data silently: the bytes stay in R2 or MinIO, the
   * only row that knew their bucket and path is gone, and nothing can find them
   * again — they keep costing money and keep holding the user's content, with
   * no record that they exist. A delete that fails is recoverable; a delete
   * that fails and forgets is not.
   *
   * Callers that want a failed object delete not to block the rest of their
   * work already wrap this — see `DeletePaperUseCase` and `removeSection`,
   * which are best-effort per image. They keep that behaviour, and now keep a
   * findable row too.
   */
  async remove(bucket: string, path: string): Promise<void> {
    const rec = await this.opts.registry.get(bucket, path);
    const target = rec?.tier === "cold" ? this.opts.cold : this.opts.hot;
    await target.remove(bucket, path);
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

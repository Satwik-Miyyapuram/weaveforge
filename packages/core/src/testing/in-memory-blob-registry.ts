import type { BlobObjectRecord, BlobTier, IBlobRegistry, RegisterBlobInput } from "../storage/blob-registry-ports.js";

/** In-memory {@link IBlobRegistry} for unit tests. */
export class InMemoryBlobRegistry implements IBlobRegistry {
  private readonly rows = new Map<string, BlobObjectRecord>();

  private key(bucket: string, path: string): string {
    return `${bucket}\0${path}`;
  }

  async get(bucket: string, path: string): Promise<BlobObjectRecord | null> {
    const row = this.rows.get(this.key(bucket, path));
    return row ? { ...row } : null;
  }

  async register(input: RegisterBlobInput): Promise<void> {
    const k = this.key(input.bucket, input.path);
    const existing = this.rows.get(k);
    this.rows.set(k, {
      bucket: input.bucket,
      path: input.path,
      tier: input.tier ?? "hot",
      sizeBytes: input.sizeBytes,
      accessCount: existing?.accessCount ?? 0,
      lastAccessedAt: existing?.lastAccessedAt ?? null,
      priority: input.priority ?? 50,
      createdAt: existing?.createdAt ?? new Date(),
    });
  }

  async recordAccess(bucket: string, path: string): Promise<void> {
    const row = this.rows.get(this.key(bucket, path));
    if (!row) return;
    row.accessCount += 1;
    row.lastAccessedAt = new Date();
  }

  async setTier(bucket: string, path: string, tier: BlobTier, sizeBytes?: number): Promise<void> {
    const row = this.rows.get(this.key(bucket, path));
    if (!row) return;
    row.tier = tier;
    if (sizeBytes !== undefined) row.sizeBytes = sizeBytes;
  }

  async remove(bucket: string, path: string): Promise<void> {
    this.rows.delete(this.key(bucket, path));
  }

  async listHot(): Promise<BlobObjectRecord[]> {
    return [...this.rows.values()].filter((r) => r.tier === "hot").map((r) => ({ ...r }));
  }

  async hotBytesTotal(): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.tier === "hot") n += r.sizeBytes;
    }
    return n;
  }
}
